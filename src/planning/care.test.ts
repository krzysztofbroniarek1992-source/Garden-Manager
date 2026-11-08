import { describe, it, expect } from "vitest";
import { finalData } from "../../tests/final-navigation-fixture";
import type { Data } from "../domain";
import type { TaskOccurrence, TaskSchedule } from "./model";
import { occurrenceId, taskStatus } from "./model";
import {
  saveTaskSchedule,
  completeCareOccurrence,
  moveTaskOccurrence,
  skipTaskOccurrence,
  endTaskSchedule,
  beginTaskOccurrence,
} from "./commands";
import { taskOccurrencesBetween, resolveOccurrence } from "./occurrences";
import { nextCareDate, pendingCareOccurrence } from "./care";
import {
  validateData,
  LocalRepository,
  STORAGE_KEY,
  STORAGE_VERSION,
  V9_BACKUP_KEY,
} from "../data/repository";
import { AtomicRepository } from "../data/atomic";
import { IDBFactory } from "fake-indexeddb";
import { GardenStore } from "../data/store";
const at = Date.parse("2027-06-20T12:00:00Z");
function seed(patch: Partial<TaskSchedule> = {}) {
  let d = finalData();
  d.taskSchedules = [];
  d.taskOccurrences = [];
  d.jobs = d.jobs.map((j) => {
    const { taskOccurrenceId: _id, ...rest } = j;
    return rest;
  });
  const s: TaskSchedule = {
    id: "care-test",
    title: "Nawożenie",
    notes: "Opis zabiegu",
    startDate: "2027-04-01",
    endDate: null,
    time: "09:00",
    gardenId: "garden-1",
    clientId: "client-1",
    zoneId: "zone-doc",
    zoneName: "Rabata różana",
    care: { season: null, material: "Preparat wpisany przez użytkownika" },
    recurrence: {
      frequency: "days",
      interval: 30,
      months: Array.from({ length: 12 }, (_, i) => i + 1),
    },
    endedOn: null,
    revision: 0,
    updatedAt: 0,
    ...patch,
  };
  d = saveTaskSchedule(d, s, at);
  validateData(d);
  return d;
}
const current = (d: Data) => pendingCareOccurrence(d, "care-test")!;
function done(d: Data, date: string, jobId: string | null = null) {
  const o = current(d),
    s = d.taskSchedules[0];
  const next = completeCareOccurrence(
    d,
    s.id,
    o.originalDate,
    o.careCycle!,
    date,
    jobId,
    at,
    { scheduleRevision: s.revision, occurrenceRevision: o.revision },
  );
  validateData(next);
  return next;
}
describe("GM-005 completion-driven occurrences share the existing planner", () => {
  it.each([
    ["2027-04-01", "2027-05-01"],
    ["2027-04-08", "2027-05-08"],
    ["2027-03-28", "2027-04-27"],
  ])("actual %s anchors next %s", (date, next) => {
    const d = done(seed(), date);
    expect(current(d).date).toBe(next);
    expect(d.taskOccurrences[0].completion).toMatchObject({
      performedOn: date,
      recordedAt: at,
      material: "Preparat wpisany przez użytkownika",
    });
    expect(d.taskOccurrences[0].originalDate).toBe("2027-04-01");
  });
  it("moves one pending date without advancing the actual-date cycle", () => {
    const d = seed(),
      o = current(d),
      m = moveTaskOccurrence(
        d,
        o.scheduleId,
        o.originalDate,
        "2027-04-05",
        "11:00",
        at,
        undefined,
        o.careCycle,
      );
    validateData(m);
    expect(m.taskOccurrences).toHaveLength(1);
    expect(done(m, "2027-04-08").taskOccurrences[1].date).toBe("2027-05-08");
    expect(m.taskOccurrences[0].completion).toBeNull();
  });
  it("has one overdue occurrence even after multiple unpaid intervals and read-only projections", () => {
    const d = seed(),
      before = structuredClone(d);
    for (const to of ["2027-04-02", "2027-04-05", "2027-04-10", "2027-12-31"])
      expect(taskOccurrencesBetween(d, "2027-01-01", to, true)).toHaveLength(1);
    expect(d).toEqual(before);
    expect(taskOccurrencesBetween(d, "2027-05-01", "2027-12-31")).toEqual([]);
  });
  it("resumes on the first active day next year, not a winter interval grid", () => {
    const d = seed({
      care: { season: { from: "04-01", to: "09-30" }, material: "" },
      startDate: "2027-09-20",
    });
    expect(nextCareDate(d.taskSchedules[0], "2027-09-20")).toBe("2028-04-01");
    expect(taskOccurrencesBetween(d, "2027-10-01", "2028-03-31")).toEqual([]);
  });
  it("supports a wrapped season across New Year", () => {
    const d = seed({
      care: { season: { from: "10-01", to: "03-31" }, material: "" },
      startDate: "2027-09-01",
    });
    expect(current(d).date).toBe("2027-10-01");
    expect(nextCareDate(d.taskSchedules[0], "2027-12-15")).toBe("2028-01-14");
    expect(nextCareDate(d.taskSchedules[0], "2027-03-20")).toBe("2027-10-01");
  });
  it("clamps the next month to its last day from the actual date", () => {
    const s = seed({
      recurrence: {
        frequency: "months",
        interval: 1,
        months: Array.from({ length: 12 }, (_, i) => i + 1),
      },
    }).taskSchedules[0];
    expect(nextCareDate(s, "2027-01-31")).toBe("2027-02-28");
    expect(nextCareDate(s, "2028-01-31")).toBe("2028-02-29");
    expect(nextCareDate(s, "2027-02-28")).toBe("2027-03-28");
  });
  it.each(["2027-03-27", "2027-03-28", "2027-10-30", "2027-10-31"])(
    "counts civil days across Warsaw DST at %s",
    (date) => {
      const s = seed({
        recurrence: {
          frequency: "days",
          interval: 1,
          months: Array.from({ length: 12 }, (_, i) => i + 1),
        },
      }).taskSchedules[0];
      expect(Date.parse(nextCareDate(s, date)!) - Date.parse(date)).toBe(
        86400000,
      );
    },
  );
  it("skips with a disclosed next date and no fictional completion", () => {
    const d = seed(),
      o = current(d),
      next = skipTaskOccurrence(
        d,
        o.scheduleId,
        o.originalDate,
        at,
        undefined,
        o.careCycle,
      );
    validateData(next);
    expect(next.taskOccurrences[0]).toMatchObject({
      status: "cancelled",
      completion: null,
      closedReason: "skipped",
    });
    expect(current(next).date).toBe("2027-05-01");
  });
  it("ending a series closes its one pending occurrence and preserves completed history", () => {
    let d = done(seed(), "2027-04-08");
    const old = structuredClone(d.taskOccurrences[0]);
    d = endTaskSchedule(
      d,
      "care-test",
      "2027-06-20",
      at,
      d.taskSchedules[0].revision,
    );
    validateData(d);
    expect(current(d)).toBeUndefined();
    expect(d.taskOccurrences[0]).toEqual(old);
    expect(d.taskOccurrences[1]).toMatchObject({
      status: "cancelled",
      closedReason: "ended",
      completion: null,
    });
  });
  it("an interval edit preserves the pending date and completed snapshot, then applies after completion", () => {
    let d = done(seed(), "2027-04-08");
    const old = structuredClone(d.taskOccurrences[0]),
      s = d.taskSchedules[0];
    d = saveTaskSchedule(
      d,
      {
        ...s,
        care: { ...s.care!, material: "Nowy preparat" },
        recurrence: { ...s.recurrence, interval: 7 },
      },
      at,
    );
    expect(current(d).date).toBe("2027-05-08");
    expect(d.taskOccurrences[0]).toEqual(old);
    d = done(d, "2027-05-10");
    expect(current(d).date).toBe("2027-05-17");
    expect(d.taskOccurrences[1].completion?.material).toBe("Nowy preparat");
  });
  it("records work performed during an existing visit without touching its business data", () => {
    const d = seed(),
      next = done(d, "2027-04-08", "job-1");
    expect(next.jobs).toEqual(d.jobs);
    expect(next.payments).toEqual(d.payments);
    expect(next.timer).toEqual(d.timer);
    expect(next.taskOccurrences[0].completion).toMatchObject({
      jobId: "job-1",
    });
    expect(d.jobs[0].status).toBe("completed");
    expect(taskStatus(d, current(d))).toBe("planned");
  });
  it("closing a started visit does not confirm its care occurrence or create the next one", () => {
    const d = seed(),
      o = current(d),
      b = beginTaskOccurrence(
        d,
        "care-test",
        o.originalDate,
        at,
        undefined,
        undefined,
        o.careCycle,
      );
    const next = {
      ...b.data,
      timer: null,
      jobs: b.data.jobs.map((j) =>
        j.id === b.jobId ? { ...j, status: "completed" as const } : j,
      ),
    };
    validateData(next);
    expect(taskStatus(next, current(next))).toBe("planned");
    expect(next.taskOccurrences).toHaveLength(1);
    expect(current(next).completion).toBeNull();
  });
  it("retries the same confirmation idempotently and rejects a conflicting actual date", () => {
    const d = seed(),
      o = current(d),
      next = done(d, "2027-04-08");
    expect(
      completeCareOccurrence(
        next,
        "care-test",
        o.originalDate,
        o.careCycle!,
        "2027-04-08",
        null,
        at,
        { scheduleRevision: 1, occurrenceRevision: 1 },
      ),
    ).toEqual(next);
    expect(() =>
      completeCareOccurrence(
        next,
        "care-test",
        o.originalDate,
        o.careCycle!,
        "2027-04-09",
        null,
        at,
      ),
    ).toThrow(/zmienił/);
  });
  it("keeps unique cycle identities even when early completion produces the same planned date twice", () => {
    let d = seed({
      startDate: "2027-04-10",
      recurrence: {
        frequency: "days",
        interval: 7,
        months: Array.from({ length: 12 }, (_, i) => i + 1),
      },
    });
    d = done(d, "2027-04-01");
    expect(current(d).date).toBe("2027-04-08");
    d = done(d, "2027-04-03");
    expect(current(d).date).toBe("2027-04-10");
    expect(new Set(d.taskOccurrences.map((o) => o.id)).size).toBe(3);
    expect(() => resolveOccurrence(d, "care-test", "2027-04-10")).toThrow(
      /niejednoznaczny/,
    );
    expect(resolveOccurrence(d, "care-test", "2027-04-10", 3)).toEqual(
      current(d),
    );
  });
  it("rejects future completion, wrong-garden visits and invalid seasons without mutating data", () => {
    const d = seed(),
      o = current(d),
      before = structuredClone(d);
    expect(() => done(d, "2028-04-08")).toThrow(/dzisiaj/);
    expect(() => done(d, "2027-04-08", "finance-paid")).toThrow(/wizytę/);
    expect(() =>
      saveTaskSchedule(
        d,
        {
          ...d.taskSchedules[0],
          care: { season: { from: "02-30", to: "09-30" }, material: "" },
        },
        at,
      ),
    ).toThrow();
    expect(() =>
      moveTaskOccurrence(
        d,
        "care-test",
        o.originalDate,
        "2027-10-01",
        "09:00",
        at,
        undefined,
        o.careCycle,
      ),
    ).not.toThrow();
    expect(d).toEqual(before);
  });
  it("rejects two active pending cycles on import", () => {
    const d = seed(),
      o = current(d);
    d.taskOccurrences.push({
      ...o,
      id: occurrenceId(o.scheduleId, "2027-05-01", 2),
      originalDate: "2027-05-01",
      date: "2027-05-01",
      careCycle: 2,
    });
    expect(() => validateData(d)).toThrow();
  });
  it("does not change existing fixed schedules or their projections on v9 migration", () => {
    const d = finalData(),
      storage = new Map([
        [STORAGE_KEY, JSON.stringify({ version: 9, data: d })],
      ]),
      port = {
        getItem: (k: string) => storage.get(k) ?? null,
        setItem: (k: string, v: string) => {
          storage.set(k, v);
        },
      };
    const before = taskOccurrencesBetween(d, "2026-01-01", "2027-12-31");
    expect(new LocalRepository(port).load()).toEqual(d);
    expect(storage.get(V9_BACKUP_KEY)).toBe(
      JSON.stringify({ version: 9, data: d }),
    );
    expect(JSON.parse(storage.get(STORAGE_KEY)!).version).toBe(STORAGE_VERSION);
    expect(
      taskOccurrencesBetween(
        new LocalRepository(port).load(),
        "2026-01-01",
        "2027-12-31",
      ),
    ).toEqual(before);
  });
  it("serializes two confirmations of the same cycle and preserves concurrent unrelated writes", async () => {
    const data = seed(),
      raw = JSON.stringify({ version: STORAGE_VERSION, data }),
      storage = new Map([[STORAGE_KEY, raw]]),
      port = {
        getItem: (k: string) => storage.get(k) ?? null,
        setItem: (k: string, v: string) => {
          storage.set(k, v);
        },
      },
      factory = new IDBFactory(),
      a = new AtomicRepository(port, factory, "gm005-test"),
      b = new AtomicRepository(port, factory, "gm005-test");
    await a.initialize();
    await b.initialize();
    const o = current(data);
    await Promise.all([
      a.command(
        (s) =>
          s.completeCareOccurrence(
            "care-test",
            o.originalDate,
            1,
            "2027-04-08",
            null,
          ),
        () => at,
      ),
      b.command(
        (s) =>
          s.completeCareOccurrence(
            "care-test",
            o.originalDate,
            1,
            "2027-04-08",
            null,
          ),
        () => at,
      ),
      a.command(
        (s) =>
          s.saveClient({ ...data.clients[0], notes: "Równoczesna notatka" }),
        () => at,
      ),
    ]);
    const next = (await a.read()).data;
    expect(next.taskOccurrences).toHaveLength(2);
    expect(
      next.taskOccurrences.filter((o) => o.status === "planned"),
    ).toHaveLength(1);
    expect(next.clients[0].notes).toBe("Równoczesna notatka");
    await a.close();
    await b.close();
  });
  it("protects a linked visit from deletion or reassignment after confirmation", () => {
    const d = done(seed(), "2027-04-08", "job-1"),
      port = { load: () => d, save: (_d: Data) => {} },
      store = new GardenStore(port, () => at);
    expect(() => store.deleteJob("job-1")).toThrow();
    expect(() => store.saveJob({ ...d.jobs[0], gardenId: "garden-2" })).toThrow(
      /historię/,
    );
  });
});

