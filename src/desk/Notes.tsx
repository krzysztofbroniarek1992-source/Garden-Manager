import { useState } from 'react';
import { useGarden, useNow } from '../state';
import { localDate } from '../domain';
import {
  deadlineGroup,
  matchesDeskScope,
  newNote,
  noteCategories,
  priorities,
  reminderLabels,
  type DeskScope,
  type Note,
} from './model';
import { NoteForm } from './Forms';
import DeskDetails, { ScopeCaption } from './Details';
import './desk.css';

export function NoteCard({ note, onOpen }: { note: Note; onOpen: () => void }) {
  return (
    <article className="card desk-card">
      <div className="desk-card-heading">
        <button className="desk-title" onClick={onOpen}>
          {note.title}
        </button>
        <span className={`desk-priority priority-${note.priority ?? 'none'}`}>
          {note.priority ? priorities[note.priority] : 'Bez priorytetu'}
        </span>
      </div>
      <div className="desk-tags">
        {note.category && <span>{noteCategories[note.category]}</span>}
        {note.archivedAt !== null && <span>Archiwum</span>}
      </div>
      {note.body && <p className="desk-preview preserve-lines">{note.body}</p>}
      <ScopeCaption record={note} />
      {note.reminder && (
        <p className="desk-due">
          Przypomnienie: {note.reminder.date}
          {note.reminder.time && ` · ${note.reminder.time}`} ·{' '}
          {note.archivedAt !== null
            ? 'Wstrzymane w archiwum'
            : reminderLabels[note.reminder.status]}
        </p>
      )}
      {note.photoId && (
        <span className="desk-photo-caption">
          Powiązane zdjęcie: {note.photoName}
        </span>
      )}
    </article>
  );
}
export default function Notes() {
  const { data } = useGarden(),
    now = new Date(useNow());
  const [query, setQuery] = useState(''),
    [client, setClient] = useState(''),
    [category, setCategory] = useState(''),
    [priority, setPriority] = useState(''),
    [status, setStatus] = useState('active'),
    [deadline, setDeadline] = useState(''),
    [from, setFrom] = useState(''),
    [to, setTo] = useState('');
  const [draft, setDraft] = useState<Note | null>(null),
    [selected, setSelected] = useState('');
  const rows = data.notes
    .filter(
      (n) =>
        `${n.title} ${n.body}`
          .toLocaleLowerCase('pl')
          .includes(query.toLocaleLowerCase('pl')) &&
        (!client ||
          (client === 'none' ? n.clientId === null : n.clientId === client)) &&
        (!category ||
          (category === 'none'
            ? n.category === null
            : n.category === category)) &&
        (!priority ||
          (priority === 'none'
            ? n.priority === null
            : n.priority === priority)) &&
        (status === 'all' ||
          (status === 'active'
            ? n.archivedAt === null
            : n.archivedAt !== null)) &&
        (!deadline ||
          (deadline === 'none'
            ? !n.reminder
            : deadline === 'completed' || deadline === 'cancelled'
              ? n.reminder?.status === deadline
              : n.archivedAt === null &&
                n.reminder?.status === 'active' &&
                deadlineGroup(n.reminder.date, n.reminder.time, now) ===
                  deadline)) &&
        (!from || (!!n.reminder && n.reminder.date >= from)) &&
        (!to || (!!n.reminder && n.reminder.date <= to)),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  return (
    <section className="desk-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">OBSERWACJE, POMYSŁY I WAŻNE TERMINY</span>
          <h1>Notatki</h1>
          <p className="muted">
            Wszystkie zapiski, także ogólne i powiązane ze zdjęciami.
          </p>
        </div>
        <div className="desk-actions">
          <button
            className="button primary"
            onClick={() => setDraft(newNote(data))}
          >
            Dodaj notatkę
          </button>
          <button
            className="button secondary"
            onClick={() => setDraft(newNote(data, {}, localDate(now)))}
          >
            Dodaj przypomnienie
          </button>
        </div>
      </div>
      <div className="desk-filters">
        <label className="field">
          Szukaj notatek
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tytuł lub treść"
          />
        </label>
        <label className="field">
          Klient
          <select value={client} onChange={(e) => setClient(e.target.value)}>
            <option value="">Wszyscy klienci</option>
            <option value="none">Ogólne — bez klienta</option>
            {data.clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Kategoria
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">Wszystkie kategorie</option>
            <option value="none">Bez kategorii</option>
            {Object.entries(noteCategories).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Priorytet
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
          >
            <option value="">Wszystkie priorytety</option>
            <option value="none">Bez priorytetu</option>
            {Object.entries(priorities).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Status notatki
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="active">Aktywne</option>
            <option value="archived">Archiwum</option>
            <option value="all">Wszystkie</option>
          </select>
        </label>
        <label className="field">
          Termin przypomnienia
          <select
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
          >
            <option value="">Dowolny</option>
            <option value="today">Na dziś</option>
            <option value="upcoming">Nadchodzące</option>
            <option value="overdue">Zaległe</option>
            <option value="none">Bez przypomnienia</option>
            <option value="completed">Wykonane</option>
            <option value="cancelled">Anulowane</option>
          </select>
        </label>
        <label className="field">
          Termin od
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="field">
          Termin do
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
      </div>
      <div className="desk-filter-summary">
        <span>{rows.length} notatek</span>
        <button
          className="text-button"
          onClick={() => {
            setQuery('');
            setClient('');
            setCategory('');
            setPriority('');
            setStatus('active');
            setDeadline('');
            setFrom('');
            setTo('');
          }}
        >
          Wyczyść filtry
        </button>
      </div>
      {from && to && from > to && (
        <p className="gm-form-error" role="alert">
          Termin „od” nie może być późniejszy niż „do”.
        </p>
      )}
      <div className="desk-grid">
        {rows.map((note) => (
          <NoteCard
            key={note.id}
            note={note}
            onOpen={() => setSelected(note.id)}
          />
        ))}
      </div>
      {!rows.length && (
        <div className="card desk-empty">
          <h3>Brak notatek dla wybranych filtrów</h3>
          <p>Dodaj zapis lub zmień filtry.</p>
        </div>
      )}
      {draft && <NoteForm initial={draft} onClose={() => setDraft(null)} />}
      {selected && (
        <DeskDetails
          kind="note"
          id={selected}
          onClose={() => setSelected('')}
        />
      )}
    </section>
  );
}
export function ContextNotes({
  scope,
  title = 'Notatki i przypomnienia',
}: {
  scope: Partial<DeskScope>;
  title?: string;
}) {
  const { data } = useGarden();
  const [draft, setDraft] = useState<Note | null>(null),
    [selected, setSelected] = useState(''),
    [archived, setArchived] = useState(false),
    [limit, setLimit] = useState(5);
  const notes = data.notes
    .filter(
      (n) =>
        matchesDeskScope(n, scope) &&
        (archived ? n.archivedAt !== null : n.archivedAt === null),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt);
  return (
    <section className="desk-context" aria-label={title}>
      <div className="desk-section-heading">
        <h3>{title}</h3>
        <div className="desk-actions">
          <button
            className="button secondary"
            onClick={() => setDraft(newNote(data, scope))}
          >
            Dodaj notatkę
          </button>
          <button
            className="button secondary"
            onClick={() => setDraft(newNote(data, scope, localDate()))}
          >
            Dodaj przypomnienie
          </button>
        </div>
      </div>
      <button className="text-button" onClick={() => setArchived((v) => !v)}>
        {archived ? 'Pokaż aktywne notatki' : 'Pokaż archiwum notatek'}
      </button>
      <div className="desk-grid">
        {notes.slice(0, limit).map((note) => (
          <NoteCard
            key={note.id}
            note={note}
            onOpen={() => setSelected(note.id)}
          />
        ))}
      </div>
      {!notes.length && (
        <p className="muted">
          Brak {archived ? 'archiwalnych' : 'aktywnych'} notatek przy tym
          obiekcie.
        </p>
      )}
      {notes.length > limit && (
        <button
          className="button secondary"
          onClick={() => setLimit((v) => v + 10)}
        >
          Pokaż kolejne notatki
        </button>
      )}
      {draft && <NoteForm initial={draft} onClose={() => setDraft(null)} />}
      {selected && (
        <DeskDetails
          kind="note"
          id={selected}
          onClose={() => setSelected('')}
        />
      )}
    </section>
  );
}
