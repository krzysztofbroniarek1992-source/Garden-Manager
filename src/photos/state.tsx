import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Data } from '../domain';
import type { AsyncStore } from '../data/atomic';
import { IndexedDbPhotoRepository } from './assets';
import { BrowserPhotoProcessor } from './images';
import { PhotoService } from './service';
import { photoStorageError, type PhotoAssetRepository, type PhotoDetails, type PhotoInput, type PhotoMetadata, type RecoveryPoint } from './model';
import type { PreparedBackup } from './backup';

interface PhotoContextValue {
  assets: PhotoAssetRepository; ready: boolean; busy: boolean; progress: string; error: string; recovery: RecoveryPoint | undefined;
  add(inputs: PhotoInput[], details: PhotoDetails): Promise<void>;
  edit(photo: PhotoMetadata, details: PhotoDetails): Promise<void>;
  remove(photo: PhotoMetadata): Promise<void>;
  retry(): Promise<void>;
  exportFull(): Promise<Blob>;
  prepare(blob: Blob): Promise<{ prepared: PreparedBackup; expected: string }>;
  importFull(prepared: PreparedBackup, expected: string): Promise<string>;
  exportRecovery(): Promise<Blob>;
  prepareRecovery(): Promise<{ point: RecoveryPoint; expected: string }>;
  restoreRecovery(id: string, expected: string): Promise<string>;
  clearRecovery(id: string): Promise<void>;
}
const PhotoContext = createContext<PhotoContextValue | null>(null);
export function PhotoProvider({ store, metadata, onChange, children }: { store: AsyncStore | null; metadata: PhotoMetadata[]; onChange: (data: Data) => void; children: ReactNode }) {
  const [assets] = useState(() => new IndexedDbPhotoRepository());
  const service = useMemo(() => store ? new PhotoService(store, assets, new BrowserPhotoProcessor()) : null, [store, assets]);
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [progress, setProgress] = useState('');
  const [recovery, setRecovery] = useState<RecoveryPoint>();
  const inFlight = useRef(false);
  const generation = useRef(0);
  const signature = metadata.map(p => `${p.id}:${p.assetId}:${p.deletedAt}`).join('|');
  useEffect(() => {
    if (!service) { setReady(false); setError('Bezpieczna pamięć IndexedDB jest niedostępna. Zapis zdjęć i danych jest zablokowany.'); return; }
    let cancelled = false;
    const started = generation.current;
    const current = () => !cancelled && !inFlight.current && started === generation.current;
    service.reconcile().then(async changed => {
      const point = await service.recovery();
      if (current()) { setReady(true); setRecovery(point); setError(''); if (changed) onChange(service.store.data); }
    }).catch(e => { if (current()) { setError(photoStorageError(e).message); setReady(false); } });
    return () => { cancelled = true; };
  }, [service, signature, onChange]);
  const run = useCallback(async <T,>(action: (service: PhotoService) => Promise<T> | T): Promise<T> => {
    if (!service) throw new Error('Zapis lokalny jest niedostępny. Zachowaj dotychczasowe dane przed naprawą pamięci przeglądarki.');
    if (inFlight.current) throw new Error('Poczekaj na zakończenie bieżącej operacji na zdjęciach.');
    generation.current++;
    inFlight.current = true; setBusy(true); setError(''); setProgress('Trwa przetwarzanie…');
    try { return await action(service); }
    catch (e) { const failure = photoStorageError(e); setError(failure.message); throw failure; }
    finally {
      onChange(service.store.data);
      try { setRecovery(await service.recovery()); } catch (e) { setError(photoStorageError(e).message); }
      generation.current++;
      inFlight.current = false; setBusy(false); setProgress('');
    }
  }, [service, onChange]);
  return <PhotoContext.Provider value={{ assets, ready, busy, progress, error, recovery,
    add: (inputs, details) => run(async s => { await s.add(inputs, details, setProgress); }),
    edit: (photo, details) => run(s => s.edit(photo.id, details, photo.revision)),
    remove: photo => run(s => s.remove(photo)),
    retry: () => run(async s => { await s.reconcile(); setReady(true); }),
    exportFull: () => run(s => s.exportFull()), prepare: blob => run(s => s.prepare(blob)), importFull: (prepared, expected) => run(s => s.importFull(prepared, expected)),
    exportRecovery: () => run(s => s.exportRecovery()), prepareRecovery: () => run(s => s.prepareRecovery()),
    restoreRecovery: (id, expected) => run(s => s.restoreRecovery(id, expected)), clearRecovery: id => run(s => s.clearRecovery(id)),
  }}>{children}</PhotoContext.Provider>;
}
export function usePhotos() { const context = useContext(PhotoContext); if (!context) throw new Error('Brak PhotoProvider.'); return context; }
