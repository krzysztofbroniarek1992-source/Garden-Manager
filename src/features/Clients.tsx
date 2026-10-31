import ClientForm from './ClientForm';
import { useState } from 'react';
import { ArrowUpRight, Mail, Pencil, Phone, Plus, Search, Sprout, Trash2, Users, X } from 'lucide-react';
import type { Client } from '../domain';
import { useGarden } from '../state';
import Modal from '../components/Modal';
import ClientDetails from './ClientDetails';
import './entities.css';
import './client-details.css';

const blankClient = (): Client => ({ id: crypto.randomUUID(), name: '', phone: '', email: '', notes: '' });
const initials = (name: string) => name.split(' ').filter(Boolean).slice(0, 2).map(word => word[0]).join('').toUpperCase();

export default function Clients() {
  const { data, deleteClient } = useGarden();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Client | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [removing, setRemoving] = useState<Client | null>(null);
  const [error, setError] = useState('');
  const [selectedClient, setSelectedClient] = useState<string | null>(() => new URLSearchParams(location.search).get('client'));
  const matches = data.clients.filter(client => `${client.name} ${client.phone} ${client.email}`.toLocaleLowerCase('pl').includes(query.toLocaleLowerCase('pl')));

  function openClient(id: string | null) {
    setSelectedClient(id);
    const url = new URL(location.href);
    if (id) url.searchParams.set('client', id);
    else url.searchParams.delete('client');
    history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    window.scrollTo({ top: 0 });
  }

  function edit(client?: Client) {
    setError('');
    setIsNew(!client);
    setEditing(client ? { ...client } : blankClient());
  }


  function remove() {
    if (!removing) return;
    try { deleteClient(removing.id); setRemoving(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Nie udało się usunąć klienta.'); }
  }

  if (selectedClient) return <ClientDetails clientId={selectedClient} onBack={() => openClient(null)}/>;

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
        return <article key={client.id} className="card entity-card client-card client-card-link" onClick={event => { if (!(event.target as HTMLElement).closest('button, a, input, select, textarea')) openClient(client.id); }}>
          <div className="card-header"><span className={`client-avatar avatar-${index % 4}`}>{initials(client.name)}</span><div className="entity-card-actions"><button className="icon-button" aria-label={`Edytuj klienta ${client.name}`} title="Edytuj klienta" onClick={() => edit(client)}><Pencil size={16} /></button><button className="icon-button entity-delete" aria-label={`Usuń klienta ${client.name}`} title="Usuń klienta" onClick={() => { setError(''); setRemoving(client); }}><Trash2 size={16} /></button></div></div>
          <h3><button className="client-name-button" onClick={() => openClient(client.id)}>{client.name}</button></h3>
          <div className="client-contact"><Phone size={15} />{client.phone ? <a href={`tel:${client.phone.replace(/\s/g, '')}`}>{client.phone}</a> : <span className="muted">Brak telefonu</span>}</div>
          <div className="client-contact"><Mail size={15} />{client.email ? <a href={`mailto:${client.email}`}>{client.email}</a> : <span className="muted">Brak adresu e-mail</span>}</div>
          <div className="client-notes">{client.notes || 'Miejsce na Twoje notatki o kliencie.'}</div>
          <div className="card-footer"><span><Sprout size={16} /> <strong>{gardens.length}</strong> {gardens.length === 1 ? 'ogród' : gardens.length > 1 && gardens.length < 5 ? 'ogrody' : 'ogrodów'}</span><button className="client-details-link" aria-label={`Zobacz kartę klienta ${client.name}`} onClick={() => openClient(client.id)}>Zobacz kartę <ArrowUpRight size={14}/></button></div>
        </article>;
      })}</div>}
    {editing && <ClientForm initial={editing} isNew={isNew} onClose={() => setEditing(null)}/>}
    {removing && <Modal title="Usunąć klienta?" onClose={() => setRemoving(null)}>
      {error && <p className="gm-form-error" role="alert">{error}</p>}
      <p>Klient <strong>{removing.name}</strong> zostanie usunięty. Tej operacji nie można cofnąć.</p>
      {data.gardens.some(garden => garden.clientId === removing.id) && <p className="gm-form-note">Klient ma przypisane ogrody. Aby zachować powiązania danych, najpierw usuń je lub przypisz innemu klientowi.</p>}
      <div className="gm-modal-actions"><button type="button" className="button secondary" onClick={() => setRemoving(null)}>Anuluj</button><button type="button" className="button danger" onClick={remove}>Usuń klienta</button></div>
    </Modal>}
  </section>;
}
