import { careData, careClock } from "./care-fixture";
export { careClock as availabilityClock };
export const availabilityDate = "2027-04-01";
export const availabilityURL =
  "/#calendar?date=2027-04-01&view=month&gardenFilter=garden-1&kindFilter=work";
export function availabilityData() {
  const d = careData();
  d.jobs.push({
    ...d.jobs.find((j) => j.id === "finance-pending")!,
    id: "availability-existing",
    title: "Zaplanowane koszenie",
    date: availabilityDate,
    time: "09:00",
    status: "planned",
    settlement: null,
    taskOccurrenceId: undefined,
    reports: undefined,
  });
  return d;
}
