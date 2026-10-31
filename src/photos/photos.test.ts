import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { createDemoData } from '../data/demo';
import { GardenStore } from '../data/store';
import { LocalRepository, STORAGE_KEY, STORAGE_VERSION, V5_BACKUP_KEY, type StoragePort } from '../data/repository';
import { IndexedDbPhotoRepository } from './assets';
import { imageDimensions, resizedDimensions, sha256, BrowserPhotoProcessor } from './images';
import { makeFullBackup, readFullBackup } from './backup';
import { PhotoService } from './service';
import { matchesPhotoScope, photoDate, photoStorageError, type PhotoAsset, type PhotoDetails, type PhotoProcessor } from './model';

class MemoryStorage implements StoragePort {
  values = new Map<string, string>(); fail = false;
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { if (this.fail && key === STORAGE_KEY) throw new Error('QuotaExceededError'); this.values.set(key, value); }
}
const jpeg = new Blob([new Uint8Array([255,216,255,192,0,17,8,0,2,0,3,3,1,17,0,2,17,0,3,17,0,255,217])], { type: 'image/jpeg' });
const details: PhotoDetails = { clientId: 'client-1', gardenId: 'garden-1', zoneId: null, jobId: 'job-1', category: 'before', description: 'Przed koszeniem', capturedDate: '2026-10-30' };
class FaultyAssets extends IndexedDbPhotoRepository {
  failPut = false; failDelete = false; failFinish = false;
  override putMany(assets: PhotoAsset[]) { if (this.failPut) return Promise.reject(new DOMException('Disk full', 'QuotaExceededError')); return super.putMany(assets); }
  override deleteMany(ids: string[]) { if (this.failDelete) return Promise.reject(new Error('IndexedDB unavailable')); return super.deleteMany(ids); }
  override finishRestore() { if (this.failFinish) return Promise.reject(new Error('IndexedDB unavailable')); return super.finishRestore(); }
}
async function fixture() {
  const storage = new MemoryStorage(), store = new GardenStore(new LocalRepository(storage));
  const assets = new FaultyAssets(new IDBFactory());
  const digest = await sha256(jpeg);
  const processor: PhotoProcessor = { process: async () => ({ image: jpeg, thumbnail: jpeg, width: 3, height: 2, thumbnailWidth: 3, thumbnailHeight: 2, sha256: digest, thumbnailSha256: digest }) };
  let now = Date.now(); const service = new PhotoService(store, assets, processor, () => now);
  const add = () => service.add([{ blob: jpeg, name: 'ogrod.jpg' }], details);
  return { storage, store, assets, service, processor, add, advance: () => { now += 700000; } };
}

