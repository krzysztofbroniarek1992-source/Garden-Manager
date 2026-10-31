import type { Data, Job } from '../domain';
import { timeEventLabels, visitTime } from './model';
import { pauseDuration, reportDuration } from './presentation';
export default function TimeHistory({
  data,
  job,
  now,
  expanded = false,
}: {
  data: Data;
  job: Job;
  now: number;
  expanded?: boolean;
}) {
  const history = job.timeHistory ?? [],
    time = visitTime(data, job, now);
  return (
    <details className="visit-audit" open={expanded ? true : undefined}>
      <summary>Historia przerw i korekt · {history.length} zdarzeń</summary>
      <p>
        Udokumentowane zakończone przerwy: {pauseDuration(time.recordedPauseMs)}
      </p>
      {data.timer?.jobId === job.id && data.timer.paused && (
        <p>
          Bieżąca pauza:{' '}
          {pauseDuration(Math.max(0, now - data.timer.startedAt))}
        </p>
      )}
      <p className="gm-form-note">
        Historia przerw i korekt jest zapisywana od wersji 0.3.6. Starsze dane
        zachowują czas pracy, bez odtwarzania nieznanych zdarzeń.
      </p>
      <ol className="visit-time-history">
        {history.map((e) => (
          <li key={e.id}>
            <strong>{timeEventLabels[e.kind]}</strong> ·{' '}
            {new Date(e.at).toLocaleString('pl-PL')}
            {e.kind === 'corrected' &&
              ` · ${reportDuration(e.beforeSeconds)} → ${reportDuration(e.afterSeconds)}`}
            {e.pauseDurationMs !== null &&
              ` · przerwa ${pauseDuration(e.pauseDurationMs)}`}
          </li>
        ))}
      </ol>
      {!history.length && (
        <p className="muted">Brak zapisanych zdarzeń tej wizyty.</p>
      )}
    </details>
  );
}
