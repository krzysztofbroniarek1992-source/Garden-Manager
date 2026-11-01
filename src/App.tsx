import { useUnsavedChanges } from './navigation/unsaved'
import RelatedCards from './features/RelatedCards'
import { NavigationProvider, useNavigation, ViewScope } from './navigation/Navigation'
import type { Page } from './navigation/routes'
import Notes from './desk/Notes'
import Todos from './desk/Todos'
import DeskOverview, { DeskQuickActions } from './desk/Overview'
import FullBackupPanel from './photos/FullBackupPanel'
import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react'
import { ArrowDownToLine, ArrowRight, Calculator, Package, StickyNote, ListTodo, ListChecks, CalendarDays, Check, ChevronRight, Clock3, Flower2, History, LayoutDashboard, Leaf, MapPin, MoreHorizontal, Pause, Play, Plus, Settings2, ShieldCheck, Sprout, Square, TrendingUp, Users, Wallet, Wifi, WifiOff } from 'lucide-react'
import { useGarden, useNow } from './state'
import { duration, elapsedSeconds, calculatedLaborCents, jobTotalCents, localDate, money, moneyCents, remainingCents, sumCents } from './domain'
import Clients from './features/Clients'
import Gardens from './features/Gardens'
import Materials from './features/Materials'
import Calculators from './features/Calculators'
import Jobs from './features/Jobs'
import Calendar from './features/Calendar'
import PlanningReminders from './features/PlanningReminders'
import Modal from './components/Modal'
import { STORAGE_VERSION } from './data/repository'
import './features/dashboard-finance.css'

const TemplateLibrary = lazy(() => import('./checklists/Library'))

