import type { Data } from "../domain";
import { scheduleDates } from "./dates";
import {
  occurrenceId,
  taskStatus,
  type TaskOccurrence,
  type TaskSchedule,
} from "./model";

export function virtualOccurrence(
  schedule: TaskSchedule,
  date: string,
  careCycle?: number,
): TaskOccurrence {
  const {
    title,
    notes,
    clientId,
    gardenId,
    zoneId,
    zoneName,
    time,
    updatedAt,
  } = schedule;
  return {
    id: occurrenceId(schedule.id, date, careCycle),
    ...(careCycle === undefined ? {} : { careCycle, completion: null }),
    scheduleId: schedule.id,
    originalDate: date,
    date,
    time,
    title,
    notes,
    clientId,
    gardenId,
    zoneId,
    zoneName,
    updatedAt,
    revision: 0,
    status: "planned",
    jobId: null,
  };
}
export function resolveOccurrence(
  data: Data,
  scheduleId: string,
  originalDate: string,
  careCycle?: number,
): TaskOccurrence {
  const candidates = data.taskOccurrences.filter(
    (item) =>
      item.scheduleId === scheduleId &&
      item.originalDate === originalDate &&
      (careCycle === undefined || item.careCycle === careCycle),
  );
  if (candidates.length > 1)
    throw new Error(
      "Termin jest niejednoznaczny. Wybierz konkretne wykonanie w historii serii.",
    );
  const stored = candidates[0];
  if (stored) return stored;
  const schedule = data.taskSchedules.find((item) => item.id === scheduleId);
  if (
    !schedule ||
    schedule.care ||
    careCycle !== undefined ||
    ![...scheduleDates(schedule, originalDate, originalDate)].length
  )
    throw new Error(
      "Termin nie należy już do harmonogramu. Otwórz go ponownie.",
    );
  return virtualOccurrence(schedule, originalDate);
}
/** Materialize only visible dates. Persisted exceptions stay visible after rule edits. */
export function taskOccurrencesBetween(
  data: Data,
  from: string,
  to: string,
  pendingOnly = false,
  limit = Infinity,
): TaskOccurrence[] {
  const stored = new Map(data.taskOccurrences.map((item) => [item.id, item]));
  const result: TaskOccurrence[] = [];
  const eligible = (item: TaskOccurrence) => {
    const job = data.jobs.find((job) => job.id === item.jobId);
    const date =
      item.careCycle !== undefined ? item.date : (job?.date ?? item.date);
    return (
      date >= from &&
      date <= to &&
      (!pendingOnly ||
        !["completed", "cancelled"].includes(taskStatus(data, item)))
    );
  };
  for (const schedule of data.taskSchedules) {
    if (schedule.care) continue;
    let count = 0;
    for (const date of scheduleDates(schedule, from, to)) {
      const id = occurrenceId(schedule.id, date);
      if (stored.has(id)) continue;
      const occurrence = virtualOccurrence(schedule, date);
      if (eligible(occurrence)) {
        result.push(occurrence);
        if (++count >= limit) break;
      }
    }
  }
  result.push(...data.taskOccurrences.filter(eligible));
  return result
    .sort((a, b) => {
      const left = data.jobs.find((job) => job.id === a.jobId),
        right = data.jobs.find((job) => job.id === b.jobId);
      return `${a.careCycle !== undefined ? a.date : (left?.date ?? a.date)}${a.careCycle !== undefined ? a.time : (left?.time ?? a.time)}${a.id}`.localeCompare(
        `${b.careCycle !== undefined ? b.date : (right?.date ?? b.date)}${b.careCycle !== undefined ? b.time : (right?.time ?? b.time)}${b.id}`,
      );
    })
    .slice(0, limit);
}
