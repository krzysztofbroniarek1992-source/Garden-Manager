import { finalData } from "./final-navigation-fixture";
import { saveTaskSchedule } from "../src/planning/commands";
import type { TaskSchedule } from "../src/planning/model";
export const careClock = new Date("2027-06-20T12:00:00Z");
export function careSchedule(patch: Partial<TaskSchedule> = {}): TaskSchedule {
  return {
    id: "care-e2e",
    title: "Nawożenie GM-005",
    notes: "Dokładny opis czynności",
    startDate: "2027-04-01",
    endDate: null,
    time: "09:00",
    clientId: "client-1",
    gardenId: "garden-1",
    zoneId: "zone-doc",
    zoneName: "Rabata różana",
    care: { season: null, material: "Materiał zapisany przez ogrodnika" },
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
}
export function careData() {
  return saveTaskSchedule(finalData(), careSchedule(), careClock.getTime());
}
export const careURL =
  "/#calendar?task=care-e2e&original=2027-04-01&cycle=1&date=2027-04-01&view=day&gardenFilter=garden-1&kindFilter=work";
