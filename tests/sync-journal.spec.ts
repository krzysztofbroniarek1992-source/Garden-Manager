import { expect, test, type Page } from "@playwright/test";
const installation = "11111111-1111-4111-8111-111111111111";
async function open(page: Page) {
  await page.goto("/"); await page.locator(".app-shell").waitFor();
}
async function activate(page: Page) {
  return page.evaluate(async id => {
    const path = "/src/data/atomic.ts", module = await import(path);
    const repo = new module.AtomicRepository(localStorage);
    await repo.initialize();
    const journal = await repo.enableSyncJournal(id); await repo.close();
    return { origin: journal.log.installation, count: journal.log.operations.length };
  }, installation);
}
test("GM-011B real IndexedDB activation preserves v12 and exact source records", async ({ page }) => {
  await open(page);
  const result = await page.evaluate(async id => {
    const path = "/src/data/atomic.ts", { AtomicRepository } = await import(path);
    const repo = new AtomicRepository(localStorage), before = await repo.initialize();
    await repo.enableSyncJournal(id);
    const db = await new Promise<IDBDatabase>((ok, no) => {
      const r = indexedDB.open("garden-manager-state"); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
    });
    const read = (key: string) => new Promise<unknown>((ok, no) => {
      const tx = db.transaction("sync"), r = tx.objectStore("sync").get(key);
      tx.oncomplete = () => ok(r.result); tx.onabort = () => no(tx.error);
    });
    const sources = await Promise.all([read("source-before-db-v2"), read("source-v12-before-activation")]);
    const after = await repo.read(); db.close(); await repo.close();
    return { before, after, sources, version: JSON.parse(localStorage.getItem("garden-manager:v1")!).version };
  }, installation);
  expect(result.after).toEqual(result.before);
  expect(result.sources).toEqual([result.before, result.before]);
  expect(result.version).toBe(12);
});
test("GM-011B two real tabs atomically append independent business commands to one journal", async ({ page, context }) => {
  await open(page); await activate(page);
  const second = await context.newPage(); await open(second);
  const save = (p: Page, id: string) => p.evaluate(async clientId => {
    const path = "/src/data/atomic.ts", { AtomicRepository } = await import(path);
    const repo = new AtomicRepository(localStorage); await repo.initialize();
    await repo.command((s: { saveClient(v: unknown): void }) => s.saveClient({
      id: clientId, name: "Synthetic " + clientId, phone: "", email: "", notes: "",
    }));
    await repo.close();
  }, id);
  await Promise.all([save(page, "sync-synthetic-a"), save(second, "sync-synthetic-b")]);
  const result = await page.evaluate(async () => {
    const path = "/src/data/atomic.ts", { AtomicRepository } = await import(path);
    const repo = new AtomicRepository(localStorage), state = await repo.initialize(), j = await repo.readSyncJournal();
    await repo.close();
    return { revision: state.revision, journalRevision: j.lastRevision, sequence: j.log.operations.map((o: { sequence: number }) => o.sequence),
      clients: state.data.clients.filter((c: { id: string }) => c.id.startsWith("sync-synthetic-")).map((c: { id: string }) => c.id).sort() };
  });
  expect(result.clients).toEqual(["sync-synthetic-a", "sync-synthetic-b"]);
  expect(result.sequence).toEqual([1, 2, 3]);
  expect(result.journalRevision).toBe(result.revision);
});
test("GM-011B native IndexedDB transaction rolls back the business write on synthetic journal quota", async ({ page }) => {
  await open(page); await activate(page);
  const result = await page.evaluate(async () => {
    const path = "/src/data/atomic.ts", { AtomicRepository } = await import(path);
    const repo = new AtomicRepository(localStorage); await repo.initialize();
    const before = await repo.read(), journal = await repo.readSyncJournal(), mirror = localStorage.getItem("garden-manager:v1");
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      if (this.name === "sync" && key === "journal-v1") throw new DOMException("Synthetic quota", "QuotaExceededError");
      return put.call(this, value, key);
    };
    let rejected = false;
    try { await repo.command((s: { setRate(v: number): void }) => s.setRate(999)); }
    catch { rejected = true; } finally { IDBObjectStore.prototype.put = put; }
    const after = await repo.read(), afterJournal = await repo.readSyncJournal();
    const result = { rejected, before, after, journal, afterJournal, mirrorSame: mirror === localStorage.getItem("garden-manager:v1") };
    await repo.close(); return result;
  });
  expect(result.rejected).toBe(true); expect(result.after).toEqual(result.before);
  expect(result.afterJournal).toEqual(result.journal); expect(result.mirrorSame).toBe(true);
});
test("GM-011B real restart retains source counter and does not accept a legacy writer", async ({ page }) => {
  await open(page); await activate(page);
  await page.evaluate(async () => {
    const path = "/src/data/atomic.ts", { AtomicRepository } = await import(path);
    const repo = new AtomicRepository(localStorage); await repo.initialize();
    await repo.command((s: { setRate(v: number): void }) => s.setRate(140)); await repo.close();
  });
  await page.reload(); await page.locator(".app-shell").waitFor();
  const result = await page.evaluate(async () => {
    const legacy = await new Promise<string>((ok) => {
      const r = indexedDB.open("garden-manager-state", 1);
      r.onerror = () => ok(r.error?.name ?? "unknown");
      r.onsuccess = () => { r.result.close(); ok("unexpected"); };
    });
    const path = "/src/data/atomic.ts", { AtomicRepository } = await import(path);
    const repo = new AtomicRepository(localStorage); const state = await repo.initialize(), j = await repo.readSyncJournal();
    await repo.close(); return { legacy, rate: state.data.settings.hourlyRate, origin: j.log.installation, next: j.log.nextSequence };
  });
  expect(result).toEqual({ legacy: "VersionError", rate: 140, origin: installation, next: 3 });
});
test("GM-011B failed activation preserves the current record and can be retried", async ({ page }) => {
  await open(page);
  const result = await page.evaluate(async id => {
    const path = "/src/data/atomic.ts", { AtomicRepository } = await import(path);
    const repo = new AtomicRepository(localStorage), before = await repo.initialize();
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      if (this.name === "sync" && key === "journal-v1") throw new DOMException("Synthetic activation quota", "QuotaExceededError");
      return put.call(this, value, key);
    };
    let rejected = false;
    try { await repo.enableSyncJournal(id); } catch { rejected = true; } finally { IDBObjectStore.prototype.put = put; }
    const after = await repo.read(), noJournal = (await repo.readSyncJournal()) === null;
    const retried = await repo.enableSyncJournal(id); await repo.close();
    return { rejected, before, after, noJournal, count: retried.log.operations.length };
  }, installation);
  expect(result.rejected).toBe(true); expect(result.after).toEqual(result.before);
  expect(result.noJournal).toBe(true); expect(result.count).toBe(1);
});
test("GM-011B real photo blobs and full ZIP remain separate from journal identity, restore requires review", async ({ page }) => {
  await open(page);
  const result = await page.evaluate(async id => {
    const a = "/src/data/atomic.ts", p = "/src/photos/assets.ts", b = "/src/photos/backup.ts";
    const { AtomicRepository } = await import(a), { IndexedDbPhotoRepository } = await import(p);
    const { makeFullBackup, readFullBackup } = await import(b);
    const repo = new AtomicRepository(localStorage), state = await repo.initialize(), assets = new IndexedDbPhotoRepository();
    const canvas = document.createElement("canvas"); canvas.width = 1; canvas.height = 1;
    canvas.getContext("2d")!.fillRect(0, 0, 1, 1);
    const image = await new Promise<Blob>(ok => canvas.toBlob(v => ok(v!), "image/jpeg"));
    const hash = async (blob: Blob) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())))
      .map(n => n.toString(16).padStart(2, "0")).join("");
    const sha = await hash(image), now = Date.now();
    await assets.putMany([{ id: "sync-synthetic-asset", image, thumbnail: image, createdAt: now }]);
    const photo = { id: "sync-synthetic-photo", assetId: "sync-synthetic-asset", filename: "synthetic.jpg",
      clientId: state.data.clients[0].id, gardenId: null, zoneId: null, jobId: null,
      clientName: state.data.clients[0].name, gardenName: null, zoneName: null, jobTitle: null,
      category: "before", description: "Synthetic pixel", capturedDate: null, addedAt: now, updatedAt: now,
      deletedAt: null, revision: 1, mimeType: "image/jpeg", width: 1, height: 1, thumbnailWidth: 1, thumbnailHeight: 1,
      size: image.size, thumbnailSize: image.size, sha256: sha, thumbnailSha256: sha };
    await repo.command((s: { appendPhotos(p: unknown[]): void }) => s.appendPhotos([photo]));
    const before = (await repo.read()).data;
    await repo.enableSyncJournal(id);
    const zip = await makeFullBackup(before, assets), restored = await readFullBackup(zip);
    await repo.command((s: { setRate(v: number): void }) => s.setRate(199));
    const expected = JSON.stringify((await repo.read()).data);
    await repo.command((s: { restoreSnapshot(d: unknown, expected: string): void }) => s.restoreSnapshot(restored.data, expected));
    const after = (await repo.read()).data, journal = await repo.readSyncJournal(), asset = await assets.get("sync-synthetic-asset");
    await repo.close();
    return { photosSame: JSON.stringify(after.photos) === JSON.stringify(before.photos), imageSame: await hash(asset.image) === sha,
      restoredPhotos: restored.assets.length, businessCopyHasIdentity: JSON.stringify(restored.data).includes(id),
      journalHasPhotoId: JSON.stringify(journal.log).includes("sync-synthetic-photo"),
      mode: journal.mode, restoreCount: journal.restoreCount, version: JSON.parse(localStorage.getItem("garden-manager:v1")!).version };
  }, installation);
  expect(result).toEqual({ photosSame: true, imageSame: true, restoredPhotos: 1, businessCopyHasIdentity: false,
    journalHasPhotoId: false, mode: "restore-review", restoreCount: 1, version: 12 });
});