describe('zdjęcia i IndexedDB', () => {
  it('przechowuje bloby i miniatury osobno, a w localStorage wyłącznie metadane', async () => {
    const { add, storage, store, assets } = await fixture(); const before = structuredClone(store.data);
    const [photo] = await add(); const asset = await assets.get(photo.assetId);
    expect(asset!.image).toBeInstanceOf(Blob); expect(asset!.thumbnail).toBeInstanceOf(Blob);
    expect(await asset!.image.arrayBuffer()).toEqual(await jpeg.arrayBuffer());
    expect(storage.getItem(STORAGE_KEY)).not.toMatch(/base64|data:image|blob:/);
    expect(store.data.jobs).toEqual(before.jobs); expect(store.data.payments).toEqual(before.payments); expect(store.data.taskSchedules).toEqual(before.taskSchedules);
    expect(new LocalRepository(storage).load().photos).toEqual([photo]);
  });
  it('atomowy zapis wielu plików w IndexedDB nie nadpisuje istniejących ID', async () => {
    const { assets } = await fixture(); const a = { id: 'one', image: jpeg, thumbnail: jpeg, createdAt: 1 };
    await assets.putMany([a]); await expect(assets.putMany([{ ...a, id: 'two' }, a])).rejects.toThrow();
    expect((await assets.list()).map(a => a.id)).toEqual(['one']);
  });
  it('kategoria, opis, data i powiązania zmieniają się bez ponownego zapisu zdjęcia', async () => {
    const { add, service, store, assets } = await fixture(); const [photo] = await add();
    service.edit(photo.id, { ...details, category: 'after', description: 'Po pracy', capturedDate: '2026-10-31', jobId: null }, photo.revision);
    const updated = store.data.photos[0]; expect(updated).toMatchObject({ category: 'after', description: 'Po pracy', jobId: null, capturedDate: '2026-10-31', assetId: photo.assetId });
    expect(await assets.get(photo.assetId)).toBeDefined();
    expect(() => service.edit(photo.id, details, photo.revision)).toThrow('innej karcie');
    expect(matchesPhotoScope(updated, { gardenId: 'garden-1' })).toBe(true); expect(matchesPhotoScope(updated, { jobId: 'job-1' })).toBe(false);
    expect(photoDate(updated)).toBe('2026-10-31');
  });
  it('nie zapisuje metadanych przy błędzie IndexedDB lub braku miejsca', async () => {
    const { add, assets, store } = await fixture(); assets.failPut = true;
    await expect(add()).rejects.toMatchObject({ name: 'QuotaExceededError' }); expect(store.data.photos).toEqual([]); expect(await assets.list()).toEqual([]);
    expect(photoStorageError(new DOMException('Disk full', 'QuotaExceededError')).message).toContain('Brak miejsca');
  });
  it('wycofuje pliki po błędzie localStorage i zachowuje dane źródłowe', async () => {
    const { add, assets, storage, store } = await fixture(); const original = storage.getItem(STORAGE_KEY); storage.fail = true;
    await expect(add()).rejects.toThrow(); expect(await assets.list()).toEqual([]); expect(storage.getItem(STORAGE_KEY)).toBe(original); expect(store.data.photos).toEqual([]);
  });
  it('bezpiecznie usuwa zdjęcie i miniaturę', async () => {
    const { add, service, assets, store } = await fixture(); const [photo] = await add(); await service.remove(photo);
    expect(store.data.photos).toEqual([]); expect(await assets.get(photo.assetId)).toBeUndefined();
  });
  it('odtwarza przerwane usuwanie po awarii IndexedDB bez osieroconych plików', async () => {
    const { add, service, assets, store, processor } = await fixture(); const [photo] = await add(); assets.failDelete = true;
    await expect(service.remove(photo)).rejects.toThrow(); expect(store.data.photos[0].deletedAt).not.toBeNull(); expect(await assets.get(photo.assetId)).toBeDefined();
    assets.failDelete = false; await new PhotoService(store, assets, processor).reconcile(); expect(store.data.photos).toEqual([]); expect(await assets.list()).toEqual([]);
  });
  it('błąd oznaczenia usunięcia w localStorage nie kasuje pliku', async () => {
    const { add, service, storage, assets, store } = await fixture(); const [photo] = await add(); storage.fail = true;
    await expect(service.remove(photo)).rejects.toThrow(); expect(store.data.photos[0].deletedAt).toBeNull(); expect(await assets.get(photo.assetId)).toBeDefined();
  });
  it('usuwa osierocone pliki po przerwanym dodawaniu, zachowując aktywne', async () => {
    const { add, service, assets } = await fixture(); const [photo] = await add(); await assets.putMany([{ id: 'orphan', image: jpeg, thumbnail: jpeg, createdAt: 0 }]);
    await service.reconcile(); expect(await assets.get('orphan')).toBeUndefined(); expect(await assets.get(photo.assetId)).toBeDefined();
  });
  it('usunięcie strefy i zlecenia pozostawia dokumentację w ogrodzie', async () => {
    const { add, service, store, assets } = await fixture(); store.saveZone('garden-1', { id: 'zone', name: 'Rabata', type: 'rabata', area: 5, length: null, plants: '', requirements: '', treatments: '' });
    const [photo] = await service.add([{ blob: jpeg, name: 'rabata.jpg' }], { ...details, zoneId: 'zone' });
    store.deleteZone('garden-1', 'zone'); store.deleteJob('job-1'); await service.reconcile();
    expect(store.data.photos[0]).toMatchObject({ zoneId: null, zoneName: 'Rabata', jobId: null, jobTitle: 'Pielęgnacja ogrodu', gardenId: 'garden-1' }); expect(await assets.get(photo.assetId)).toBeDefined();
    expect(store.data.jobs.some(j => j.id === 'job-2')).toBe(true);
    await expect(add()).rejects.toThrow('zlecenia');
  });
  it('usunięcie klienta usuwa jego zdjęcia po potwierdzeniu polecenia i sprząta pliki', async () => {
    const { service, store, assets } = await fixture(); store.saveClient({ id: 'empty', name: 'Klient', phone: '', email: '', notes: '' });
    const [photo] = await service.add([{ blob: jpeg, name: 'klient.jpg' }], { ...details, clientId: 'empty', gardenId: null, jobId: null });
    store.deleteClient('empty'); await service.reconcile(); expect(await assets.get(photo.assetId)).toBeUndefined(); expect(store.data.photos).toEqual([]);
  });
  it('przeniesienie zlecenia między ogrodami aktualizuje powiązanie zdjęcia', async () => {
    const { add, store } = await fixture(); await add(); store.saveJob({ ...store.data.jobs[0], gardenId: 'garden-2' });
    expect(store.data.photos[0]).toMatchObject({ gardenId: 'garden-2', clientId: 'client-2', zoneId: null, jobId: 'job-1' });
  });
});

