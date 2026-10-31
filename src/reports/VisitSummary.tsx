import TimeHistory from './TimeHistory';
import { useState } from 'react';
import Modal from '../components/Modal';
import { useGarden, useNow } from '../state';
import {
  billingBreakdown,
  moneyCents,
  paidCents,
  remainingCents,
} from '../domain';
import { ChecklistProgress } from '../checklists/ChecklistPanel';
import { incompleteVisitChecklists } from '../checklists/model';
import { PhotoImage } from '../photos/PhotoGallery';
import { photoCategories } from '../photos/model';
import { pauseDuration, reportDuration } from './presentation';
import { visitTime, visitZone } from './model';
import ReportPanel from './ReportPanel';
import './reports.css';
export type VisitSection =
  'work' | 'billing' | 'checklists' | 'notes' | 'photos';
export default function VisitSummary({
  jobId,
  onClose,
  onNavigate,
  onEdit,
  onTime,
  onBilling,
}: {
  jobId: string;
  onClose: () => void;
  onNavigate: (section: VisitSection) => void;
  onEdit: () => void;
  onTime: () => void;
  onBilling: () => void;
}) {
  const { data, saveVisitDetails } = useGarden(),
    now = useNow(),
    job = data.jobs.find((j) => j.id === jobId),
    garden = data.gardens.find((g) => g.id === job?.gardenId),
    client = data.clients.find((c) => c.id === garden?.clientId);
  const occurrence = data.taskOccurrences.find(
    (o) => o.id === job?.taskOccurrenceId && o.gardenId === job?.gardenId,
  );
  const [work, setWork] = useState(
      job?.visitDetails?.publicWork ?? job?.activities.join('\n') ?? '',
    ),
    [remarks, setRemarks] = useState(job?.visitDetails?.clientRemarks ?? ''),
    [zoneId, setZoneId] = useState(
      job?.visitDetails?.zoneId ??
        (garden?.zones.some((z) => z.id === occurrence?.zoneId)
          ? occurrence?.zoneId
          : null) ??
        '',
    ),
    [revision, setRevision] = useState(job?.visitDetails?.revision ?? 0),
    [baseline, setBaseline] = useState(() =>
      JSON.stringify([work, remarks, zoneId]),
    ),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [reporting, setReporting] = useState(false);
  if (!job || !garden || !client)
    return (
      <Modal title="Podsumowanie wizyty" onClose={onClose}>
        <p>Wizyta nie jest już dostępna.</p>
      </Modal>
    );
  const dirty = baseline !== JSON.stringify([work, remarks, zoneId]),
    time = visitTime(data, job, now),
    breakdown = billingBreakdown(job, now, data.timer),
    lists = data.checklists.filter(
      (c) => c.kind === 'visit' && c.jobId === jobId,
    ),
    photos = data.photos.filter(
      (p) => p.jobId === jobId && p.deletedAt === null,
    ),
    internal = data.notes.filter(
      (n) => n.jobId === jobId && n.archivedAt === null,
    );
  const active = data.timer?.jobId === jobId;
  return (
    <Modal title="Podsumowanie wizyty" onClose={onClose} wide>
      <div className="visit-summary">
        <div className="visit-summary-heading">
          <div>
            <h3>{job.title}</h3>
            <p>
              {client.name} · {garden.name}
            </p>
            {garden.address && <p>{garden.address}</p>}
            <p>
              {job.date} ·{' '}
              {job.status === 'completed'
                ? 'Wykonana'
                : job.status === 'in-progress'
                  ? 'W trakcie'
                  : 'Zaplanowana'}
              {visitZone(data, job) && ` · ${visitZone(data, job)}`}
            </p>
          </div>
          <button
            className="button primary"
            disabled={job.status !== 'completed' || active || dirty}
            onClick={() => setReporting(true)}
          >
            Generuj raport PDF
          </button>
        </div>
        {job.status !== 'completed' && (
          <p className="report-info">
            Raport wykonanych prac przygotujesz po zakończeniu wizyty.
            Podsumowanie nie zmienia stopera.
          </p>
        )}
        {dirty && (
          <p className="report-info">
            Zapisz tekst podsumowania przed przygotowaniem raportu.
          </p>
        )}
        {incompleteVisitChecklists(data, jobId).length > 0 && (
          <p className="checklist-finish-warning">
            Checklista jest niepełna. Możesz zakończyć wizytę i przygotować
            raport; niewykonane czynności pozostają w dokumentacji.
          </p>
        )}
        <section className="visit-summary-section">
          <div className="visit-summary-section-heading">
            <h4>Zakres zaplanowanych prac</h4>
            <button className="button secondary" onClick={onEdit}>
              Edytuj zakres, czynności i materiały
            </button>
          </div>
          <p>{job.title}</p>
          <h4>Faktycznie wykonane czynności</h4>
          <ul>
            {job.activities.map((activity, i) => (
              <li key={i}>{activity}</li>
            ))}
          </ul>
        </section>
        <form
          className="visit-public-form"
          onSubmit={(e) => {
            e.preventDefault();
            try {
              saveVisitDetails(
                jobId,
                {
                  publicWork: work,
                  clientRemarks: remarks,
                  zoneId: zoneId || null,
                },
                revision,
              );
              setRevision((v) => v + 1);
              setBaseline(JSON.stringify([work, remarks, zoneId]));
              setError('');
              setNotice('Podsumowanie dla klienta zapisane.');
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <h4>Treść przeznaczona dla klienta</h4>
          <label className="field">
            Strefa wizyty
            <select
              aria-label="Strefa wizyty"
              value={zoneId}
              onChange={(e) => setZoneId(e.target.value)}
            >
              <option value="">Cały ogród / bez wskazania strefy</option>
              {garden.zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Opis wykonanych prac dla klienta
            <textarea
              aria-label="Opis wykonanych prac dla klienta"
              maxLength={8000}
              rows={5}
              value={work}
              onChange={(e) => setWork(e.target.value)}
            />
          </label>
          <label className="field">
            Uwagi i zalecenia dla klienta
            <textarea
              aria-label="Uwagi i zalecenia dla klienta"
              maxLength={5000}
              rows={3}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
            />
          </label>
          <p className="gm-form-note">
            Sprawdź opis przed udostępnieniem. Notatki wewnętrzne nie są
            kopiowane do tych pól. Uwagi włączysz osobno w ustawieniach raportu.
          </p>
          {error && (
            <p role="alert" className="gm-form-error">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="report-notice">
              {notice}
            </p>
          )}
          <button className="button primary" type="submit">
            Zapisz podsumowanie dla klienta
          </button>
        </form>
        <section className="visit-summary-section">
          <div className="visit-summary-section-heading">
            <h4>Czas, przerwy i korekty</h4>
            <button
              className="button secondary"
              disabled={active}
              onClick={onTime}
            >
              Przejdź do korekty czasu
            </button>
          </div>
          <p>
            <strong>
              Rzeczywisty czas pracy: {reportDuration(time.workSeconds)}
            </strong>
          </p>
          <TimeHistory data={data} job={job} now={now} expanded />
        </section>
        <section className="visit-summary-section">
          <div className="visit-summary-section-heading">
            <h4>Materiały i ilości</h4>
            <button
              className="button secondary"
              onClick={() => onNavigate('billing')}
            >
              Przejdź do materiałów i rozliczenia
            </button>
          </div>
          <ul>
            {job.materials.map((m) => (
              <li key={m.id}>
                {m.name} ·{' '}
                {m.quantity.toLocaleString('pl-PL', {
                  maximumFractionDigits: 20,
                })}{' '}
                {m.unit ?? 'jedn.'}
              </li>
            ))}
          </ul>
          {!job.materials.length && (
            <p className="muted">Nie wykazano materiałów.</p>
          )}
        </section>
        <section className="visit-summary-section">
          <div className="visit-summary-section-heading">
            <h4>Checklisty i postęp</h4>
            <button
              className="button secondary"
              onClick={() => onNavigate('checklists')}
            >
              Otwórz checklisty wizyty
            </button>
          </div>
          {lists.map((c) => (
            <article className="visit-checklist-row" key={c.id}>
              <strong>{c.name}</strong>
              <ChecklistProgress checklist={c} />
            </article>
          ))}
          {!lists.length && <p className="muted">Nie przypisano checklist.</p>}
        </section>
        <section className="visit-summary-section">
          <div className="visit-summary-section-heading">
            <h4>Dokumentacja fotograficzna</h4>
            <button
              className="button secondary"
              onClick={() => onNavigate('photos')}
            >
              Otwórz galerię wizyty
            </button>
          </div>
          <div className="visit-photo-groups">
            {(['before', 'during', 'after'] as const).map((category) => (
              <div key={category}>
                <h5>
                  {photoCategories[category]} ·{' '}
                  {photos.filter((p) => p.category === category).length}
                </h5>
                {photos.find((p) => p.category === category) && (
                  <PhotoImage
                    photo={photos.find((p) => p.category === category)!}
                    thumbnail
                  />
                )}
              </div>
            ))}
          </div>
        </section>
        <section className="visit-summary-section">
          <div className="visit-summary-section-heading">
            <h4>Notatki wewnętrzne</h4>
            <button
              className="button secondary"
              onClick={() => onNavigate('notes')}
            >
              Otwórz notatki wizyty
            </button>
          </div>
          {job.notes && <p className="preserve-lines">{job.notes}</p>}
          {internal.map((n) => (
            <div key={n.id}>
              <strong>{n.title}</strong>
              <p className="preserve-lines">{n.body}</p>
            </div>
          ))}
          <p className="gm-form-note">
            Te treści nie należą do raportu dla klienta.
          </p>
        </section>
        <section className="visit-summary-section">
          <div className="visit-summary-section-heading">
            <h4>Rozliczenie i płatności</h4>
            <button
              className="button secondary"
              disabled={job.status !== 'completed'}
              onClick={onBilling}
            >
              Otwórz rozliczenie wizyty
            </button>
          </div>
          <dl className="visit-summary-finance">
            <dt>
              {breakdown.approved
                ? 'Zatwierdzona należność'
                : 'Wartość przed zatwierdzeniem'}
            </dt>
            <dd>{moneyCents(breakdown.totalCents)}</dd>
            <dt>Robocizna</dt>
            <dd>{moneyCents(breakdown.finalLaborCents)}</dd>
            <dt>Materiały osobno</dt>
            <dd>{moneyCents(breakdown.materialsCents)}</dd>
            <dt>Zapłacono</dt>
            <dd>{moneyCents(paidCents(jobId, data.payments))}</dd>
            <dt>Pozostało</dt>
            <dd>
              {moneyCents(remainingCents(job, data.payments, now, data.timer))}
            </dd>
          </dl>
          <p className="gm-form-note">
            Finanse w raporcie wymagają jawnego zaznaczenia i zatwierdzonej
            należności.
          </p>
        </section>
        {reporting && (
          <ReportPanel jobId={jobId} onClose={() => setReporting(false)} />
        )}
      </div>
    </Modal>
  );
}
