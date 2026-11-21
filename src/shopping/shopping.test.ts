import { readJsonBackup } from "../photos/json-backup";
import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { createDemoData } from "../data/demo";
import { AtomicRepository } from "../data/atomic";
import { LocalRepository, STORAGE_KEY, STORAGE_VERSION, validateData } from "../data/repository";
import { saveExpense } from "../expenses/commands";
import { otherCategory, type Expense } from "../expenses/model";
import { makeFullBackup, readFullBackup } from "../photos/backup";
import { IndexedDbPhotoRepository } from "../photos/assets";
import { imageDimensions, sha256 } from "../photos/images";
import { addShoppingBatch, createShoppingExpense, linkShoppingExpense, repeatShopping, saveShopping, shoppingAction } from "./commands";
import { newShoppingItem, quantityMilli, quantityText, shoppingTotal } from "./model";
const at = Date.parse("2026-11-10T10:00:00Z");
const seed = () => createDemoData(new Date(at));
const expense = (): Expense => ({ id: crypto.randomUUID(), revision: 1, createdAt: 0, updatedAt: 0, date: "2026-11-10", amountCents: 100, direction: "outgoing", counterparty: "Firma", description: "Zakup", categoryId: otherCategory, source: "manual", origin: null, status: "approved", note: "", history: [] });
const added = () => addShoppingBatch(seed(), [{ ...newShoppingItem("Kora"), jobId: "job-1", quantityMilli: 2500, plannedPrice: { amountCents: 1234, basis: "unit" } }], at);
class Memory {
  values = new Map<string, string>();
  getItem(k: string) { return this.values.get(k) ?? null; }
  setItem(k: string, v: string) { this.values.set(k, v); }
}
async function record(factory: IDBFactory, key: string, put?: unknown) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const r = factory.open("garden-manager-state", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("state");
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });
  try {
    return await new Promise<any>((resolve, reject) => {
      const t = db.transaction("state", put === undefined ? "readonly" : "readwrite");
      const r = put === undefined ? t.objectStore("state").get(key) : t.objectStore("state").put(put, key);
      t.oncomplete = () => resolve(r.result); t.onabort = () => reject(t.error);
    });
  } finally { db.close(); }
}
describe("GM-010A exact quantities and independent company purchases", () => {
  it("calculates exact milli-units and integer cents, including a fractional grosz and a total-price override", () => {
    expect(quantityMilli("2,501")).toBe(2501); expect(quantityText(2501)).toBe("2,501");
    expect(shoppingTotal({ amountCents: 1234, basis: "unit" }, 2500)).toBe(3085);
    expect(shoppingTotal({ amountCents: 1, basis: "unit" }, 500)).toBe(1);
    expect(shoppingTotal({ amountCents: 1234, basis: "total" }, 2500)).toBe(1234);
    expect(shoppingTotal(null, 2500)).toBeNull();
    for (const v of ["0", "-1", "1,0001", "1e3", "", "1.2.3"]) expect(() => quantityMilli(v)).toThrow();
    expect(() => shoppingTotal({ amountCents: Number.MAX_SAFE_INTEGER, basis: "unit" }, 2000)).toThrow();
  });
  it("batch creation stamps distinct records; replay and any invalid row commit nothing", () => {
    const items = [newShoppingItem("Kora"), newShoppingItem("Rękawice")], before = seed();
    const d = addShoppingBatch(before, items, at);
    expect(d.shoppingItems).toHaveLength(2);
    expect(d.shoppingItems[0]).toMatchObject({ createdAt: at, updatedAt: at, revision: 1 });
    expect(() => addShoppingBatch(d, items, at)).toThrow();
    expect(() => addShoppingBatch(before, [items[0], { ...items[1], name: " " }], at)).toThrow();
    expect(before.shoppingItems).toEqual([]);
    expect(() => addShoppingBatch(before, Array.from({ length: 101 }, () => newShoppingItem("a")), at)).toThrow();
  });
  it("status, date, archive, repeat and tombstone operations leave existing business data unchanged", () => {
    const before = seed(), d = added(), p = d.shoppingItems[0];
    expect(p.jobTitle).toBe(d.jobs[0].title);
    const ordered = shoppingAction(d, p.id, 1, "ordered", at + 1);
    expect(ordered.shoppingItems[0]).toMatchObject({ status: "ordered", purchasedOn: null, archivedAt: null });
    const bought = shoppingAction(ordered, p.id, 2, "purchased", at + 2);
    expect(bought.shoppingItems[0].purchasedOn).toBe("2026-11-10");
    const archived = shoppingAction(bought, p.id, 3, "archive", at + 3);
    expect(archived.shoppingItems[0].archivedAt).toBe(at + 3);
    const repeated = repeatShopping(archived, p.id, 4, crypto.randomUUID(), at + 4);
    expect(repeated.shoppingItems).toHaveLength(2);
    expect(repeated.shoppingItems[1]).toMatchObject({ status: "needed", purchasedOn: null, actualPrice: null, expenseId: null, archivedAt: null });
    expect(repeated.shoppingItems[0]).toEqual(archived.shoppingItems[0]);
    const deleted = shoppingAction(repeated, p.id, 4, "delete", at + 5);
    expect(deleted.shoppingItems[0]).toMatchObject({ deletedAt: at + 5, revision: 5 });
    const { shoppingItems: _a, ...rest } = deleted, { shoppingItems: _b, ...previous } = before;
    expect(rest).toEqual(previous);
  });
  it("stale edits and deletes fail; a deleted historical job remains readable and a new missing link is rejected", () => {
    const d = added(), p = d.shoppingItems[0];
    const changed = saveShopping(d, { ...p, name: "Nowa kora", priority: "urgent" }, 1, at + 1);
    expect(() => saveShopping(changed, p, 1, at + 2)).toThrow("zmieniła");
    expect(() => shoppingAction(changed, p.id, 1, "delete", at + 2)).toThrow();
    expect(() => saveShopping(d, { ...p, jobId: "gone" }, 1, at)).toThrow();
    const noJob = { ...d, jobs: d.jobs.filter(j => j.id !== p.jobId) };
    expect(() => saveShopping(noJob, { ...p, notes: "Historia" }, 1, at)).not.toThrow();
  });
  it.each(["javascript:alert(1)", "file:///secret", "https://user:pass@example.com/", "data:text/html,test"])("rejects unsafe product URL %s", url => {
    const d = added(), p = d.shoppingItems[0];
    expect(() => saveShopping(d, { ...p, url }, 1, at)).toThrow();
  });
  it("rejects malformed v12 and fractional money; migration is never a repair path for current-format data", () => {
    expect(() => validateData({ ...seed(), shoppingItems: undefined })).toThrow("zakupów");
    const d = added(), p = d.shoppingItems[0];
    expect(() => validateData({ ...d, shoppingItems: [{ ...p, plannedPrice: { amountCents: 1.5, basis: "unit" } }] })).toThrow();
    expect(() => validateData({ ...d, shoppingItems: [p, p] })).toThrow();
  });
  it("purchase status alone creates no cost; explicit expense creation and association are indivisible", () => {
    const d = added(), p = d.shoppingItems[0], bought = shoppingAction(d, p.id, 1, "purchased", at + 1);
    expect(bought.expenses).toEqual(d.expenses);
    const e = { ...expense(), amountCents: 3085 };
    const next = createShoppingExpense(bought, p.id, 2, e, at + 2);
    expect(next.expenses).toHaveLength(1); expect(next.shoppingItems[0].expenseId).toBe(e.id);
    expect(() => createShoppingExpense(next, p.id, 2, expense(), at + 3)).toThrow();
    expect(() => shoppingAction(next, p.id, 3, "ordered", at + 3)).toThrow("wydatek");
    expect(shoppingAction(next, p.id, 3, "delete", at + 3).expenses).toEqual(next.expenses);
    expect(next.payments).toEqual(d.payments); expect(next.jobs).toEqual(d.jobs); expect(next.timer).toEqual(d.timer);
  });
  it("linking a current outgoing receipt adds no cost; a changed receipt invalidates confirmation", () => {
    const d = added(), p = d.shoppingItems[0], bought = shoppingAction(d, p.id, 1, "purchased", at);
    const e = expense(), withExpense = saveExpense(bought, e, null, at), current = withExpense.expenses[0];
    const linked = linkShoppingExpense(withExpense, p.id, 2, current.id, 1, at + 1);
    expect(linked.expenses).toEqual(withExpense.expenses); expect(linked.shoppingItems[0].expenseId).toBe(e.id);
    expect(() => linkShoppingExpense(withExpense, p.id, 2, current.id, 2, at + 1)).toThrow("Wydatek zmienił");
  });
  it("two authorities racing one purchase create exactly one expense; independent concurrent additions survive reopening", async () => {
    const factory = new IDBFactory(), storage = new Memory();
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, data: added() }));
    const a = new AtomicRepository(storage, factory), b = new AtomicRepository(storage, factory);
    await Promise.all([a.initialize(), b.initialize()]);
    const p = (await a.read()).data.shoppingItems[0];
    await a.command(s => s.shoppingAction(p.id, 1, "purchased"));
    const results = await Promise.allSettled([a, b].map(repo => repo.command(s => s.createShoppingExpense(p.id, 2, expense()))));
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    await Promise.all([a, b].map((repo, i) => repo.command(s => s.addShoppingBatch([newShoppingItem("Równoległy " + i)]))));
    await a.close(); await b.close();
    const reopened = new AtomicRepository(storage, factory), state = await reopened.initialize();
    expect(state.data.expenses).toHaveLength(1); expect(state.data.shoppingItems).toHaveLength(3);
    await reopened.close();
  });
});
describe("v11 to v12 migration and full backup compatibility", () => {
  async function setup() {
    const factory = new IDBFactory(), storage = new Memory(), legacy = seed();
    delete (legacy as Partial<typeof legacy>).shoppingItems;
    const original = { formatVersion: 11, revision: 41, data: legacy };
    await record(factory, "current", original);
    const stale = seed(); stale.clients[0].name = "Nieaktualna kopia";
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 11, data: stale }));
    return { factory, storage, original, repo: new AtomicRepository(storage, factory) };
  }
  it("preserves the exact canonical v11 source and ignores a stale mirror, including after reopen", async () => {
    const f = await setup(), state = await f.repo.initialize();
    expect(state).toEqual({ ...f.original, formatVersion: 12, data: { ...f.original.data, shoppingItems: [] } });
    expect(await record(f.factory, "format-v11-source")).toEqual(f.original);
    expect(JSON.parse(f.storage.getItem(STORAGE_KEY)!).version).toBe(12);
    await f.repo.close();
    const r = new AtomicRepository(f.storage, f.factory);
    expect(await r.initialize()).toEqual(state); await r.close();
  });
  it("failed migration rolls back current and backup together without altering the compatibility bytes", async () => {
    const f = await setup(), mirror = f.storage.getItem(STORAGE_KEY), put = IDBObjectStore.prototype.put;
    const spy = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, value, key) {
      if (key === "current" && value.formatVersion === 12) throw new DOMException("full", "QuotaExceededError");
      return put.call(this, value, key);
    });
    try { await expect(f.repo.initialize()).rejects.toThrow(); } finally { spy.mockRestore(); }
    expect(await record(f.factory, "current")).toEqual(f.original);
    expect(await record(f.factory, "format-v11-source")).toBeUndefined();
    expect(f.storage.getItem(STORAGE_KEY)).toBe(mirror); await f.repo.close();
  });
  it("does not silently recreate missing expense fields of a supposedly valid v11", async () => {
    const f = await setup();
    delete (f.original.data as Partial<typeof f.original.data>).expenses;
    await record(f.factory, "current", f.original);
    await expect(f.repo.initialize()).rejects.toThrow();
    expect(await record(f.factory, "current")).toEqual(f.original); await f.repo.close();
  });
  it("reads old JSON while retaining exact pre-migration bytes", () => {
    const old = seed(); delete (old as Partial<typeof old>).shoppingItems;
    const storage = new Memory(), raw = JSON.stringify({ version: 11, data: old });
    storage.setItem(STORAGE_KEY, raw);
    expect(new LocalRepository(storage).load()).toEqual({ ...old, shoppingItems: [] });
    expect(storage.getItem("garden-manager:backup:v11")).toBe(raw);
  });
  it("denied IndexedDB leaves existing data intact and never seeds over it", async () => {
    const f = await setup(), raw = f.storage.getItem(STORAGE_KEY);
    const denied = new AtomicRepository(f.storage, { open() { throw Error("denied"); } } as unknown as IDBFactory);
    await expect(denied.initialize()).rejects.toThrow("niedostępny");
    expect(f.storage.getItem(STORAGE_KEY)).toBe(raw);
    expect(await record(f.factory, "current")).toEqual(f.original); await f.repo.close();
  });
  it("roundtrips v12 shopping and expenses with real photo bytes; a v11 ZIP restores empty shopping without losing its data", async () => {
    const factory = new IDBFactory(), assets = new IndexedDbPhotoRepository(factory);
    let d = added(); const p = d.shoppingItems[0];
    d = shoppingAction(d, p.id, 1, "purchased", at);
    d = createShoppingExpense(d, p.id, 2, expense(), at);
    const bytes = await readFile(new URL("../reports/fixtures/garden.jpg", import.meta.url));
    const image = new Blob([Uint8Array.from(bytes)], { type: "image/jpeg" });
    const dim = imageDimensions(new Uint8Array(await image.arrayBuffer())), hash = await sha256(image);
    const photo = {
      id: "shopping-photo", assetId: "shopping-asset", filename: "garden.jpg",
      clientId: d.clients[0].id, gardenId: d.gardens[0].id, zoneId: null, jobId: d.jobs[0].id,
      clientName: d.clients[0].name, gardenName: d.gardens[0].name, zoneName: null, jobTitle: d.jobs[0].title,
      category: "before" as const, description: "", capturedDate: null, addedAt: at, updatedAt: at, deletedAt: null,
      revision: 1, mimeType: "image/jpeg" as const, width: dim.width, height: dim.height,
      thumbnailWidth: dim.width, thumbnailHeight: dim.height, size: image.size, thumbnailSize: image.size,
      sha256: hash, thumbnailSha256: hash,
    };
    d = { ...d, photos: [photo] };
    await assets.putMany([{ id: photo.assetId, image, thumbnail: image, createdAt: at }]);
    const zip = await makeFullBackup(d, assets, at), prepared = await readFullBackup(zip);
    expect(prepared.data).toEqual(d); expect(await sha256(prepared.assets[0].image)).toBe(hash);
    const contents = unzipSync(new Uint8Array(await zip.arrayBuffer()));
    const envelope = JSON.parse(strFromU8(contents["data.json"]));
    envelope.version = 11; delete envelope.data.shoppingItems;
    contents["data.json"] = strToU8(JSON.stringify(envelope));
    const manifest = JSON.parse(strFromU8(contents["manifest.json"]));
    manifest.dataSha256 = await sha256(new Blob([contents["data.json"].slice().buffer]));
    contents["manifest.json"] = strToU8(JSON.stringify(manifest));
    const old = await readFullBackup(new Blob([zipSync(contents).slice().buffer]));
    expect(old.data).toEqual({ ...envelope.data, shoppingItems: [] });
    expect(old.data.expenses).toEqual(d.expenses); expect(await sha256(old.assets[0].thumbnail)).toBe(hash);
  });
  it("restores old and new JSON without photos through validation, and refuses ambiguous active timer snapshots", async () => {
    const d = added(), assets = new IndexedDbPhotoRepository(new IDBFactory());
    const parsed = await readJsonBackup(new Blob([JSON.stringify({ version: 12, data: d })]), assets, at);
    expect(parsed.data).toEqual(d);
    const old = seed(); delete (old as Partial<typeof old>).shoppingItems;
    expect((await readJsonBackup(new Blob([JSON.stringify({ version: 11, data: old })]), assets, at)).data).toEqual({ ...old, shoppingItems: [] });
    const running = seed(); running.jobs[0].status = "in-progress"; running.timer = { jobId: running.jobs[0].id, startedAt: at, paused: false };
    await expect(readJsonBackup(new Blob([JSON.stringify({ version: 12, data: running })]), assets, at)).rejects.toThrow("aktywny stoper");
    await expect(readJsonBackup(new Blob(["corrupt"]), assets, at)).rejects.toThrow();
  });

});
