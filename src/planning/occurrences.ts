import type { Data } from '../domain';
import { scheduleDates } from './dates';
import { occurrenceId, taskStatus, type TaskOccurrence, type TaskSchedule } from './model';

export function virtualOccurrence(schedule: TaskSchedule, date: string): TaskOccurrence {
  const { title, notes, clientId, gardenId, zoneId, zoneName, time, updatedAt } = schedule;
  return { id: occurrenceId(schedule.id, date), scheduleId: schedule.id, originalDate: date, date, time,
    title, notes, clientId, gardenId, zoneId, zoneName, updatedAt, revision: 0, status: 'planned', jobId: null };
}
export function resolveOccurrence(data: Data, scheduleId: string, originalDate: string): TaskOccurrence {
  const stored = data.taskOccurrences.find(item => item.id === occurrenceId(scheduleId, originalDate));
  if (stored) return stored;
  const schedule = data.taskSchedules.find(item => item.id === scheduleId);
  if (!schedule || ![...scheduleDates(schedule, originalDate, originalDate)].length) throw new Error('Termin nie należy już do harmonogramu. Otwórz go ponownie.');
  return virtualOccurrence(schedule, originalDate);
}
/** Materialize only visible dates. Persisted exceptions stay visible after rule edits. */
export function taskOccurrencesBetween(data: Data, from: string, to: string, pendingOnly = false, limit = Infinity): TaskOccurrence[] {
  const stored = new Map(data.taskOccurrences.map(item => [item.id, item]));
  const result: TaskOccurrence[] = [];
  const eligible = (item: TaskOccurrence) => {
    const job = data.jobs.find(job => job.id === item.jobId);
    const date = job?.date ?? item.date;
    return date >= from && date <= to && (!pendingOnly || !['completed', 'cancelled'].includes(taskStatus(data, item)));
  };
  for (const schedule of data.taskSchedules) {
    let count = 0;
    for (const date of scheduleDates(schedule, from, to)) {
      const id = occurrenceId(schedule.id, date);
      if (stored.has(id)) continue;
      const occurrence = virtualOccurrence(schedule, date);
      if (eligible(occurrence)) { result.push(occurrence); if (++count >= limit) break; }
    }
  }
  result.push(...data.taskOccurrences.filter(eligible));
  return result.sort((a, b) => {
    const left = data.jobs.find(job => job.id === a.jobId), right = data.jobs.find(job => job.id === b.jobId);
    return `${left?.date ?? a.date}${left?.time ?? a.time}${a.id}`.localeCompare(`${right?.date ?? b.date}${right?.time ?? b.time}${b.id}`);
  }).slice(0, limit);
}