const navigation = [
  { id: 'dashboard', label: 'Panel główny', short: 'Pulpit', icon: LayoutDashboard },
  { id: 'clients', label: 'Klienci', short: 'Klienci', icon: Users },
  { id: 'gardens', label: 'Obiekty i ogrody', short: 'Ogrody', icon: Sprout },
  { id: 'jobs', label: 'Zlecenia', short: 'Zlecenia', icon: ClipboardIcon },
  { id: 'calendar', label: 'Kalendarz', short: 'Kalendarz', icon: CalendarDays },
  { id: 'materials', label: 'Materiały', short: 'Materiały', icon: Package },
  { id: 'calculators', label: 'Kalkulatory', short: 'Oblicz', icon: Calculator },
  { id: 'notes', label: 'Notatki', short: 'Notatki', icon: StickyNote },
  { id: 'todos', label: 'Do zrobienia', short: 'Sprawy', icon: ListTodo },
  { id: 'templates', label: 'Szablony prac', short: 'Szablony', icon: ListChecks },
  { id: 'history', label: 'Historia prac', short: 'Historia', icon: History },
] as const
function ClipboardIcon({ size = 20 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="4" width="14" height="17" rx="2"/><rect x="9" y="2" width="6" height="4" rx="1"/><path d="M9 11h6M9 15h4"/></svg> }

export default function App() { return <NavigationProvider><AppContent/></NavigationProvider> }
function AppContent() {
  const navigationState = useNavigation()
  const page = navigationState.route.page
  const [settings, setSettings] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const [more, setMore] = useState(false)
  const { data, error } = useGarden()
  const go = (value: Page) => { navigationState.go(value); setMore(false) }
  useEffect(() => {
    const onOnline = () => setOnline(navigator.onLine)
    window.addEventListener('online', onOnline); window.addEventListener('offline', onOnline)
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOnline) }
  }, [])
  return <div className="app-shell">
    <aside className="sidebar">
      <a href="#dashboard" className="brand" onClick={event => {event.preventDefault();go('dashboard')}}><span className="brand-icon"><Leaf size={25}/></span><span>garden<span className="brand-light">manager</span><small>TWÓJ BIZNES. NATURALNIE.</small></span></a>
      <div className="workspace-label">PRZESTRZEŃ ROBOCZA</div>
      <nav aria-label="Nawigacja główna">{navigation.map(item => <button key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`} aria-current={page === item.id ? 'page' : undefined} onClick={() => go(item.id)}><item.icon size={20}/><span>{item.label}</span>{item.id === 'jobs' && <span className="nav-count">{data.jobs.filter(j => j.status !== 'completed').length}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="demo-sidebar"><span className="demo-dot"/> Wersja demonstracyjna<p>Poznaj swój nowy rytm pracy.<br/>Dane zapisujemy na tym urządzeniu.</p><span className="version-tag">WERSJA 0.3.6</span></div><button className="nav-item" onClick={() => setSettings(true)}><Settings2 size={20}/>Ustawienia</button><div className="profile"><span className="avatar">OG</span><div><strong>Moja firma ogrodnicza</strong><small>Konto demonstracyjne</small></div><ShieldCheck size={17}/></div></div>
    </aside>
    <div className="app-body">
      <header className="topbar"><div className="breadcrumb"><span>Moja firma</span><ChevronRight size={15}/><strong>{navigation.find(n => n.id === page)?.label}</strong></div><div className="topbar-right"><span className="connection">{online ? <Wifi size={15}/> : <WifiOff size={15}/>}<span>{online ? 'Zapis lokalny' : 'Tryb offline'}</span></span><span className="topbar-divider"/><span className="demo-badge">DEMO · DANE TESTOWE</span><button className="avatar small" aria-label="Ustawienia konta demonstracyjnego" onClick={() => setSettings(true)}>OG</button></div></header>
      <main id="main-content">{navigationState.invalid && <div role="alert" className="error-banner">Nieprawidłowy adres widoku. Wybierz obiekt z listy.<button className="button secondary" onClick={() => go(page)}>Pokaż listę</button></div>}{error && <div role="alert" className="error-banner">{error}</div>}<ViewScope.Provider value={`page:${page}`}><div hidden={page === 'clients' && navigationState.route.cards[0]?.kind === 'client'} inert={navigationState.route.cards.length > 0}>{page === 'dashboard' ? <Dashboard go={go}/> : page === 'clients' ? <Clients/> : page === 'gardens' ? <Gardens/> : page === 'materials' ? <Materials/> : page === 'calculators' ? <Calculators/> : page === 'notes' ? <Notes/> : page === 'todos' ? <Todos/> : page === 'templates' ? <Suspense fallback={<p role="status">Otwieranie szablonów prac…</p>}><TemplateLibrary/></Suspense> : page === 'calendar' ? <Calendar onOpenJobs={() => go('jobs')}/> : <Jobs key={page} history={page === 'history'}/>}</div></ViewScope.Provider><RelatedCards/></main>
      <footer className="app-footer"><span><Leaf size={13}/> Garden Manager <span className="footer-version">0.3.6</span></span><span>Dobra organizacja. Więcej czasu na to, co rośnie.</span></footer>
    </div>
    {more && <div className="mobile-more"><button onClick={() => go('templates')}><ListChecks size={20}/>Szablony prac</button><button onClick={() => go('notes')}><StickyNote size={20}/>Notatki</button><button onClick={() => go('todos')}><ListTodo size={20}/>Do zrobienia</button><button onClick={() => go('materials')}><Package size={20}/>Materiały</button><button onClick={() => go('calculators')}><Calculator size={20}/>Kalkulatory</button><button onClick={() => { go('history') }}><History size={20}/>Historia prac</button><button onClick={() => {setSettings(true);setMore(false)}}><Settings2 size={20}/>Ustawienia</button></div>}
    <nav className="mobile-nav" aria-label="Nawigacja mobilna">{navigation.filter(n => ['dashboard','clients','gardens','jobs','calendar'].includes(n.id)).map(item => <button key={item.id} onClick={() => go(item.id)} aria-current={page === item.id ? 'page' : undefined} className={page === item.id ? 'active' : ''}><item.icon size={21}/><span>{item.short}</span></button>)}<button onClick={() => setMore(!more)} aria-expanded={more}><MoreHorizontal size={21}/><span>Więcej</span></button></nav>
    {settings && <Settings onClose={() => setSettings(false)}/>}
  </div>
}

function Dashboard({ go }: { go: (page: Page) => void }) {
  const navigation=useNavigation()
  const { data, startTimer, stopTimer, pauseTimer, resumeTimer } = useGarden()
  const now = useNow()
  const [selection, setSelection] = useState('')
  const [message, setMessage] = useState('')
  const today = localDate()
  const month = today.slice(0, 7)
  const completed = data.jobs.filter(j => j.status === 'completed' && j.date.startsWith(month))
  const upcoming = data.jobs.filter(j => j.status !== 'completed').sort((a,b) => (a.date+a.time).localeCompare(b.date+b.time))
  const todayJobs = upcoming.filter(j => j.date === today)
  const activeJob = data.jobs.find(j => j.id === data.timer?.jobId)
  const selected = activeJob ?? upcoming.find(j => j.id === selection) ?? todayJobs[0] ?? upcoming[0]
  const garden = data.gardens.find(g => g.id === selected?.gardenId)
  const client = data.clients.find(c => c.id === garden?.clientId)
  const revenue = sumCents(completed.filter(j => j.settlement !== null).map(j => jobTotalCents(j)))
  const received = sumCents(data.payments.filter(p => p.receivedDate.startsWith(month)).map(p => p.amountCents))
  const finished = data.jobs.filter(j => j.status === 'completed' && j.settlement !== null)
  const pendingPrices = data.jobs.filter(j => j.status === 'completed' && j.settlement === null).length
  const outstanding = sumCents(finished.map(j => remainingCents(j,data.payments)))
  const unsettled = finished.filter(j => remainingCents(j,data.payments)>0).length
  const workSeconds = completed.reduce((sum,j) => sum+j.seconds,0)
  const action = () => {try { if(data.timer) { setSelection(data.timer.jobId); stopTimer() } else if(selected) startTimer(selected.id); setMessage('') } catch(e) {setMessage((e as Error).message)} }
  const days = Array.from({length:7},(_,i) => {const date = new Date();date.setDate(date.getDate()-6+i);const key=localDate(date);return {label:date.toLocaleDateString('pl-PL',{weekday:'short'}),value:sumCents(data.jobs.filter(j=>j.status==='completed' && j.settlement !== null && j.date===key).map(j=>jobTotalCents(j))),key} })
  const maxRevenue = Math.max(...days.map(d=>d.value),100)
  return <>
    <div className="dashboard-heading"><div><div className="eyebrow">TWÓJ BIZNES POD KONTROLĄ</div><h1>Dzień dobry, Ogrodniku <span className="greeting-leaf">✳</span></h1><p className="muted">Dobry plan to początek pięknego ogrodu. Zobacz, co przed Tobą.</p></div><div className="date-chip"><CalendarDays size={18}/><span>{new Date().toLocaleDateString('pl-PL',{day:'numeric',month:'long',year:'numeric'})}</span></div></div>
    <DeskQuickActions/>
    <section className="welcome-banner"><div><span className="banner-tag"><span/> TWOJE CODZIENNE CENTRUM DOWODZENIA</span><h2>Mniej formalności.<br/><em>Więcej zieleni.</em></h2><p>Klienci, ogrody i zlecenia — wszystko w jednym miejscu.<br/>Zaplanuj dzień i skup się na tym, co robisz najlepiej.</p><button className="button orange" onClick={() => go('jobs')}><Plus size={18}/> Dodaj zlecenie <ArrowRight size={16}/></button></div><Botanical/><div className="banner-note"><Sprout size={18}/><span>Porządek w pracy.<br/><strong>Spokój w głowie.</strong></span></div></section>
    <section className="stats-grid" aria-label="Podsumowanie miesiąca"><Stat label="Wartość wykonanych prac" value={moneyCents(revenue)} note="Zatwierdzone · bieżący miesiąc" icon={<Wallet size={21}/>} tone="green"/><Stat label="Czas pracy" value={`${(workSeconds/3600).toLocaleString('pl-PL',{maximumFractionDigits:1})} godz.`} note="Zakończone · bieżący miesiąc" icon={<Clock3 size={21}/>} tone="orange"/><Stat label="Zaplanowane prace" value={String(upcoming.length).padStart(2,'0')} note={`${todayJobs.length} do realizacji dzisiaj`} icon={<CalendarDays size={21}/>} tone="blue"/><Stat label="Twoi klienci" value={String(data.clients.length).padStart(2,'0')} note={`${data.gardens.length} ogrodów pod Twoją opieką`} icon={<Users size={21}/>} tone="purple"/></section>
    <section className="dashboard-finance" aria-label="Rozliczenia firmy">
      <article className="card dashboard-finance-metric" data-testid="dashboard-received"><span className="eyebrow">OTRZYMANE PŁATNOŚCI</span><strong>{moneyCents(received)}</strong><span className="muted">Wpłaty zarejestrowane w tym miesiącu, w tym zaliczki</span></article>
      <article className="card dashboard-finance-metric" data-testid="dashboard-outstanding"><span className="eyebrow">POZOSTAŁO DO ZAPŁATY</span><strong>{moneyCents(outstanding)}</strong><span className="muted">Zatwierdzone zakończone prace ze wszystkich okresów</span></article>
      <article className="card dashboard-finance-metric"><span className="eyebrow">NIEROZLICZONE ZLECENIA</span><strong>{unsettled}</strong><button className="text-button" onClick={() => go('history')}>Przejrzyj zakończone prace <ArrowRight size={15}/></button></article>
    </section>
    {pendingPrices > 0 && <div className="pending-prices-notice"><span>{pendingPrices} zakończonych zleceń czeka na zatwierdzenie ceny. Ich wyceny nie zwiększają jeszcze wartości prac ani salda.</span><button className="text-button" onClick={() => go('history')}>Zatwierdź rozliczenia <ArrowRight size={15}/></button></div>}
    <div className="dashboard-columns"><section className="card schedule-card"><div className="section-header"><div><h2>Plan pracy</h2><p className="muted">Najbliższe zlecenia w Twoim kalendarzu</p></div><button className="text-button" onClick={() => go('calendar')}>Kalendarz <ArrowRight size={16}/></button></div><div className="schedule-label"><span>NAJBLIŻSZE TERMINY</span><span>{upcoming.length} ZLECEŃ</span></div><div>{upcoming.slice(0,4).map(job => {const g=data.gardens.find(g=>g.id===job.gardenId);const c=data.clients.find(c=>c.id===g?.clientId);return <div key={job.id} className="upcoming-entry"><button className="schedule-row" aria-label={`Otwórz szczegóły zlecenia ${job.title}`} onClick={()=>navigation.open({kind:'job',id:job.id})}><div className="schedule-time"><strong>{job.time}</strong><span>{job.date===today?'Dzisiaj':new Date(`${job.date}T12:00:00`).toLocaleDateString('pl-PL',{day:'numeric',month:'short'})}</span></div><span className={`schedule-mark ${job.status==='in-progress'?'orange-mark':''}`}/><div className="schedule-details"><strong>{job.title}</strong><span>{c?.name} <i>·</i> {g?.name}</span></div><div className="schedule-right"><span className={`badge ${job.status==='in-progress'?'badge-orange':'badge-green'}`}>{job.status==='in-progress'?'W realizacji':'Zaplanowane'}</span><span className="schedule-location"><MapPin size={12}/>{g?.address}</span></div><ChevronRight size={16}/></button><button className="text-button schedule-timer-choice" disabled={!!data.timer} aria-label={`Wybierz do stopera ${job.title}`} onClick={()=>{setSelection(job.id);document.getElementById('work-timer')?.scrollIntoView({behavior:'smooth',block:'center'});document.getElementById('timer-job')?.focus({preventScroll:true})}}>Wybierz do stopera</button></div>})}{upcoming.length===0 && <div className="empty-state"><Sprout size={30}/><h3>Wszystko zrobione!</h3><p>Dodaj zlecenie i zaplanuj kolejną pracę.</p><button className="button secondary" onClick={()=>go('jobs')}>Przejdź do zleceń</button></div>}</div><button className="schedule-all" onClick={()=>go('jobs')}>Zobacz wszystkie zlecenia <ArrowRight size={15}/></button></section>
    <section id="work-timer" className={`timer-card ${data.timer?'is-running':''}`}>
      <div className="timer-header"><span><Clock3 size={19}/> Wizyta u klienta</span><span className="timer-indicator">{data.timer?.paused?'PAUZA':data.timer?'W TRAKCIE':'STOPER'}</span></div>
      <p className="timer-intro timer-contract">Od wyjścia z samochodu do sprzątnięcia i spakowania sprzętu. Dojazd i powrót poza pomiarem.</p>
      <div className="timer-digits" aria-live="off" data-testid="timer-display">{selected?duration(elapsedSeconds(selected,data.timer,now)):'00:00:00'}</div>
      <div className="timer-subtitle">{data.timer?.paused?<><Pause size={12}/>Przerwa — czas nie jest naliczany</>:data.timer?<><span className="live-dot"/>Pomiar czasu trwa</>:'Gotowy, kiedy Ty jesteś'}</div>
      <label className="timer-select-label" htmlFor="timer-job">ZLECENIE DO REALIZACJI</label>
      <select id="timer-job" className="timer-select" value={selected?.id??''} onChange={e=>setSelection(e.target.value)} disabled={!!data.timer || !upcoming.length}>{!upcoming.length && <option value="">Brak otwartych zleceń</option>}{upcoming.map(j=><option value={j.id} key={j.id}>{j.title}</option>)}</select>
      <p className="timer-client"><MapPin size={13}/>{client?.name??'Dodaj pierwsze zlecenie'}{garden && ` · ${garden.name}`}</p>
      {data.timer && <button className="button timer-secondary" onClick={() => {try { data.timer?.paused ? resumeTimer() : pauseTimer(); setMessage('') } catch(error) {setMessage((error as Error).message)} }}>{data.timer.paused?<><Play size={16}/>WZNÓW — Kontynuuj wizytę</>:<><Pause size={16}/>PAUZA — Przerwa bez naliczania</>}</button>}
      <button className={`button timer-action ${data.timer?'stop':'orange'}`} disabled={!selected} onClick={action}>{data.timer?<><Square size={17} fill="currentColor"/> STOP — Zakończ pomiar</>:<><Play size={18} fill="currentColor"/> START — Rozpocznij wizytę</>}</button>
      {message && <p role="alert">{message}</p>}
      <div className="timer-rate"><span>{selected?.billing==='fixed'?'Rozliczenie ryczałtowe':`Stawka ${money(selected?.rate??data.settings.hourlyRate)}/h`}</span><strong>{selected?moneyCents(calculatedLaborCents(selected,now,data.timer)):moneyCents(0)}</strong></div>
      <p className="timer-pricing-note">Robocizna jest wyliczana dokładnie. Cenę zatwierdzisz po zakończeniu zlecenia.</p>
    </section></div>
    <DeskOverview/>
    <PlanningReminders/>
    <div className="dashboard-bottom"><section className="card revenue-card"><div className="section-header"><div><h2>Małe kroki, dobre wyniki</h2><p className="muted">Zatwierdzona wartość prac · ostatnie 7 dni</p></div><span className="chart-total"><TrendingUp size={16}/>{moneyCents(sumCents(days.map(d=>d.value)))}</span></div><div className="revenue-chart" role="img" aria-label={`Wartość wykonanych prac z ostatnich 7 dni: ${days.map(d=>`${d.label} ${moneyCents(d.value)}`).join(', ')}`}>{days.map(d=><div className="chart-column" key={d.key}><span className="chart-value">{d.value?moneyCents(d.value):'—'}</span><div className="bar-track"><div className={`chart-bar ${d.key===today?'today-bar':''}`} style={{height:`${Math.max(3,d.value/maxRevenue*100)}%`}}/></div><span className={d.key===today?'today-label':''}>{d.label}</span></div>)}</div></section><section className="next-step-card"><span className="step-icon"><Flower2 size={27}/></span><div className="eyebrow">DOBRZE MIEĆ WSZYSTKO POD RĘKĄ</div><h2>Twoi klienci.<br/>{' '}Twoje relacje.</h2><p>Adresy ogrodów, dane kontaktowe i ważne notatki. Bez szukania w telefonie.</p><button className="text-button" onClick={()=>go('clients')}>Przejdź do klientów <ArrowRight size={16}/></button></section></div>
    <div className="demo-notice"><ShieldCheck size={16}/><span>Pracujesz na <strong>danych testowych</strong>. Zmiany są zapisywane tylko w tej przeglądarce. Synchronizacja między urządzeniami będzie dostępna w kolejnej wersji.</span></div>
  </>
}

function Stat({label,value,note,icon,tone}:{label:string,value:string,note:string,icon:React.ReactNode,tone:string}) {return <article className="card stat-card"><div className="stat-top"><span>{label}</span><span className={`stat-icon ${tone}`}>{icon}</span></div><strong className="stat-value">{value}</strong><span className="stat-note">{note}</span></article>}

function Settings({onClose}:{onClose:()=>void}) {
  const {data,setRate} = useGarden()
  const [rate,changeRate] = useState(String(data.settings.hourlyRate))
  const guard = useUnsavedChanges(rate !== String(data.settings.hourlyRate))
  const [message,setMessage] = useState('')
  useEffect(() => { changeRate(String(data.settings.hourlyRate)); setMessage('') }, [data.photoRestoreId])
  const save=(e:FormEvent)=>{e.preventDefault();try{setRate(Number(rate));setMessage('Zapisano domyślną stawkę dla nowych zleceń.')}catch(e){setMessage((e as Error).message)}}
  const backup=()=>{const blob=new Blob([JSON.stringify({version:STORAGE_VERSION,data},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=`garden-manager-${localDate()}.json`;link.click();URL.revokeObjectURL(url)}
  return <Modal title="Ustawienia" onClose={onClose}><div className="settings-intro"><span className="badge badge-green">Tryb demonstracyjny</span><p className="muted">Jedna firma, jedno miejsce na Twoją pracę. Dane pozostają na tym urządzeniu.</p></div><form ref={guard.ref} onSubmit={save}><label className="field">Domyślna stawka godzinowa (zł/h)<input type="number" min="0" max="100000" step="0.01" required value={rate} onChange={e=>changeRate(e.target.value)}/></label><p className="muted settings-help">Zmiana dotyczy nowych zleceń. Stawki w istniejących zleceniach pozostają zachowane.</p><button className="button primary" type="submit"><Check size={17}/>Zapisz ustawienia</button>{message && <p role="status" className="settings-message">{message}</p>}</form><div className="settings-backup"><h3>Kopia danych lokalnych</h3><p className="muted">Eksport JSON obejmuje wszystkie dane, notatki, przypomnienia, sprawy i metadane zdjęć, ale nie zawiera plików zdjęć. Do pełnego zabezpieczenia i odtworzenia użyj kopii ZIP poniżej.</p><button className="button secondary" onClick={backup}><ArrowDownToLine size={17}/>Eksportuj dane</button></div><FullBackupPanel/><div className="settings-backup"><h3>Synchronizacja Supabase</h3><p className="muted">Struktura bazy i zasady dostępu są przygotowane w repozytorium. Logowanie i synchronizacja to kolejny etap; obecna wersja działa bez konta.</p></div></Modal>
}

function Botanical(){return <svg className="botanical" viewBox="0 0 400 280" fill="none" aria-hidden="true"><circle cx="226" cy="140" r="112" fill="#e0e9d9" opacity=".55"/><circle cx="226" cy="140" r="92" stroke="#c7d4bf" strokeDasharray="3 7"/><path d="M218 258c13-88 26-145 24-221M229 173c-46-24-64-43-77-74M235 125c33-19 55-42 62-70M221 219c37-15 67-43 80-68" stroke="#51745a" strokeWidth="3" strokeLinecap="round"/><path d="M239 90c-46-8-64-33-53-60 37-3 64 17 53 60Z" fill="#557957"/><path d="M243 68c3-44 28-60 50-49 9 31-13 51-50 49Z" fill="#91ab77"/><path d="M233 139c-54 1-83-21-80-55 42-9 76 13 80 55Z" fill="#829d70"/><path d="M240 120c12-45 46-66 75-50-3 34-28 56-75 50Z" fill="#426c50"/><path d="M227 183c-53 2-88-24-83-58 46-7 76 13 83 58Z" fill="#365f47"/><path d="M229 179c14-38 44-53 73-41 1 32-28 51-73 41Z" fill="#a3b488"/><path d="M220 226c-51 3-91-21-87-58 47-5 79 19 87 58Z" fill="#67895d"/><path d="M224 220c17-40 53-57 82-38-4 35-38 52-82 38Z" fill="#446e50"/><path d="m150 99 80 42m-79 1 74 42m-83 0 77 42m28-108 53-39m-68 96 55-28m-59 69 61-26" stroke="#c7d6ac" strokeWidth="1.4" opacity=".55"/><path d="M84 235c1-42-2-65-23-88m23 63c-22-12-31-26-29-44 22 5 34 23 29 44Zm-1-17c18-22 22-41 10-57-17 15-21 34-10 57Z" fill="#9eb18a"/><circle cx="326" cy="105" r="5" fill="#e39c59"/><circle cx="111" cy="84" r="4" fill="#e39c59"/><path d="M322 219h16m-8-8v16" stroke="#9aac8c" strokeWidth="2"/></svg>}
