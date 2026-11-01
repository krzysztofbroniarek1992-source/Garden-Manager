import { describe, it, expect, vi } from "vitest";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { AtomicRepository } from "./atomic";
import { createDemoData } from "./demo";
import { STORAGE_KEY, STORAGE_VERSION } from "./repository";
import { ReportService } from "../reports/service";
import { defaultReportOptions } from "../reports/model";
import type { PhotoAssetRepository } from "../photos/model";

function fixture() {
  const data = createDemoData(new Date("2026-10-31T10:00:00+01:00"));
  data.jobs.slice(0, 2).forEach((j) => {
    j.status = "completed";
    j.settlement = null;
    j.reports = [];
  });
  data.payments = [];
  return data;
}
class StorageMock {
  values = new Map<string, string>();
  fail = false;
  getItem(k: string) {
    return this.values.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    if (this.fail) throw new DOMException("full", "QuotaExceededError");
    this.values.set(k, v);
  }
}
async function setup() {
  const factory = new IDBFactory(),
    data = fixture();
  const raw = JSON.stringify({ version: STORAGE_VERSION, data });
  const aStorage = new StorageMock(),
    bStorage = new StorageMock();
  aStorage.setItem(STORAGE_KEY, raw);
  bStorage.setItem(STORAGE_KEY, raw);
  const a = new AtomicRepository(aStorage as unknown as Storage, factory),
    b = new AtomicRepository(bStorage as unknown as Storage, factory);
  await Promise.all([a.initialize(), b.initialize()]);
  const service = (repo: AtomicRepository) =>
    new ReportService(
      {
        snapshot: async () => (await repo.read()).data,
        saveVisitReport: async (...args) => {
          await repo.command((s) => s.saveVisitReport(...args));
        },
      },
      {} as PhotoAssetRepository,
      async () => new Uint8Array([37, 80, 68, 70]),
      () => Date.parse("2026-10-31T10:00:00Z"),
    );
  return {
    factory,
    a,
    b,
    aStorage,
    bStorage,
    data,
    raw,
    one: service(a),
    two: service(b),
  };
}
describe("authoritative IndexedDB transactions", () => {
  it("migrates once without changing the v9 data or deleting the pre-cutover source", async () => {
    const f = await setup();
    expect((await f.a.read()).data).toEqual(f.data);
    f.bStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 9, data: { ...f.data, reportSequence: 999 } }),
    );
    expect((await f.b.initialize()).data).toEqual(f.data);
    expect(JSON.parse(f.bStorage.getItem(STORAGE_KEY)!).data).toEqual(f.data);
  });
  it("rejects one of two prepared reports even with independent stale localStorage caches", async () => {
    const f = await setup(),
      options = defaultReportOptions();
    const [a, b] = await Promise.all([
      f.one.prepare("job-1", options),
      f.two.prepare("job-2", options),
    ]);
    expect(a.record.number).toBe(b.record.number);
    const result = await Promise.allSettled([
      f.one.save("job-1", a),
      f.two.save("job-2", b),
    ]);
    expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(result.filter((r) => r.status === "rejected")).toHaveLength(1);
    const current = (await f.a.read()).data;
    expect(current.reportSequence).toBe(1);
    expect(current.jobs.flatMap((j) => j.reports ?? [])).toHaveLength(1);
    const loser = current.jobs[0].reports?.length ? "job-2" : "job-1";
    const retry = await f.two.prepare(loser, options);
    await f.two.save(loser, retry);
    const final = (await f.b.read()).data;
    expect(final.reportSequence).toBe(2);
    expect(
      new Set(final.jobs.flatMap((j) => j.reports ?? []).map((r) => r.number))
        .size,
    ).toBe(2);
    expect(final.payments).toEqual(f.data.payments);
  });
  it("preserves another command and an old job form alongside report history", async () => {
    const f = await setup(),
      report = await f.one.prepare("job-1", defaultReportOptions());
    await Promise.all([
      f.one.save("job-1", report),
      f.b.command((s) =>
        s.saveClient({ ...f.data.clients[1], name: "Nowa nazwa" }),
      ),
    ]);
    await f.b.command((s) =>
      s.saveJob({
        ...f.data.jobs[0],
        notes: "Notatka z formularza sprzed raportu",
      }),
    );
    const d = (await f.a.read()).data;
    expect(d.clients[1].name).toBe("Nowa nazwa");
    expect(d.jobs[0].reports?.[0].id).toBe(report.record.id);
    expect(d.jobs[0].notes).toBe("Notatka z formularza sprzed raportu");
  });
  it("fails a stale import instead of replacing a committed report", async () => {
    const f = await setup(),
      expected = JSON.stringify(f.data),
      report = await f.one.prepare("job-1", defaultReportOptions());
    await f.one.save("job-1", report);
    await expect(
      f.b.command((s) => s.restoreSnapshot(f.data, expected)),
    ).rejects.toThrow("Dane zmieniły");
    expect((await f.b.read()).data.jobs[0].reports?.[0].id).toBe(
      report.record.id,
    );
  });
  it("rejects a prepared report after an import changed its source", async () => {
    const f = await setup(),
      report = await f.one.prepare("job-1", defaultReportOptions());
    const replacement = structuredClone(f.data);
    replacement.jobs[0].activities = ["Inny zakres z kopii"];
    await f.b.command((s) =>
      s.restoreSnapshot(replacement, JSON.stringify(f.data)),
    );
    await expect(f.one.save("job-1", report)).rejects.toThrow("zmieniły");
    expect((await f.a.read()).data).toEqual(replacement);
  });
  it("survives close/reopen and ignores a stale compatibility mirror", async () => {
    const f = await setup(),
      report = await f.one.prepare("job-1", defaultReportOptions());
    await f.one.save("job-1", report);
    await f.a.close();
    await f.b.close();
    f.bStorage.values.set(STORAGE_KEY, f.raw);
    const reopened = new AtomicRepository(
      f.bStorage as unknown as Storage,
      f.factory,
    );
    expect((await reopened.initialize()).data.jobs[0].reports?.[0]).toEqual(
      report.record,
    );
  });
  it("rolls back failed authoritative writes, without accepting a report or changing the mirror", async () => {
    const f = await setup(),
      before = await f.a.read(),
      raw = f.aStorage.getItem(STORAGE_KEY);
    const put = vi
      .spyOn(IDBObjectStore.prototype, "put")
      .mockImplementation(() => {
        throw new DOMException("full", "QuotaExceededError");
      });
    try {
      await expect(f.a.command((s) => s.setRate(123))).rejects.toThrow("full");
    } finally {
      put.mockRestore();
    }
    expect(await f.a.read()).toEqual(before);
    expect(f.aStorage.getItem(STORAGE_KEY)).toBe(raw);
  });
  it("keeps a committed authoritative snapshot when only the compatibility mirror is full", async () => {
    const f = await setup();
    f.aStorage.fail = true;
    await f.a.command((s) => s.setRate(123));
    expect((await f.b.read()).data.settings.hourlyRate).toBe(123);
    expect(f.a.warning).toContain("Dane zapisano w IndexedDB");
  });
  it("does not fall back to localStorage when IndexedDB cannot open", async () => {
    const storage = new StorageMock();
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 9, data: fixture() }),
    );
    const raw = storage.getItem(STORAGE_KEY);
    const factory = {
      open() {
        throw new Error("blocked");
      },
    } as unknown as IDBFactory;
    const repo = new AtomicRepository(storage as unknown as Storage, factory);
    await expect(repo.initialize()).rejects.toThrow("Zapis zablokowano");
    expect(storage.getItem(STORAGE_KEY)).toBe(raw);
    await repo.close();
  });
});
