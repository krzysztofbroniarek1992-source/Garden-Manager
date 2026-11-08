import type { Data } from "../domain";
import type { TaskSchedule } from "./model";
import { addDays, addMonths, dateNumber, isDate } from "./dates";

export function careDateAllowed(schedule: TaskSchedule, date: string) {
  const season = schedule.care?.season,
    md = date.slice(5);
  return (
    !season ||
    (season.from <= season.to
      ? md >= season.from && md <= season.to
      : md >= season.from || md <= season.to)
  );
}
/** First active civil day on/after the candidate. This also supports wrapped seasons and leap-day seasons. */
export function activeCareDate(
  schedule: TaskSchedule,
  candidate: string,
): string | null {
  if (!isDate(candidate)) throw new Error("Podaj poprawny termin zabiegu.");
  const end = [schedule.endDate, schedule.endedOn, "9999-12-31"]
    .filter((x): x is string => x !== null)
    .sort()[0];
  for (
    let n = dateNumber(candidate),
      last = Math.min(dateNumber(end), n + 366 * 8);
    n <= last;
    n++
  ) {
    const date = new Date(n * 86400000).toISOString().slice(0, 10);
    if (careDateAllowed(schedule, date)) return date;
  }
  return null;
}
/** Reuses the existing UTC civil-date arithmetic, independent of DST or the save timestamp. */
export function nextCareDate(
  schedule: TaskSchedule,
  performedOn: string,
): string | null {
  if (schedule.endedOn !== null) return null;
  const r = schedule.recurrence;
  let candidate: string | null;
  if (r.frequency === "months") candidate = addMonths(performedOn, r.interval);
  else {
    try {
      candidate = addDays(
        performedOn,
        r.interval * (r.frequency === "weeks" ? 7 : 1),
      );
    } catch {
      return null;
    }
  }
  return candidate ? activeCareDate(schedule, candidate) : null;
}
export const pendingCareOccurrence = (data: Data, scheduleId: string) =>
  data.taskOccurrences.find(
    (o) =>
      o.scheduleId === scheduleId &&
      o.careCycle !== undefined &&
      o.status === "planned",
  );
