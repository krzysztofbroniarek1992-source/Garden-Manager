import JobDetails from './JobDetails';
import JobForm from './JobForm';
import type { Job } from '../domain';
import { useState } from 'react';
import { ChevronLeft, ChevronRight, CalendarDays, MapPin, ArrowUpRight } from 'lucide-react';
import { useGarden } from '../state';
import { localDate } from '../domain';
import './jobs.css';

const weekDays = ['Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob', 'Ndz'];
export default function Calendar({ onOpenJobs }: { onOpenJobs?: () => void }) {
  const { data, saveJob } = useGarden();
  const [selectedJob, setSelectedJob] = useState<string | null>(null);
  const [newJob, setNewJob] = useState<Job | null>(null);
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selected, setSelected] = useState(localDate());
  const firstOffset = (month.getDay() + 6) % 7;
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cellCount = Math.ceil((firstOffset + daysInMonth) / 7) * 7;
  const cells = Array.from({length:cellCount}, (_, i) => new Date(month.getFullYear(), month.getMonth(), i - firstOffset + 1));
  const jobs = data.jobs.filter(job => job.date === selected).sort((a, b) => a.time.localeCompare(b.time));
  const changeMonth = (offset: number) => setMonth(value => new Date(value.getFullYear(), value.getMonth() + offset, 1));
  return <><div className="page-heading"><div><p className="eyebrow">MIEJSCE NA KAŻDE ZLECENIE</p><h1>Kalendarz prac</h1><p className="muted">Twój harmonogram. Zawsze w zasięgu ręki.</p></div><button className="button secondary" onClick={() => { const today = new Date(); setMonth(new Date(today.getFullYear(), today.getMonth(), 1)); setSelected(localDate()); }}>Dzisiaj</button></div><div className="calendar-layout"><section className="card calendar-card"><div className="calendar-heading"><h2>{month.toLocaleDateString('pl-PL', {month:'long',year:'numeric'})}</h2><div><button className="icon-button" aria-label="Poprzedni miesiąc" onClick={() => changeMonth(-1)}><ChevronLeft size={20}/></button><button className="icon-button" aria-label="Następny miesiąc" onClick={() => changeMonth(1)}><ChevronRight size={20}/></button></div></div><div className="calendar-grid calendar-weekdays">{weekDays.map(day => <span key={day}>{day}</span>)}</div><div className="calendar-grid">{cells.map(day => {
    const date = localDate(day);
    const dayJobs = data.jobs.filter(job => job.date === date);
    const outside = day.getMonth() !== month.getMonth();
    return <button type="button" key={date} className={`calendar-day ${outside ? 'outside' : ''} ${selected === date ? 'selected' : ''} ${date === localDate() ? 'today' : ''}`} onClick={() => setSelected(date)} aria-pressed={selected === date} aria-label={`${day.toLocaleDateString('pl-PL')}, ${dayJobs.length} zleceń`}><span className="day-number">{day.getDate()}</span><span className="calendar-dots">{dayJobs.slice(0,3).map(job => <i key={job.id} className={`dot-${job.status}`}/>)}</span><span className="calendar-job-title">{dayJobs[0]?.title}{dayJobs.length > 1 ? ` +${dayJobs.length-1}` : ''}</span></button>;
  })}</div><div className="calendar-legend"><span><i className="dot-planned"/> Zaplanowane</span><span><i className="dot-in-progress"/> W trakcie</span><span><i className="dot-completed"/> Zakończone</span></div></section><section className="card calendar-agenda"><div className="card-header"><div><p className="eyebrow">PLAN DNIA</p><h2>{new Date(`${selected}T12:00:00`).toLocaleDateString('pl-PL', {day:'numeric',month:'long'})}</h2><p className="muted">{new Date(`${selected}T12:00:00`).toLocaleDateString('pl-PL', {weekday:'long'})}</p></div><CalendarDays size={22}/></div>{jobs.map(job => { const garden = data.gardens.find(g => g.id === job.gardenId); return <div className="agenda-entry" key={job.id}><span className="agenda-time">{job.time}</span><div><span className={`badge status-${job.status}`}>{job.status === 'completed' ? 'Zakończone' : job.status === 'in-progress' ? 'W trakcie' : 'Zaplanowane'}</span><h3><button className="job-title-button" onClick={() => setSelectedJob(job.id)}>{job.title}</button></h3><p>{data.clients.find(c => c.id === garden?.clientId)?.name}</p><p className="muted"><MapPin size={13}/>{garden?.name}</p></div></div>; })}{!jobs.length && <div className="empty-state"><CalendarDays size={32}/><h3>Wolny dzień</h3><p className="muted">Na ten dzień nie ma zaplanowanych zleceń.</p></div>}<button className="button primary agenda-button" disabled={!data.gardens.length} onClick={() => setNewJob({ id: crypto.randomUUID(), gardenId: data.gardens[0].id, title: '', date: selected, time: '08:00', status: 'planned', billing: 'hourly', rate: data.settings.hourlyRate, fixedPrice: 0, seconds: 0, materials: [], notes: '', activities: [], settlement: null })}>+ Nowe zlecenie na ten dzień</button>{!data.gardens.length && <p>Najpierw dodaj klienta i ogród.</p>}{onOpenJobs && <button className="button secondary agenda-button" onClick={onOpenJobs}>Przejdź do zleceń<ArrowUpRight size={17}/></button>}</section></div>{selectedJob && <JobDetails jobId={selectedJob} onClose={() => setSelectedJob(null)}/>}{newJob && <JobForm job={newJob} onClose={() => setNewJob(null)} onSave={job => { saveJob(job); setNewJob(null); setSelectedJob(job.id); }}/>}</>;
}
