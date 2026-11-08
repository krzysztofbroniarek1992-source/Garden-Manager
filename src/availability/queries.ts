import { localDate, type Data } from "../domain";
import { addDays } from "../planning/dates";
import { taskOccurrencesBetween } from "../planning/occurrences";
import { taskStatus } from "../planning/model";
import {
  availabilityConflict,
  availabilityWindow,
  dayAvailability,
} from "./model";
export function workConflicts(data: Data, from: string, to = from) {
  const jobs = data.jobs
    .filter(
      (j) =>
        j.date >= from &&
        j.date <= to &&
        j.status !== "completed" &&
        availabilityConflict(data, j.date, j.time),
    )
    .map((j) => ({
      id: j.id,
      date: j.date,
      time: j.time,
      title: j.title,
      jobId: j.id,
      task: null,
    }));
  const tasks = taskOccurrencesBetween(data, from, to, true)
    .filter(
      (o) =>
        (!o.jobId || o.careCycle !== undefined) &&
        availabilityConflict(data, o.date, o.time),
    )
    .map((o) => ({
      id: o.id,
      date: o.date,
      time: o.time,
      title: o.title,
      jobId: null,
      task: o,
    }));
  return [...jobs, ...tasks].sort((a, b) =>
    `${a.date}${a.time}${a.id}`.localeCompare(`${b.date}${b.time}${b.id}`),
  );
}
export function nextAvailableDays(
  data: Data,
  start: string,
  now: Date,
  limit = 7,
  horizon = 60,
) {
  const today = localDate(now),
    from = start < today ? today : start,
    result = [];
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  for (let i = 0; i < horizon && result.length < limit; i++) {
    let date: string;
    try {
      date = addDays(from, i);
    } catch {
      break;
    }
    const rule = dayAvailability(data, date),
      [begin, end] = availabilityWindow(rule);
    if (begin >= end || (date === today && end <= currentMinutes)) continue;
    const jobs = data.jobs.filter((j) => j.date === date).length;
    const tasks = taskOccurrencesBetween(data, date, date, true).filter(
      (o) => !o.jobId || o.careCycle !== undefined,
    ).length;
    result.push({ date, rule, jobs, tasks });
  }
  return result;
}
