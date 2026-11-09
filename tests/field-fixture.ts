import { availabilityData, availabilityClock } from "./availability-fixture";
import {
  beginTaskOccurrence,
  saveTaskSchedule,
} from "../src/planning/commands";
import { careSchedule } from "./care-fixture";
import { createBlankChecklist } from "../src/checklists/commands";
import { newChecklistItem } from "../src/checklists/model";
import { newNote } from "../src/desk/model";
export { availabilityClock as fieldClock };
export const fieldDay = "2027-06-20";
export const fieldURL = "/#field?field=field-today";
export function fieldData() {
  let d = availabilityData();
  const base = d.jobs.find((j) => j.id === "availability-existing")!;
  d.jobs = d.jobs.filter((j) => j.id !== base.id);
  d.jobs.push({
    ...base,
    id: "field-today",
    title: "Terenowe koszenie",
    date: fieldDay,
    activities: [],
    seconds: 0,
    materials: [],
    notes: "Uwaga na młode róże.",
  });
  d.jobs.push({
    ...base,
    id: "field-next",
    title: "Jutrzejszy żywopłot",
    date: "2027-06-21",
    seconds: 0,
    activities: [],
    materials: [],
  });
  d.availability = [
    {
      date: "2027-06-21",
      kind: "until",
      from: null,
      to: "14:00",
      reason: "pawnshop",
      note: "Zmiana popołudniowa",
      revision: 1,
      updatedAt: availabilityClock.getTime(),
    },
  ];
  const list = createBlankChecklist(
    d,
    { kind: "visit", jobId: "field-today", zoneId: "zone-doc" },
    "Przygotowanie terenu",
    availabilityClock.getTime(),
  );
  d = list.data;
  const c = d.checklists.find((c) => c.id === list.id)!;
  c.id = "field-list";
  c.items = [newChecklistItem("Sprawdź bramę", availabilityClock.getTime())];
  d.notes.push({
    ...newNote(d, { jobId: "field-today" }),
    id: "field-note",
    title: "Uwaga terenowa",
    body: "Nie zadepcz rabaty",
    revision: 1,
    createdAt: availabilityClock.getTime(),
    updatedAt: availabilityClock.getTime(),
  });
  d = saveTaskSchedule(
    d,
    careSchedule({ id: "field-care", startDate: fieldDay, revision: 0 }),
    availabilityClock.getTime(),
  );
  const started = beginTaskOccurrence(
    d,
    "field-care",
    fieldDay,
    availabilityClock.getTime(),
    undefined,
    undefined,
    1,
  );
  // The fixture has an existing, stopped real visit from a care occurrence.
  d = started.data;
  d.timer = null;
  return d;
}
