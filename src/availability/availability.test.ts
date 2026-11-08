import { describe, it, expect, vi } from "vitest";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { careData, careClock } from "../../tests/care-fixture";
import {
  availabilityConflict,
  availabilitySignature,
  expectedAvailability,
  validateAvailabilityRule,
  defaultAvailability,
  type AvailabilityRule,
} from "./model";
import { changeAvailability } from "./commands";
import { nextAvailableDays, workConflicts } from "./queries";
import {
  validateData,
  STORAGE_VERSION,
  STORAGE_KEY,
  LocalRepository,
} from "../data/repository";
import { AtomicRepository } from "../data/atomic";
import { GardenStore } from "../data/store";
import { completeCareOccurrence, saveTaskSchedule } from "../planning/commands";
import { pendingCareOccurrence } from "../planning/care";
import {
  address,
  parseAddress,
  validRoute,
  cardKey,
  type Card,
} from "../navigation/routes";
const now = careClock.getTime(),
  day = "2027-04-01";
const blocked: AvailabilityRule = {
  ...defaultAvailability(),
  kind: "unavailable",
  reason: "pawnshop",
  note: "Zmiana 8:15–20:45",
};
const set = (data = careData(), rule = blocked, dates = [day]) =>
  changeAvailability(data, dates, rule, expectedAvailability(data, dates), now);
