import { useState } from 'react';
import Modal from '../components/Modal';
import { useGarden, useNow } from '../state';
import { PhotoImage } from '../photos/PhotoGallery';
import { NoteForm, TodoForm } from './Forms';
import {
  deadlineGroup,
  noteCategories,
  priorities,
  reminderLabels,
  todoLabels,
  type DeskRecord,
} from './model';
import './desk.css';
export function ScopeCaption({ record }: { record: DeskRecord }) {
  const names = [
    record.clientName,
    record.gardenName,
    record.zoneName,
    record.jobTitle,
  ].filter(Boolean);
  return (
    <p className="desk-scope">
      {names.length ? names.join(' · ') : 'Ogólne — bez powiązania'}
    </p>
  );
}
export default function DeskDetails({
  kind,
  id,
  onClose,
}: {
  kind: 'note' | 'todo';
  id: string;
  onClose: () => void;
}) {
  const {
    data,
    archiveNote,
    changeReminder,
    changeTodoStatus,
    deleteDeskRecord,
  } = useGarden();
  const now = new Date(useNow());
  const note =
      kind === 'note' ? data.notes.find((n) => n.id === id) : undefined,
    todo = kind === 'todo' ? data.todos.find((t) => t.id === id) : undefined,
    record = note ?? todo;
  const [editing, setEditing] = useState(false),
    [removing, setRemoving] = useState(false),
    [postponing, setPostponing] = useState(false),
    [error, setError] = useState('');
  const [date, setDate] = useState(note?.reminder?.date ?? ''),
    [time, setTime] = useState(note?.reminder?.time ?? '');
  if (!record)
    return (
      <Modal title="Szczegóły wpisu" onClose={onClose}>
        <p>Wpis został usunięty lub zmienił się po odtworzeniu kopii.</p>
      </Modal>
    );
  if (editing)
    return note ? (
      <NoteForm
        initial={note}
        onClose={() => setEditing(false)}
        onDone={() => setEditing(false)}
      />
    ) : (
      <TodoForm
        initial={todo!}
        onClose={() => setEditing(false)}
        onDone={() => setEditing(false)}
      />
    );
  const perform = (action: () => void) => {
    try {
      action();
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const photo = note?.photoId
    ? data.photos.find((p) => p.id === note.photoId && p.deletedAt === null)
    : undefined;
  const overdue =
    (note?.archivedAt === null &&
      note?.reminder?.status === 'active' &&
      deadlineGroup(note.reminder.date, note.reminder.time, now) ===
        'overdue') ||
    (todo?.status === 'open' &&
      deadlineGroup(todo.dueDate, todo.dueTime, now) === 'overdue');
  return (
    <Modal
      title={note ? 'Szczegóły notatki' : 'Szczegóły sprawy'}
      onClose={onClose}
      wide
    >
      <div className="desk-details">
        <h3>{record.title}</h3>
        <div className="desk-tags">
          <span
            className={`desk-priority priority-${record.priority ?? 'none'}`}
          >
            {record.priority ? priorities[record.priority] : 'Bez priorytetu'}
          </span>
          {note?.category && <span>{noteCategories[note.category]}</span>}
          {note && note.archivedAt !== null && <span>Archiwum</span>}
          {todo && <span>{todoLabels[todo.status]}</span>}
        </div>
        <ScopeCaption record={record} />
        <p className="preserve-lines desk-body">
          {note?.body ?? todo?.description}
        </p>
        <p className="muted desk-audit">
          Utworzono: {new Date(record.createdAt).toLocaleString('pl-PL')} ·
          Edytowano: {new Date(record.updatedAt).toLocaleString('pl-PL')}
        </p>
        {photo && (
          <div className="desk-linked-photo">
            <h4>Zdjęcie z galerii: {photo.filename}</h4>
            <PhotoImage photo={photo} thumbnail />
          </div>
        )}
        {note && !photo && note.photoName && (
          <p className="muted">
            Historyczne zdjęcie „{note.photoName}” zostało odłączone lub
            usunięte.
          </p>
        )}
        {note?.reminder && (
          <section
            className="desk-reminder-details"
            aria-label="Przypomnienie notatki"
          >
            <h4>Przypomnienie · {reminderLabels[note.reminder.status]}</h4>
            <p>
              <strong>
                {note.reminder.date}
                {note.reminder.time
                  ? ` · ${note.reminder.time}`
                  : ' · bez godziny'}
              </strong>
              {overdue && (
                <span className="desk-overdue-label"> · Zaległe</span>
              )}
            </p>
            {note.archivedAt !== null ? (
              <p>
                Notatka jest w archiwum. Przypomnienie nie pojawia się na
                pulpicie ani w kalendarzu.
              </p>
            ) : (
              <div className="desk-actions">
                {note.reminder.status === 'active' ? (
                  <>
                    <button
                      className="button primary"
                      onClick={() =>
                        perform(() =>
                          changeReminder(note.id, note.revision, 'completed'),
                        )
                      }
                    >
                      Przypomnienie wykonane
                    </button>
                    <button
                      className="button secondary"
                      onClick={() =>
                        perform(() =>
                          changeReminder(note.id, note.revision, 'cancelled'),
                        )
                      }
                    >
                      Anuluj przypomnienie
                    </button>
                  </>
                ) : (
                  <button
                    className="button primary"
                    onClick={() =>
                      perform(() =>
                        changeReminder(note.id, note.revision, 'active'),
                      )
                    }
                  >
                    Aktywuj ponownie
                  </button>
                )}
                <button
                  className="button secondary"
                  onClick={() => {
                    setDate(note.reminder!.date);
                    setTime(note.reminder!.time ?? '');
                    setPostponing(true);
                  }}
                >
                  Odrocz przypomnienie
                </button>
              </div>
            )}
            {postponing && (
              <form
                className="desk-postpone"
                onSubmit={(e) => {
                  e.preventDefault();
                  perform(() => {
                    changeReminder(
                      note.id,
                      note.revision,
                      'active',
                      date,
                      time || null,
                    );
                    setPostponing(false);
                  });
                }}
              >
                <div className="form-grid">
                  <label className="field">
                    Nowa data przypomnienia
                    <input
                      required
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                    />
                  </label>
                  <label className="field">
                    Nowa godzina przypomnienia
                    <input
                      type="time"
                      value={time}
                      onChange={(e) => setTime(e.target.value)}
                    />
                  </label>
                </div>
                <div className="desk-actions">
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => setPostponing(false)}
                  >
                    Anuluj odroczenie
                  </button>
                  <button className="button primary" type="submit">
                    Zapisz odroczenie
                  </button>
                </div>
              </form>
            )}
          </section>
        )}
        {todo && (
          <p className={overdue ? 'desk-overdue-label' : ''}>
            Termin: {todo.dueDate ?? 'Bez terminu'}
            {todo.dueTime && ` · ${todo.dueTime}`}
            {overdue && ' · Zaległe'}
          </p>
        )}
        {error && (
          <p role="alert" className="gm-form-error">
            {error}
          </p>
        )}
        <div className="desk-actions">
          <button className="button secondary" onClick={() => setEditing(true)}>
            {note ? 'Edytuj notatkę' : 'Edytuj sprawę'}
          </button>
          {note && (
            <button
              className="button secondary"
              onClick={() =>
                perform(() =>
                  archiveNote(note.id, note.revision, note.archivedAt === null),
                )
              }
            >
              {note.archivedAt === null
                ? 'Archiwizuj notatkę'
                : 'Przywróć notatkę'}
            </button>
          )}
          {todo && (
            <>
              <button
                className="button primary"
                onClick={() =>
                  perform(() =>
                    changeTodoStatus(
                      todo.id,
                      todo.revision,
                      todo.status === 'completed' ? 'open' : 'completed',
                    ),
                  )
                }
              >
                {todo.status === 'completed'
                  ? 'Oznacz jako niewykonane'
                  : 'Oznacz jako wykonane'}
              </button>
              {todo.status !== 'cancelled' && (
                <button
                  className="button secondary"
                  onClick={() =>
                    perform(() =>
                      changeTodoStatus(todo.id, todo.revision, 'cancelled'),
                    )
                  }
                >
                  Anuluj sprawę
                </button>
              )}
            </>
          )}
          <button className="button ghost" onClick={() => setRemoving(true)}>
            {note ? 'Usuń notatkę' : 'Usuń sprawę'}
          </button>
        </div>
        {removing && (
          <div
            className="desk-delete-confirm"
            role="group"
            aria-label="Potwierdzenie usunięcia wpisu"
          >
            <p>
              Usunąć „{record.title}”?{' '}
              {note
                ? 'Powiązane przypomnienie także zostanie usunięte. Zdjęcie pozostanie w galerii.'
                : 'Powiązane obiekty pozostaną zachowane.'}
            </p>
            <div className="desk-actions">
              <button
                className="button secondary"
                onClick={() => setRemoving(false)}
              >
                Zachowaj wpis
              </button>
              <button
                className="button danger"
                onClick={() =>
                  perform(() => {
                    deleteDeskRecord(kind, record.id, record.revision);
                    onClose();
                  })
                }
              >
                Potwierdź usunięcie wpisu
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
