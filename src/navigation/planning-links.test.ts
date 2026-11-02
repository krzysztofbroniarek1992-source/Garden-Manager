import { describe, it, expect } from "vitest";
import { createDemoData } from "../data/demo";
import { virtualOccurrence } from "../planning/occurrences";
import type { TaskSchedule } from "../planning/model";
import {
  scheduleWindow,
  nextScheduleOccurrence,
  occurrenceDate,
  jobSource,
} from "./planning-links";

const now = new Date("2026-11-01T10:00:00+01:00");
function fixture() {
  const data = createDemoData(now);
  const s: TaskSchedule = {
    id: "series:1",
    title: "Stała pielęgnacja",
    notes: "",
    clientId: "client-1",
    gardenId: "garden-1",
    zoneId: null,
    zoneName: null,
    startDate: "2026-10-31",
    endDate: null,
    time: "08:00",
    recurrence: {
      frequency: "days",
      interval: 14,
      months: Array.from({ length: 12 }, (_, i) => i + 1),
    },
    endedOn: null,
    revision: 1,
    updatedAt: now.getTime(),
  };
  data.taskSchedules = [s];
  const moved = {
    ...virtualOccurrence(s, "2026-10-31"),
    date: "2026-11-03",
    revision: 1,
  };
  const skipped = {
    ...virtualOccurrence(s, "2026-11-14"),
    status: "cancelled" as const,
    revision: 1,
  };
  const linked = {
    ...virtualOccurrence(s, "2026-11-28"),
    jobId: "job-1",
    revision: 1,
  };
  data.taskOccurrences = [moved, skipped, linked];
  data.jobs[0] = {
    ...data.jobs[0],
    taskOccurrenceId: linked.id,
    date: "2026-12-01",
    time: "10:00",
  };
  return { data, s, moved, skipped, linked };
}
describe("read-only planning navigation", () => {
  it("resolves moved and job dates by permanent occurrence identity", () => {
    const { data, s, linked } = fixture();
    const before = structuredClone(data);
    expect(occurrenceDate(data, s.id, "2026-10-31")).toBe("2026-11-03");
    expect(occurrenceDate(data, s.id, linked.originalDate)).toBe("2026-12-01");
    expect(jobSource(data, "job-1")).toEqual(linked);
    expect(data).toEqual(before);
  });
  it("includes skipped terms in history and chooses the first pending occurrence", () => {
    const { data, s, moved, skipped, linked } = fixture();
    const before = structuredClone(data);
    expect(scheduleWindow(data, s.id, "2026-11-01")).toContainEqual(skipped);
    expect(nextScheduleOccurrence(data, s.id, "2026-11-01")?.id).toBe(moved.id);
    expect(nextScheduleOccurrence(data, s.id, "2026-11-04")?.id).toBe(
      linked.id,
    );
    expect(data).toEqual(before);
  });
  it("limits the selected series without letting other schedules hide it", () => {
    const { data, s } = fixture();
    data.taskSchedules.unshift({
      ...s,
      id: "other",
      title: "Inna seria",
      recurrence: { ...s.recurrence, interval: 1 },
    });
    const rows = scheduleWindow(data, s.id, "2026-11-01", 3);
    expect(rows).toHaveLength(3);
    expect(rows.every((o) => o.scheduleId === s.id)).toBe(true);
    expect(new Set(rows.map((o) => o.id)).size).toBe(rows.length);
  });
  it("does not invent a relation for missing or detached records", () => {
    const { data } = fixture();
    expect(jobSource(data, "missing")).toBeUndefined();
    expect(scheduleWindow(data, "missing", "2026-11-01")).toEqual([]);
    expect(nextScheduleOccurrence(data, "missing", "2026-11-01")).toBeNull();
    data.taskOccurrences = [];
    expect(jobSource(data, "job-1")).toBeUndefined();
  });
});
