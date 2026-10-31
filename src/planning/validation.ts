import type { Data } from '../domain';
import { isDate, validateRule } from './dates';
import { occurrenceId, type TaskScope } from './model';

export function validatePlanning(data: Data): void {
  const fail = (): never => { throw new Error('Nieprawidłowy harmonogram lub wystąpienia zadań. Oryginalny zapis nie został zmieniony.'); };
  const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
  const text = (value: unknown): value is string => typeof value === 'string';
  const id = (value: unknown) => text(value) && value.trim().length > 0;
  const nullableId = (value: unknown) => value === null || id(value);
  const revision = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;
  const scope = (value: TaskScope) => nullableId(value.clientId) && nullableId(value.gardenId) && nullableId(value.zoneId)
    && (value.zoneName === null || text(value.zoneName)) && (!value.zoneId || !!value.gardenId)
    && (!value.clientId || data.clients.some(client => client.id === value.clientId))
    && (!value.gardenId || data.gardens.some(garden => garden.id === value.gardenId && (!value.clientId || garden.clientId === value.clientId)));
  if (!Array.isArray(data.taskSchedules) || !Array.isArray(data.taskOccurrences)) fail();
  for (const schedule of data.taskSchedules) {
    if (!object(schedule) || !id(schedule.id) || !id(schedule.title) || !text(schedule.notes) || !scope(schedule)
      || !revision(schedule.revision) || !Number.isFinite(schedule.updatedAt) || schedule.updatedAt < 0) fail();
    validateRule(schedule);
  }
  if (new Set(data.taskSchedules.map(item => item.id)).size !== data.taskSchedules.length) fail();
  const linked = new Set<string>();
  for (const item of data.taskOccurrences) {
    if (!object(item) || !data.taskSchedules.some(schedule => schedule.id === item.scheduleId) || !isDate(item.originalDate)
      || item.id !== occurrenceId(item.scheduleId, item.originalDate) || !isDate(item.date)
      || !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.time) || !id(item.title) || !text(item.notes) || !scope(item)
      || !['planned', 'cancelled'].includes(item.status) || !revision(item.revision) || !Number.isFinite(item.updatedAt) || item.updatedAt < 0
      || !(item.jobId === null || id(item.jobId))) fail();
    if (item.jobId) {
      if (item.status === 'cancelled' || linked.has(item.jobId) || !data.jobs.some(job => job.id === item.jobId && job.taskOccurrenceId === item.id)) fail();
      linked.add(item.jobId);
    }
  }
  if (new Set(data.taskOccurrences.map(item => item.id)).size !== data.taskOccurrences.length) fail();
  for (const job of data.jobs) {
    if (job.taskOccurrenceId !== undefined && (!id(job.taskOccurrenceId) || !data.taskOccurrences.some(item => item.id === job.taskOccurrenceId && item.jobId === job.id))) fail();
  }
}
