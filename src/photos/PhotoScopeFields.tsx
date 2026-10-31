import { useGarden } from '../state';
import type { PhotoDetails } from './model';
export default function PhotoScopeFields({ value, onChange }: { value: PhotoDetails; onChange: (value: PhotoDetails) => void }) {
  const { data } = useGarden();
  const gardens = data.gardens.filter(g => g.clientId === value.clientId), garden = gardens.find(g => g.id === value.gardenId);
  return <>
    <label className="field">Klient zdjęcia<select required value={value.clientId ?? ''} onChange={e => onChange({ ...value, clientId: e.target.value || null, gardenId: null, zoneId: null, jobId: null })}><option value="">Wybierz klienta</option>{data.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <label className="field">Ogród zdjęcia<select value={value.gardenId ?? ''} disabled={!value.clientId} onChange={e => onChange({ ...value, gardenId: e.target.value || null, zoneId: null, jobId: null })}><option value="">Bez ogrodu</option>{gardens.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
    <label className="field">Strefa zdjęcia<select value={value.zoneId ?? ''} disabled={!garden} onChange={e => onChange({ ...value, zoneId: e.target.value || null })}><option value="">Bez strefy</option>{garden?.zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}</select></label>
    <label className="field">Zlecenie zdjęcia<select value={value.jobId ?? ''} disabled={!garden} onChange={e => onChange({ ...value, jobId: e.target.value || null })}><option value="">Bez zlecenia</option>{data.jobs.filter(j => j.gardenId === garden?.id).map(j => <option key={j.id} value={j.id}>{j.title} · {j.date}</option>)}</select></label>
  </>;
}
