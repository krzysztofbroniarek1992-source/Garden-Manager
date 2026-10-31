import { useState, type FormEvent } from 'react';
import Modal from '../components/Modal';
import { useGarden } from '../state';
import { localDate } from '../domain';
import { resolveOccurrence } from '../planning/occurrences';
import { taskStatus, taskStatusLabels } from '../planning/model';
import JobDetails from './JobDetails';
import TaskForm, { scheduleDescription } from './TaskForm';
import './planning.css';

export default function TaskDetails({ scheduleId, originalDate, onClose }: { scheduleId: string; originalDate: string; onClose: () => void }) {
  const { data, moveTaskOccurrence, skipTaskOccurrence, endTaskSchedule, beginTaskOccurrence } = useGarden();
  const schedule = data.taskSchedules.find(s => s.id === scheduleId);
  const [original] = useState(() => { try { return resolveOccurrence(data, scheduleId, originalDate); } catch { return null; } });
  const [version] = useState({ scheduleRevision: schedule?.revision ?? 0, occurrenceRevision: original?.revision ?? 0 });
  const [targetDate, setTargetDate] = useState(original?.date ?? '');
  const [time, setTime] = useState(original?.time ?? '08:00');
  const [gardenId, setGardenId] = useState(original?.gardenId ?? '');
  const [endingDate, setEndingDate] = useState(localDate());
  const [panel, setPanel] = useState<'move' | 'skip' | 'end' | null>(null);
  const [editing, setEditing] = useState(false);
  const [jobId, setJobId] = useState('');
  const [error, setError] = useState('');
  if (!schedule || !original) return <Modal title="Szczegóły zadania" onClose={onClose}><p>Ten termin zmienił się. Zamknij szczegóły i wybierz aktualny termin.</p></Modal>;
  if (editing) return <TaskForm initial={schedule} onClose={() => setEditing(false)} onDone={onClose}/>;
  if (jobId) return <JobDetails jobId={jobId} onClose={onClose}/>;
  let occurrence = original;
  try { occurrence = resolveOccurrence(data, scheduleId, originalDate); } catch { /* Keep the submitted snapshot visible if the series changed elsewhere. */ }
  const job = data.jobs.find(j => j.id === occurrence.jobId);
  const garden = data.gardens.find(g => g.id === (job?.gardenId ?? occurrence.gardenId));
  const status = taskStatus(data, occurrence);
  const perform = (action: () => void) => { try { action(); setError(''); } catch (e) { setError((e as Error).message); } };
  const move = (e: FormEvent) => { e.preventDefault(); perform(() => { moveTaskOccurrence(scheduleId, originalDate, targetDate, time, version); onClose(); }); };
  return <Modal title="Szczegóły zadania" onClose={onClose} wide><div className="task-details">
    <span className={`badge status-${status}`}>{taskStatusLabels[status]}</span><h3>{occurrence.title}</h3>
    <p><strong>{job?.date ?? occurrence.date} · {job?.time ?? occurrence.time}</strong></p>
    {occurrence.date !== originalDate && <p className="muted">Termin pierwotny: {originalDate}</p>}
    <p>{data.clients.find(c => c.id === (garden?.clientId ?? occurrence.clientId))?.name ?? 'Bez przypisania do klienta'}{garden && ` · ${garden.name}`}{occurrence.zoneName && ` · ${occurrence.zoneName}`}</p>
    <p className="preserve-lines">{occurrence.notes}</p><p className="muted">{scheduleDescription(schedule)} · od {schedule.startDate}{schedule.endDate && ` do ${schedule.endDate}`}{schedule.endedOn && ` · seria zakończona ${schedule.endedOn}`}</p>
    {!job && status === 'planned' && <>
      {!occurrence.gardenId && <label className="field">Ogród do wykonania pracy<select value={gardenId} onChange={e => setGardenId(e.target.value)}><option value="">Wybierz ogród przed rozpoczęciem</option>{data.gardens.filter(g => !occurrence.clientId || g.clientId === occurrence.clientId).map(g => <option value={g.id} key={g.id}>{g.name}</option>)}</select></label>}
      <p className="planning-note">Dopiero „Rozpocznij pracę” utworzy rzeczywiste zlecenie i uruchomi stoper wizyty. Sam termin nie nalicza czasu ani należności.</p>
    </>}
    {error && <p role="alert" className="gm-form-error">{error}</p>}
    <div className="planning-actions">
      {job ? <button className="button primary" onClick={() => setJobId(job.id)}>Otwórz rzeczywiste zlecenie</button> : status === 'planned' && <button className="button primary" disabled={!gardenId} onClick={() => perform(() => setJobId(beginTaskOccurrence(scheduleId, originalDate, gardenId, version)))}>Rozpocznij pracę</button>}
      {!job && status === 'planned' && <><button className="button secondary" onClick={() => { setPanel('move'); setError(''); }}>Przesuń ten termin</button><button className="button secondary" onClick={() => { setPanel('skip'); setError(''); }}>Pomiń ten termin</button></>}
      <button className="button secondary" onClick={() => setEditing(true)}>Edytuj całą serię</button>
      {!schedule.endedOn && schedule.recurrence.frequency !== 'once' && <button className="button secondary" onClick={() => { setPanel('end'); setError(''); }}>Zakończ serię</button>}
    </div>
    {panel === 'move' && <form className="planning-confirm" onSubmit={move}><h4>Przesunięcie jednego terminu</h4><div className="form-grid"><label className="field">Nowa data terminu<input required type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)}/></label><label className="field">Nowa godzina terminu<input required type="time" value={time} onChange={e => setTime(e.target.value)}/></label></div><p>Pozostałe terminy zachowają swój rytm.</p><div className="planning-actions"><button type="button" className="button secondary" onClick={() => setPanel(null)}>Anuluj przesunięcie</button><button className="button primary" type="submit">Zapisz przesunięcie</button></div></form>}
    {panel === 'skip' && <div className="planning-confirm" role="group" aria-label="Potwierdzenie pominięcia terminu"><h4>Pominąć tylko ten termin?</h4><p>Termin zostanie oznaczony jako odwołany. Kolejne wystąpienia serii pozostaną zaplanowane.</p><div className="planning-actions"><button className="button secondary" onClick={() => setPanel(null)}>Anuluj pominięcie</button><button className="button danger" onClick={() => perform(() => { skipTaskOccurrence(scheduleId, originalDate, version); onClose(); })}>Potwierdź pominięcie</button></div></div>}
    {panel === 'end' && <form className="planning-confirm" onSubmit={e => { e.preventDefault(); perform(() => { endTaskSchedule(scheduleId, endingDate, version.scheduleRevision); onClose(); }); }}><h4>Zakończenie serii</h4><label className="field">Ostatni dzień serii<input required type="date" value={endingDate} onChange={e => setEndingDate(e.target.value)}/></label><p>Nie powstaną kolejne terminy po tej dacie. Rzeczywiste zlecenia i historia pozostaną zachowane.</p><div className="planning-actions"><button className="button secondary" type="button" onClick={() => setPanel(null)}>Anuluj zakończenie</button><button className="button danger" type="submit">Potwierdź zakończenie serii</button></div></form>}
  </div></Modal>;
}