describe("GM-005 atomic migration and conflicts", () => {
  async function authority(data: Data = seed()) {
    const values = new Map([
        [STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, data })],
      ]),
      port = {
        getItem: (k: string) => values.get(k) ?? null,
        setItem: (k: string, v: string) => {
          values.set(k, v);
        },
      },
      factory = new IDBFactory(),
      name = crypto.randomUUID(),
      repo = new AtomicRepository(port, factory, name);
    await repo.initialize();
    return { repo, port, factory, name };
  }
  it("links several independent care series to one existing visit without touching work or money", () => {
    const d = seed(),
      second = {
        ...d.taskSchedules[0],
        id: "second-care",
        title: "Drugie działanie",
        revision: 0,
      },
      added = saveTaskSchedule(d, second, at),
      one = done(added, "2027-04-08", "job-1");
    const two = completeCareOccurrence(
      one,
      second.id,
      "2027-04-01",
      1,
      "2027-04-08",
      "job-1",
      at,
    );
    validateData(two);
    expect(
      two.taskOccurrences.filter((o) => o.completion?.jobId === "job-1"),
    ).toHaveLength(2);
    expect(two.jobs).toEqual(d.jobs);
    expect(two.payments).toEqual(d.payments);
    expect(two.timer).toEqual(d.timer);
  });
  it("only one different actual date wins concurrent confirmations; neither history nor the next cursor is overwritten", async () => {
    const f = await authority();
    const other = new AtomicRepository(f.port, f.factory, f.name);
    await other.initialize();
    const result = await Promise.allSettled([
      f.repo.command(
        (s) =>
          s.completeCareOccurrence(
            "care-test",
            "2027-04-01",
            1,
            "2027-04-08",
            null,
          ),
        () => at,
      ),
      other.command(
        (s) =>
          s.completeCareOccurrence(
            "care-test",
            "2027-04-01",
            1,
            "2027-04-09",
            null,
          ),
        () => at,
      ),
    ]);
    expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const data = (await f.repo.read()).data;
    expect(data.taskOccurrences).toHaveLength(2);
    expect(data.taskOccurrences[0].completion!.performedOn).toBe("2027-04-08");
    expect(current(data).date).toBe("2027-05-08");
    await f.repo.close();
    await other.close();
  });
  it("upgrades old authoritative v9 state without changing any data, preserving the exact pre-upgrade state", async () => {
    const data = finalData(),
      factory = new IDBFactory(),
      name = crypto.randomUUID(),
      old = { revision: 47, data };
    await new Promise<void>((resolve, reject) => {
      const r = factory.open(name, 1);
      r.onupgradeneeded = () => r.result.createObjectStore("state");
      r.onsuccess = () => {
        const db = r.result,
          tx = db.transaction("state", "readwrite");
        tx.objectStore("state").put(old, "current");
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onabort = () => reject(tx.error);
      };
    });
    const port = { getItem: () => null, setItem: () => {} },
      repo = new AtomicRepository(port, factory, name);
    const initialized = await repo.initialize();
    expect(initialized.data).toEqual(data);
    expect(initialized.revision).toBe(47);
    const stored = await new Promise<any>((resolve) => {
      const r = factory.open(name, 1);
      r.onsuccess = () => {
        const db = r.result,
          tx = db.transaction("state", "readonly"),
          s = tx.objectStore("state"),
          a = s.get("current"),
          b = s.get("format-v9-source");
        tx.oncomplete = () => {
          db.close();
          resolve({ current: a.result, source: b.result });
        };
      };
    });
    expect(stored.source).toEqual(old);
    expect(stored.current.formatVersion).toBe(STORAGE_VERSION);
    await repo.close();
  });
  it("rejects an import confirmed from a snapshot older than a care completion", async () => {
    const f = await authority(),
      before = await f.repo.read();
    await f.repo.command(
      (s) =>
        s.completeCareOccurrence(
          "care-test",
          "2027-04-01",
          1,
          "2027-04-08",
          null,
        ),
      () => at,
    );
    await expect(
      f.repo.command((s) =>
        s.restoreSnapshot(before.data, JSON.stringify(before.data)),
      ),
    ).rejects.toThrow();
    expect((await f.repo.read()).data.taskOccurrences).toHaveLength(2);
    await f.repo.close();
  });
  it("season edits preserve completed history and move only the unresolved cursor into the new active season", () => {
    const d = done(seed(), "2027-04-08"),
      history = structuredClone(d.taskOccurrences[0]),
      s = d.taskSchedules[0];
    const next = saveTaskSchedule(
      d,
      { ...s, care: { ...s.care!, season: { from: "06-01", to: "09-30" } } },
      at,
    );
    validateData(next);
    expect(next.taskOccurrences[0]).toEqual(history);
    expect(current(next).date).toBe("2027-06-01");
  });
});