describe("GM-006 availability boundaries", () => {
  it.each([
    [defaultAvailability(), "00:00", false],
    [defaultAvailability(), "23:59", false],
    [blocked, "00:00", true],
    [blocked, "23:59", true],
    [{ ...defaultAvailability(), kind: "until", to: "14:00" }, "13:59", false],
    [{ ...defaultAvailability(), kind: "until", to: "14:00" }, "14:00", true],
    [{ ...defaultAvailability(), kind: "from", from: "14:00" }, "13:59", true],
    [{ ...defaultAvailability(), kind: "from", from: "14:00" }, "14:00", false],
    [
      { ...defaultAvailability(), kind: "range", from: "08:15", to: "20:45" },
      "08:14",
      true,
    ],
    [
      { ...defaultAvailability(), kind: "range", from: "08:15", to: "20:45" },
      "08:15",
      false,
    ],
    [
      { ...defaultAvailability(), kind: "range", from: "08:15", to: "20:45" },
      "20:44",
      false,
    ],
    [
      { ...defaultAvailability(), kind: "range", from: "08:15", to: "20:45" },
      "20:45",
      true,
    ],
  ] as [AvailabilityRule, string, boolean][])(
    "%o at %s conflicts=%s",
    (rule, time, conflict) => {
      const data = set(careData(), rule);
      validateData(data);
      expect(!!availabilityConflict(data, day, time)).toBe(conflict);
    },
  );
  it.each([
    { ...defaultAvailability(), kind: "range", from: "14:00", to: "08:00" },
    { ...defaultAvailability(), kind: "range", from: "14:00", to: "14:00" },
    { ...defaultAvailability(), kind: "until", to: "00:00" },
    { ...defaultAvailability(), kind: "until", to: "24:00" },
    { ...defaultAvailability(), kind: "from", from: "8:00" },
    { ...defaultAvailability(), kind: "unavailable", from: "09:00" },
    { ...defaultAvailability(), kind: "available", reason: "bad" },
    { ...defaultAvailability(), note: "a".repeat(501) },
  ])("rejects invalid rule %o", (rule) => {
    expect(() => validateAvailabilityRule(rule)).toThrow();
  });
  it("absent optional data means available without changing v10 or old data on read", () => {
    const data = careData(),
      raw = JSON.stringify({ version: 10, data }),
      values = new Map([[STORAGE_KEY, raw]]),
      repo = new LocalRepository({
        getItem: (k) => values.get(k) ?? null,
        setItem: (k, v) => {
          values.set(k, v);
        },
      });
    expect(repo.load()).toEqual(data);
    expect(values.get(STORAGE_KEY)).toBe(raw);
    expect(repo.load()).not.toHaveProperty("availability");
    expect(availabilityConflict(data, day, "16:00")).toBeNull();
    expect(STORAGE_VERSION).toBe(10);
  });
  it("mass changes preserve every existing business field and delete only selected settings", () => {
    const original = careData(),
      dates = [day, "2027-04-02", "2027-04-03"],
      data = set(original, blocked, dates);
    validateData(data);
    expect(data.availability).toHaveLength(3);
    const { availability: _a, ...business } = data;
    expect(business).toEqual(original);
    const removed = changeAvailability(
      data,
      [day, dates[2]],
      null,
      expectedAvailability(data, [day, dates[2]]),
      now,
    );
    expect(removed.availability?.map((d) => d.date)).toEqual([dates[1]]);
    expect(availabilityConflict(removed, day, "16:00")).toBeNull();
  });
  it("one stale date rejects the whole batch before any change", () => {
    const data = set(),
      expected = expectedAvailability(data, [day, "2027-04-02"]),
      newer = set(data, { ...blocked, note: "Nowszy grafik" });
    const before = structuredClone(newer);
    expect(() =>
      changeAvailability(
        newer,
        [day, "2027-04-02"],
        defaultAvailability(),
        expected,
        now,
      ),
    ).toThrow("innej karcie");
    expect(newer).toEqual(before);
  });
  it.each(
    [
      [],
      [day, day],
      ["2027-02-30"],
      Array.from({ length: 367 }, (_, i) => `2027-${i}`),
    ].map((dates) => ({ dates })),
  )("rejects malformed batch %o", ({ dates }) => {
    expect(() => set(careData(), blocked, dates)).toThrow();
  });
  it("rejects duplicate records and malformed v10 imports", () => {
    const data = set();
    data.availability!.push(data.availability![0]);
    expect(() => validateData(data)).toThrow();
  });
  it("checks the start only and requires an exact latest availability permit for scheduling", () => {
    let data = set(careData(), {
      ...defaultAvailability(),
      kind: "until",
      to: "14:00",
    });
    const port = {
        load: () => data,
        save: (d: typeof data) => {
          validateData(d);
          data = d;
        },
      },
      store = new GardenStore(port, () => now),
      job = {
        ...data.jobs[0],
        id: "new-work",
        date: day,
        time: "13:59",
        status: "planned" as const,
        settlement: null,
        seconds: 1000000,
        reports: undefined,
        taskOccurrenceId: undefined,
      };
    store.saveJob(job);
    expect(data.jobs.at(-1)!.seconds).toBe(1000000);
    const changed = { ...job, time: "16:00" };
    expect(() => store.saveJob(changed)).toThrow("Zaplanuj mimo wszystko");
    const permit = {
      date: day,
      time: "16:00",
      signature: availabilitySignature(data, day),
      accepted: true as const,
    };
    store.saveJob(changed, undefined, permit);
    data = set(data, { ...blocked, note: "Inny powód" });
    expect(() =>
      store.saveJob({ ...changed, id: "other-new" }, undefined, permit),
    ).toThrow();
  });
  it("blocking a day does not change existing jobs, settlements, timer or actual-date care rules", () => {
    const original = careData(),
      data = set(original);
    expect(
      workConflicts(data, day).some((c) => c.task?.scheduleId === "care-e2e"),
    ).toBe(true);
    expect(data.taskOccurrences).toEqual(original.taskOccurrences);
    expect(data.jobs).toEqual(original.jobs);
    expect(data.payments).toEqual(original.payments);
    expect(data.timer).toEqual(original.timer);
    const completed = completeCareOccurrence(
      data,
      "care-e2e",
      day,
      1,
      "2027-04-08",
      null,
      now,
    );
    expect(pendingCareOccurrence(completed, "care-e2e")!.date).toBe(
      "2027-05-08",
    );
    expect(completed.availability).toEqual(data.availability);
  });
  it("bounded nearest dates omit blocks, show partial days and count existing work without assuming duration", () => {
    const date = "2027-06-20",
      data = set(careData(), blocked, [date, "2027-06-22"]);
    const withPartial = set(
      data,
      { ...defaultAvailability(), kind: "from", from: "14:00" },
      ["2027-06-21"],
    );
    withPartial.jobs[0].date = "2027-06-21";
    const rows = nextAvailableDays(withPartial, date, new Date(now));
    expect(rows).toHaveLength(7);
    expect(rows[0]).toMatchObject({
      date: "2027-06-21",
      jobs: 1,
      rule: { kind: "from" },
    });
    expect(rows.some((r) => r.date === "2027-06-22")).toBe(false);
    expect(nextAvailableDays(withPartial, date, new Date(now), 7, 1)).toEqual(
      [],
    );
  });
  it("does not offer an already-ended window today and stops at date range limits", () => {
    const date = "2027-06-20",
      data = set(
        careData(),
        { ...defaultAvailability(), kind: "until", to: "01:00" },
        [date],
      );
    expect(nextAvailableDays(data, date, new Date(now))[0].date).toBe(
      "2027-06-21",
    );
    expect(nextAvailableDays(data, "9999-12-31", new Date(now))).toHaveLength(
      1,
    );
  });
});
describe("GM-006 same atomic authority and backup format", () => {
  async function setup() {
    const data = careData(),
      values = new Map([[STORAGE_KEY, JSON.stringify({ version: 10, data })]]),
      port = {
        getItem: (k: string) => values.get(k) ?? null,
        setItem: (k: string, v: string) => {
          values.set(k, v);
        },
      },
      factory = new IDBFactory(),
      name = crypto.randomUUID(),
      a = new AtomicRepository(port, factory, name),
      b = new AtomicRepository(port, factory, name);
    await Promise.all([a.initialize(), b.initialize()]);
    return { a, b, data, port, factory, name };
  }
  it("merges two tabs editing different dates; same-date stale batch loses without partial writes", async () => {
    const f = await setup();
    await Promise.all([
      f.a.command(
        (s) =>
          s.changeAvailability(
            [day],
            blocked,
            expectedAvailability(f.data, [day]),
          ),
        () => now,
      ),
      f.b.command(
        (s) =>
          s.changeAvailability(
            ["2027-04-02"],
            blocked,
            expectedAvailability(f.data, ["2027-04-02"]),
          ),
        () => now,
      ),
    ]);
    let data = (await f.a.read()).data;
    expect(data.availability).toHaveLength(2);
    const expected = expectedAvailability(data, [day, "2027-04-03"]);
    await f.a.command(
      (s) =>
        s.changeAvailability(
          [day],
          { ...blocked, note: "Zmieniono" },
          expectedAvailability(data, [day]),
        ),
      () => now,
    );
    await expect(
      f.b.command(
        (s) =>
          s.changeAvailability(
            [day, "2027-04-03"],
            defaultAvailability(),
            expected,
          ),
        () => now,
      ),
    ).rejects.toThrow();
    data = (await f.a.read()).data;
    expect(data.availability).toHaveLength(2);
    expect(data.availability?.find((d) => d.date === day)?.note).toBe(
      "Zmieniono",
    );
    await f.a.close();
    await f.b.close();
  });
  it("a failed write aborts the entire bulk save and preserves business data", async () => {
    const f = await setup(),
      before = await f.a.read(),
      put = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => {
        throw new DOMException("Full", "QuotaExceededError");
      });
    try {
      await expect(
        f.a.command(
          (s) =>
            s.changeAvailability(
              [day, "2027-04-02"],
              blocked,
              expectedAvailability(f.data, [day, "2027-04-02"]),
            ),
          () => now,
        ),
      ).rejects.toThrow();
    } finally {
      put.mockRestore();
    }
    expect(await f.a.read()).toEqual(before);
    await f.a.close();
    await f.b.close();
  });
  it("an old import cannot erase a newly committed availability change and state survives reopen", async () => {
    const f = await setup(),
      before = (await f.a.read()).data;
    await f.a.command(
      (s) =>
        s.changeAvailability(
          [day],
          blocked,
          expectedAvailability(before, [day]),
        ),
      () => now,
    );
    await expect(
      f.b.command((s) => s.restoreSnapshot(before, JSON.stringify(before))),
    ).rejects.toThrow("Dane zmieniły");
    const saved = (await f.a.read()).data;
    await f.a.close();
    await f.b.close();
    const reopened = new AtomicRepository(f.port, f.factory, f.name);
    expect((await reopened.initialize()).data).toEqual(saved);
    expect(new LocalRepository(f.port).load()).toEqual(saved);
    await reopened.close();
  });
});
describe("addressed availability cards", () => {
  it("roundtrips one day or a sorted batch with calendar context", () => {
    for (const dates of [[day], [day, "2027-04-02"]]) {
      const card: Card = {
          kind: "availability",
          id: day,
          ...(dates.length > 1 ? { dates } : {}),
        },
        route = {
          page: "calendar" as const,
          cards: [card],
          calendar: {
            date: day,
            anchor: day,
            view: "month" as const,
            gardenId: "garden-1",
          },
        };
      expect(validRoute(route)).toBe(true);
      expect(parseAddress("http://localhost:5173/" + address(route))).toEqual({
        route,
        invalid: false,
      });
    }
    expect(cardKey({ kind: "availability", id: day })).not.toBe(
      cardKey({ kind: "availability", id: day, dates: [day, "2027-04-02"] }),
    );
  });
  it.each([
    "#calendar?availability=bad",
    "#calendar?availability=2027-02-30",
    "#calendar?availability=2027-04-01&availabilityDates=2027-04-01,2027-04-01",
    "#calendar?availability=2027-04-01&availabilityDates=2027-04-02,2027-04-01",
    "#calendar?availabilityDates=2027-04-01",
    "#jobs?job=job-1&availabilityDates=2027-04-01",
  ])("rejects invalid address %s", (hash) =>
    expect(parseAddress("http://localhost:5173/" + hash).invalid).toBe(true),
  );
});
