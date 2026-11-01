import { useUnsavedChanges } from '../navigation/unsaved';
import { useState, type FormEvent } from 'react';
import Modal from '../components/Modal';
import { useGarden } from '../state';
import type { Frequency, TaskSchedule } from '../planning/model';
import './planning.css';

export const months = ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'];
export const frequencies: Record<Frequency, string> = { once: 'Jednorazowo', days: 'Codziennie / co kilka dni', weeks: 'Co tydzień / kilka tygodni', months: 'Co miesiąc / kilka miesięcy', years: 'Co rok / kilka lat' };
export function newTaskSchedule(date: string): TaskSchedule {
  return { id: crypto.randomUUID(), title: '', notes: '', startDate: date, endDate: null, time: '08:00', clientId: null, gardenId: null, zoneId: null, zoneName: null,
    recurrence: { frequency: 'once', interval: 1, months: months.map((_, i) => i + 1) }, endedOn: null, revision: 0, updatedAt: 0 };
}
export function scheduleDescription(schedule: TaskSchedule): string {
  if (schedule.recurrence.frequency === 'once') return 'Jednorazowo';
  const unit = { days: 'dni', weeks: 'tyg.', months: 'mies.', years: 'lat' }[schedule.recurrence.frequency];
  return `Co ${schedule.recurrence.interval} ${unit}${schedule.recurrence.months.length < 12 ? ` · ${schedule.recurrence.months.map(m => months[m - 1].slice(0, 3).toLocaleLowerCase('pl')).join(', ')}` : ''}`;
}
export default function TaskForm({ initial, onClose, onDone = onClose }: { initial: TaskSchedule; onClose: () => void; onDone?: () => void }) {
  const { data, saveTaskSchedule } = useGarden();
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState('');
  const guard = useUnsavedChanges(JSON.stringify(draft) !== JSON.stringify(initial));
  const patch = <K extends keyof TaskSchedule>(key: K, value: TaskSchedule[K]) => setDraft(current => ({ ...current, [key]: value }));
  const gardens = data.gardens.filter(g => !draft.clientId || g.clientId === draft.clientId);
  const garden = data.gardens.find(g => g.id === draft.gardenId);
  const submit = (e: FormEvent) => { e.preventDefault(); try { guard.save(() => {saveTaskSchedule(draft);onDone();}); } catch (e) { setError((e as Error).message); } };
  return <Modal title={initial.revision ? 'Edytuj harmonogram' : 'Nowe zadanie'} onClose={onClose} wide><form ref={guard.ref} onSubmit={submit}>
    {error && <p role="alert" className="gm-form-error">{error}</p>}
    <p className="gm-form-note">Planowanie nie uruchamia stopera i nie tworzy należności. Pracę rozpoczniesz z konkretnego terminu.</p>
    {initial.revision > 0 && <p className="planning-note">Zmiana reguły dotyczy terminów bez zapisanych wyjątków. Przesunięte i pominięte terminy oraz istniejące zlecenia zostaną zachowane.</p>}
    {initial.endedOn && <p className="planning-note">Seria zakończona: {initial.endedOn}. Edycja opisu nie wznawia serii.</p>}
    <div className="form-grid planning-form-grid">
      <label className="field full-width">Nazwa zadania<input required maxLength={150} value={draft.title} onChange={e => patch('title', e.target.value)} placeholder="np. Koszenie trawnika"/></label>
      <label className="field">Klient (opcjonalnie)<select value={draft.clientId ?? ''} onChange={e => setDraft(current => ({ ...current, clientId: e.target.value || null, gardenId: null, zoneId: null, zoneName: null }))}><option value="">Bez przypisania do klienta</option>{data.clients.map(c => <option value={c.id} key={c.id}>{c.name}</option>)}</select></label>
      <label className="field">Ogród (opcjonalnie)<select value={draft.gardenId ?? ''} onChange={e => { const g = data.gardens.find(g => g.id === e.target.value); setDraft(current => ({ ...current, gardenId: g?.id ?? null, clientId: g?.clientId ?? current.clientId, zoneId: null, zoneName: null })); }}><option value="">Bez przypisania do ogrodu</option>{gardens.map(g => <option value={g.id} key={g.id}>{g.name}</option>)}</select></label>
      <label className="field full-width">Strefa (opcjonalnie)<select disabled={!garden} value={draft.zoneId ?? ''} onChange={e => patch('zoneId', e.target.value || null)}><option value="">Cały ogród / bez strefy</option>{draft.zoneId && !garden?.zones.some(z => z.id === draft.zoneId) && <option value={draft.zoneId}>{draft.zoneName || 'Usunięta strefa'}</option>}{garden?.zones.map(z => <option value={z.id} key={z.id}>{z.name}</option>)}</select></label>
      <label className="field full-width">Szablon checklisty (opcjonalnie)<select aria-label="Szablon checklisty (opcjonalnie)" value={draft.checklistTemplateId??''} onChange={e => patch('checklistTemplateId',e.target.value||null)}><option value="">Bez szablonu checklisty</option>{data.workTemplates.filter(t=>t.archivedAt===null||t.id===draft.checklistTemplateId).map(t=><option key={t.id} value={t.id}>{t.name}{t.archivedAt!==null?' (archiwum)':''}</option>)}</select><small className="gm-form-note">Lista powstanie dopiero po zastosowaniu przy rzeczywistej wizycie.</small></label>
      <label className="field">Data rozpoczęcia<input required type="date" value={draft.startDate} onChange={e => patch('startDate', e.target.value)}/></label>
      <label className="field">Godzina zadania<input required type="time" value={draft.time} onChange={e => patch('time', e.target.value)}/></label>
      <label className="field">Powtarzanie<select value={draft.recurrence.frequency} onChange={e => patch('recurrence', { ...draft.recurrence, frequency: e.target.value as Frequency })}>{Object.entries(frequencies).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {draft.recurrence.frequency !== 'once' && <label className="field">Powtarzaj co ({({ days: 'dni', weeks: 'tygodni', months: 'miesięcy', years: 'lat' })[draft.recurrence.frequency]})<input required type="number" min="1" max="1000" step="1" value={draft.recurrence.interval} onChange={e => patch('recurrence', { ...draft.recurrence, interval: Number(e.target.value) })}/></label>}
      <label className="field">Data zakończenia (opcjonalnie)<input type="date" min={draft.startDate} value={draft.endDate ?? ''} onChange={e => patch('endDate', e.target.value || null)}/></label>
      <label className="field full-width">Opis i wymagania<textarea maxLength={5000} value={draft.notes} onChange={e => patch('notes', e.target.value)}/></label>
    </div>
    {draft.recurrence.frequency !== 'once' && <fieldset className="season-months"><legend>Miesiące realizacji</legend><div>{months.map((month, i) => <label key={month}><input type="checkbox" checked={draft.recurrence.months.includes(i + 1)} onChange={e => patch('recurrence', { ...draft.recurrence, months: e.target.checked ? [...draft.recurrence.months, i + 1].sort((a,b) => a-b) : draft.recurrence.months.filter(m => m !== i + 1) })}/>{month}</label>)}</div><p className="gm-form-note">Terminy liczymy od daty rozpoczęcia i pokazujemy tylko w zaznaczonych miesiącach. Dla prac dwa razy w roku wybierz powtarzanie co 1 miesiąc i zaznacz dwa miesiące.</p></fieldset>}
    <div className="gm-modal-actions"><button className="button secondary" type="button" onClick={() => guard.confirm(onClose)}>Anuluj</button><button className="button primary" type="submit">Zapisz harmonogram</button></div>
  </form></Modal>;
}