describe('pełna kopia i odtwarzanie', () => {
  it('ZIP zawiera dane, zdjęcie i miniaturę z poprawnymi sumami kontrolnymi', async () => {
    const { add, service, store } = await fixture(); await add(); const full = await service.exportFull(); const prepared = await readFullBackup(full);
    expect(prepared.data).toEqual(store.data); expect(prepared.assets).toHaveLength(1); expect(await sha256(prepared.assets[0].image)).toBe(store.data.photos[0].sha256);
    const files = unzipSync(new Uint8Array(await full.arrayBuffer())); expect(Object.keys(files)).toHaveLength(4);
  });
  it('pełne odtworzenie zachowuje poprzednie dane i pliki w punkcie odzyskiwania', async () => {
    const source = await fixture(); await source.add(); const archive = await source.service.exportFull();
    const target = await fixture(); await target.add(); target.store.saveClient({ ...target.store.data.clients[0], name: 'Poprzedni klient' }); const previous = structuredClone(target.store.data);
    const preview = await target.service.prepare(archive); await target.service.importFull(preview.prepared, preview.expected);
    expect(target.store.data.clients).toEqual(source.store.data.clients); expect(target.store.data.photos[0].id).toBe(source.store.data.photos[0].id); expect(target.store.data.photos[0].assetId).not.toBe(source.store.data.photos[0].assetId);
    expect((await target.assets.recovery())!.data).toEqual(previous); expect(await target.assets.get(previous.photos[0].assetId)).toBeDefined();
    const recovery = await target.service.prepareRecovery(); await target.service.restoreRecovery(recovery.point.id, recovery.expected); expect(target.store.data.clients[0].name).toBe('Poprzedni klient');
    expect(target.store.data.photos[0].assetId).toBe(previous.photos[0].assetId);
  });
  it('przywrócenie nie uruchamia starego stopera i nie nalicza dni od wykonania kopii', async () => {
    const source = await fixture(); source.store.startTimer('job-1'); const archive = await source.service.exportFull();
    const target = await fixture(); const p = await target.service.prepare(archive); await target.service.importFull(p.prepared, p.expected);
    expect(target.store.data.timer!.paused).toBe(true); expect(target.store.data.jobs[0].seconds).toBeLessThan(5);
  });
  it('odmawia nadpisania danych zmienionych po podglądzie kopii', async () => {
    const { add, service, store, assets } = await fixture(); await add(); const p = await service.prepare(await service.exportFull());
    store.saveClient({ ...store.data.clients[0], notes: 'Nowa informacja' }); await expect(service.importFull(p.prepared, p.expected)).rejects.toThrow('zmieniły');
    expect(store.data.clients[0].notes).toBe('Nowa informacja'); expect(await assets.recovery()).toBeUndefined(); expect((await assets.list()).length).toBe(1);
  });
  it('błąd localStorage przy odtwarzaniu wycofuje nowe pliki bez zmiany poprzedniego zestawu', async () => {
    const { add, service, store, storage, assets } = await fixture(); await add(); const before = structuredClone(store.data); const p = await service.prepare(await service.exportFull()); storage.fail = true;
    await expect(service.importFull(p.prepared, p.expected)).rejects.toThrow(); expect(storage.getItem(STORAGE_KEY)).toBe(JSON.stringify({ version: STORAGE_VERSION, data: before })); expect((await assets.list()).length).toBe(1); expect(await assets.journal()).toBeUndefined();
  });
  it('dziennik kończy zatwierdzone odtwarzanie po awarii finalizacji IndexedDB', async () => {
    const { add, service, assets, store, processor } = await fixture(); await add(); const p = await service.prepare(await service.exportFull()); assets.failFinish = true;
    const warning = await service.importFull(p.prepared, p.expected); expect(warning).toContain('odtworzone'); expect(await assets.journal()).toBeDefined();
    assets.failFinish = false; await new PhotoService(store, assets, processor).reconcile(); expect(await assets.journal()).toBeUndefined(); expect(await assets.recovery()).toBeDefined();
  });
  it('przy starcie wycofuje niezatwierdzone odtwarzanie, nie kasując aktywnych zdjęć', async () => {
    const { add, service, assets, store } = await fixture(); const [photo] = await add();
    await assets.stageRestore([{ id: 'staged', image: jpeg, thumbnail: jpeg, createdAt: 0 }], { id: 'not-committed', data: store.data, createdAt: 1, stagedAssetIds: ['staged'] });
    await service.reconcile(); expect(await assets.get('staged')).toBeUndefined(); expect(await assets.get(photo.assetId)).toBeDefined(); expect(await assets.journal()).toBeUndefined();
  });
  it('punkt odzyskiwania chroni stare pliki aż do jawnego usunięcia punktu', async () => {
    const source = await fixture(); const target = await fixture(); const [old] = await target.add();
    const p = await target.service.prepare(await source.service.exportFull()); await target.service.importFull(p.prepared, p.expected);
    expect(await target.assets.get(old.assetId)).toBeDefined(); const point = await target.assets.recovery(); await target.service.clearRecovery(point!.id);
    expect(await target.assets.get(old.assetId)).toBeUndefined();
  });
  it('nie przedstawia kopii z brakującym plikiem jako pełnej', async () => {
    const { add, service, assets } = await fixture(); const [photo] = await add(); await assets.deleteMany([photo.assetId]); await expect(service.exportFull()).rejects.toThrow('brak');
  });
  it('odrzuca plik ZIP z uszkodzonym zdjęciem', async () => {
    const { add, service } = await fixture(); await add(); const archive = await service.exportFull(); const files = unzipSync(new Uint8Array(await archive.arrayBuffer()));
    const path = Object.keys(files).find(name => name.endsWith('image.jpg'))!; files[path][files[path].length - 1] ^= 1;
    await expect(readFullBackup(new Blob([zipSync(files).slice().buffer]))).rejects.toThrow('Uszkodzony');
  });
  it.each(['../data.json', '/tmp/evil.jpg', 'photos/x/unexpected.svg'])('odrzuca niedozwoloną ścieżkę %s', async path => {
    await expect(readFullBackup(new Blob([zipSync({ [path]: strToU8('unsafe') }).slice().buffer]))).rejects.toThrow('ścieżki');
  });
  it('odrzuca ZIP przekraczający limit przed rozpakowaniem pliku', async () => {
    const large = new Uint8Array(3 * 1024 ** 2 + 1); const zip = zipSync({ 'photos/x/image.jpg': large });
    await expect(readFullBackup(new Blob([zip.slice().buffer]))).rejects.toThrow('limity');
  });
});

