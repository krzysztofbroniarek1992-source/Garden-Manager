import { useState, type FormEvent } from 'react';
import { ClipboardList, Leaf, MapPin, Pencil, Plus, Ruler, Search, Sprout, Trash2, UserRound, X } from 'lucide-react';
import type { Garden } from '../domain';
import { useGarden } from '../state';
import Modal from '../components/Modal';
import './entities.css';

export default function Gardens() {
  const { data, saveGarden, deleteGarden } = useGarden();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Garden | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [removing, setRemoving] = useState<Garden | null>(null);
  const [error, setError] = useState('');
  const clientName = (clientId: string) => data.clients.find(client => client.id === clientId)?.name ?? 'Nieznany klient';
  const matches = data.gardens.filter(garden => `${garden.name} ${garden.address} ${clientName(garden.clientId)}`.toLocaleLowerCase('pl').includes(query.toLocaleLowerCase('pl')));

  function edit(garden?: Garden) {
    setError(''); setIsNew(!garden);
    setEditing(garden ? { ...garden } : { id: crypto.randomUUID(), clientId: data.clients[0]?.id ?? '', name: '', address: '', area: 0, notes: '' });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    try {
      if (!editing.name.trim()) throw new Error('Podaj nazwę ogrodu.');
      if (!editing.address.trim()) throw new Error('Podaj adres ogrodu.');
      if (!editing.clientId) throw new Error('Najpierw dodaj klienta w zakładce „Klienci”.');
      saveGarden({ ...editing, name: editing.name.trim(), address: editing.address.trim(), notes: editing.notes.trim() });
      setEditing(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Nie udało się zapisać ogrodu.'); }
  }

  function remove() {
    if (!removing) return;
    try { deleteGarden(removing.id); setRemoving(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Nie udało się usunąć ogrodu.'); }
  }

  return <section className="entities-page">
    <div className="page-heading">
      <div><span className="eyebrow">TWOJE MIEJSCA PRACY</span><h1>Obiekty <span className="entity-count">{data.gardens.length}</span></h1><p className="muted">Każdy ogród ma swoją historię. Zadbaj o szczegóły.</p></div>
      <button className="button primary" onClick={() => edit()}><Plus size={18} /> Dodaj ogród</button>
    </div>
    <div className="entities-toolbar">
      <div className="search-box"><Search size={18} /><input className="search-input" aria-label="Szukaj ogrodów" placeholder="Szukaj ogrodu, adresu lub klienta…" value={query} onChange={event => setQuery(event.target.value)} />{query && <button className="icon-button" aria-label="Wyczyść wyszukiwanie" onClick={() => setQuery('')}><X size={16}/></button>}</div>
      <span className="muted entities-result">{matches.length} z {data.gardens.length} obiektów</span>
    </div>
    {matches.length === 0 ? <div className="card empty-state"><Sprout size={35} /><h3>{query ? 'Nie znaleziono ogrodów' : 'Pierwszy ogród, nowe możliwości'}</h3><p className="muted">{query ? 'Spróbuj wyszukać inną nazwę, klienta lub adres.' : 'Dodaj ogród i przypisz go do klienta. Jeden klient może mieć wiele ogrodów.'}</p><button className="button secondary" onClick={() => query ? setQuery('') : edit()}>{query ? 'Pokaż wszystkie' : 'Dodaj ogród'}</button></div> :
      <div className="entity-grid gardens-grid">{matches.map((garden, index) => {
        const jobs = data.jobs.filter(job => job.gardenId === garden.id);
        return <article key={garden.id} className="card entity-card garden-card">
          <div className={`garden-visual garden-visual-${index % 3}`} aria-hidden="true"><div className="garden-circle garden-circle-one" /><div className="garden-circle garden-circle-two" /><Leaf className="garden-visual-leaf" size={70} strokeWidth={1} /><span>PRZESTRZEŃ POD OPIEKĄ</span></div>
          <div className="garden-card-content"><div className="garden-title-row"><h3>{garden.name}</h3><div className="entity-card-actions"><button className="icon-button" title="Edytuj ogród" aria-label={`Edytuj ogród ${garden.name}`} onClick={() => edit(garden)}><Pencil size={16}/></button><button className="icon-button entity-delete" title="Usuń ogród" aria-label={`Usuń ogród ${garden.name}`} onClick={() => { setError(''); setRemoving(garden); }}><Trash2 size={16}/></button></div></div>
          <div className="client-contact"><UserRound size={15} /><span>{clientName(garden.clientId)}</span></div>
          <div className="client-contact garden-address"><MapPin size={15} /><span>{garden.address}</span></div>
          {garden.notes && <p className="garden-notes">{garden.notes}</p>}
          <div className="card-footer"><span><Ruler size={16}/><strong>{garden.area.toLocaleString('pl-PL')}</strong> m²</span><span><ClipboardList size={15}/>{jobs.length} {jobs.length === 1 ? 'zlecenie' : jobs.length > 1 && jobs.length < 5 ? 'zlecenia' : 'zleceń'}</span></div></div>
        </article>;
      })}</div>}
    {editing && <Modal title={isNew ? 'Nowy ogród' : 'Edytuj ogród'} onClose={() => setEditing(null)}>
      <form onSubmit={submit}>
        {error && <p className="gm-form-error" role="alert">{error}</p>}
        {!data.clients.length && <p className="gm-form-error" role="alert">Najpierw dodaj klienta w zakładce „Klienci”. Każdy ogród musi mieć właściciela.</p>}
        <div className="form-grid">
          <label className="field full-width">Nazwa ogrodu *<input required maxLength={150} value={editing.name} onChange={event => setEditing({ ...editing, name: event.target.value })} placeholder="np. Ogród przy domu" /></label>
          <label className="field full-width">Klient *<select required value={editing.clientId} onChange={event => setEditing({ ...editing, clientId: event.target.value })}><option value="" disabled>Wybierz klienta</option>{data.clients.map(client => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
          <label className="field full-width">Adres *<input required maxLength={300} autoComplete="street-address" value={editing.address} onChange={event => setEditing({ ...editing, address: event.target.value })} placeholder="Ulica, numer, miejscowość" /></label>
          <label className="field">Powierzchnia (m²)<input required type="number" min="0" max="100000000" step="0.1" value={editing.area} onChange={event => setEditing({ ...editing, area: Number(event.target.value) })} /></label>
          <label className="field full-width">Notatki<textarea maxLength={3000} value={editing.notes} onChange={event => setEditing({ ...editing, notes: event.target.value })} placeholder="Dostęp do ogrodu, kod do furtki, rodzaj roślin…" /></label>
        </div>
        <p className="gm-form-note">* Pole wymagane. Jeden klient może mieć przypisanych wiele ogrodów.</p>
        <div className="gm-modal-actions"><button type="button" className="button secondary" onClick={() => setEditing(null)}>Anuluj</button><button className="button primary" type="submit" disabled={!data.clients.length}>{isNew ? 'Dodaj ogród' : 'Zapisz zmiany'}</button></div>
      </form>
    </Modal>}
    {removing && <Modal title="Usunąć ogród?" onClose={() => setRemoving(null)}>
      {error && <p className="gm-form-error" role="alert">{error}</p>}
      <p>Ogród <strong>{removing.name}</strong> zostanie usunięty. Tej operacji nie można cofnąć.</p>
      {data.jobs.some(job => job.gardenId === removing.id) && <p className="gm-form-note">Ogród ma powiązane zlecenia. Najpierw usuń je lub przypisz do innego ogrodu, aby zachować spójność danych.</p>}
      <div className="gm-modal-actions"><button type="button" className="button secondary" onClick={() => setRemoving(null)}>Anuluj</button><button type="button" className="button danger" onClick={remove}>Usuń ogród</button></div>
    </Modal>}
  </section>;
}
