import type { Data, Job } from "../domain";
import {
  availabilityConflict,
  availabilitySignature,
  dayAvailability,
  validateAvailabilityDates,
  validateAvailabilityRule,
  type AvailabilityRule,
  type AvailabilityExpected,
  type AvailabilityPermit,
} from "./model";
export function changeAvailability(
  data: Data,
  dates: readonly string[],
  rule: AvailabilityRule | null,
  expected: AvailabilityExpected,
  now: number,
): Data {
  validateAvailabilityDates(dates);
  if (rule !== null) validateAvailabilityRule(rule);
  if (
    !Array.isArray(expected) ||
    expected.length !== dates.length ||
    new Set(expected.map((e) => e.date)).size !== dates.length ||
    dates.some(
      (date) =>
        expected.find((e) => e.date === date)?.signature !==
        availabilitySignature(data, date),
    )
  )
    throw new Error(
      "Dostępność zmieniła się w innej karcie. Zamknij formularz i otwórz ponownie, aby sprawdzić aktualne dni. Nie zapisano żadnego z wybranych dni.",
    );
  const selected = new Set(dates),
    remaining = (data.availability ?? []).filter((d) => !selected.has(d.date));
  if (rule === null && !dates.some((date) => dayAvailability(data, date)))
    return data;
  const added =
    rule === null
      ? []
      : dates.map((date) => ({
          ...rule,
          note: rule.note.trim(),
          date,
          revision: (dayAvailability(data, date)?.revision ?? 0) + 1,
          updatedAt: now,
        }));
  return {
    ...data,
    availability: [...remaining, ...added].sort((a, b) =>
      a.date.localeCompare(b.date),
    ),
  };
}
/** A scheduling warning can be overridden only for the exact date/time and latest day record. */
export function checkJobAvailability(
  data: Data,
  job: Job,
  existing: Job | undefined,
  permit?: AvailabilityPermit,
) {
  if (
    job.status === "completed" ||
    (existing &&
      existing.date === job.date &&
      existing.time === job.time &&
      existing.status !== "completed")
  )
    return;
  const conflict = availabilityConflict(data, job.date, job.time);
  if (!conflict) return;
  if (
    !permit?.accepted ||
    permit.date !== job.date ||
    permit.time !== job.time ||
    permit.signature !== availabilitySignature(data, job.date)
  )
    throw new Error(
      "Termin koliduje z aktualną dostępnością. Sprawdź ostrzeżenie i wybierz „Zaplanuj mimo wszystko” albo zmień termin.",
    );
}
