import { useState, type FormEvent } from 'react';
import { useGarden } from '../state';
import { duration, type GardenZone } from '../domain';
import { formatQuantity } from '../gardening';
import Modal from '../components/Modal';
import GardenForm from './GardenForm';
import JobDetails from './JobDetails';
import './gardening.css';

const workLabels = { planned: 'Zaplanowane', 'in-progress': 'W trakcie', completed: 'Zakończone' };
export default function GardenDetails({ gardenId, onClose }: { gardenId: string; onClose: () => void }) {
  const { data, deleteZone } = useGarden();
  const garden = data.gardens.find(item => item.id === gardenId);
  const [editing, setEditing] = useState(false);
  const [zone, setZone] = useState<GardenZone | null>(null);
  const [removing, setRemoving] = useState<GardenZone | null>(null);
  const [selectedJob, setSelectedJob] = useState('');
  const [error, setError] = useState('');
  if (!garden) return <Modal title="Karta ogrodu" onClose={onClose}><p>Ogród nie jest już dostępny.</p></Modal>;
  if (editing) return <GardenForm initial={garden} isNew={false} onClose={() => setEditing(false)}/>;
  if (selectedJob) return <JobDetails jobId={selectedJob} onClose={() => setSelectedJob('')}/>;
  const jobs = data.jobs.filter(job => job.gardenId === gardenId).sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`));
  return <Modal title={`Karta ogrodu: ${garden.name}`} onClose={onClose} wide>
    <div className="garden-summary"><p>{data.clients.find(client => client.id === garden.clientId)?.name} · {garden.address}</p><strong>{formatQuantity(garden.area)} m²</strong><p className="preserve-lines">{garden.notes}</p><button className="button secondary" onClick={() => setEditing(true)}>Edytuj dane ogrodu</button></div>
    {zone ? <ZoneForm key={zone.id} gardenId={gardenId} initial={zone} onClose={() => setZone(null)}/> : <>
      <div className="tool-heading"><h3>Strefy ogrodu ({garden.zones.length})</h3><button className="button primary" onClick={() => setZone({ id: crypto.randomUUID(), name: '', type: 'trawnik', area: null, length: null, plants: '', requirements: '', treatments: '' })}>Dodaj strefę</button></div>
      {error && <p role="alert" className="gm-form-error">{error}</p>}
      {removing && <div className="tool-confirm" role="group" aria-label="Potwierdzenie usunięcia strefy"><strong>Usunąć strefę „{removing.name}”?</strong><p>Zapisane zlecenia, materiały i historia prac pozostaną zachowane.</p><div className="tool-actions"><button className="button secondary" onClick={() => setRemoving(null)}>Anuluj usunięcie</button><button className="button danger" onClick={() => { try { deleteZone(gardenId, removing.id); setRemoving(null); setError(''); } catch (e) { setError((e as Error).message); } }}>Potwierdź usunięcie strefy</button></div></div>}
      {!garden.zones.length && <p className="muted">Dodaj trawnik, rabatę, żywopłot lub inną strefę, aby zapisać jej wymiary i wymagania.</p>}
      <div className="zone-list">{garden.zones.map(item => <article className="tool-card zone-card" key={item.id}>
        <h4>{item.name} <small>{item.type}</small></h4><p>{item.area !== null && `${formatQuantity(item.area)} m²`}{item.area !== null && item.length !== null && ' · '}{item.length !== null && `${formatQuantity(item.length)} m`}</p>
        <dl>{([['Rośliny', item.plants], ['Szczególne wymagania', item.requirements], ['Wykonane zabiegi', item.treatments]] as const).map(([label, value]) => value && <div key={label}><dt>{label}</dt><dd className="preserve-lines">{value}</dd></div>)}</dl>
        <div className="tool-actions"><button className="button secondary" aria-label={`Edytuj strefę ${item.name}`} onClick={() => setZone(item)}>Edytuj strefę</button><button className="button ghost" aria-label={`Usuń strefę ${item.name}`} onClick={() => { setRemoving(item); setError(''); }}>Usuń strefę</button></div>
      </article>)}</div>
    </>}
    <div className="tool-heading"><h3>Zlecenia i historia prac ({jobs.length})</h3></div>
    {!jobs.length && <p className="muted">Zlecenia przypisane do tego ogrodu pojawią się tutaj.</p>}
    <div className="garden-job-list">{jobs.map(job => <button className="tool-card garden-job" key={job.id} onClick={() => setSelectedJob(job.id)}><strong>{job.title}</strong><span>{job.date} · {workLabels[job.status]} · {duration(job.seconds)}</span><span>{job.activities.join(' · ')}</span></button>)}</div>
  </Modal>;
}

function ZoneForm({ gardenId, initial, onClose }: { gardenId: string; initial: GardenZone; onClose: () => void }) {
  const { saveZone } = useGarden();
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState('');
  const patch = <K extends keyof GardenZone>(key: K, value: GardenZone[K]) => setDraft(current => ({ ...current, [key]: value }));
  function submit(event: FormEvent) {
    event.preventDefault();
    try { saveZone(gardenId, draft); onClose(); } catch (e) { setError((e as Error).message); }
  }
  return <form onSubmit={submit} className="zone-form"><h3>{initial.name ? 'Edycja strefy' : 'Nowa strefa'}</h3>{error && <p role="alert" className="gm-form-error">{error}</p>}<div className="form-grid">
    <label className="field">Nazwa strefy<input required maxLength={150} value={draft.name} onChange={e => patch('name', e.target.value)}/></label>
    <label className="field">Rodzaj strefy<input required list="zone-types" maxLength={100} value={draft.type} onChange={e => patch('type', e.target.value)}/><datalist id="zone-types">{['trawnik', 'rabata', 'żywopłot', 'drzewa', 'nawierzchnia'].map(type => <option key={type} value={type}/>)}</datalist></label>
    <label className="field">Powierzchnia strefy (m²)<input type="number" min="0" step="any" value={draft.area ?? ''} onChange={e => patch('area', e.target.value === '' ? null : Number(e.target.value))}/></label>
    <label className="field">Długość strefy (m)<input type="number" min="0" step="any" value={draft.length ?? ''} onChange={e => patch('length', e.target.value === '' ? null : Number(e.target.value))}/></label>
    <label className="field full-width">Rośliny<textarea maxLength={5000} value={draft.plants} onChange={e => patch('plants', e.target.value)}/></label>
    <label className="field full-width">Szczególne wymagania<textarea maxLength={5000} value={draft.requirements} onChange={e => patch('requirements', e.target.value)}/></label>
    <label className="field full-width">Wykonane zabiegi<textarea maxLength={10000} placeholder="Data i opis zabiegu" value={draft.treatments} onChange={e => patch('treatments', e.target.value)}/></label>
  </div><div className="gm-modal-actions"><button className="button secondary" type="button" onClick={onClose}>Anuluj edycję strefy</button><button className="button primary" type="submit">Zapisz strefę</button></div></form>;
}
