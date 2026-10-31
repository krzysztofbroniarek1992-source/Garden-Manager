import { useState } from 'react';
import { useGarden, useNow } from '../state';
import {
  deadlineGroup,
  newTodo,
  priorities,
  todoLabels,
  type Todo,
} from './model';
import { TodoForm } from './Forms';
import DeskDetails, { ScopeCaption } from './Details';
import './desk.css';
const tabs = {
  all: 'Wszystkie',
  today: 'Na dziś',
  upcoming: 'Nadchodzące',
  overdue: 'Zaległe',
  completed: 'Wykonane',
  none: 'Bez terminu',
  cancelled: 'Anulowane',
};
export default function Todos() {
  const { data, changeTodoStatus } = useGarden(),
    now = new Date(useNow());
  const [tab, setTab] = useState<keyof typeof tabs>('all'),
    [query, setQuery] = useState(''),
    [client, setClient] = useState(''),
    [priority, setPriority] = useState(''),
    [status, setStatus] = useState(''),
    [from, setFrom] = useState(''),
    [to, setTo] = useState('');
  const [draft, setDraft] = useState<Todo | null>(null),
    [selected, setSelected] = useState(''),
    [error, setError] = useState('');
  const rows = data.todos
    .filter(
      (t) =>
        (tab === 'all' ||
          (tab === 'completed' || tab === 'cancelled'
            ? t.status === tab
            : t.status === 'open' &&
              deadlineGroup(t.dueDate, t.dueTime, now) === tab)) &&
        `${t.title} ${t.description}`
          .toLocaleLowerCase('pl')
          .includes(query.toLocaleLowerCase('pl')) &&
        (!client ||
          (client === 'none' ? t.clientId === null : t.clientId === client)) &&
        (!priority ||
          (priority === 'none'
            ? t.priority === null
            : t.priority === priority)) &&
        (!status || t.status === status) &&
        (!from || (!!t.dueDate && t.dueDate >= from)) &&
        (!to || (!!t.dueDate && t.dueDate <= to)),
    )
    .sort(
      (a, b) =>
        `${a.status === 'open' ? '0' : '1'}${a.dueDate ?? '9999-12-31'}${a.dueTime ?? ''}`.localeCompare(
          `${b.status === 'open' ? '0' : '1'}${b.dueDate ?? '9999-12-31'}${b.dueTime ?? ''}`,
        ) || a.title.localeCompare(b.title, 'pl'),
    );
  return (
    <section className="desk-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">TWOJA LISTA SPRAW</span>
          <h1>Do zrobienia</h1>
          <p className="muted">
            Kontakty, zakupy i drobne sprawy — bez zakładania zlecenia.
          </p>
        </div>
        <button
          className="button primary"
          onClick={() => setDraft(newTodo(data))}
        >
          Dodaj sprawę
        </button>
      </div>
      <div className="desk-tabs" role="group" aria-label="Widok listy spraw">
        {Object.entries(tabs).map(([value, label]) => (
          <button
            className="button secondary"
            aria-pressed={tab === value}
            key={value}
            onClick={() => {
              setTab(value as keyof typeof tabs);
              setStatus('');
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="desk-filters">
        <label className="field">
          Szukaj spraw
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tytuł lub opis"
          />
        </label>
        <label className="field">
          Klient
          <select value={client} onChange={(e) => setClient(e.target.value)}>
            <option value="">Wszyscy klienci</option>
            <option value="none">Ogólne — bez klienta</option>
            {data.clients.map((c) => (
              <option value={c.id} key={c.id}>
                {c.name}
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
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Status sprawy
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Wszystkie statusy</option>
            {Object.entries(todoLabels).map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
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
        <span>{rows.length} spraw</span>
        <button
          className="text-button"
          onClick={() => {
            setQuery('');
            setClient('');
            setPriority('');
            setStatus('');
            setFrom('');
            setTo('');
            setTab('all');
          }}
        >
          Wyczyść filtry
        </button>
      </div>
      {error && (
        <p role="alert" className="gm-form-error">
          {error}
        </p>
      )}
      {from && to && from > to && (
        <p role="alert" className="gm-form-error">
          Termin „od” nie może być późniejszy niż „do”.
        </p>
      )}
      <div className="desk-todo-list">
        {rows.map((todo) => (
          <article
            className={`card desk-todo-row ${todo.status === 'open' && deadlineGroup(todo.dueDate, todo.dueTime, now) === 'overdue' ? 'desk-row-overdue' : ''}`}
            key={todo.id}
          >
            <div>
              <button
                className="desk-title"
                onClick={() => setSelected(todo.id)}
              >
                {todo.title}
              </button>
              <ScopeCaption record={todo} />
              {todo.description && (
                <p className="desk-preview preserve-lines">
                  {todo.description}
                </p>
              )}
              <p className="desk-due">
                {todo.dueDate ?? 'Bez terminu'}
                {todo.dueTime && ` · ${todo.dueTime}`} ·{' '}
                {todoLabels[todo.status]}
              </p>
            </div>
            <div className="desk-todo-actions">
              <span
                className={`desk-priority priority-${todo.priority ?? 'none'}`}
              >
                {todo.priority ? priorities[todo.priority] : 'Bez priorytetu'}
              </span>
              <button
                className="button secondary"
                aria-label={`${todo.status === 'completed' ? 'Oznacz jako niewykonane' : 'Wykonaj sprawę'} ${todo.title}`}
                onClick={() => {
                  try {
                    changeTodoStatus(
                      todo.id,
                      todo.revision,
                      todo.status === 'completed' ? 'open' : 'completed',
                    );
                    setError('');
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                {todo.status === 'completed' ? 'Przywróć' : 'Wykonane'}
              </button>
            </div>
          </article>
        ))}
      </div>
      {!rows.length && (
        <div className="card desk-empty">
          <h3>Brak spraw dla wybranych filtrów</h3>
          <p>Dodaj samodzielną sprawę lub wybierz inny widok.</p>
        </div>
      )}
      {draft && <TodoForm initial={draft} onClose={() => setDraft(null)} />}
      {selected && (
        <DeskDetails
          kind="todo"
          id={selected}
          onClose={() => setSelected('')}
        />
      )}
    </section>
  );
}
