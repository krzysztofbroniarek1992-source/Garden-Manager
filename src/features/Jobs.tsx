import { useState, type FormEvent } from 'react';
import { Plus, Search, MapPin, CalendarDays, Clock3, Pencil, Play, Square, Check, Trash2, X, ReceiptText } from 'lucide-react';
import Modal from '../components/Modal';
import PaymentBadge from '../components/PaymentBadge';
import JobDetails from './JobDetails';
import { useGarden, useNow } from '../state';
import { duration, elapsedSeconds, jobLaborCents, jobTotalCents, materialsTotalCents, paidCents, remainingCents, settlementStatus, localDate, money, moneyCents, type Job, type Material } from '../domain';
import './jobs.css';

const statusLabels = { planned: 'Zaplanowane', 'in-progress': 'W trakcie', completed: 'Zakończone' };
export default function Jobs({ history = false }: { history?: boolean }) {
  const { data, saveJob, deleteJob, startTimer, stopTimer, completeJob } = useGarden();
  const now = useNow();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Job | null>(null);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const run = (action: () => void) => { try { action(); setError(''); } catch (e) { setError(e instanceof Error ? e.message : 'Nie udało się zapisać zmian.'); } };
  const create = () => {
    if (!data.gardens.length) { setError('Najpierw dodaj klienta i ogród w zakładce Obiekty.'); return; }
    setEditing({ id: crypto.randomUUID(), gardenId: data.gardens[0].id, title: '', date: localDate(), time: '08:00', status: 'planned', billing: 'hourly', rate: data.settings.hourlyRate, fixedPrice: 0, seconds: 0, materials: [], notes: '' });
  };
  const jobs = data.jobs.filter(job => (history ? job.status === 'completed' : job.status !== 'completed')).filter(job => {
    const garden = data.gardens.find(g => g.id === job.gardenId);
    const client = data.clients.find(c => c.id === garden?.clientId);
    return `${job.title} ${garden?.name} ${client?.name}`.toLocaleLowerCase('pl').includes(search.toLocaleLowerCase('pl'));
  }).sort((a, b) => history ? b.date.localeCompare(a.date) : `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  return <>
    <div className="page-heading"><div><p className="eyebrow">{history ? 'TWOJA WYKONANA PRACA' : 'DOBRZE ZAPLANOWANY DZIEŃ'}</p><h1>{history ? 'Historia zleceń' : 'Zlecenia'}</h1><p className="muted">{history ? 'Czas, materiały i podsumowania wykonanych prac.' : 'Wszystkie prace, terminy i rozliczenia w jednym miejscu.'}</p></div>{!history && <button className="button primary" onClick={create}><Plus size={18}/> Nowe zlecenie</button>}</div>
    {error && <div className="error-banner" role="alert">{error}<button className="icon-button" aria-label="Zamknij komunikat" onClick={() => setError('')}><X size={16}/></button></div>}
    <div className="jobs-toolbar"><div className="search-box"><Search size={18}/><input className="search-input" placeholder="Szukaj zlecenia, klienta lub ogrodu…" aria-label="Szukaj zlecenia" value={search} onChange={e => setSearch(e.target.value)}/></div><span className="muted">{jobs.length} {jobs.length === 1 ? 'zlecenie' : 'zleceń'}</span></div>
    <div className="jobs-list">{jobs.map(job => {
      const garden = data.gardens.find(g => g.id === job.gardenId);
      const client = data.clients.find(c => c.id === garden?.clientId);
      const running = data.timer?.jobId === job.id;
      const materials = materialsTotalCents(job);
      const paid = paidCents(job.id, data.payments);
      const remaining = remainingCents(job, data.payments, now, data.timer);
      return <article className={`card job-card ${running ? 'is-running' : ''}`} key={job.id}>
        <div className="job-main"><div className="job-topline"><span className={`badge status-${job.status}`}>{running && <span className="live-dot"/>}{statusLabels[job.status]}</span><PaymentBadge status={settlementStatus(job, data.payments, now, data.timer)}/><span className="job-billing">{job.billing === 'hourly' ? `${money(job.rate)}/h` : 'Ryczałt'}</span></div><h2><button className="job-title-button" onClick={() => setDetailId(job.id)}>{job.title}</button></h2><p className="job-client">{client?.name ?? 'Nieznany klient'}</p><p className="job-location"><MapPin size={15}/>{garden?.name} · {garden?.address}</p><div className="job-meta"><span><CalendarDays size={15}/>{new Date(`${job.date}T12:00:00`).toLocaleDateString('pl-PL', { day:'numeric', month:'long' })}, {job.time}</span><span><Clock3 size={15}/>{duration(elapsedSeconds(job, data.timer, now))}</span></div>{job.notes && <p className="job-notes">{job.notes}</p>}</div>
        <div className="job-side"><div className="job-amount"><small>Łącznie</small><strong>{moneyCents(jobTotalCents(job, now, data.timer))}</strong><span>Praca {moneyCents(jobLaborCents(job, now, data.timer))} + materiały {moneyCents(materials)}</span></div><div className="job-settlement"><span>Zapłacono <b>{moneyCents(paid)}</b></span><span>Pozostało <b>{moneyCents(remaining)}</b></span></div><button className="job-details-link" onClick={() => setDetailId(job.id)}><ReceiptText size={15}/> Szczegóły i płatności</button><div className="job-actions">{!history && <>{running ? <button className="button stop-button" onClick={() => run(stopTimer)}><Square size={16} fill="currentColor"/> STOP</button> : <button className="button primary" disabled={!!data.timer} onClick={() => run(() => startTimer(job.id))} title={data.timer ? 'Zatrzymaj aktywny stoper przed rozpoczęciem kolejnego.' : 'Rozpocznij pomiar czasu'}><Play size={16} fill="currentColor"/> START</button>}<button className="button secondary" onClick={() => run(() => completeJob(job.id))}><Check size={16}/> Zakończ</button></>}<button className="icon-button" title="Edytuj zlecenie" aria-label={`Edytuj ${job.title}`} disabled={running} onClick={() => setEditing({ ...job, materials: job.materials.map(m => ({...m})) })}><Pencil size={17}/></button><button className="icon-button" title="Usuń zlecenie" aria-label={`Usuń ${job.title}`} disabled={running} onClick={() => { setError(''); setDeleting(job.id); }}><Trash2 size={17}/></button></div></div>
      </article>;
    })}{!jobs.length && <div className="card empty-state"><ReceiptText size={36}/><h2>{search ? 'Brak wyników' : history ? 'Historia dopiero się zaczyna' : 'Wszystko pod kontrolą'}</h2><p className="muted">{search ? 'Zmień wyszukiwaną frazę.' : history ? 'Tutaj zobaczysz zakończone zlecenia.' : 'Dodaj zlecenie i zaplanuj kolejny dzień pracy.'}</p>{!history && !search && <button className="button primary" onClick={create}><Plus size={16}/> Dodaj zlecenie</button>}</div>}</div>
    {editing && <JobForm job={editing} onClose={() => setEditing(null)} onSave={job => { saveJob(job); setEditing(null); }}/ >}
    {deleting && <Modal title="Usunąć zlecenie?" onClose={() => setDeleting(null)}>{error && <div className="error-banner" role="alert">{error}</div>}<p>Usunięcie zlecenia skasuje jego czas i rozliczenie. Tej operacji nie można cofnąć.</p><div className="modal-actions"><button className="button secondary" onClick={() => setDeleting(null)}>Anuluj</button><button className="button danger" onClick={() => run(() => { deleteJob(deleting); setDeleting(null); })}>Usuń zlecenie</button></div></Modal>}
    {detailId && <JobDetails jobId={detailId} onClose={() => setDetailId(null)}/>}
  </>;
}

function JobForm({ job, onClose, onSave }: { job: Job; onClose: () => void; onSave: (job: Job) => void }) {
  const { data } = useGarden();
  const [draft, setDraft] = useState(job);
  const [error, setError] = useState('');
  const patch = <K extends keyof Job>(key: K, value: Job[K]) => setDraft(current => ({ ...current, [key]: value }));
  const patchMaterial = (id: string, key: keyof Material, value: string | number) => patch('materials', draft.materials.map(item => item.id === id ? { ...item, [key]: value } : item));
  const submit = (event: FormEvent) => { event.preventDefault(); try { onSave({ ...draft, title: draft.title.trim(), notes: draft.notes.trim() }); } catch (e) { setError(e instanceof Error ? e.message : 'Nie udało się zapisać zlecenia.'); } };
  const existing = data.jobs.some(item => item.id === job.id);
  let materialPreview = 'Sprawdź kwoty materiałów';
  try { materialPreview = moneyCents(materialsTotalCents(draft)); } catch { /* Invalid draft values are reported on save without crashing the form. */ }
  return <Modal title={existing ? 'Edytuj zlecenie' : 'Nowe zlecenie'} onClose={onClose} wide><form onSubmit={submit}>
    {error && <div className="error-banner" role="alert">{error}</div>}
    <div className="form-grid"><label className="field full">Nazwa pracy<input autoFocus required maxLength={150} value={draft.title} onChange={e => patch('title', e.target.value)} placeholder="np. Jesienne porządki i pielęgnacja"/></label><label className="field full">Ogród i klient<select required value={draft.gardenId} onChange={e => patch('gardenId', e.target.value)}>{data.gardens.map(g => <option key={g.id} value={g.id}>{g.name} — {data.clients.find(c => c.id === g.clientId)?.name}</option>)}</select></label><label className="field">Data<input required type="date" value={draft.date} onChange={e => patch('date', e.target.value)}/></label><label className="field">Godzina<input required type="time" value={draft.time} onChange={e => patch('time', e.target.value)}/></label><label className="field">Sposób rozliczenia<select value={draft.billing} onChange={e => patch('billing', e.target.value as Job['billing'])}><option value="hourly">Godzinowe</option><option value="fixed">Ryczałtowe</option></select></label>{draft.billing === 'hourly' ? <label className="field">Stawka (zł/h)<input required type="number" min="0" step="0.01" value={draft.rate} onChange={e => patch('rate', Number(e.target.value))}/></label> : <label className="field">Kwota ryczałtu (zł)<input required type="number" min="0" step="0.01" value={draft.fixedPrice} onChange={e => patch('fixedPrice', Number(e.target.value))}/></label>}<label className="field full">Notatka<textarea rows={2} maxLength={2000} value={draft.notes} onChange={e => patch('notes', e.target.value)} placeholder="Zakres prac, dojazd, ważne informacje…"/></label></div>
    <div className="materials-heading"><div><h3>Materiały</h3><p className="muted">Rozliczane osobno, poza kosztem pracy.</p></div><button className="button ghost" type="button" onClick={() => patch('materials', [...draft.materials, { id: crypto.randomUUID(), name: '', quantity: 1, unitPrice: 0 }])}><Plus size={16}/> Dodaj</button></div>
    <div className="materials-list">{draft.materials.map((item, index) => <div className="material-row" key={item.id}><label className="field material-name">Materiał<input required aria-label={`Nazwa materiału ${index + 1}`} maxLength={120} placeholder="np. Nawóz 5 kg" value={item.name} onChange={e => patchMaterial(item.id, 'name', e.target.value)}/></label><label className="field">Ilość<input required aria-label={`Ilość materiału ${index + 1}`} type="number" min="0.01" step="0.01" value={item.quantity} onChange={e => patchMaterial(item.id, 'quantity', Number(e.target.value))}/></label><label className="field">Cena / szt. (zł)<input required aria-label={`Cena materiału ${index + 1}`} type="number" min="0" step="0.01" value={item.unitPrice} onChange={e => patchMaterial(item.id, 'unitPrice', Number(e.target.value))}/></label><button className="icon-button" type="button" aria-label={`Usuń materiał ${index + 1}`} onClick={() => patch('materials', draft.materials.filter(m => m.id !== item.id))}><Trash2 size={16}/></button></div>)}</div>
    <div className="materials-total"><span>Materiały razem</span><strong>{materialPreview}</strong></div>
    <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Anuluj</button><button type="submit" className="button primary">Zapisz zlecenie</button></div>
  </form></Modal>;
}
