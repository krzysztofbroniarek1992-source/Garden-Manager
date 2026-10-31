import type { Data } from '../domain';

export type Frequency = 'once' | 'days' | 'weeks' | 'months' | 'years';
export interface TaskScope {
  clientId: string | null;
  gardenId: string | null;
  zoneId: string | null;
  zoneName: string | null;
}
export interface TaskSchedule extends TaskScope {
  checklistTemplateId?: string | null;
  id: string;
  title: string;
  notes: string;
  startDate: string;
  endDate: string | null;
  time: string;
  recurrence: { frequency: Frequency; interval: number; months: number[] };
  endedOn: string | null;
  revision: number;
  updatedAt: number;
}
/** Original date is the permanent identity, even after moving the occurrence. */
export interface TaskOccurrence extends TaskScope {
  id: string;
  scheduleId: string;
  originalDate: string;
  date: string;
  time: string;
  title: string;
  notes: string;
  status: 'planned' | 'cancelled';
  jobId: string | null;
  revision: number;
  updatedAt: number;
}
export interface OccurrenceVersion { scheduleRevision: number; occurrenceRevision: number }
export const taskStatusLabels = { planned: 'Zaplanowane', 'in-progress': 'W trakcie', completed: 'Wykonane', cancelled: 'Odwołane' } as const;
export function taskStatus(data: Data, occurrence: TaskOccurrence) {
  return data.jobs.find(job => job.id === occurrence.jobId)?.status ?? occurrence.status;
}
export const occurrenceId = (scheduleId: string, date: string) => `task:${encodeURIComponent(scheduleId)}:${date}`;
