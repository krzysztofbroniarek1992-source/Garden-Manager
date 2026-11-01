import { useUnsavedChanges } from '../navigation/unsaved';
import { useState, type FormEvent } from 'react';
import Modal from '../components/Modal';
import { useGarden } from '../state';
import { localDate } from '../domain';
import {
  noteCategories,
  priorities,
  reminderLabels,
  todoLabels,
  type Note,
  type Todo,
  type Priority,
} from './model';
import ScopeFields from './ScopeFields';
import './desk.css';

export function PriorityField({
  value,
  onChange,
}: {
  value: Priority | null;
  onChange: (value: Priority | null) => void;
}) {
  return (
    <label className="field">
      Priorytet
      <select
        value={value ?? ''}
        onChange={(e) => onChange((e.target.value as Priority) || null)}
      >
        <option value="">Bez priorytetu</option>
        {Object.entries(priorities).map(([value, label]) => (
          <option value={value} key={value}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}
export function NoteForm({
  initial,
  onClose,
  onDone = onClose,
}: {
  initial: Note;
  onClose: () => void;
  onDone?: () => void;
}) {
  const { data, saveNote } = useGarden();
  const [draft, setDraft] = useState(initial),
    [error, setError] = useState('');
  const guard = useUnsavedChanges(JSON.stringify(draft) !== JSON.stringify(initial));
  const photos = data.photos.filter(
    (p) =>
      p.deletedAt === null &&
      (p.id === draft.photoId ||
        ((!draft.clientId || p.clientId === draft.clientId) &&
          (!draft.gardenId || p.gardenId === draft.gardenId))),
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    try {
      guard.save(() => {saveNote(draft);onDone();});
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal
      title={
        initial.revision
          ? 'Edytuj notatkę'
          : initial.reminder
            ? 'Nowe przypomnienie'
            : 'Nowa notatka'
      }
      onClose={onClose}
      wide
    >
      <form onSubmit={submit} className="desk-form">
        {error && (
          <p role="alert" className="gm-form-error">
            {error}
          </p>
        )}
        <div className="form-grid">
          <label className="field full-width">
            Tytuł notatki
            <input
              required
              maxLength={150}
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </label>
          <label className="field full-width">
            Treść notatki
            <textarea
              aria-label="Treść notatki"
              maxLength={10000}
              rows={5}
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            />
          </label>
          <label className="field">
            Kategoria notatki
            <select
              value={draft.category ?? ''}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  category: (e.target.value as Note['category']) || null,
                })
              }
            >
              <option value="">Bez kategorii</option>
              {Object.entries(noteCategories).map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <PriorityField
            value={draft.priority}
            onChange={(priority) => setDraft({ ...draft, priority })}
          />
          <ScopeFields
            value={draft}
            onChange={(scope) => setDraft({ ...draft, ...scope })}
          />
          <label className="field full-width">
            Zdjęcie z galerii (opcjonalnie)
            <select
              value={draft.photoId ?? ''}
              onChange={(e) =>
                setDraft({ ...draft, photoId: e.target.value || null })
              }
            >
              <option value="">Bez powiązanego zdjęcia</option>
              {photos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.filename} ·{' '}
                  {p.description.slice(0, 60) || p.gardenName || p.clientName}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="desk-checkbox">
          <input
            type="checkbox"
            checked={!!draft.reminder}
            onChange={(e) =>
              setDraft({
                ...draft,
                reminder: e.target.checked
                  ? {
                      date: localDate(),
                      time: null,
                      status: 'active',
                      completedAt: null,
                    }
                  : null,
              })
            }
          />
          Dodaj przypomnienie do notatki
        </label>
        {draft.reminder && (
          <div className="desk-reminder-form">
            <div className="form-grid">
              <label className="field">
                Data przypomnienia
                <input
                  required
                  type="date"
                  value={draft.reminder.date}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      reminder: { ...draft.reminder!, date: e.target.value },
                    })
                  }
                />
              </label>
              <label className="field">
                Godzina przypomnienia (opcjonalnie)
                <input
                  type="time"
                  value={draft.reminder.time ?? ''}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      reminder: {
                        ...draft.reminder!,
                        time: e.target.value || null,
                      },
                    })
                  }
                />
              </label>
            </div>
            <p className="muted">
              Status: {reminderLabels[draft.reminder.status]}. Przypomnienie
              pojawia się w aplikacji, bez tworzenia zlecenia.
            </p>
          </div>
        )}
        <p className="gm-form-note">
          Powiązane zdjęcie pozostaje w galerii. Plik nie jest kopiowany.
        </p>
        <div className="gm-modal-actions">
          <button type="button" className="button secondary" onClick={() => guard.confirm(onClose)}>
            Anuluj
          </button>
          <button type="submit" className="button primary">
            Zapisz notatkę
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function TodoForm({
  initial,
  onClose,
  onDone = onClose,
}: {
  initial: Todo;
  onClose: () => void;
  onDone?: () => void;
}) {
  const { saveTodo } = useGarden();
  const [draft, setDraft] = useState(initial),
    [error, setError] = useState('');
  const guard = useUnsavedChanges(JSON.stringify(draft) !== JSON.stringify(initial));
  return (
    <Modal
      title={initial.revision ? 'Edytuj sprawę' : 'Nowa sprawa do załatwienia'}
      onClose={onClose}
      wide
    >
      <form
        ref={guard.ref}
        className="desk-form"
        onSubmit={(e) => {
          e.preventDefault();
          try {
            guard.save(() => {saveTodo(draft);onDone();});
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        {error && (
          <p role="alert" className="gm-form-error">
            {error}
          </p>
        )}
        <div className="form-grid">
          <label className="field full-width">
            Tytuł sprawy
            <input
              required
              maxLength={150}
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </label>
          <label className="field full-width">
            Opis sprawy
            <textarea
              aria-label="Opis sprawy"
              maxLength={10000}
              rows={4}
              value={draft.description}
              onChange={(e) =>
                setDraft({ ...draft, description: e.target.value })
              }
            />
          </label>
          <label className="field">
            Termin sprawy (opcjonalnie)
            <input
              type="date"
              value={draft.dueDate ?? ''}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  dueDate: e.target.value || null,
                  dueTime: e.target.value ? draft.dueTime : null,
                })
              }
            />
          </label>
          <label className="field">
            Godzina sprawy (opcjonalnie)
            <input
              type="time"
              disabled={!draft.dueDate}
              value={draft.dueTime ?? ''}
              onChange={(e) =>
                setDraft({ ...draft, dueTime: e.target.value || null })
              }
            />
          </label>
          <PriorityField
            value={draft.priority}
            onChange={(priority) => setDraft({ ...draft, priority })}
          />
          <label className="field">
            Status sprawy
            <select
              value={draft.status}
              onChange={(e) =>
                setDraft({ ...draft, status: e.target.value as Todo['status'] })
              }
            >
              {Object.entries(todoLabels).map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <ScopeFields
            value={draft}
            onChange={(scope) => setDraft({ ...draft, ...scope })}
          />
        </div>
        <p className="gm-form-note">
          Sprawa nie wymaga zlecenia i nie nalicza czasu ani należności.
        </p>
        <div className="gm-modal-actions">
          <button type="button" className="button secondary" onClick={() => guard.confirm(onClose)}>
            Anuluj
          </button>
          <button type="submit" className="button primary">
            Zapisz sprawę
          </button>
        </div>
      </form>
    </Modal>
  );
}