it("multiple rounds of two-tab confirmations produce exactly one successor per completed cycle", async () => {
  const values = new Map([
      [STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, data: seed() })],
    ]),
    port = {
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => {
        values.set(k, v);
      },
    },
    factory = new IDBFactory(),
    a = new AtomicRepository(port, factory, "care-repeated"),
    b = new AtomicRepository(port, factory, "care-repeated");
  await Promise.all([a.initialize(), b.initialize()]);
  for (let i = 0; i < 10; i++) {
    const data = (await a.read()).data,
      o = current(data),
      date = `2027-04-${String(i + 8).padStart(2, "0")}`;
    await Promise.all([
      a.command(
        (s) =>
          s.completeCareOccurrence(
            o.scheduleId,
            o.originalDate,
            o.careCycle!,
            date,
            null,
          ),
        () => at,
      ),
      b.command(
        (s) =>
          s.completeCareOccurrence(
            o.scheduleId,
            o.originalDate,
            o.careCycle!,
            date,
            null,
          ),
        () => at,
      ),
    ]);
    const saved = (await a.read()).data;
    expect(saved.taskOccurrences).toHaveLength(i + 2);
    expect(
      saved.taskOccurrences.filter((o) => o.status === "planned"),
    ).toHaveLength(1);
  }
  const final = (await b.read()).data;
  expect(final.taskOccurrences.filter((o) => o.completion)).toHaveLength(10);
  await a.close();
  await b.close();
  const reopened = new AtomicRepository(port, factory, "care-repeated");
  expect((await reopened.initialize()).data).toEqual(final);
  await reopened.close();
});
