import { useState, type FormEvent } from 'react';
import { Building2, Mail, Pencil, Phone, Plus, Search, Sprout, Trash2, Users, X } from 'lucide-react';
import type { Client } from '../domain';
import { useGarden } from '../state';
import Modal from '../components/Modal';
import './entities.css';

const blankClient = (): Client => ({ id: crypto.randomUUID(), name: '', phone: '', email: '', notes: '' });
const initials = (name: string) => name.split(' ').filter(Boolean).slice(0, 2).map(word => word[0]).join('').toUpperCase();

export default function Clients() {
  const { data, saveClient, deleteClient } = useGarden();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Client | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [removing, setRemoving] = useState<Client | null>(null);
  const [error, setError] = useState('');
  const matches = data.clients.filter(client => `${client.name} ${client.phone} ${client.email}`.toLocaleLowerCase('pl').includes(query.toLocaleLowerCase('pl')));

  function edit(client?: Client) {
    setError('');
    setIsNew(!client);
    setEditing(client ? { ...client } : blankClient());
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    try {
      if (!editing.name.trim()) throw new Error('Podaj imię i nazwisko lub nazwę firmy.');
      saveClient({ ...editing, name: editing.name.trim(), phone: editing.phone.trim(), email: editing.email.trim(), notes: editing.notes.trim() });
      setEditing(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Nie udało się zapisać klienta.'); }
  }

  function remove() {
    if (!removing) return;
    try { deleteClient(removing.id); setRemoving(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Nie udało się usunąć klienta.'); }
  }

  return <section className="entities-page">
    <div className="page-heading">
      <div><span className="eyebrow">RELACJE, KTÓRE ROSNĄ</span><h1>Klienci <span className="entity-count">{data.clients.length}</span></h1><p className="muted">Wszystkie kontakty i ich ogrody w jednym miejscu.</p></div>
      <button className="button primary" onClick={() => edit()}><Plus size={18} /> Dodaj klienta</button>
    </div>
    <div className="entities-toolbar">
      <div className="search-box"><Search size={18} /><input className="search-input" aria-label="Szukaj klientów" placeholder="Szukaj po nazwie, telefonie lub e-mailu…" value={query} onChange={event => setQuery(event.target.value)} />{query && <button className="icon-button" aria-label="Wyczyść wyszukiwanie" onClick={() => setQuery('')}><X size={16}/></button>}</div>
      <span className="muted entities-result">{matches.length} z {data.clients.length} kontaktów</span>
    </div>
    {matches.length === 0 ? <div className="card empty-state"><Users size={35} /><h3>{query ? 'Brak pasujących klientów' : 'Twoja lista klientów czeka'}</h3><p className="muted">{query ? 'Zmień wyszukiwaną frazę i spróbuj ponownie.' : 'Dodaj pierwszego klienta, a następnie przypisz do niego ogród.'}</p><button className="button secondary" onClick={() => query ? setQuery('') : edit()}>{query ? 'Pokaż wszystkich' : 'Dodaj klienta'}</button></div> :
      <div className="entity-grid clients-grid">{matches.map((client, index) => {
        const gardens = data.gardens.filter(garden => garden.clientId === client.id);
        return <article key={client.id} className="card entity-card client-card">
          <div className="card-header"><span className={`client-avatar avatar-${index % 4}`}>{initials(client.name)}</span><div className="entity-card-actions"><button className="icon-button" aria-label={`Edytuj klienta ${client.name}`} title="Edytuj klienta" onClick={() => edit(client)}><Pencil size={16} /></button><button className="icon-button entity-delete" aria-label={`Usuń klienta ${client.name}`} title="Usuń klienta" onClick={() => { setError(''); setRemoving(client); }}><Trash2 size={16} /></button></div></div>
          <h3>{client.name}</h3>
          <div className="client-contact"><Phone size={15} />{client.phone ? <a href={`tel:${client.phone.replace(/\s/g, '')}`}>{client.phone}</a> : <span className="muted">Brak telefonu</span>}</div>
          <div className="client-contact"><Mail size={15} />{client.email ? <a href={`mailto:${client.email}`}>{client.email}</a> : <span className="muted">Brak adresu e-mail</span>}</div>
          <div className="client-notes">{client.notes || 'Miejsce na Twoje notatki o kliencie.'}</div>
          <div className="card-footer"><span><Sprout size={16} /> <strong>{gardens.length}</strong> {gardens.length === 1 ? 'ogród' : gardens.length > 1 && gardens.length < 5 ? 'ogrody' : 'ogrodów'}</span><span className="entity-caption"><Building2 size={14} /> Klient</span></div>
        </article>;
      })}</div>}
    {editing && <Modal title={isNew ? 'Nowy klient' : 'Edytuj klienta'} onClose={() => setEditing(null)}>
      <form onSubmit={submit}>
        {error && <p className="gm-form-error" role="alert">{error}</p>}
        <div className="form-grid">
          <label className="field full-width">Imię i nazwisko / nazwa firmy *<input required maxLength={150} name="name" autoComplete="name" value={editing.name} onChange={event => setEditing({ ...editing, name: event.target.value })} placeholder="np. Anna Kowalska" /></label>
          <label className="field">Telefon<input type="tel" name="phone" autoComplete="tel" maxLength={40} value={editing.phone} onChange={event => setEditing({ ...editing, phone: event.target.value })} placeholder="np. 600 100 200" /></label>
          <label className="field">Adres e-mail<input type="email" name="email" autoComplete="email" maxLength={254} value={editing.email} onChange={event => setEditing({ ...editing, email: event.target.value })} placeholder="anna@example.com" /></label>
          <label className="field full-width">Notatki<textarea maxLength={3000} value={editing.notes} onChange={event => setEditing({ ...editing, notes: event.target.value })} placeholder="Preferowany kontakt, wskazówki, ważne informacje…" /></label>
        </div>
        <p className="gm-form-note">* Pole wymagane. Ogrody przypiszesz w zakładce „Obiekty”.</p>
        <div className="gm-modal-actions"><button type="button" className="button secondary" onClick={() => setEditing(null)}>Anuluj</button><button className="button primary" type="submit">{isNew ? 'Dodaj klienta' : 'Zapisz zmiany'}</button></div>
      </form>
    </Modal>}
    {removing && <Modal title="Usunąć klienta?" onClose={() => setRemoving(null)}>
      {error && <p className="gm-form-error" role="alert">{error}</p>}
      <p>Klient <strong>{removing.name}</strong> zostanie usunięty. Tej operacji nie można cofnąć.</p>
      {data.gardens.some(garden => garden.clientId === removing.id) && <p className="gm-form-note">Klient ma przypisane ogrody. Aby zachować powiązania danych, najpierw usuń je lub przypisz innemu klientowi.</p>}
      <div className="gm-modal-actions"><button type="button" className="button secondary" onClick={() => setRemoving(null)}>Anuluj</button><button type="button" className="button danger" onClick={remove}>Usuń klienta</button></div>
    </Modal>}
  </section>;
}
