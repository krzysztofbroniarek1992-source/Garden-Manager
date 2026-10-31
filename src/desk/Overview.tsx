import { useState } from 'react';
import { useGarden, useNow } from '../state';
import { localDate } from '../domain';
import {
  deadlineGroup,
  newNote,
  newTodo,
  priorities,
  type Note,
  type Todo,
} from './model';
import { NoteForm, TodoForm } from './Forms';
import DeskDetails from './Details';
import './desk.css';
export function DeskQuickActions() {
  const { data } = useGarden();
  const [note, setNote] = useState<Note | null>(null),
    [todo, setTodo] = useState<Todo | null>(null);
  return (
    <>
      <div className="desk-quick-actions">
        <button
          className="button secondary"
          onClick={() => setNote(newNote(data))}
        >
          Dodaj notatkę
        </button>
        <button
          className="button secondary"
          onClick={() => setNote(newNote(data, {}, localDate()))}
        >
          Dodaj przypomnienie
        </button>
        <button
          className="button secondary"
          onClick={() => setTodo(newTodo(data))}
        >
          Dodaj sprawę
        </button>
      </div>
      {note && <NoteForm initial={note} onClose={() => setNote(null)} />}
      {todo && <TodoForm initial={todo} onClose={() => setTodo(null)} />}
    </>
  );
}
export default function DeskOverview() {
  const { data, changeReminder, changeTodoStatus } = useGarden(),
    now = new Date(useNow());
  const [selected, setSelected] = useState<{
      kind: 'note' | 'todo';
      id: string;
    } | null>(null),
    [error, setError] = useState('');
  const reminderRows = data.notes
    .filter((n) => n.archivedAt === null && n.reminder?.status === 'active')
    .map((n) => ({
      kind: 'note' as const,
      id: n.id,
      title: n.title,
      date: n.reminder!.date,
      time: n.reminder!.time,
      priority: n.priority,
      revision: n.revision,
    }));
  const todoRows = data.todos
    .filter((t) => t.status === 'open')
    .map((t) => ({
      kind: 'todo' as const,
      id: t.id,
      title: t.title,
      date: t.dueDate,
      time: t.dueTime,
      priority: t.priority,
      revision: t.revision,
    }));
  return (
    <section className="desk-overview" aria-label="Przypomnienia i sprawy">
      <h2>Przypomnienia i sprawy</h2>
      <div className="desk-overview-grid">
        {[
          { title: 'Przypomnienia z notatek', rows: reminderRows },
          { title: 'Sprawy do załatwienia', rows: todoRows },
        ].map((list) => (
          <article className="card desk-overview-card" key={list.title}>
            <h3>{list.title}</h3>
            {list.rows
              .sort((a, b) =>
                `${a.date ?? '9999-12-31'}${a.time ?? ''}`.localeCompare(
                  `${b.date ?? '9999-12-31'}${b.time ?? ''}`,
                ),
              )
              .slice(0, 5)
              .map((row) => (
                <div
                  className={`desk-overview-row ${deadlineGroup(row.date, row.time, now) === 'overdue' ? 'desk-row-overdue' : ''}`}
                  key={row.id}
                >
                  <button
                    className="desk-overview-open"
                    onClick={() => setSelected({ kind: row.kind, id: row.id })}
                  >
                    <strong>{row.title}</strong>
                    <small>
                      {row.date ?? 'Bez terminu'}
                      {row.time && ` · ${row.time}`}
                      {deadlineGroup(row.date, row.time, now) === 'overdue' &&
                        ' · Zaległe'}
                    </small>
                    {row.priority && (
                      <span
                        className={`desk-priority priority-${row.priority}`}
                      >
                        {priorities[row.priority]}
                      </span>
                    )}
                  </button>
                  <button
                    className="button secondary"
                    aria-label={`Wykonaj ${row.kind === 'note' ? 'przypomnienie' : 'sprawę'} ${row.title}`}
                    onClick={() => {
                      try {
                        row.kind === 'note'
                          ? changeReminder(row.id, row.revision, 'completed')
                          : changeTodoStatus(row.id, row.revision, 'completed');
                        setError('');
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                  >
                    Wykonane
                  </button>
                </div>
              ))}
            {!list.rows.length && (
              <p className="muted">Brak aktywnych wpisów.</p>
            )}
            {list.rows.length > 5 && (
              <p className="gm-form-note">
                Pokazujemy 5 najbliższych wpisów. Pełną listę znajdziesz w
                widoku{' '}
                {list.title === 'Przypomnienia z notatek'
                  ? 'Notatki'
                  : 'Do zrobienia'}
                .
              </p>
            )}
          </article>
        ))}
      </div>
      {error && (
        <p role="alert" className="gm-form-error">
          {error}
        </p>
      )}
      {selected && (
        <DeskDetails
          kind={selected.kind}
          id={selected.id}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
}
