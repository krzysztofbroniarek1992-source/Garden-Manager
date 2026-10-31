import { startWork, type Data, type Job } from '../domain';
import { isDate, validateRule } from './dates';
import { resolveOccurrence } from './occurrences';
import type { OccurrenceVersion, TaskOccurrence, TaskSchedule } from './model';

const put = <T extends { id: string }>(items: T[], item: T): T[] => items.some(value => value.id === item.id) ? items.map(value => value.id === item.id ? item : value) : [...items, item];
const conflict = () => new Error('Plan zmienił się w innej karcie. Zamknij szczegóły i otwórz je ponownie.');
function currentOccurrence(data: Data, scheduleId: string, originalDate: string, expected?: OccurrenceVersion): TaskOccurrence {
  const occurrence = resolveOccurrence(data, scheduleId, originalDate);
  const schedule = data.taskSchedules.find(item => item.id === scheduleId)!;
  if (expected && (schedule.revision !== expected.scheduleRevision || occurrence.revision !== expected.occurrenceRevision)) throw conflict();
  return occurrence;
}
function requirePending(occurrence: TaskOccurrence) {
  if (occurrence.jobId) throw new Error('To zadanie ma już rzeczywiste zlecenie. Termin i przebieg pracy zmień w karcie zlecenia.');
  if (occurrence.status === 'cancelled') throw new Error('Ten termin został pominięty.');
}
export function saveTaskSchedule(data: Data, draft: TaskSchedule, now: number): Data {
  const existing = data.taskSchedules.find(item => item.id === draft.id);
  if (existing && draft.revision !== existing.revision || !existing && draft.revision !== 0) throw conflict();
  validateRule(draft);
  if (!draft.title.trim()) throw new Error('Podaj nazwę zadania.');
  const garden = data.gardens.find(item => item.id === draft.gardenId);
  if (draft.gardenId && (!garden || draft.clientId && garden.clientId !== draft.clientId)) throw new Error('Wybierz ogród tego klienta.');
  const zone = garden?.zones.find(item => item.id === draft.zoneId);
  if (draft.zoneId && !zone && !(existing?.zoneId === draft.zoneId && existing.gardenId === draft.gardenId)) throw new Error('Wybierz strefę wybranego ogrodu.');
  const next = { ...draft, title: draft.title.trim(), notes: draft.notes.trim(), clientId: garden?.clientId ?? draft.clientId,
    zoneName: zone?.name ?? (draft.zoneId ? draft.zoneName : null), endedOn: existing?.endedOn ?? null,
    revision: (existing?.revision ?? 0) + 1, updatedAt: now };
  return { ...data, taskSchedules: put(data.taskSchedules, next),
    taskOccurrences: data.taskOccurrences.map(item => item.scheduleId === next.id && !item.jobId && item.status === 'planned'
      ? { ...item, title: next.title, notes: next.notes, clientId: next.clientId, gardenId: next.gardenId, zoneId: next.zoneId, zoneName: next.zoneName,
        status: next.endDate && item.date > next.endDate ? 'cancelled' : item.status, revision: item.revision + 1, updatedAt: now } : item) };
}
export function moveTaskOccurrence(data: Data, scheduleId: string, originalDate: string, date: string, time: string, now: number, expected?: OccurrenceVersion): Data {
  const occurrence = currentOccurrence(data, scheduleId, originalDate, expected);
  requirePending(occurrence);
  const schedule = data.taskSchedules.find(item => item.id === scheduleId)!;
  if (!isDate(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Podaj poprawny termin.');
  if (schedule.endedOn && date > schedule.endedOn || schedule.endDate && date > schedule.endDate) throw new Error('Termin wypada po zakończeniu serii. Najpierw zmień datę końca harmonogramu.');
  return { ...data, taskOccurrences: put(data.taskOccurrences, { ...occurrence, date, time, revision: occurrence.revision + 1, updatedAt: now }) };
}
export function skipTaskOccurrence(data: Data, scheduleId: string, originalDate: string, now: number, expected?: OccurrenceVersion): Data {
  const occurrence = currentOccurrence(data, scheduleId, originalDate, expected);
  requirePending(occurrence);
  return { ...data, taskOccurrences: put(data.taskOccurrences, { ...occurrence, status: 'cancelled', revision: occurrence.revision + 1, updatedAt: now }) };
}
export function endTaskSchedule(data: Data, scheduleId: string, lastDate: string, now: number, revision?: number): Data {
  const schedule = data.taskSchedules.find(item => item.id === scheduleId);
  if (!schedule) throw new Error('Nie znaleziono harmonogramu.');
  if (revision !== undefined && revision !== schedule.revision) throw conflict();
  if (!isDate(lastDate)) throw new Error('Podaj poprawną datę zakończenia serii.');
  return { ...data, taskSchedules: put(data.taskSchedules, { ...schedule, endedOn: lastDate, revision: schedule.revision + 1, updatedAt: now }),
    taskOccurrences: data.taskOccurrences.map(item => item.scheduleId === scheduleId && !item.jobId && item.date > lastDate
      ? { ...item, status: 'cancelled', revision: item.revision + 1, updatedAt: now } : item) };
}
/** One transaction creates a real visit and starts its timer, only on explicit user action. */
export function beginTaskOccurrence(data: Data, scheduleId: string, originalDate: string, now: number, gardenId?: string, expected?: OccurrenceVersion): { data: Data; jobId: string } {
  const current = resolveOccurrence(data, scheduleId, originalDate);
  // Repeated taps and another tab always open the same visit, without restarting it.
  if (current.jobId) return { data, jobId: current.jobId };
  const occurrence = currentOccurrence(data, scheduleId, originalDate, expected);
  requirePending(occurrence);
  const target = data.gardens.find(garden => garden.id === (occurrence.gardenId ?? gardenId));
  if (!target || occurrence.clientId && target.clientId !== occurrence.clientId) throw new Error('Przed rozpoczęciem wybierz ogród właściwego klienta.');
  const jobId = `job:${occurrence.id}`;
  if (data.jobs.some(job => job.id === jobId)) throw new Error('Istnieje już zlecenie o tym identyfikatorze. Zachowano jego dane.');
  const job: Job = { id: jobId, taskOccurrenceId: occurrence.id, gardenId: target.id, title: occurrence.title,
    date: occurrence.date, time: occurrence.time, notes: [occurrence.notes, occurrence.zoneName ? `Strefa: ${occurrence.zoneName}` : ''].filter(Boolean).join('\n'),
    status: 'planned', billing: 'hourly', rate: data.settings.hourlyRate, fixedPrice: 0, seconds: 0,
    materials: [], activities: [occurrence.title], settlement: null };
  const next = { ...data, jobs: [...data.jobs, job], taskOccurrences: put(data.taskOccurrences, { ...occurrence, jobId, revision: occurrence.revision + 1, updatedAt: now }) };
  return { data: startWork(next, jobId, now), jobId };
}
