import { ContextNotes } from '../desk/Notes';
import PhotoGallery from '../photos/PhotoGallery';
import ClientForm from './ClientForm';
import GardenForm from './GardenForm';
import { lazy, Suspense } from 'react';
import { useCardNavigation } from './card-navigation';
import GroupedJobHistory from './GroupedJobHistory';
const RelatedCards=lazy(()=>import('./RelatedCards'));
import JobForm from './JobForm';
import { localDate, type Garden } from '../domain';
import { useState } from 'react';
import { ArrowLeft, CalendarDays, CheckCheck, Clock3, FilterX, Mail, MapPin, Phone, Sprout, Wallet } from 'lucide-react';
import { clientSummary, duration, moneyCents, settlementLabels, settlementStatus, type Job } from '../domain';
import { useGarden, useNow } from '../state';
import JobDetails from './JobDetails';
import './client-details.css';

const workLabels: Record<Job['status'], string> = { planned: 'Zaplanowane', 'in-progress': 'W trakcie', completed: 'Zakończone' };
type PaymentFilter = '' | 'unpaid' | 'partial' | 'paid';
const polishPlural = (count: number, one: string, few: string, many: string) => count === 1 ? one : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14) ? few : many;

export default function ClientDetails({ clientId, onBack, backLabel='Wróć do klientów' }: { clientId: string; onBack: () => void; backLabel?:string }) {
  const { data, saveJob } = useGarden();
  const now = useNow();
  const navigation=useCardNavigation();
  const openGarden=(id:string)=>navigation?navigation.open({kind:'garden',id}):setSelectedGarden(id);
  const openJob=(id:string,initialBilling=false)=>{if(navigation)navigation.open({kind:'job',id,initialBilling});else{setJobBilling(initialBilling);setSelectedJob(id);}};
  const [selectedGarden, setSelectedGarden] = useState('');
  const [editClient, setEditClient] = useState(false);
  const [editGarden, setEditGarden] = useState<Garden | null>(null);
  const [newJob, setNewJob] = useState<Job | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [gardenFilter, setGardenFilter] = useState('');
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>('');
  const [workFilter, setWorkFilter] = useState<Job['status'] | ''>('');
  const [jobBilling,setJobBilling]=useState(false);
  const [selectedJob, setSelectedJob] = useState<string | null>(null);
  const client = data.clients.find(item => item.id === clientId);
  const gardens = data.gardens.filter(item => item.clientId === clientId);
  const gardenIds = new Set(gardens.map(item => item.id));
  const jobs = data.jobs.filter(item => gardenIds.has(item.gardenId));
  const summary = clientSummary(data, clientId, now);
  const awaitingApproval = jobs.filter(job => job.status === 'completed' && !job.settlement).length;
  const invalidPeriod = !!(from && to && from > to);
  const filteredJobs = jobs.filter(job =>
    (!from || job.date >= from) && (!to || job.date <= to)
    && (!gardenFilter || job.gardenId === gardenFilter)
    && (!paymentFilter || settlementStatus(job, data.payments, now, data.timer) === paymentFilter)
    && (!workFilter || job.status === workFilter),
  ).sort((left, right) => `${right.date}${right.time}`.localeCompare(`${left.date}${left.time}`));
  const resetFilters = () => { setFrom(''); setTo(''); setGardenFilter(''); setPaymentFilter(''); setWorkFilter(''); };
  const hasFilters = !!(from || to || gardenFilter || paymentFilter || workFilter);

  if (!client) return <section className="client-details-page"><button className="client-back" onClick={onBack}><ArrowLeft size={16}/>{backLabel}</button><div className="card empty-state"><h1>Nie znaleziono klienta</h1><p>Wróć do listy, aby wybrać dostępnego klienta.</p></div></section>;

  return <section className="client-details-page">
    <button className="client-back" onClick={onBack}><ArrowLeft size={16}/>{backLabel}</button>
    <div className="page-heading client-panel-heading"><div><p className="eyebrow">KARTA KLIENTA</p><h1>{client.name}</h1><p className="muted">Wszystkie ogrody, wykonane prace i rozliczenia w jednym miejscu.</p></div><span className="client-panel-label"><Sprout size={17}/>{gardens.length} {polishPlural(gardens.length, 'ogród', 'ogrody', 'ogrodów')} pod opieką</span></div>

    <div className="job-actions"><button className="button secondary" onClick={() => setEditClient(true)}>Edytuj klienta</button><button className="button secondary" onClick={() => setEditGarden({ id: crypto.randomUUID(), clientId, name: '', address: '', area: 0, notes: '', zones: [] })}>Dodaj ogród</button><button className="button primary" disabled={!gardens.length} onClick={() => setNewJob({ id: crypto.randomUUID(), gardenId: gardens.length === 1 ? gardens[0].id : '', title: '', date: localDate(), time: '08:00', status: 'planned', billing: 'hourly', rate: data.settings.hourlyRate, fixedPrice: 0, seconds: 0, materials: [], notes: '', activities: [], settlement: null })}>Nowe zlecenie</button></div>
    <div className="client-metrics" aria-label="Podsumowanie finansowe klienta">
      <Metric label="WARTOŚĆ WYKONANYCH PRAC" value={moneyCents(summary.completedValueCents)} note="Zakończone · zatwierdzone należności" icon={<CheckCheck size={20}/>} testId="client-completed-value"/>
      <Metric label="OTRZYMANE PŁATNOŚCI" value={moneyCents(summary.receivedCents)} note="Rzeczywiste wpłaty, także zaliczki" icon={<Wallet size={20}/>} testId="client-received"/>
      <Metric label="POZOSTAŁO DO ZAPŁATY" value={moneyCents(summary.outstandingCents)} note="Zatwierdzone należności za zakończone prace" icon={<Wallet size={20}/>} testId="client-outstanding" debt/>
      <Metric label="ŁĄCZNY CZAS PRACY" value={duration(summary.seconds)} note="Wszystkie prace · godz.:min.:sek." icon={<Clock3 size={20}/>} testId="client-work-time"/>
    </div>
    <p className="client-summary-note">Wskaźniki obejmują całą współpracę i wszystkie ogrody klienta. Wartość prac i saldo uwzględniają zatwierdzone należności za zakończone zlecenia. Czas pracy i faktyczne wpłaty są liczone niezależnie od zatwierdzenia ceny. Filtry poniżej dotyczą wyłącznie tabeli zleceń.</p>
    <div className="client-status-counts" aria-label="Liczba zleceń klienta"><span><i className="status-count-dot done"/><strong>{summary.completedCount}</strong> zakończonych</span><span><i className="status-count-dot planned"/><strong>{summary.plannedCount}</strong> zaplanowanych</span><span title="Zakończone zlecenia z zatwierdzoną kwotą pozostającą do zapłaty"><i className="status-count-dot unpaid"/><strong>{summary.unsettledCount}</strong> nierozliczonych zakończonych</span>{awaitingApproval > 0 && <span className="client-awaiting-count"><strong>{awaitingApproval}</strong> do zatwierdzenia ceny</span>}<span className="client-all-jobs">Wszystkich zleceń: <strong>{jobs.length}</strong></span></div>

    <div className="client-context-grid">
      <section className="card client-contact-panel"><h2>Dane kontaktowe</h2><div className="client-contact"><Phone size={16}/>{client.phone ? <a href={`tel:${client.phone.replace(/\s/g, '')}`}>{client.phone}</a> : <span>Brak telefonu</span>}</div><div className="client-contact"><Mail size={16}/>{client.email ? <a href={`mailto:${client.email}`}>{client.email}</a> : <span>Brak adresu e-mail</span>}</div><div className="client-contact-notes"><span className="eyebrow">NOTATKI O KLIENCIE</span><p>{client.notes || 'Brak dodatkowych notatek.'}</p></div></section>
      <section className="card client-gardens-panel"><div className="client-section-heading"><div><h2>Ogrody klienta</h2><p className="muted">Wszystkie obiekty przypisane do tego klienta</p></div><Sprout size={22}/></div>{gardens.length ? <div className="client-gardens-grid">{gardens.map(garden => <article className="client-garden" key={garden.id}><div><Sprout size={16}/><h3><button className="client-garden-name" aria-label={`Otwórz ogród ${garden.name}`} onClick={()=>openGarden(garden.id)}>{garden.name}</button></h3><button className="button secondary" onClick={() => setEditGarden(garden)}>Edytuj ogród</button></div><p><MapPin size={13}/>{garden.address || 'Brak adresu'}</p><button className="text-button" onClick={() => openGarden(garden.id)}>Otwórz ogród</button><footer><span>{garden.area.toLocaleString('pl-PL')} m²</span><span>{jobs.filter(job => job.gardenId === garden.id).length} zleceń</span></footer>{garden.notes && <p className="client-garden-note">{garden.notes}</p>}</article>)}</div> : <div className="client-inline-empty">Ten klient nie ma jeszcze przypisanych ogrodów. Użyj przycisku „Dodaj ogród” powyżej, a następnie utwórz zlecenie.</div>}</section>
    </div>

    <section className="card client-jobs-panel">
      <div className="client-section-heading"><div><h2>Zlecenia i historia prac</h2><p className="muted">Kliknij zlecenie, aby zobaczyć jego szczegóły i historię płatności.</p></div><div className="client-history-actions"><button className={`button ${workFilter === '' ? 'primary' : 'secondary'}`} onClick={() => setWorkFilter('')}>Wszystkie prace</button><button className={`button ${workFilter === 'completed' ? 'primary' : 'secondary'}`} onClick={() => setWorkFilter('completed')}><CheckCheck size={15}/>Historia wykonanych</button></div></div>
      <div className="client-job-filters" aria-label="Filtry zleceń klienta">
        <label className="field">Okres od<input aria-label="Okres od" type="date" value={from} onChange={event => setFrom(event.target.value)}/></label>
        <label className="field">Okres do<input aria-label="Okres do" type="date" value={to} onChange={event => setTo(event.target.value)}/></label>
        <label className="field">Ogród<select aria-label="Filtr ogrodu" value={gardenFilter} onChange={event => setGardenFilter(event.target.value)}><option value="">Wszystkie ogrody</option>{gardens.map(garden => <option key={garden.id} value={garden.id}>{garden.name}</option>)}</select></label>
        <label className="field">Status płatności<select aria-label="Filtr statusu płatności" value={paymentFilter} onChange={event => setPaymentFilter(event.target.value as PaymentFilter)}><option value="">Wszystkie rozliczenia</option>{(['unpaid', 'partial', 'paid'] as const).map(status => <option key={status} value={status}>{settlementLabels[status]}</option>)}</select></label>
        <label className="field">Status wykonania<select aria-label="Filtr statusu wykonania" value={workFilter} onChange={event => setWorkFilter(event.target.value as Job['status'] | '')}><option value="">Wszystkie statusy</option>{(['planned', 'in-progress', 'completed'] as const).map(status => <option key={status} value={status}>{workLabels[status]}</option>)}</select></label>
      </div>
      <div className="client-filter-summary"><span>{filteredJobs.length} z {jobs.length} zleceń</span>{hasFilters && <button onClick={resetFilters}><FilterX size={14}/>Wyczyść filtry</button>}</div>

      {invalidPeriod && <p className="client-period-error" role="alert">Data „od” nie może być późniejsza niż data „do”. Popraw wybrany okres.</p>}
      {filteredJobs.length ? <GroupedJobHistory jobs={filteredJobs} onOpen={openJob} showGarden/> : <div className="client-jobs-empty"><CalendarDays size={30}/><h3>{jobs.length ? 'Brak zleceń dla wybranych filtrów' : 'Współpraca dopiero się zaczyna'}</h3><p>{jobs.length ? 'Zmień okres, ogród lub status, aby zobaczyć pozostałe prace.' : 'Zlecenia przypisane do ogrodów tego klienta pojawią się tutaj.'}</p>{hasFilters && <button className="button secondary" onClick={resetFilters}>Pokaż wszystkie zlecenia</button>}</div>}
      <p className="client-table-note">Wartości prac przed zatwierdzeniem ceny są orientacyjne i nie zwiększają podsumowania należności. W szczegółach zlecenia sprawdzisz dokładny czas, wyliczoną robociznę, propozycję zaokrąglenia i materiały. Zakończenie pracy nie rejestruje wpłaty.</p>
    </section>
    <ContextNotes scope={{ clientId }} title="Notatki klienta"/>
    <PhotoGallery key={clientId} scope={{ clientId }} title="Galeria klienta"/>
    {selectedGarden && <Suspense fallback={<p role="status">Otwieranie ogrodu…</p>}><RelatedCards initial={{kind:'garden',id:selectedGarden}} originClientId={clientId} onClose={() => setSelectedGarden('')}/></Suspense>}
    {editClient && <ClientForm initial={client} isNew={false} onClose={() => setEditClient(false)}/>}
    {editGarden && <GardenForm initial={editGarden} isNew={!data.gardens.some(g => g.id === editGarden.id)} onClose={() => setEditGarden(null)}/>}
    {newJob && <JobForm clientId={clientId} job={newJob} onClose={() => setNewJob(null)} onSave={job => { saveJob(job); setNewJob(null); openJob(job.id); }}/>}
    {selectedJob && <JobDetails jobId={selectedJob} initialBilling={jobBilling} onClose={() => setSelectedJob(null)}/>}
  </section>;
}

function Metric({ label, value, note, icon, testId, debt = false }: { label: string; value: string; note: string; icon: React.ReactNode; testId: string; debt?: boolean }) {
  return <article className={`card client-metric ${debt ? 'client-debt-metric' : ''}`}><div><span>{label}</span><i>{icon}</i></div><strong data-testid={testId}>{value}</strong><small>{note}</small></article>;
}
