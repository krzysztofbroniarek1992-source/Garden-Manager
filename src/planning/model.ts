import type { Data } from "../domain";

export type Frequency = "once" | "days" | "weeks" | "months" | "years";
export interface TaskScope {
  clientId: string | null;
  gardenId: string | null;
  zoneId: string | null;
  zoneName: string | null;
}
export interface CareOptions {
  notes?: string;
  season: { from: string; to: string } | null;
  material: string;
}
export interface CareCompletion {
  performedOn: string;
  recordedAt: number;
  jobId: string | null;
  jobTitle: string | null;
  frequency: "days" | "weeks" | "months";
  interval: number;
  material: string;
}
export interface TaskSchedule extends TaskScope {
  care?: CareOptions;
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
  status: "planned" | "cancelled" | "completed";
  careCycle?: number;
  completion?: CareCompletion | null;
  closedReason?: "skipped" | "ended" | "limit";
  jobId: string | null;
  revision: number;
  updatedAt: number;
}
export interface OccurrenceVersion {
  scheduleRevision: number;
  occurrenceRevision: number;
}
export const taskStatusLabels = {
  planned: "Zaplanowane",
  "in-progress": "W trakcie",
  completed: "Wykonane",
  cancelled: "Odwołane",
} as const;
export function taskStatus(data: Data, occurrence: TaskOccurrence) {
  const job = data.jobs.find((job) => job.id === occurrence.jobId);
  if (occurrence.careCycle !== undefined)
    return occurrence.status === "planned"
      ? job?.status === "in-progress"
        ? "in-progress"
        : "planned"
      : occurrence.status;
  return job?.status ?? occurrence.status;
}
export const occurrenceId = (
  scheduleId: string,
  date: string,
  cycle?: number,
) =>
  `task:${encodeURIComponent(scheduleId)}:${date}${cycle === undefined ? "" : `:care:${cycle}`}`;
