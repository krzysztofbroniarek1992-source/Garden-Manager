import '../checklists/checklists.css';
import { incompleteVisitChecklists } from '../checklists/model';
import { useState } from 'react';
import { Plus, Search, MapPin, CalendarDays, Clock3, Pencil, Play, Pause, Square, Check, Trash2, X, ReceiptText, ListChecks } from 'lucide-react';
import Modal from '../components/Modal';
import JobForm from './JobForm';
import PaymentBadge from '../components/PaymentBadge';
import JobDetails from './JobDetails';
import { useGarden, useNow } from '../state';
import { billingBreakdown, duration, paidCents, remainingCents, settlementStatus, localDate, money, moneyCents, type Job } from '../domain';
import './jobs.css';

const statusLabels = { planned: 'Zaplanowane', 'in-progress': 'W trakcie', completed: 'Zakończone' };
export default function Jobs({ history = false }: { history?: boolean }) {
  const { data, saveJob, deleteJob, startTimer, stopTimer, pauseTimer, resumeTimer, completeJob } = useGarden();
  const now = useNow();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Job | null>(null);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ jobId: string; initialBilling: boolean } | null>(null);
  const run = (action: () => void) => { try { action(); setError(''); } catch (e) { setError(e instanceof Error ? e.message : 'Nie udało się zapisać zmian.'); } };
  const create = () => {
    if (!data.gardens.length) { setError('Najpierw dodaj klienta i ogród w zakładce Obiekty.'); return; }
    setEditing({ id: crypto.randomUUID(), gardenId: data.gardens[0].id, title: '', date: localDate(), time: '08:00', status: 'planned', billing: 'hourly', rate: data.settings.hourlyRate, fixedPrice: 0, seconds: 0, materials: [], notes: '', activities: [], settlement: null });
  };
  const jobs = data.jobs.filter(job => (history ? job.status === 'completed' : job.status !== 'completed')).filter(job => {
    const garden = data.gardens.find(g => g.id === job.gardenId);
    const client = data.clients.find(c => c.id === garden?.clientId);
    return `${job.title} ${job.activities.join(' ')} ${garden?.name} ${client?.name}`.toLocaleLowerCase('pl').includes(search.toLocaleLowerCase('pl'));
  }).sort((a, b) => history ? b.date.localeCompare(a.date) : `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  return <>
    <div className="page-heading"><div><p className="eyebrow">{history ? 'TWOJA WYKONANA PRACA' : 'DOBRZE ZAPLANOWANY DZIEŃ'}</p><h1>{history ? 'Historia zleceń' : 'Zlecenia'}</h1><p className="muted">{history ? 'Czas, materiały i podsumowania wykonanych prac.' : 'Wszystkie prace, terminy i rozliczenia w jednym miejscu.'}</p></div>{!history && <button className="button primary" onClick={create}><Plus size={18}/> Nowe zlecenie</button>}</div>
    {!history && <p className="visit-definition"><Clock3 size={16}/><span>Wizytę licz od wyjścia z samochodu u klienta do zakończenia sprzątania i spakowania sprzętu. Dojazd, powrót oraz pauzy nie są doliczane.</span></p>}
    {error && <div className="error-banner" role="alert">{error}<button className="icon-button" aria-label="Zamknij komunikat" onClick={() => setError('')}><X size={16}/></button></div>}
    <div className="jobs-toolbar"><div className="search-box"><Search size={18}/><input className="search-input" placeholder="Szukaj zlecenia, klienta lub ogrodu…" aria-label="Szukaj zlecenia" value={search} onChange={e => setSearch(e.target.value)}/></div><span className="muted">{jobs.length} {jobs.length === 1 ? 'zlecenie' : 'zleceń'}</span></div>
    <div className="jobs-list">{jobs.map(job => {
      const garden = data.gardens.find(g => g.id === job.gardenId);
      const client = data.clients.find(c => c.id === garden?.clientId);
      const measuring = data.timer?.jobId === job.id;
      const paused = measuring && data.timer?.paused;
      const breakdown = billingBreakdown(job, now, data.timer);
      const paid = paidCents(job.id, data.payments);
      const remaining = remainingCents(job, data.payments, now, data.timer);
      return <article className={`card job-card ${measuring ? 'is-running' : ''} ${paused ? 'is-paused' : ''}`} key={job.id}>
        <div className="job-main">
          <div className="job-topline"><span className={`badge status-${job.status}`}>{measuring && !paused && <span className="live-dot"/>}{statusLabels[job.status]}</span>{paused && <span className="badge job-paused-badge"><Pause size={11}/>Pauza · czas nie jest naliczany</span>}<PaymentBadge status={settlementStatus(job, data.payments, now, data.timer)}/><span className="job-billing">{job.billing === 'hourly' ? `${money(job.rate)}/h` : 'Ryczałt'}</span></div>
          <h2><button className="job-title-button" onClick={() => setDetail({jobId: job.id, initialBilling: false})}>{job.title}</button></h2><p className="job-client">{client?.name ?? 'Nieznany klient'}</p><p className="job-location"><MapPin size={15}/>{garden?.name} · {garden?.address}</p>
          <div className="job-meta"><span><CalendarDays size={15}/>{new Date(`${job.date}T12:00:00`).toLocaleDateString('pl-PL', { day:'numeric', month:'long' })}, {job.time}</span><span><Clock3 size={15}/>{duration(breakdown.actualSeconds)}</span></div>
          {job.activities.length > 0 && <ul className="job-activities" aria-label="Czynności podczas wizyty">{job.activities.map((activity, index) => <li key={`${index}-${activity}`}><Check size={12}/>{activity}</li>)}</ul>}
          {!history && measuring && <button className="job-add-activity" onClick={() => setDetail({jobId: job.id, initialBilling: false})}><ListChecks size={15}/>Zapisz czynności bez zatrzymywania wizyty</button>}
          {job.notes && <p className="job-notes">{job.notes}</p>}
          {history && <dl className="job-history-breakdown"><div><dt>Robocizna wyliczona</dt><dd>{moneyCents(breakdown.calculatedLaborCents)}</dd></div><div><dt>{job.billing === 'fixed' ? 'Zaokrąglenie' : 'Propozycja po zaokrągleniu'}</dt><dd>{breakdown.suggestedLaborCents === null ? (breakdown.isLegacy ? 'Zachowano dotychczasową wycenę' : 'Nie dotyczy ryczałtu') : moneyCents(breakdown.suggestedLaborCents)}</dd></div><div><dt>Materiały osobno</dt><dd>{moneyCents(breakdown.materialsCents)}</dd></div><div><dt>Ostateczna robocizna</dt><dd>{breakdown.approved ? moneyCents(breakdown.finalLaborCents) : 'Do zatwierdzenia'}</dd></div></dl>}
        </div>
        <div className="job-side">
          <div className="job-amount"><small>{breakdown.approved ? 'Ostateczna należność' : 'Wartość przed zatwierdzeniem'}</small><strong>{moneyCents(breakdown.totalCents)}</strong><span>Praca {moneyCents(breakdown.finalLaborCents)} + materiały {moneyCents(breakdown.materialsCents)}</span></div>
          {history && <span className={`badge ${breakdown.approved ? 'job-price-approved' : 'job-price-pending'}`}>{breakdown.approved ? (breakdown.isLegacy ? 'Zachowana należność' : 'Cena zatwierdzona') : 'Cena wymaga zatwierdzenia'}</span>}
          <div className="job-settlement"><span>Zapłacono <b>{moneyCents(paid)}</b></span><span>Pozostało <b>{moneyCents(remaining)}</b></span></div>
          <button className="job-details-link" onClick={() => setDetail({jobId: job.id, initialBilling: false})}><ReceiptText size={15}/> Szczegóły i płatności</button>
          {history && !breakdown.approved && <button className="button secondary" onClick={() => setDetail({jobId: job.id, initialBilling: true})}>Zatwierdź rozliczenie</button>}
          {incompleteVisitChecklists(data,job.id).length>0 && <p className="checklist-finish-warning">{history?'Wizyta zakończona z niepełną checklistą.':'Niepełna checklista — zakończenie wizyty zachowa niewykonane czynności.'}</p>}
          <div className="job-actions">{!history && <>
            {measuring ? <>
              {paused ? <button className="button primary visit-control" onClick={() => run(resumeTimer)}><Play size={16} fill="currentColor"/> WZNÓW — Kontynuuj wizytę</button> : <button className="button secondary visit-control" onClick={() => run(pauseTimer)}><Pause size={16} fill="currentColor"/> PAUZA — Przerwa bez naliczania</button>}
              <button className="button stop-button visit-control" onClick={() => run(stopTimer)}><Square size={16} fill="currentColor"/> STOP — Zakończ pomiar</button>
            </> : <button className="button primary visit-control" disabled={!!data.timer} onClick={() => run(() => startTimer(job.id))} title={data.timer ? 'Zakończ aktywny lub wstrzymany pomiar przed rozpoczęciem kolejnej wizyty.' : 'Od wyjścia z samochodu do spakowania sprzętu'}><Play size={16} fill="currentColor"/> START — Rozpocznij wizytę</button>}
            <button className="button secondary" onClick={() => run(() => { completeJob(job.id); setDetail({jobId: job.id, initialBilling: true}); })}><Check size={16}/> Zakończ</button>
          </>}<button className="icon-button" title="Edytuj zlecenie" aria-label={`Edytuj ${job.title}`} onClick={() => setDetail({jobId: job.id, initialBilling: false})}><Pencil size={17}/></button><button className="icon-button" title="Usuń zlecenie" aria-label={`Usuń ${job.title}`} disabled={measuring} onClick={() => { setError(''); setDeleting(job.id); }}><Trash2 size={17}/></button></div>
        </div>
      </article>;
    })}{!jobs.length && <div className="card empty-state"><ReceiptText size={36}/><h2>{search ? 'Brak wyników' : history ? 'Historia dopiero się zaczyna' : 'Wszystko pod kontrolą'}</h2><p className="muted">{search ? 'Zmień wyszukiwaną frazę.' : history ? 'Tutaj zobaczysz zakończone zlecenia.' : 'Dodaj zlecenie i zaplanuj kolejny dzień pracy.'}</p>{!history && !search && <button className="button primary" onClick={create}><Plus size={16}/> Dodaj zlecenie</button>}</div>}</div>
    {editing && <JobForm job={editing} onClose={() => setEditing(null)} onSave={job => { saveJob(job); setEditing(null); }}/ >}
    {deleting && <Modal title="Usunąć zlecenie?" onClose={() => setDeleting(null)}>{error && <div className="error-banner" role="alert">{error}</div>}<p>Usunięcie zlecenia skasuje jego czas i rozliczenie. Tej operacji nie można cofnąć.</p><div className="modal-actions"><button className="button secondary" onClick={() => setDeleting(null)}>Anuluj</button><button className="button danger" onClick={() => run(() => { deleteJob(deleting); setDeleting(null); })}>Usuń zlecenie</button></div></Modal>}
    {detail && <JobDetails jobId={detail.jobId} initialBilling={detail.initialBilling} onClose={() => setDetail(null)}/>}
  </>;
}

