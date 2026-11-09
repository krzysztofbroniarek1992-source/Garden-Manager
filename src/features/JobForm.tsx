import { availabilityConflict, availabilityMessage, availabilitySignature, type AvailabilityPermit } from '../availability/model';
import '../availability/availability.css';
import { useUnsavedChanges } from '../navigation/unsaved';
import { useRef, useState, type FormEvent } from 'react';
import { ActivitiesEditor, MaterialsEditor } from './VisitFields';
import Modal from '../components/Modal';
import { useGarden } from '../state';
import type { Job } from '../domain';
export default function JobForm({ job, onClose, onSave, clientId: initialClientId, embedded = false }: { job: Job; clientId?: string; embedded?: boolean; onClose: () => void; onSave: (job: Job, expected?: Job, permit?: AvailabilityPermit) => void | Promise<void> }) {
  const { data, snapshot } = useGarden();
  const [draft, setDraft] = useState(job);
  const [original] = useState(job);
  const [wasExisting] = useState(() => data.jobs.some(item => item.id === job.id));
  const [clientId, setClientId] = useState(() => initialClientId ?? data.gardens.find(g => g.id === job.gardenId)?.clientId ?? '');
  const gardens = data.gardens.filter(g => g.clientId === clientId);
  const [error, setError] = useState('');
  const [availabilityPrompt,setAvailabilityPrompt]=useState(false);
  const inFlight=useRef(false);
  const guard = useUnsavedChanges(JSON.stringify(draft) !== JSON.stringify(original));
  const patch = <K extends keyof Job>(key: K, value: Job[K]) => {setDraft(current => ({ ...current, [key]: value }));if(key==='date'||key==='time')setAvailabilityPrompt(false);};
  const scheduling=!wasExisting||draft.date!==original.date||draft.time!==original.time;
  const availability= scheduling && draft.status!=='completed' ? availabilityConflict(data,draft.date,draft.time) : null;
  const persist=async(override=false)=>{
    if(inFlight.current||!guard.ref.current?.reportValidity())return;
    if(availability&&!override){setAvailabilityPrompt(true);return;}
    inFlight.current=true;
    try { await guard.save(async()=>await onSave({...draft,title:draft.title.trim(),notes:draft.notes.trim(),activities:draft.activities.map(item=>item.trim()).filter(Boolean)},wasExisting?original:undefined,availability&&override?{date:draft.date,time:draft.time,signature:availabilitySignature(data,draft.date),accepted:true}:undefined)); }
    catch(e){setError(e instanceof Error?e.message:'Nie udało się zapisać zlecenia.');await snapshot().catch(()=>{});setAvailabilityPrompt(false);}
    finally{inFlight.current=false;}
  };
  const submit=async(event:FormEvent)=>{event.preventDefault();await persist();};
  const existing = data.jobs.some(item => item.id === job.id);
  const contents = <form ref={guard.ref} onSubmit={submit}>
    {error && <div className="error-banner" role="alert">{error}</div>}
    {availability&&<div className="availability-warning" role="alert"><strong>Uwaga! Termin koliduje z dostępnością: {availabilityMessage(availability)}</strong><p>Sprawdzamy godzinę rozpoczęcia, nie rzeczywisty czas stopera. Możesz zmienić termin albo świadomie zrobić wyjątek.</p>{availabilityPrompt&&<div role="group" aria-label="Potwierdzenie kolizji dostępności"><button type="button" className="button secondary" onClick={()=>{setAvailabilityPrompt(false);guard.ref.current?.querySelector<HTMLInputElement>('input[type="date"]')?.focus();}}>Zmień termin</button><button type="button" className="button danger" onClick={()=>persist(true)}>Zaplanuj mimo wszystko</button></div>}</div>}
    {draft.settlement && <p className="job-frozen-price-note">To zlecenie ma zatwierdzoną należność. Edycja czasu, stawki lub materiałów nie zmieni jej samoczynnie. Nową cenę zatwierdzisz jawnie w szczegółach rozliczenia.</p>}
    <div className="form-grid"><label className="field full">Nazwa pracy<input autoFocus required maxLength={150} value={draft.title} onChange={e => patch('title', e.target.value)} placeholder="np. Jesienne porządki i pielęgnacja"/></label><label className="field full">Klient<select required value={clientId} onChange={e => { setClientId(e.target.value); const matches = data.gardens.filter(g => g.clientId === e.target.value); patch('gardenId', matches.length === 1 ? matches[0].id : ''); }}><option value="">Wybierz klienta</option>{data.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label className="field full">Ogród i klient<select required value={draft.gardenId} onChange={e => patch('gardenId', e.target.value)}><option value="">Wybierz ogród</option>{gardens.map(g => <option key={g.id} value={g.id}>{g.name} — {data.clients.find(c => c.id === g.clientId)?.name}</option>)}</select></label><label className="field">Data<input required type="date" value={draft.date} onChange={e => patch('date', e.target.value)}/></label><label className="field">Godzina<input required type="time" value={draft.time} onChange={e => patch('time', e.target.value)}/></label><label className="field">Sposób rozliczenia<select value={draft.billing} onChange={e => patch('billing', e.target.value as Job['billing'])}><option value="hourly">Godzinowe</option><option value="fixed">Ryczałtowe</option></select></label>{draft.billing === 'hourly' ? <label className="field">Stawka (zł/h)<input required type="number" min="0" step="0.01" value={draft.rate} onChange={e => patch('rate', Number(e.target.value))}/></label> : <label className="field">Kwota ryczałtu (zł)<input required type="number" min="0" step="0.01" value={draft.fixedPrice} onChange={e => patch('fixedPrice', Number(e.target.value))}/></label>}<label className="field full">Notatka<textarea rows={2} maxLength={2000} value={draft.notes} onChange={e => patch('notes', e.target.value)} placeholder="Zakres prac, dojazd, ważne informacje…"/></label></div>
    <ActivitiesEditor value={draft.activities} onChange={value => patch('activities',value)}/>
    <MaterialsEditor value={draft.materials} onChange={value => patch('materials',value)}/>
    <div className="modal-actions"><button type="button" className="button secondary" onClick={() => guard.confirm(onClose)}>Anuluj</button><button type="submit" className="button primary">Zapisz zlecenie</button></div>
  </form>;
  return embedded ? contents : <Modal title={existing ? 'Edytuj zlecenie' : 'Nowe zlecenie'} onClose={onClose} wide>{contents}</Modal>;
}
