import type { PhotoAsset, PhotoAssetRepository, RecoveryPoint, RestoreJournal } from './model';

export const PHOTO_DB_NAME = 'garden-manager-photos';
export class IndexedDbPhotoRepository implements PhotoAssetRepository {
  private connection?: Promise<IDBDatabase>;
  private readonly factory: IDBFactory | undefined;
  constructor(factory?: IDBFactory, private readonly name = PHOTO_DB_NAME) {
    try { this.factory = factory ?? globalThis.indexedDB; } catch { this.factory = undefined; }
  }
  private open(): Promise<IDBDatabase> {
    if (this.connection) return this.connection;
    this.connection = new Promise<IDBDatabase>((resolve, reject) => {
      if (!this.factory) { reject(new Error('IndexedDB jest niedostępne. Zdjęcia wymagają zezwolenia na lokalną pamięć witryny.')); return; }
      let settled = false;
      const request = this.factory.open(this.name, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('control')) db.createObjectStore('control');
      };
      request.onblocked = () => { settled = true; reject(new Error('Inna karta blokuje magazyn zdjęć. Zamknij pozostałe karty Garden Manager i ponów.')); };
      request.onerror = () => { settled = true; reject(request.error ?? new Error('Nie można otworzyć IndexedDB.')); };
      request.onsuccess = () => {
        if (settled) { request.result.close(); return; }
        const db = request.result;
        db.onversionchange = () => { db.close(); this.connection = undefined; };
        resolve(db);
      };
    }).catch(error => { this.connection = undefined; throw error; });
    return this.connection;
  }
  private async run<T>(names: string[], mode: IDBTransactionMode, action: (tx: IDBTransaction, result: (value: T) => void, fail: (error: Error) => void) => void): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      let value: T, failure: Error | null = null;
      const tx = db.transaction(names, mode);
      tx.oncomplete = () => resolve(value);
      tx.onabort = () => reject(failure ?? tx.error ?? new Error('Operacja IndexedDB została przerwana.'));
      tx.onerror = () => { /* onabort reports the transaction result, including quota errors. */ };
      const fail = (error: Error) => { failure = error; tx.abort(); };
      try { action(tx, result => { value = result; }, fail); } catch (error) { fail(error instanceof Error ? error : new Error('Błąd magazynu zdjęć.')); }
    });
  }
  get(id: string) { return this.run<PhotoAsset | undefined>(['assets'], 'readonly', (tx, done) => { const r = tx.objectStore('assets').get(id); r.onsuccess = () => done(r.result); }); }
  putMany(assets: PhotoAsset[]) { return this.run<void>(['assets'], 'readwrite', tx => { for (const asset of assets) tx.objectStore('assets').add(asset); }); }
  deleteMany(ids: string[]) { return this.run<void>(['assets'], 'readwrite', tx => { for (const id of ids) tx.objectStore('assets').delete(id); }); }
  list() {
    return this.run<{ id: string; createdAt: number }[]>(['assets'], 'readonly', (tx, done) => {
      const rows: { id: string; createdAt: number }[] = [], request = tx.objectStore('assets').openCursor();
      request.onsuccess = () => { const cursor = request.result; if (cursor) { rows.push({ id: cursor.value.id, createdAt: cursor.value.createdAt }); cursor.continue(); } else done(rows); };
    });
  }
  private control<T>(key: string) { return this.run<T | undefined>(['control'], 'readonly', (tx, done) => { const r = tx.objectStore('control').get(key); r.onsuccess = () => done(r.result); }); }
  recovery() { return this.control<RecoveryPoint>('recovery'); }
  journal() { return this.control<RestoreJournal>('journal'); }
  stageRestore(assets: PhotoAsset[], journal: RestoreJournal) {
    return this.run<void>(['assets', 'control'], 'readwrite', (tx, _done, fail) => {
      const control = tx.objectStore('control'), check = control.get('journal');
      check.onsuccess = () => {
        if (check.result) { fail(new Error('Poprzednie odtwarzanie wymaga dokończenia. Ponów po odświeżeniu.')); return; }
        for (const asset of assets) tx.objectStore('assets').add(asset);
        control.put(journal, 'journal');
      };
    });
  }
  finishRestore() {
    return this.run<void>(['control'], 'readwrite', tx => {
      const store = tx.objectStore('control'), request = store.get('journal');
      request.onsuccess = () => { const journal = request.result as RestoreJournal | undefined; if (journal) { const { stagedAssetIds: _staged, ...point } = journal; store.put(point, 'recovery'); store.delete('journal'); } };
    });
  }
  abortRestore(protectedIds: string[]) {
    return this.run<void>(['assets', 'control'], 'readwrite', tx => {
      const control = tx.objectStore('control'), request = control.get('journal');
      request.onsuccess = () => { const journal = request.result as RestoreJournal | undefined; if (journal) { for (const id of journal.stagedAssetIds) if (!protectedIds.includes(id)) tx.objectStore('assets').delete(id); control.delete('journal'); } };
    });
  }
  clearRecovery() { return this.run<void>(['control'], 'readwrite', tx => { tx.objectStore('control').delete('recovery'); }); }
}
