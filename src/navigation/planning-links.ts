import type { Card } from "./routes";
import type { TaskOccurrence } from "../planning/model";
import { pendingCareOccurrence } from "../planning/care";
import type { Data } from "../domain";
import { addDays } from "../planning/dates";
import {
  resolveOccurrence,
  taskOccurrencesBetween,
} from "../planning/occurrences";

/** Read projections only: never materialize or save a virtual occurrence. */
export function scheduleWindow(
  data: Data,
  id: string,
  from: string,
  limit = 24,
  pendingOnly = false,
) {
  let to: string;
  try {
    to = addDays(from, 365);
  } catch {
    to = "9999-12-31";
  }
  return taskOccurrencesBetween(
    {
      ...data,
      taskSchedules: data.taskSchedules.filter((s) => s.id === id),
      taskOccurrences: data.taskOccurrences.filter((o) => o.scheduleId === id),
    },
    from,
    to,
    pendingOnly,
    limit,
  );
}
export function jobSource(data: Data, jobId: string) {
  const job = data.jobs.find((j) => j.id === jobId);
  return data.taskOccurrences.find(
    (o) => o.id === job?.taskOccurrenceId && o.jobId === jobId,
  );
}
export function occurrenceCard(o: TaskOccurrence): Card {
  return {
    kind: "task",
    id: o.scheduleId,
    originalDate: o.originalDate,
    ...(o.careCycle !== undefined ? { cycle: o.careCycle } : {}),
  };
}
export function occurrenceDate(
  data: Data,
  id: string,
  originalDate: string,
  cycle?: number,
) {
  const o = resolveOccurrence(data, id, originalDate, cycle);
  return o.careCycle !== undefined
    ? o.date
    : (data.jobs.find((j) => j.id === o.jobId)?.date ?? o.date);
}
export function nextScheduleOccurrence(data: Data, id: string, today: string) {
  const s = data.taskSchedules.find((s) => s.id === id);
  if (!s) return null;
  const next = s.care
    ? pendingCareOccurrence(data, id)
    : scheduleWindow(data, id, today, 1, true)[0];
  if (next) return next;
  const stored = data.taskOccurrences
    .filter((o) => o.scheduleId === id)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  if (stored) return stored;
  try {
    return resolveOccurrence(data, id, s.startDate);
  } catch {
    return null;
  }
}
