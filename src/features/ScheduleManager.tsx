import { useState } from 'react';
import { useGarden } from '../state';
import { localDate } from '../domain';
import type { TaskSchedule } from '../planning/model';
import Modal from '../components/Modal';
import TaskForm, { scheduleDescription } from './TaskForm';

export default function ScheduleManager() {
  const { data, endTaskSchedule } = useGarden();
  const [editing, setEditing] = useState<TaskSchedule | null>(null);
  const [ending, setEnding] = useState<TaskSchedule | null>(null);
  const [date, setDate] = useState(localDate());
  const [error, setError] = useState('');
  return <details className="card schedule-manager"><summary>Harmonogramy i zadania ({data.taskSchedules.length})</summary><p className="muted">Edytuj reguły lub zakończ serię. Wykonane prace i zapisane wyjątki pozostają w historii.</p>{!data.taskSchedules.length && <p>Dodaj zadanie z wybranego dnia kalendarza.</p>}<div className="schedule-manager-list">{data.taskSchedules.map(schedule => <article key={schedule.id} className="planning-schedule-row"><div><h3>{schedule.title}</h3><p>{scheduleDescription(schedule)} · {schedule.startDate}{schedule.endDate && ` – ${schedule.endDate}`}</p><p>{data.clients.find(c => c.id === schedule.clientId)?.name}{schedule.gardenId && ` · ${data.gardens.find(g => g.id === schedule.gardenId)?.name}`}{schedule.zoneName && ` · ${schedule.zoneName}`}</p>{schedule.endedOn && <span className="badge status-cancelled">Seria zakończona {schedule.endedOn}</span>}</div><div className="planning-actions"><button className="button secondary" aria-label={`Edytuj harmonogram ${schedule.title}`} onClick={() => setEditing(schedule)}>Edytuj harmonogram</button>{!schedule.endedOn && schedule.recurrence.frequency !== 'once' && <button className="button secondary" aria-label={`Zakończ serię ${schedule.title}`} onClick={() => { setEnding(schedule); setDate(localDate()); setError(''); }}>Zakończ serię</button>}</div></article>)}</div>
    {editing && <TaskForm initial={editing} onClose={() => setEditing(null)}/>}
    {ending && <Modal title="Zakończyć serię?" onClose={() => setEnding(null)}><form onSubmit={e => { e.preventDefault(); try { endTaskSchedule(ending.id, date, ending.revision); setEnding(null); } catch (e) { setError((e as Error).message); } }}><p>{ending.title}: istniejące zlecenia zostaną zachowane. Nie będą planowane nowe terminy po wskazanej dacie.</p>{error && <p role="alert" className="gm-form-error">{error}</p>}<label className="field">Ostatni dzień serii<input required type="date" value={date} onChange={e => setDate(e.target.value)}/></label><div className="gm-modal-actions"><button type="button" className="button secondary" onClick={() => setEnding(null)}>Anuluj</button><button type="submit" className="button danger">Potwierdź zakończenie serii</button></div></form></Modal>}
  </details>;
}
