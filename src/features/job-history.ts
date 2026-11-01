import {
  clientSummary,
  elapsedSeconds,
  jobTotalCents,
  sumCents,
  type Data,
  type Job,
  type Timer,
} from '../domain';

export function gardenSummary(data: Data, gardenId: string, now: number) {
  const garden = data.gardens.find((g) => g.id === gardenId);
  return clientSummary(
    { ...data, gardens: garden ? [garden] : [] },
    garden?.clientId ?? '',
    now,
  );
}

export interface JobMonth {
  key: string;
  year: string;
  jobs: Job[];
  seconds: number;
  approvedValueCents: number;
  pendingPrices: number;
}
/** Group without rounding time or inventing pricing. Only completed, approved
 * visits contribute to the value of performed work, as in clientSummary. */
export function groupJobHistory(
  jobs: readonly Job[],
  timer: Timer | null,
  now: number,
  order: 'desc' | 'asc' = 'desc',
): JobMonth[] {
  const months = new Map<string, JobMonth>();
  for (const job of jobs) {
    const key = job.date.slice(0, 7);
    let month = months.get(key);
    if (!month) {
      month = {
        key,
        year: key.slice(0, 4),
        jobs: [],
        seconds: 0,
        approvedValueCents: 0,
        pendingPrices: 0,
      };
      months.set(key, month);
    }
    month.jobs.push(job);
    month.seconds += elapsedSeconds(job, timer, now);
    if (job.status === 'completed' && job.settlement)
      month.approvedValueCents = sumCents([
        month.approvedValueCents,
        jobTotalCents(job, now, timer),
      ]);
    if (job.status === 'completed' && !job.settlement) month.pendingPrices++;
  }
  const direction = order === 'desc' ? -1 : 1;
  for (const month of months.values())
    month.jobs.sort(
      (a, b) =>
        direction *
        `${a.date}${a.time}${a.id}`.localeCompare(`${b.date}${b.time}${b.id}`),
    );
  return [...months.values()].sort(
    (a, b) => direction * a.key.localeCompare(b.key),
  );
}

export function jobDeletionReview(data: Data, jobId: string) {
  const job = data.jobs.find((j) => j.id === jobId);
  const payments = data.payments.filter((p) => p.jobId === jobId);
  const photos = data.photos.filter(
    (p) => p.jobId === jobId && p.deletedAt === null,
  );
  const notes = data.notes.filter((n) => n.jobId === jobId);
  const checklists = data.checklists.filter((c) => c.jobId === jobId);
  const reasons: string[] = [];
  if (!job) reasons.push('Zlecenie nie jest już dostępne.');
  if (data.timer?.jobId === jobId)
    reasons.push('Najpierw zatrzymaj stoper tego zlecenia.');
  if (payments.length)
    reasons.push('Zlecenie ma płatności. Zachowaj je wraz z historią wpłat.');
  if (job?.settlement)
    reasons.push(
      'Zlecenie ma zatwierdzone rozliczenie. Zachowaj je w historii prac.',
    );
  if (data.taskOccurrences.some((o) => o.jobId === jobId))
    reasons.push(
      'Zlecenie jest historią zadania z kalendarza. Zachowaj je, aby nie utworzyć powtórnej wizyty.',
    );
  if (job?.reports?.length)
    reasons.push(
      'Zlecenie ma zapisane raporty. Zachowaj je wraz z ich wersjami.',
    );
  return {
    job,
    reasons,
    photos: photos.length,
    notes: notes.length,
    checklists: checklists.length,
    signature: JSON.stringify([
      job,
      payments,
      photos,
      notes,
      checklists,
      data.timer?.jobId === jobId ? data.timer : null,
    ]),
  };
}
