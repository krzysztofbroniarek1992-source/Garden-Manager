import { GardenStore } from '../data/store';
import { pauseActiveTimer, type Data } from '../domain';
import { validateData, withDeskData, withChecklistData } from '../data/repository';
import { makeFullBackup, readFullBackup, type PreparedBackup } from './backup';
import { photoLimits, resolvePhotoScope, type PhotoAssetRepository, type PhotoDetails, type PhotoInput, type PhotoMetadata, type PhotoProcessor, type PreparedImage, type RecoveryPoint } from './model';

let queue: Promise<unknown> = Promise.resolve();
async function locked<T>(action: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request('garden-manager-photos', action);
  const next = queue.then(action, action); queue = next.catch(() => {}); return next;
}
const refs = (data: Data) => data.photos.map(p => p.assetId);
export class PhotoService {
  constructor(readonly store: GardenStore, readonly assets: PhotoAssetRepository, private readonly processor: PhotoProcessor, private readonly clock = Date.now) {}
  async add(inputs: PhotoInput[], details: PhotoDetails, progress?: (message: string) => void) {
    if (!inputs.length || inputs.length > photoLimits.batch) throw new Error('Wybierz od 1 do 20 zdjęć jednocześnie.');
    const prepared: PreparedImage[] = [];
    for (const [index, input] of inputs.entries()) { progress?.(`Przygotowywanie zdjęcia ${index + 1} z ${inputs.length}…`); prepared.push(await this.processor.process(input)); }
    return locked(async () => {
      const data = this.store.snapshot(), scope = resolvePhotoScope(data, details), now = this.clock();
      const metadata: PhotoMetadata[] = prepared.map((p, index) => ({ id: crypto.randomUUID(), assetId: crypto.randomUUID(), filename: inputs[index].name.slice(0, 200), ...details, ...scope,
        addedAt: now, updatedAt: now, deletedAt: null, revision: 1, mimeType: 'image/jpeg', width: p.width, height: p.height, thumbnailWidth: p.thumbnailWidth, thumbnailHeight: p.thumbnailHeight,
        size: p.image.size, thumbnailSize: p.thumbnail.size, sha256: p.sha256, thumbnailSha256: p.thumbnailSha256 }));
      const assets = prepared.map((p, index) => ({ id: metadata[index].assetId, image: p.image, thumbnail: p.thumbnail, createdAt: now }));
      await this.assets.putMany(assets);
      try { this.store.appendPhotos(metadata); } catch (error) {
        try { await this.assets.deleteMany(assets.map(a => a.id)); } catch { /* Unreferenced staged files are reclaimed on the next successful reconciliation. */ }
        throw error;
      }
      return metadata;
    });
  }
  edit(id: string, details: PhotoDetails, revision: number) { this.store.editPhoto(id, details, revision); }
  async remove(photo: PhotoMetadata) {
    return locked(async () => { this.store.markPhotoDeleted(photo.id, photo.revision); await this.reconcileUnlocked(); });
  }
  private async reconcileUnlocked(): Promise<boolean> {
    const journal = await this.assets.journal();
    if (journal) {
      const data = this.store.snapshot();
      if (data.photoRestoreId === journal.id) await this.assets.finishRestore();
      else { const recovery = await this.assets.recovery(); await this.assets.abortRestore([...refs(data), ...(recovery ? refs(recovery.data) : [])]); }
    }
    const recovery = await this.assets.recovery();
    const retained = new Set(recovery ? refs(recovery.data) : []);
    const deleted = this.store.snapshot().photos.filter(p => p.deletedAt !== null);
    if (deleted.length) { await this.assets.deleteMany(deleted.filter(p => !retained.has(p.assetId)).map(p => p.assetId)); this.store.finalizePhotoDeletion(deleted.map(p => p.id)); }
    const protectedIds = new Set([...refs(this.store.snapshot()), ...(recovery ? refs(recovery.data) : [])]);
    const immediate = typeof navigator === 'undefined' || !!navigator.locks;
    const orphans = (await this.assets.list()).filter(a => !protectedIds.has(a.id) && (immediate || a.createdAt < this.clock() - 600_000));
    if (orphans.length) await this.assets.deleteMany(orphans.map(a => a.id));
    return deleted.length > 0 || !!journal;
  }
  reconcile() { return locked(() => this.reconcileUnlocked()); }
  exportFull() { return locked(async () => { await this.reconcileUnlocked(); return makeFullBackup(this.store.snapshot(), this.assets, this.clock()); }); }
  async prepare(blob: Blob) {
    let prepared: PreparedBackup;
    try { prepared = await readFullBackup(blob); } catch (error) {
      if (error instanceof SyntaxError || error instanceof Error && /invalid zip|unexpected eof|invalid distance|invalid length/i.test(error.message)) throw new Error('Nie można odczytać pełnej kopii ZIP. Plik jest uszkodzony lub nie jest kopią Garden Manager.');
      throw error;
    }
    const current = this.store.snapshot();
    if (current.timer) throw new Error('Przed odtwarzaniem zakończ pomiar wizyty przyciskiem STOP.');
    if (await this.assets.recovery()) throw new Error('Najpierw pobierz lub przywróć zachowany punkt odzyskiwania, a następnie usuń go przed kolejnym importem.');
    return { prepared, expected: JSON.stringify(current) };
  }
  private async restore(prepared: PreparedBackup, expected: string, isRecovery: boolean) {
    await this.reconcileUnlocked();
    const current = this.store.snapshot();
    if (JSON.stringify(current) !== expected) throw new Error('Dane zmieniły się od sprawdzenia kopii. Wczytaj kopię ponownie przed potwierdzeniem.');
    if (current.timer) throw new Error('Przed odtwarzaniem zakończ pomiar wizyty przyciskiem STOP.');
    if (!isRecovery && await this.assets.recovery()) throw new Error('Zachowano już poprzedni punkt odzyskiwania. Pobierz go i usuń przed kolejnym importem.');
    const token = crypto.randomUUID(), now = this.clock();
    const remap = new Map(prepared.assets.map(a => [a.id, crypto.randomUUID()]));
    const assets = prepared.assets.map(a => ({ ...a, id: remap.get(a.id)!, createdAt: now }));
    let replacement = structuredClone(prepared.data);
    replacement = { ...replacement, photos: replacement.photos.map(p => ({ ...p, assetId: remap.get(p.assetId) ?? p.assetId })), photoRestoreId: token };
    if (replacement.timer && !replacement.timer.paused) replacement = pauseActiveTimer(replacement, prepared.createdAt);
    validateData(replacement);
    await this.assets.stageRestore(assets, { id: token, data: current, createdAt: now, stagedAssetIds: assets.map(a => a.id) });
    try { this.store.restoreSnapshot(replacement, expected); } catch (error) {
      const point = await this.assets.recovery();
      try { await this.assets.abortRestore([...refs(this.store.snapshot()), ...(point ? refs(point.data) : [])]); } catch { /* Durable journal recovers an interrupted import on next open. */ }
      throw error;
    }
    try { await this.assets.finishRestore(); return ''; }
    catch { return 'Dane i zdjęcia zostały odtworzone. Ponów porządkowanie, aby dokończyć zapis punktu odzyskiwania.'; }
  }
  importFull(prepared: PreparedBackup, expected: string) { return locked(() => this.restore(prepared, expected, false)); }
  async recovery() { const point = await this.assets.recovery(); if (!point) return undefined; const data = withChecklistData(withDeskData(point.data)); validateData(data); return { ...point, data }; }
  exportRecovery() { return locked(async () => { const point = await this.recovery(); if (!point) throw new Error('Brak punktu odzyskiwania.'); return makeFullBackup(point.data, this.assets, point.createdAt); }); }
  async prepareRecovery(): Promise<{ point: RecoveryPoint; expected: string }> {
    const point = await this.recovery(); if (!point) throw new Error('Brak punktu odzyskiwania.');
    validateData(point.data); return { point, expected: JSON.stringify(this.store.snapshot()) };
  }
  restoreRecovery(id: string, expected: string) { return locked(async () => {
    const point = await this.recovery(); if (!point || point.id !== id) throw new Error('Punkt odzyskiwania zmienił się. Wczytaj go ponownie.');
    return this.restore({ data: point.data, assets: [], createdAt: point.createdAt }, expected, true);
  }); }
  clearRecovery(id: string) { return locked(async () => {
    const point = await this.assets.recovery(); if (!point || point.id !== id) throw new Error('Punkt odzyskiwania zmienił się.');
    await this.assets.clearRecovery(); await this.reconcileUnlocked();
  }); }
}
