import { createDemoData } from "../src/data/demo";
import type { TaskSchedule } from "../src/planning/model";
import { virtualOccurrence } from "../src/planning/occurrences";
export const planningClock = new Date("2026-11-01T10:00:00+01:00");
export function planningNavigationData() {
  const d = createDemoData(planningClock);
  d.gardens[0].zones = [
    {
      id: "zone-navigation",
      name: "Rabata nawigacyjna",
      type: "rabata",
      area: 25,
      length: null,
      plants: "Róże",
      requirements: "Podlewanie rano",
      treatments: "",
    },
  ];
  const s: TaskSchedule = {
    id: "series-navigation",
    title: "Nawigacyjna pielęgnacja",
    notes: "Seria testowa",
    clientId: "client-1",
    gardenId: "garden-1",
    zoneId: "zone-navigation",
    zoneName: "Rabata nawigacyjna",
    startDate: "2026-10-31",
    endDate: "2027-02-28",
    time: "08:00",
    recurrence: {
      frequency: "days",
      interval: 14,
      months: Array.from({ length: 12 }, (_, i) => i + 1),
    },
    endedOn: null,
    revision: 1,
    updatedAt: planningClock.getTime(),
  };
  d.taskSchedules = [s];
  const linked = {
    ...virtualOccurrence(s, "2026-11-28"),
    jobId: "linked-work",
    revision: 1,
  };
  d.taskOccurrences = [
    { ...virtualOccurrence(s, "2026-10-31"), date: "2026-11-03", revision: 1 },
    { ...virtualOccurrence(s, "2026-11-14"), status: "cancelled", revision: 1 },
    linked,
  ];
  d.jobs.push({
    ...d.jobs[0],
    id: "linked-work",
    title: "Powiązana wizyta",
    date: "2026-12-01",
    time: "10:00",
    taskOccurrenceId: linked.id,
    seconds: 123,
  });
  return d;
}
