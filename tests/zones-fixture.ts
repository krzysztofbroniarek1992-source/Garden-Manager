import { financeData } from "./finance-fixture";
import { virtualOccurrence } from "../src/planning/occurrences";
import type { TaskSchedule } from "../src/planning/model";
export const zonesClock = new Date("2026-11-16T09:00:00Z");
export function zonesData() {
  const d = financeData(),
    zone = d.gardens[0].zones[0];
  Object.assign(zone, {
    name: "Rabata różana",
    type: "rabata",
    area: 12.3456789,
    length: null,
    plants: "Róże 'New Dawn'\nSzałwia",
    requirements: "Podlewanie rano",
    treatments: "2026-10-20: Przycięto róże\nKontrola stanu liści",
  });
  d.gardens[0].zones.push({
    ...zone,
    id: "zone-lawn",
    name: "Trawnik",
    type: "trawnik",
    area: 200,
    plants: "Mieszanka traw",
    treatments: "",
  });
  d.gardens[5].zones = [{ ...zone, name: "Rabata weekendowa" }];
  const s: TaskSchedule = {
    id: "care-series",
    title: "Pielęgnacja róż",
    notes: "Kontrola róż i porządkowanie rabaty",
    clientId: "client-1",
    gardenId: "garden-1",
    zoneId: "zone-doc",
    zoneName: zone.name,
    startDate: "2026-11-01",
    endDate: "2027-02-28",
    time: "08:00",
    recurrence: {
      frequency: "days",
      interval: 14,
      months: Array.from({ length: 12 }, (_, i) => i + 1),
    },
    endedOn: null,
    revision: 1,
    updatedAt: zonesClock.getTime(),
  };
  d.taskSchedules = [
    s,
    {
      ...s,
      id: "care-lawn-series",
      zoneId: "zone-lawn",
      zoneName: "Trawnik",
      title: "Pielęgnacja trawnika",
    },
    {
      ...s,
      id: "care-weekend-series",
      gardenId: "garden-6",
      zoneName: "Rabata weekendowa",
    },
  ];
  const done = {
    ...virtualOccurrence(s, "2026-11-01"),
    jobId: "job-1",
    revision: 1,
  };
  d.taskOccurrences = [
    done,
    { ...virtualOccurrence(s, "2026-11-15"), date: "2026-11-17", revision: 1 },
    { ...virtualOccurrence(s, "2026-11-29"), status: "cancelled", revision: 1 },
  ];
  d.jobs[0].taskOccurrenceId = done.id;
  d.jobs[0].date = done.date;
  d.jobs[0].time = done.time;
  for (const [id, zoneId, zoneName] of [
    ["finance-pending", "zone-lawn", "Trawnik"],
    ["finance-paid", "zone-doc", "Rabata weekendowa"],
  ] as const) {
    d.jobs.find((j) => j.id === id)!.visitDetails = {
      zoneId,
      zoneName,
      publicWork: "Wykonane prace",
      clientRemarks: "",
      revision: 1,
      updatedAt: zonesClock.getTime(),
    };
  }
  d.jobs.push({
    ...d.jobs[0],
    id: "care-unassigned",
    title: "Róże w opisie bez przypisania strefy",
    notes: "Rabata różana",
    activities: ["Rabata różana"],
    taskOccurrenceId: undefined,
    reports: undefined,
  });
  return d;
}
