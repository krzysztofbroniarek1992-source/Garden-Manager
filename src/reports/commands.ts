import { elapsedSeconds, type Data, type Job } from '../domain';
import {
  buildReportSnapshot,
  reportSourceSignature,
  type TimeEventKind,
  type VisitDetails,
  type VisitReport,
  type VisitTimeEvent,
} from './model';
const conflict = () =>
  new Error(
    'Dane wizyty lub historia raportów zmieniły się. Otwórz ponownie podsumowanie i przygotuj aktualny podgląd.',
  );
export function saveVisitDetails(
  data: Data,
  jobId: string,
  draft: Pick<VisitDetails, 'publicWork' | 'clientRemarks' | 'zoneId'>,
  revision: number,
  now: number,
): Data {
  const job = data.jobs.find((j) => j.id === jobId);
  if (!job || (job.visitDetails?.revision ?? 0) !== revision) throw conflict();
  const garden = data.gardens.find((g) => g.id === job.gardenId),
    zone = garden?.zones.find((z) => z.id === draft.zoneId);
  if (draft.zoneId && !zone)
    throw new Error('Wybierz aktualną strefę tego ogrodu.');
  const details: VisitDetails = {
    publicWork: draft.publicWork.trim(),
    clientRemarks: draft.clientRemarks.trim(),
    zoneId: zone?.id ?? null,
    zoneName: zone?.name.slice(0, 300) ?? null,
    updatedAt: now,
    revision: revision + 1,
  };
  return {
    ...data,
    jobs: data.jobs.map((j) =>
      j.id === jobId ? { ...j, visitDetails: details } : j,
    ),
  };
}
/** Observe existing timer commands; never change their timer, seconds or pricing fields. */
export function auditTimeChanges(
  before: Data,
  after: Data,
  now: number,
  correctionId?: string,
): Data {
  let jobs = after.jobs;
  const recorded = new Set<string>();
  const add = (id: string, kind: TimeEventKind) => {
    const old = before.jobs.find((j) => j.id === id),
      job = jobs.find((j) => j.id === id);
    if (!job) return;
    const timer = before.timer?.jobId === id ? before.timer : null;
    const pauseDurationMs =
      timer?.paused && ['resumed', 'stopped', 'completed'].includes(kind)
        ? Math.max(0, now - timer.startedAt)
        : null;
    const event: VisitTimeEvent = {
      id: crypto.randomUUID(),
      kind,
      at: now,
      beforeSeconds: old ? elapsedSeconds(old, before.timer, now) : 0,
      afterSeconds: elapsedSeconds(job, after.timer, now),
      pauseDurationMs,
    };
    jobs = jobs.map((j) =>
      j.id === id
        ? { ...j, timeHistory: [...(j.timeHistory ?? []), event] }
        : j,
    );
    recorded.add(id);
  };
  const a = before.timer,
    b = after.timer;
  if (a && (!b || a.jobId !== b.jobId))
    add(
      a.jobId,
      after.jobs.find((j) => j.id === a.jobId)?.status === 'completed'
        ? 'completed'
        : 'stopped',
    );
  if (b && (!a || a.jobId !== b.jobId)) add(b.jobId, 'started');
  if (a && b && a.jobId === b.jobId && a.paused !== b.paused)
    add(b.jobId, b.paused ? 'paused' : 'resumed');
  for (const j of after.jobs)
    if (
      j.status === 'completed' &&
      before.jobs.some((o) => o.id === j.id && o.status !== 'completed') &&
      !recorded.has(j.id)
    )
      add(j.id, 'completed');
  if (correctionId && !recorded.has(correctionId))
    add(correctionId, 'corrected');
  return jobs === after.jobs ? after : { ...after, jobs };
}
export function nextReportIdentity(data: Data, job: Job, now: number) {
  const history = job.reports ?? [],
    latest = history.at(-1);
  return {
    number:
      latest?.number ??
      `BO/${new Date(now).getFullYear()}/${String(data.reportSequence + 1).padStart(6, '0')}`,
    version: (latest?.version ?? 0) + 1,
  };
}
export function saveVisitReport(
  data: Data,
  jobId: string,
  record: VisitReport,
  expected: string,
): Data {
  const job = data.jobs.find((j) => j.id === jobId);
  if (!job) throw conflict();
  const existing = job.reports?.find((r) => r.id === record.id);
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(record)) throw conflict();
    return data;
  }
  if (
    reportSourceSignature(data, jobId, record.options) !== expected ||
    JSON.stringify(record.snapshot) !==
      JSON.stringify(buildReportSnapshot(data, jobId, record.options))
  )
    throw conflict();
  const identity = nextReportIdentity(data, job, record.generatedAt);
  if (identity.number !== record.number || identity.version !== record.version)
    throw conflict();
  return {
    ...data,
    reportSequence: data.reportSequence + (job.reports?.length ? 0 : 1),
    jobs: data.jobs.map((j) =>
      j.id === jobId
        ? { ...j, reports: [...(j.reports ?? []), structuredClone(record)] }
        : j,
    ),
  };
}
export function reconcileVisitDetails(data: Data, now: number): Data {
  const jobs = data.jobs.map((j) => {
    const v = j.visitDetails;
    if (
      !v?.zoneId ||
      data.gardens
        .find((g) => g.id === j.gardenId)
        ?.zones.some((z) => z.id === v.zoneId)
    )
      return j;
    return {
      ...j,
      visitDetails: {
        ...v,
        zoneId: null,
        updatedAt: now,
        revision: v.revision + 1,
      },
    };
  });
  return jobs.some((j, i) => j !== data.jobs[i]) ? { ...data, jobs } : data;
}