describe('migracja i przygotowanie plików', () => {
  it.each([1,2,3,4,5])('migruje v%s bez zmiany starych danych', version => {
    const storage = new MemoryStorage(); const { photos: _p, photoRestoreId: _r, ...old } = createDemoData();
    const raw = JSON.stringify({ version, data: old }); storage.setItem(STORAGE_KEY, raw);
    const migrated = new LocalRepository(storage).load(); expect(migrated.photos).toEqual([]); expect(migrated.photoRestoreId).toBeNull(); expect(migrated.clients).toEqual(old.clients); expect(migrated.gardens).toEqual(old.gardens); expect(migrated.materialCatalog).toEqual(old.materialCatalog);
    if (version >= 3) { expect(migrated.jobs).toEqual(old.jobs); expect(migrated.taskSchedules).toEqual(old.taskSchedules); }
    expect(storage.getItem(`garden-manager:backup:v${version}`)).toBe(raw);
  });
  it('zachowuje źródło v5 przy błędzie kopii bezpieczeństwa', () => {
    const storage = new MemoryStorage(); const raw = JSON.stringify({ version: 5, data: createDemoData() }); storage.setItem(STORAGE_KEY, raw);
    const write = storage.setItem.bind(storage); storage.setItem = (key,value) => { if (key === V5_BACKUP_KEY) throw new Error('Full'); write(key,value); };
    expect(() => new LocalRepository(storage).load()).toThrow('kopii'); expect(storage.getItem(STORAGE_KEY)).toBe(raw);
  });
  it('zmniejsza wymiary bez powiększania małych zdjęć i blokuje nadmierną liczbę pikseli', () => {
    expect(resizedDimensions(4000,3000,1920)).toEqual({ width: 1920, height: 1440 }); expect(resizedDimensions(100,80,320)).toEqual({ width: 100, height: 80 }); expect(() => resizedDimensions(100000,100000,1920)).toThrow('50');
  });
  it('rozpoznaje JPEG po zawartości i odrzuca aktywne lub nieobsługiwane formaty', async () => {
    expect(imageDimensions(new Uint8Array(await jpeg.arrayBuffer()))).toEqual({ width: 3, height: 2, mime: 'image/jpeg' });
    await expect(new BrowserPhotoProcessor().process({ blob: new Blob(['<svg onload="alert(1)"/>'], { type: 'image/jpeg' }), name: 'fake.jpg' })).rejects.toThrow('JPEG');
    await expect(new BrowserPhotoProcessor().process({ blob: new Blob(), name: 'empty.jpg' })).rejects.toThrow('25 MB');
  });
});
