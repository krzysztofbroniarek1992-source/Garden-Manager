import { useId, useMemo, useState } from 'react';
import { useGarden, useNow } from '../state';
import {
  elapsedSeconds,
  jobTotalCents,
  localDate,
  moneyCents,
  paidCents,
  remainingCents,
  settlementStatus,
  type Job,
} from '../domain';
import { reportDuration } from '../reports/presentation';
import { groupJobHistory, type JobMonth } from './job-history';
import PaymentBadge from '../components/PaymentBadge';
import './garden-details.css';

const labels = {
  planned: 'Zaplanowane',
  'in-progress': 'W trakcie',
  completed: 'Zakończone',
};
export default function GroupedJobHistory({
  jobs,
  onOpen,
  onEdit,
  onDelete,
  showGarden = false,
}: {
  jobs: Job[];
  onOpen: (id: string, billing?: boolean) => void;
  onEdit?: (job: Job) => void;
  onDelete?: (id: string) => void;
  showGarden?: boolean;
}) {
  const { data } = useGarden(),
    now = useNow();
  const [order, setOrder] = useState<'desc' | 'asc'>('desc');
  const currentMonth = localDate(new Date(now)).slice(0, 7);
  const [openMonths, setOpenMonths] = useState(() => new Set([currentMonth]));
  const timing = jobs.some((j) => j.id === data.timer?.jobId) ? now : 0;
  const months = useMemo(
    () => groupJobHistory(jobs, data.timer, timing, order),
    [jobs, data.timer, timing, order],
  );
  const years = [...new Set(months.map((m) => m.year))];
  const id = useId();
  return (
    <div className="grouped-job-history">
      <label className="field history-order">
        Kolejność historii
        <select
          aria-label="Kolejność historii"
          value={order}
          onChange={(e) => setOrder(e.target.value as typeof order)}
        >
          <option value="desc">Najnowsze najpierw</option>
          <option value="asc">Najstarsze najpierw</option>
        </select>
      </label>
      <p className="gm-form-note">
        Wartość miesiąca obejmuje zakończone prace z zatwierdzoną należnością.
        Czas i liczba zleceń obejmują wszystkie wyniki wybranych filtrów.
      </p>
      {years.map((year) => (
        <section
          className="history-year"
          key={year}
          aria-labelledby={`${id}-${year}`}
        >
          <h3 id={`${id}-${year}`}>{year}</h3>
          {months
            .filter((m) => m.year === year)
            .map((month) => (
              <details
                className="history-month"
                data-month={month.key}
                key={month.key}
                open={openMonths.has(month.key)}
                onToggle={(e) => {
                  const open = e.currentTarget.open;
                  setOpenMonths((previous) => {
                    if (previous.has(month.key) === open) return previous;
                    const next = new Set(previous);
                    if (open) next.add(month.key);
                    else next.delete(month.key);
                    return next;
                  });
                }}
              >
                <summary>
                  <strong>
                    {new Date(`${month.key}-01T12:00:00`).toLocaleDateString(
                      'pl-PL',
                      { month: 'long', year: 'numeric' },
                    )}
                  </strong>
                  <span>
                    Zlecenia: {month.jobs.length} · Czas:{' '}
                    {reportDuration(month.seconds)} · Wartość:{' '}
                    {moneyCents(month.approvedValueCents)}
                  </span>
                  {month.pendingPrices > 0 && (
                    <small>{month.pendingPrices} cen do zatwierdzenia</small>
                  )}
                </summary>
                {openMonths.has(month.key) && (
                  <MonthJobs
                    key={`${month.key}:${order}`}
                    month={month}
                    onOpen={onOpen}
                    onEdit={onEdit}
                    onDelete={onDelete}
                    showGarden={showGarden}
                  />
                )}
              </details>
            ))}
        </section>
      ))}
      {!months.length && (
        <p className="muted">Brak zleceń dla wybranych filtrów.</p>
      )}
    </div>
  );
}
function MonthJobs({
  month,
  onOpen,
  onEdit,
  onDelete,
  showGarden,
}: {
  month: JobMonth;
  onOpen: (id: string, billing?: boolean) => void;
  onEdit?: (job: Job) => void;
  onDelete?: (id: string) => void;
  showGarden: boolean;
}) {
  const { data } = useGarden(),
    now = useNow(),
    [limit, setLimit] = useState(50);
  const gardenNames = useMemo(
    () => new Map(data.gardens.map((g) => [g.id, g.name])),
    [data.gardens],
  );
  return (
    <>
      <div
        className="client-table-wrap"
        tabIndex={0}
        aria-label="Tabela historii zleceń"
      >
        <table className="client-jobs-table">
          <thead>
            <tr>
              <th>Data</th>
              {showGarden && <th>Ogród</th>}
              <th>Rodzaj pracy</th>
              <th>Czas</th>
              <th>Wartość</th>
              <th>Zapłacono</th>
              <th>Pozostało</th>
              <th>Status</th>
              <th>Akcje</th>
            </tr>
          </thead>
          <tbody>
            {month.jobs.slice(0, limit).map((job) => {
              const provisional = job.status === 'completed' && !job.settlement;
              return (
                <tr key={job.id}>
                  <td data-label="Data">
                    <time dateTime={job.date}>
                      {new Date(`${job.date}T12:00:00`).toLocaleDateString(
                        'pl-PL',
                      )}
                    </time>
                    <small>{job.time}</small>
                  </td>
                  {showGarden && (
                    <td data-label="Ogród">{gardenNames.get(job.gardenId)}</td>
                  )}
                  <td data-label="Praca">
                    <button
                      className="client-job-title"
                      aria-label={`Szczegóły zlecenia ${job.title}`}
                      onClick={() => onOpen(job.id)}
                    >
                      {job.title}
                    </button>
                    {job.activities.length > 0 && (
                      <small className="client-job-activities">
                        {job.activities.join(' · ')}
                      </small>
                    )}
                  </td>
                  <td data-label="Czas">
                    {reportDuration(elapsedSeconds(job, data.timer, now))}
                  </td>
                  <td data-label="Wartość">
                    {moneyCents(jobTotalCents(job, now, data.timer))}
                    {provisional && <small>Przed zatwierdzeniem</small>}
                    {job.settlement?.source === 'legacy' && (
                      <small>Kwota zachowana</small>
                    )}
                  </td>
                  <td data-label="Zapłacono">
                    {moneyCents(paidCents(job.id, data.payments))}
                  </td>
                  <td data-label="Pozostało">
                    {moneyCents(
                      remainingCents(job, data.payments, now, data.timer),
                    )}
                  </td>
                  <td data-label="Status">
                    <span className={`badge status-${job.status}`}>
                      {labels[job.status]}
                    </span>
                    <PaymentBadge
                      status={settlementStatus(
                        job,
                        data.payments,
                        now,
                        data.timer,
                      )}
                    />
                    {provisional && <small>Cena do zatwierdzenia</small>}
                  </td>
                  <td data-label="Akcje">
                    <div className="garden-job-actions">
                      <button
                        className="button secondary"
                        aria-label={`Rozliczenie zlecenia ${job.title}`}
                        onClick={() => onOpen(job.id, true)}
                      >
                        Wizyta i rozliczenie
                      </button>
                      {onEdit && (
                        <button
                          className="button secondary"
                          aria-label={`Edytuj zlecenie ${job.title}`}
                          onClick={() => onEdit(job)}
                        >
                          Edytuj
                        </button>
                      )}
                      {onDelete && (
                        <button
                          className="button ghost"
                          aria-label={`Usuń zlecenie ${job.title}`}
                          onClick={() => onDelete(job.id)}
                        >
                          Usuń
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {limit < month.jobs.length && (
        <button
          className="button secondary"
          onClick={() => setLimit((n) => n + 50)}
        >
          Pokaż kolejne 50 zleceń ({month.jobs.length - limit} pozostało)
        </button>
      )}
    </>
  );
}
