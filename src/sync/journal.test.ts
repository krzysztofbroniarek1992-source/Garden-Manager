import { afterEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { AtomicRepository } from "../data/atomic";
import { createDemoData } from "../data/demo";
import { STORAGE_KEY, STORAGE_VERSION, validateData } from "../data/repository";
import { newShoppingItem } from "../shopping/model";
import { otherCategory, type Expense } from "../expenses/model";
import { newNote } from "../desk/model";
import type { PhotoMetadata } from "../photos/model";
import { canonical, dotId, recordView } from "./causal";
import { DATABASE_SOURCE, JOURNAL_KEY, JOURNAL_SOURCE, JOURNAL_STORE, validateJournal } from "./journal";
import { businessRecords } from "./records";

const INSTALLATION = "11111111-1111-4111-8111-111111111111";
class MemoryStorage {
  values = new Map<string, string>();
  fail = false;
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) {
    if (this.fail) throw new DOMException("Synthetic mirror quota", "QuotaExceededError");
    this.values.set(key, value);
  }
}
async function setup(withPhoto = false) {
  const factory = new IDBFactory(), storage = new MemoryStorage();
  const data = createDemoData(new Date("2026-11-22T12:00:00Z"));
  if (withPhoto) data.photos.push({
    id: "synthetic-photo", assetId: "synthetic-asset", filename: "synthetic.jpg",
    clientId: "client-1", gardenId: null, zoneId: null, jobId: null,
    clientName: data.clients[0].name, gardenName: null, zoneName: null, jobTitle: null,
    category: "before", description: "Synthetic local-only photo", capturedDate: null,
    addedAt: 1, updatedAt: 1, deletedAt: null, revision: 1, mimeType: "image/jpeg",
    width: 1, height: 1, thumbnailWidth: 1, thumbnailHeight: 1,
    size: 1, thumbnailSize: 1, sha256: "1".repeat(64), thumbnailSha256: "2".repeat(64),
  } satisfies PhotoMetadata);
  validateData(data); storage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, data }));
  const repo = new AtomicRepository(storage, factory); await repo.initialize();
  return { factory, storage, repo, data };
}
async function raw(factory: IDBFactory, store: string, key: string): Promise<unknown> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const r = factory.open("garden-manager-state"); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly"), r = tx.objectStore(store).get(key);
    tx.oncomplete = () => { db.close(); resolve(r.result); };
    tx.onabort = () => { db.close(); reject(tx.error); };
  });
}
afterEach(() => vi.restoreAllMocks());
describe("atomically enabled GM-011B journal, business v12 unchanged", () => {
  it("does not enable communication or change existing data during ordinary startup", async () => {
    const f = await setup();
    expect(await f.repo.readSyncJournal()).toBeNull();
    await f.repo.command(s => s.setRate(125));
    expect(await f.repo.readSyncJournal()).toBeNull();
    expect((await f.repo.read()).data.settings.hourlyRate).toBe(125);
    expect(JSON.parse(f.storage.getItem(STORAGE_KEY)!).version).toBe(12);
  });
  it("upgrades only the IDB schema on activation and preserves both source checkpoints", async () => {
    const f = await setup(), before = await f.repo.read();
    const journal = await f.repo.enableSyncJournal(INSTALLATION);
    expect((await f.repo.read())).toEqual(before);
    expect(await raw(f.factory, JOURNAL_STORE, DATABASE_SOURCE)).toEqual(before);
    expect(await raw(f.factory, JOURNAL_STORE, JOURNAL_SOURCE)).toEqual(before);
    expect(journal.log.installation).toBe(INSTALLATION);
    expect(journal.appliedLocal).toEqual([dotId(journal.log.operations[0])]);
    expect(journal.log.operations).toHaveLength(1);
    expect(JSON.parse(f.storage.getItem(STORAGE_KEY)!).version).toBe(12);
    const again = await f.repo.enableSyncJournal();
    expect(again.log.installation).toBe(INSTALLATION);
    expect(await raw(f.factory, JOURNAL_STORE, JOURNAL_SOURCE)).toEqual(before);
  });
  it("keeps the v12 source readable and upgrade retryable after an IDB open failure", async () => {
    const f = await setup(), before = await f.repo.read();
    const open = f.factory.open.bind(f.factory);
    const failure = vi.spyOn(f.factory, "open").mockImplementation((name, version) => {
      if (version === 2) throw new DOMException("Synthetic upgrade denied", "SecurityError");
      return open(name, version);
    });
    await expect(f.repo.enableSyncJournal(INSTALLATION)).rejects.toThrow("Synthetic upgrade denied");
    failure.mockRestore();
    expect(await f.repo.read()).toEqual(before);
    expect(await f.repo.readSyncJournal()).toBeNull();
    const j = await f.repo.enableSyncJournal(INSTALLATION);
    expect(j.log.operations).toHaveLength(1);
    expect((await f.repo.read()).data).toEqual(before.data);
  });
  it("rejects a GM-011A v1 writer after activation", async () => {
    const f = await setup(); await f.repo.enableSyncJournal(INSTALLATION);
    await expect(new Promise((resolve, reject) => {
      const r = f.factory.open("garden-manager-state", 1);
      r.onerror = () => reject(r.error); r.onsuccess = () => { r.result.close(); resolve("unexpected"); };
    })).rejects.toMatchObject({ name: "VersionError" });
    expect((await f.repo.read()).data).toEqual(f.data);
  });
  it("serializes two installations of the repository in one profile with one source counter", async () => {
    const f = await setup(), other = new AtomicRepository(f.storage, f.factory);
    await other.initialize(); await f.repo.enableSyncJournal(INSTALLATION);
    await Promise.all([
      f.repo.command(s => s.saveClient({ id: "new-a", name: "Synthetic A", phone: "", email: "", notes: "" })),
      other.command(s => s.saveClient({ id: "new-b", name: "Synthetic B", phone: "", email: "", notes: "" })),
    ]);
    const j = (await other.readSyncJournal())!;
    expect(j.log.operations.map(o => o.sequence)).toEqual([1, 2, 3]);
    expect(new Set(j.log.operations.map(o => o.id)).size).toBe(3);
    expect((await f.repo.read()).data.clients.filter(c => c.id.startsWith("new-"))).toHaveLength(2);
    expect(j.lastRevision).toBe((await f.repo.read()).revision);
    await other.close();
  });
  it("retains origin, history and counters after reopening without a version-1 fallback", async () => {
    const f = await setup(); await f.repo.enableSyncJournal(INSTALLATION);
    await f.repo.command(s => s.setRate(130));
    const before = await f.repo.readSyncJournal(); await f.repo.close();
    const next = new AtomicRepository(f.storage, f.factory); await next.initialize();
    expect(await next.readSyncJournal()).toEqual(before);
    await next.command(s => s.setRate(140));
    expect((await next.readSyncJournal())!.log.nextSequence).toBe(4);
    expect((await next.read()).data.settings.hourlyRate).toBe(140);
    await next.close();
  });
  it("rolls back current, revision, receipt and counter when journal.put fails", async () => {
    const f = await setup(); await f.repo.enableSyncJournal(INSTALLATION);
    const state = await f.repo.read(), journal = await f.repo.readSyncJournal(), mirror = f.storage.getItem(STORAGE_KEY);
    const put = IDBObjectStore.prototype.put;
    const failure = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
      this: IDBObjectStore, value: unknown, key?: IDBValidKey,
    ) {
      if (this.name === JOURNAL_STORE && key === JOURNAL_KEY) throw new DOMException("Synthetic journal quota", "QuotaExceededError");
      return put.call(this, value, key);
    });
    await expect(f.repo.command(s => s.setRate(999))).rejects.toThrow();
    failure.mockRestore();
    expect(await f.repo.read()).toEqual(state);
    expect(await f.repo.readSyncJournal()).toEqual(journal);
    expect(f.storage.getItem(STORAGE_KEY)).toBe(mirror);
    await f.repo.command(s => s.setRate(150));
    expect((await f.repo.readSyncJournal())!.log.operations.at(-1)!.sequence).toBe(2);
  });
  it("does not undo an authoritative commit when only the compatibility mirror is full", async () => {
    const f = await setup(); await f.repo.enableSyncJournal(INSTALLATION); f.storage.fail = true;
    await f.repo.command(s => s.setRate(155));
    expect((await f.repo.read()).data.settings.hourlyRate).toBe(155);
    expect((await f.repo.readSyncJournal())!.log.operations).toHaveLength(2);
    expect(f.repo.warning).toContain("Dane zapisano w IndexedDB");
  });
  it("preserves local photos and strips local photo references from journal records", async () => {
    const f = await setup(true);
    const note = { ...newNote(f.data, { clientId: "client-1" }, undefined, "synthetic-photo"), title: "Synthetic note" };
    await f.repo.command(s => s.saveNote(note), () => 1000);
    const before = (await f.repo.read()).data;
    await f.repo.enableSyncJournal(INSTALLATION);
    const j = (await f.repo.readSyncJournal())!;
    expect((await f.repo.read()).data).toEqual(before);
    expect(canonical(j.log)).not.toContain("synthetic-photo");
    expect(canonical(j.log)).not.toContain("synthetic-asset");
    expect([...businessRecords(before).keys()].some(k => k.startsWith("photos/"))).toBe(false);
    const projected = recordView(j.log, "notes/" + encodeURIComponent(note.id)).value as { photoId: null };
    expect(projected.photoId).toBeNull();
  });
  it("captures payments with their visit as one financial aggregate", async () => {
    const f = await setup(); await f.repo.enableSyncJournal(INSTALLATION);
    await f.repo.command(s => s.savePayment({ id: "synthetic-payment", jobId: "job-5", amountCents: 100,
      receivedDate: "2026-11-22", method: "cash", note: "Synthetic" }, null));
    const j = (await f.repo.readSyncJournal())!, op = j.log.operations.at(-1)!;
    expect(op.changes.map(c => c.key)).toEqual(["visits/job-5"]);
    expect(canonical(op.changes[0].after)).toContain("synthetic-payment");
    expect((await f.repo.read()).data.payments).toHaveLength(1);
  });
  it("captures expense creation and its purchase association in one operation", async () => {
    const f = await setup(); await f.repo.enableSyncJournal(INSTALLATION);
    const item = { ...newShoppingItem("Synthetic product"), id: "synthetic-purchase", status: "purchased" as const, purchasedOn: "2026-11-22" };
    await f.repo.command(s => s.saveShoppingItem(item, null), () => 1000);
    const expense: Expense = { id: "synthetic-expense", revision: 0, createdAt: 0, updatedAt: 0,
      date: "2026-11-22", amountCents: 1500, direction: "outgoing", counterparty: "Synthetic vendor",
      description: "Synthetic", categoryId: otherCategory, source: "manual", origin: null,
      status: "approved", note: "Synthetic", history: [] };
    await f.repo.command(s => s.createShoppingExpense(item.id, 1, expense), () => 1001);
    const op = (await f.repo.readSyncJournal())!.log.operations.at(-1)!;
    expect(op.changes.map(c => c.key).sort()).toEqual(["expenses/synthetic-expense", "shoppingItems/synthetic-purchase"]);
    expect((await f.repo.read()).data.shoppingItems[0].expenseId).toBe(expense.id);
  });
  it("keeps the live Timer local while preserving closed time events in the visit aggregate", async () => {
    const f = await setup(); await f.repo.enableSyncJournal(INSTALLATION);
    await f.repo.command(s => s.startTimer("job-1"), () => 1000);
    const running = (await f.repo.read()).data.timer;
    expect(running?.startedAt).toBe(1000);
    expect(canonical((await f.repo.readSyncJournal())!.log)).not.toContain('"startedAt"');
    await f.repo.command(s => s.pauseTimer(), () => 5100);
    await f.repo.command(s => s.stopTimer(), () => 6000);
    const state = (await f.repo.read()).data, j = (await f.repo.readSyncJournal())!;
    expect(state.timer).toBeNull(); expect(state.jobs[0].seconds).toBe(4);
    const visit = recordView(j.log, "visits/job-1").value as unknown as { job: { seconds: number; timeHistory: unknown[] } };
    expect(visit.job.seconds).toBe(4); expect(visit.job.timeHistory).toHaveLength(3);
    expect(canonical(j.log)).not.toContain('"remainderMs"');
  });
  it("preserves old journal and tombstones and requires review after restoring an old snapshot", async () => {
    const f = await setup(); await f.repo.enableSyncJournal(INSTALLATION);
    await f.repo.command(s => s.saveClient({ ...f.data.clients[0], notes: "New synthetic note" }, f.data.clients[0]));
    const beforeRestore = (await f.repo.read()).data;
    await f.repo.command(s => s.restoreSnapshot(f.data, JSON.stringify(beforeRestore)));
    const j = (await f.repo.readSyncJournal())!;
    expect(j.mode).toBe("restore-review"); expect(j.restoreCount).toBe(1);
    expect(j.log.operations).toHaveLength(3);
    expect(j.log.nextSequence).toBe(4);
    expect(recordView(j.log, "clients/client-1").value).toEqual(f.data.clients[0]);
    await f.repo.command(s => s.setRate(160));
    expect((await f.repo.readSyncJournal())!.mode).toBe("restore-review");
  });
  it("fails closed on an untracked writer rather than inventing missing operations", async () => {
    const f = await setup(); await f.repo.enableSyncJournal(INSTALLATION);
    const journal = await f.repo.readSyncJournal();
    const db = await new Promise<IDBDatabase>(resolve => { const r = f.factory.open("garden-manager-state"); r.onsuccess = () => resolve(r.result); });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("state", "readwrite"), store = tx.objectStore("state"), get = store.get("current");
      get.onsuccess = () => store.put({ ...get.result, revision: get.result.revision + 1 }, "current");
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => reject(tx.error);
    });
    const before = await f.repo.read();
    await expect(f.repo.command(s => s.setRate(999))).rejects.toThrow("pomijający dziennik");
    expect(await f.repo.read()).toEqual(before);
    expect(await f.repo.readSyncJournal()).toEqual(journal);
  });
  it("rejects damaged causal metadata without replacing the original journal or business state", async () => {
    const f = await setup(); await f.repo.enableSyncJournal(INSTALLATION);
    const j = (await f.repo.readSyncJournal())!, damaged = structuredClone(j);
    damaged.log.known[INSTALLATION] = 99;
    expect(() => validateJournal(damaged)).toThrow();
    const db = await new Promise<IDBDatabase>(resolve => { const r = f.factory.open("garden-manager-state"); r.onsuccess = () => resolve(r.result); });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(JOURNAL_STORE, "readwrite");
      tx.objectStore(JOURNAL_STORE).put(damaged, JOURNAL_KEY);
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => reject(tx.error);
    });
    const state = await f.repo.read();
    await expect(f.repo.command(s => s.setRate(999))).rejects.toThrow("niespójny");
    expect(await f.repo.read()).toEqual(state);
    expect(await raw(f.factory, JOURNAL_STORE, JOURNAL_KEY)).toEqual(damaged);
  });
});
