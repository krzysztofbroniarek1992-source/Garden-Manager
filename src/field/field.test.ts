import { describe, it, expect } from "vitest";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { fieldData, fieldClock, fieldDay } from "../../tests/field-fixture";
import { fieldJobs } from "./model";
import {
  controlVisitTimer,
  finishFieldVisit,
  saveVisitActivities,
  timerEventId,
} from "./commands";
import { elapsedSeconds, type Data } from "../domain";
import { AtomicRepository } from "../data/atomic";
import { STORAGE_KEY, STORAGE_VERSION, validateData } from "../data/repository";
import {
  address,
  openCard,
  parseAddress,
  type Route,
} from "../navigation/routes";
const at = fieldClock.getTime(),
  id = "field-today";
function repository() {
  const source = fieldData(),
    values = new Map([
      [STORAGE_KEY, JSON.stringify({ version: 10, data: source })],
    ]),
    factory = new IDBFactory();
  const port = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  return {
    a: new AtomicRepository(port, factory, "field-test"),
    b: new AtomicRepository(port, factory, "field-test"),
    source,
    values,
  };
}
describe("GM-007 shared visit projection and controls", () => {
  it("only reads existing jobs, puts an active visit before searched work, and preserves all source data", () => {
    const data = fieldData(),
      before = structuredClone(data);
    validateData(data);
    expect(fieldJobs(data, fieldDay).today.some((j) => j.id === id)).toBe(true);
    expect(
      fieldJobs(data, fieldDay).upcoming.some((j) => j.id === "field-next"),
    ).toBe(true);
    expect(
      fieldJobs(data, fieldDay, "Terenowe").today.map((j) => j.id),
    ).toEqual([id]);
    expect(fieldJobs(data, fieldDay, "nie ma nic").today).toEqual([]);
    expect(data).toEqual(before);
    const running = controlVisitTimer(data, id, "start", null, at);
    expect(fieldJobs(running, fieldDay, "nie ma nic").active?.id).toBe(id);
  });
  it("uses timestamp time after two hours without a running JS process, preserving pauses and seconds", () => {
    let d = controlVisitTimer(fieldData(), id, "start", null, at);
    const job = () => d.jobs.find((j) => j.id === id)!;
    expect(elapsedSeconds(job(), d.timer, at + 7200321)).toBe(7200);
    d = controlVisitTimer(d, id, "pause", d.timer, at + 7200321);
    expect(elapsedSeconds(job(), d.timer, at + 9000000)).toBe(7200);
    d = controlVisitTimer(d, id, "resume", d.timer, at + 9000000);
    d = controlVisitTimer(d, id, "stop", d.timer, at + 9001679);
    expect(job().seconds).toBe(7202);
    expect(d.timer).toBeNull();
    expect(job().status).toBe("in-progress");
    expect(job().settlement).toBeNull();
  });
  it("separates STOP, finish and explicit GM-005 confirmation without approving a price", () => {
    const d = fieldData(),
      source = structuredClone(d.taskOccurrences),
      schedules = structuredClone(d.taskSchedules);
    const running = controlVisitTimer(d, id, "start", null, at);
    expect(() => finishFieldVisit(running, id, at + 5000)).toThrow(/STOP/);
    const stopped = controlVisitTimer(
        running,
        id,
        "stop",
        running.timer,
        at + 5000,
      ),
      finished = finishFieldVisit(stopped, id, at + 6000);
    expect(finished.jobs.find((j) => j.id === id)).toMatchObject({
      status: "completed",
      seconds: 5,
      settlement: null,
    });
    expect(finished.taskOccurrences).toEqual(source);
    expect(finished.taskSchedules).toEqual(schedules);
    expect(finished.payments).toEqual(d.payments);
    expect(finished.availability).toEqual(d.availability);
  });
  it.each(["pause", "resume", "stop"] as const)(
    "a stale %s never controls a timer switched by another tab",
    (action) => {
      const d = fieldData(),
        first = controlVisitTimer(d, id, "start", null, at),
        other = controlVisitTimer(d, "field-next", "start", null, at);
      expect(() =>
        controlVisitTimer(other, id, action, first.timer, at + 1000),
      ).toThrow(/innej karcie/);
      expect(other.timer?.jobId).toBe("field-next");
    },
  );
  it("refuses second START and a stale pause/stop without resetting the current interval", () => {
    const d = controlVisitTimer(fieldData(), id, "start", null, at),
      before = structuredClone(d);
    expect(() => controlVisitTimer(d, id, "start", null, at + 1000)).toThrow();
    expect(() =>
      controlVisitTimer(d, "field-next", "start", d.timer, at + 1000),
    ).toThrow(/aktywny/);
    const paused = controlVisitTimer(d, id, "pause", d.timer, at + 1000);
    expect(() =>
      controlVisitTimer(paused, id, "stop", d.timer, at + 2000),
    ).toThrow();
    expect(d).toEqual(before);
  });
  it("editing activities preserves the active timer, materials, reports, payments, availability and every other job field", () => {
    const d = controlVisitTimer(fieldData(), id, "start", null, at),
      before = structuredClone(d);
    const next = saveVisitActivities(
        d,
        id,
        "garden-1",
        [" Koszenie ", " Cięcie ", ""],
        [],
      ),
      j = next.jobs.find((j) => j.id === id)!;
    expect(j.activities).toEqual(["Koszenie", "Cięcie"]);
    expect({ ...j, activities: [] }).toEqual(
      before.jobs.find((j) => j.id === id),
    );
    expect({ ...next, jobs: before.jobs }).toEqual(before);
    validateData(next);
  });
  it("stale activities, moved or deleted jobs cannot be recreated or overwrite another edit", () => {
    const d = fieldData(),
      next = saveVisitActivities(d, id, "garden-1", ["Pierwsza edycja"], []);
    expect(() =>
      saveVisitActivities(next, id, "garden-1", ["Druga edycja"], []),
    ).toThrow(/innej karcie/);
    expect(() => saveVisitActivities(d, id, "inny-ogród", [], [])).toThrow();
    expect(() =>
      saveVisitActivities(
        { ...d, jobs: d.jobs.filter((j) => j.id !== id) },
        id,
        "garden-1",
        [],
        [],
      ),
    ).toThrow();
  });
  it.each(["work", "photos", "notes", "checklists", "materials"] as const)(
    "addresses the %s section without data/schema writes",
    (section) => {
      const route: Route = {
        page: "field",
        cards: [{ kind: "field", id: "wizyta / Łódź", section }],
      };
      expect(parseAddress("http://localhost:5173/" + address(route))).toEqual({
        route,
        invalid: false,
      });
      expect(STORAGE_VERSION).toBe(11);
    },
  );
  it.each([
    "#field?field=",
    "#field?field=j&section=billing",
    "#field?field=j&job=j",
    "#field?field=j&section=nope",
  ])("rejects malformed %s", (url) =>
    expect(parseAddress("http://localhost:5173/" + url).invalid).toBe(true),
  );
  it("returns to an existing field card without duplicating a visit", () => {
    const route: Route = {
      page: "calendar",
      cards: [
        { kind: "field", id },
        { kind: "job", id },
      ],
    };
    expect(openCard(route, { kind: "field", id }).cards).toEqual([
      { kind: "field", id },
    ]);
  });
});
describe("GM-007 real transaction boundary", () => {
  it("an old STOP cannot stop a restarted interval with the same millisecond timestamp", async () => {
    const { a } = repository();
    try {
      await a.initialize();
      await a.command(
        (s) => s.controlVisitTimer(id, "start", null, null),
        () => at,
      );
      const old = (await a.read()).data;
      await a.command(
        (s) => s.controlVisitTimer(id, "stop", old.timer, timerEventId(old)),
        () => at,
      );
      await a.command(
        (s) => s.controlVisitTimer(id, "start", null, null),
        () => at,
      );
      const current = (await a.read()).data;
      expect(current.timer).toEqual(old.timer);
      expect(timerEventId(current)).not.toBe(timerEventId(old));
      await expect(
        a.command(
          (s) => s.controlVisitTimer(id, "stop", old.timer, timerEventId(old)),
          () => at,
        ),
      ).rejects.toThrow(/innej karcie/);
      expect((await a.read()).data).toEqual(current);
    } finally {
      await a.close();
    }
  });

  it("serializes simultaneous STARTs in two stores, preserving one timer and all other data", async () => {
    const { a, b, source } = repository();
    try {
      await a.initialize();
      await b.initialize();
      const results = await Promise.allSettled([
        a.command(
          (s) => s.controlVisitTimer(id, "start", null, null),
          () => at,
        ),
        b.command(
          (s) => s.controlVisitTimer("field-next", "start", null, null),
          () => at,
        ),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
      const next = (await a.read()).data;
      expect([id, "field-next"]).toContain(next.timer?.jobId);
      expect(next.payments).toEqual(source.payments);
      expect(next.taskSchedules).toEqual(source.taskSchedules);
      validateData(next);
    } finally {
      await a.close();
      await b.close();
    }
  });
  it("merges independent materials and activities with elapsed time, while keeping approved dues frozen", async () => {
    const { a, b, source } = repository();
    try {
      await a.initialize();
      await b.initialize();
      await a.command(
        (s) => s.controlVisitTimer(id, "start", null, null),
        () => at,
      );
      await Promise.all([
        a.command((s) =>
          s.saveVisitActivities(id, "garden-1", ["Koszenie", "Sprzątanie"], []),
        ),
        b.command((s) =>
          s.addJobMaterial(id, "garden-1", [
            { id: "a", name: "Kora", quantity: 2, unitPrice: 10 },
            { id: "b", name: "Ziemia", quantity: 1, unitPrice: 8 },
          ]),
        ),
      ]);
      const running = (await a.read()).data;
      expect(running.timer?.startedAt).toBe(at);
      expect(running.jobs.find((j) => j.id === id)?.materials).toHaveLength(2);
      expect(running.jobs.find((j) => j.id === id)?.activities).toHaveLength(2);
      const approved = source.jobs.find((j) => j.settlement)!;
      await b.command((s) =>
        s.addJobMaterial(approved.id, approved.gardenId, {
          id: "c",
          name: "Nawóz",
          quantity: 1,
          unitPrice: 20,
        }),
      );
      const next = (await a.read()).data;
      expect(next.jobs.find((j) => j.id === approved.id)?.settlement).toEqual(
        approved.settlement,
      );
      expect(next.payments).toEqual(source.payments);
      expect(next.reportSequence).toBe(source.reportSequence);
      validateData(next);
    } finally {
      await a.close();
      await b.close();
    }
  });
  it("aborted/quota writes leave the complete visit and timer unchanged, never falling back to localStorage", async () => {
    const { a, source, values } = repository();
    try {
      await a.initialize();
      const raw = values.get(STORAGE_KEY),
        put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (
        ...args: Parameters<IDBObjectStore["put"]>
      ) {
        if (args[1] === "current")
          throw new DOMException("No space", "QuotaExceededError");
        return put.apply(this, args);
      };
      try {
        await expect(
          a.command(
            (s) => s.controlVisitTimer(id, "start", null, null),
            () => at,
          ),
        ).rejects.toThrow();
      } finally {
        IDBObjectStore.prototype.put = put;
      }
      expect((await a.read()).data).toEqual(source);
      expect(values.get(STORAGE_KEY)).toBe(raw);
    } finally {
      await a.close();
    }
  });
  it("reopens the same v10 state and active timestamp without migrating business data", async () => {
    const { a, b, source } = repository();
    try {
      await a.initialize();
      await a.command(
        (s) => s.controlVisitTimer(id, "start", null, null),
        () => at,
      );
      await a.close();
      const next = (await b.initialize()).data;
      expect(next.timer?.startedAt).toBe(at);
      expect(
        elapsedSeconds(
          next.jobs.find((j) => j.id === id)!,
          next.timer,
          at + 7200000,
        ),
      ).toBe(7200);
      expect(next.availability).toEqual(source.availability);
      expect(next.photos).toEqual(source.photos);
      expect(
        JSON.parse(JSON.stringify({ version: 10, data: next })).data,
      ).toEqual(next);
      validateData(next);
    } finally {
      await a.close();
      await b.close();
    }
  });
});
