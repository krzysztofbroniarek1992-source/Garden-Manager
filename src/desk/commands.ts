import type { Data } from '../domain';
import { isDate } from '../planning/dates';
import {
  resolveDeskScope,
  type DeskRecord,
  type Note,
  type ReminderStatus,
  type Todo,
} from './model';
const conflict = () =>
  new Error(
    'Wpis zmienił się lub został usunięty w innej karcie. Otwórz go ponownie.',
  );
const put = <T extends { id: string }>(rows: T[], row: T) =>
  rows.some((r) => r.id === row.id)
    ? rows.map((r) => (r.id === row.id ? row : r))
    : [...rows, row];
function expected<T extends DeskRecord>(
  rows: T[],
  id: string,
  revision: number,
): T {
  const row = rows.find((r) => r.id === id);
  if (!row || row.revision !== revision) throw conflict();
  return row;
}
export function saveNote(data: Data, draft: Note, now: number): Data {
  const existing = data.notes.find((n) => n.id === draft.id);
  if (
    data.deskTombstones.some((t) => t.kind === 'note' && t.id === draft.id) ||
    (existing && existing.revision !== draft.revision) ||
    (!existing && draft.revision !== 0)
  )
    throw conflict();
  const scope = resolveDeskScope(data, draft),
    photo = data.photos.find(
      (p) => p.id === draft.photoId && p.deletedAt === null,
    );
  if (draft.photoId && !photo)
    throw new Error(
      'Zdjęcie zostało usunięte. Wybierz inne lub usuń powiązanie.',
    );
  const sameScope =
    existing &&
    (['clientId', 'gardenId', 'zoneId', 'jobId'] as const).every(
      (key) => existing[key] === scope[key],
    );
  const note: Note = {
    ...draft,
    ...scope,
    ...(sameScope
      ? {
          clientName: existing.clientName,
          gardenName: existing.gardenName,
          zoneName: existing.zoneName,
          jobTitle: existing.jobTitle,
        }
      : {}),
    title: draft.title.trim(),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    revision: (existing?.revision ?? 0) + 1,
    archivedAt: existing?.archivedAt ?? null,
    photoName:
      photo?.filename ??
      (existing?.photoId === draft.photoId
        ? (existing?.photoName ?? null)
        : null),
  };
  return { ...data, notes: put(data.notes, note) };
}
export function archiveNote(
  data: Data,
  id: string,
  revision: number,
  archived: boolean,
  now: number,
): Data {
  const note = expected(data.notes, id, revision);
  return {
    ...data,
    notes: put(data.notes, {
      ...note,
      archivedAt: archived ? now : null,
      updatedAt: now,
      revision: note.revision + 1,
    }),
  };
}
export function changeReminder(
  data: Data,
  id: string,
  revision: number,
  status: ReminderStatus,
  now: number,
  date?: string,
  time?: string | null,
): Data {
  const note = expected(data.notes, id, revision);
  if (!note.reminder) throw new Error('Notatka nie ma przypomnienia.');
  if (note.archivedAt !== null && status === 'active')
    throw new Error(
      'Przywróć notatkę z archiwum przed aktywowaniem przypomnienia.',
    );
  if (date !== undefined && !isDate(date))
    throw new Error('Podaj poprawny termin.');
  return {
    ...data,
    notes: put(data.notes, {
      ...note,
      reminder: {
        date: date ?? note.reminder.date,
        time: time === undefined ? note.reminder.time : time,
        status,
        completedAt: status === 'completed' ? now : null,
      },
      updatedAt: now,
      revision: note.revision + 1,
    }),
  };
}
export function saveTodo(data: Data, draft: Todo, now: number): Data {
  const existing = data.todos.find((t) => t.id === draft.id);
  if (
    data.deskTombstones.some((t) => t.kind === 'todo' && t.id === draft.id) ||
    (existing && existing.revision !== draft.revision) ||
    (!existing && draft.revision !== 0)
  )
    throw conflict();
  const scope = resolveDeskScope(data, draft);
  const sameScope =
    existing &&
    (['clientId', 'gardenId', 'zoneId', 'jobId'] as const).every(
      (key) => existing[key] === scope[key],
    );
  const todo: Todo = {
    ...draft,
    ...scope,
    ...(sameScope
      ? {
          clientName: existing.clientName,
          gardenName: existing.gardenName,
          zoneName: existing.zoneName,
          jobTitle: existing.jobTitle,
        }
      : {}),
    title: draft.title.trim(),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    revision: (existing?.revision ?? 0) + 1,
    completedAt:
      draft.status === 'completed' ? (existing?.completedAt ?? now) : null,
  };
  return { ...data, todos: put(data.todos, todo) };
}
export function changeTodoStatus(
  data: Data,
  id: string,
  revision: number,
  status: Todo['status'],
  now: number,
): Data {
  const todo = expected(data.todos, id, revision);
  return {
    ...data,
    todos: put(data.todos, {
      ...todo,
      status,
      completedAt: status === 'completed' ? now : null,
      updatedAt: now,
      revision: todo.revision + 1,
    }),
  };
}
export function deleteDeskRecord(
  data: Data,
  kind: 'note' | 'todo',
  id: string,
  revision: number,
  now: number,
): Data {
  const record = expected<DeskRecord>(
    kind === 'note' ? data.notes : data.todos,
    id,
    revision,
  );
  return {
    ...data,
    notes: kind === 'note' ? data.notes.filter((r) => r.id !== id) : data.notes,
    todos: kind === 'todo' ? data.todos.filter((r) => r.id !== id) : data.todos,
    deskTombstones: [
      ...data.deskTombstones,
      { kind, id, deletedAt: now, revision: record.revision + 1 },
    ],
  };
}
/** Retain notes and matters after deleting a relation; preserve its historical name. */
export function reconcileDeskLinks(data: Data, now: number): Data {
  function repair<T extends DeskRecord>(record: T): T {
    let { clientId, gardenId, zoneId, jobId } = record;
    const job = data.jobs.find((j) => j.id === jobId);
    if (jobId && !job) jobId = null;
    if (job) gardenId = job.gardenId;
    const garden = data.gardens.find((g) => g.id === gardenId);
    if (gardenId && !garden) gardenId = null;
    if (garden) clientId = garden.clientId;
    if (clientId && !data.clients.some((c) => c.id === clientId))
      clientId = null;
    if (zoneId && !garden?.zones.some((z) => z.id === zoneId)) zoneId = null;
    if (!clientId) {
      gardenId = null;
      zoneId = null;
      jobId = null;
    }
    const changed =
      clientId !== record.clientId ||
      gardenId !== record.gardenId ||
      zoneId !== record.zoneId ||
      jobId !== record.jobId;
    return changed
      ? {
          ...record,
          clientId,
          gardenId,
          zoneId,
          jobId,
          clientName:
            clientId !== record.clientId && clientId
              ? data.clients.find((c) => c.id === clientId)!.name.slice(0, 300)
              : record.clientName,
          gardenName:
            gardenId !== record.gardenId && gardenId
              ? garden!.name.slice(0, 300)
              : record.gardenName,
          updatedAt: now,
          revision: record.revision + 1,
        }
      : record;
  }
  const notes = data.notes.map((n) => {
    let note = repair(n);
    if (
      note.photoId &&
      !data.photos.some((p) => p.id === note.photoId && p.deletedAt === null)
    )
      note = {
        ...note,
        photoId: null,
        updatedAt: now,
        revision: note.revision + 1,
      };
    return note;
  });
  const todos = data.todos.map(repair);
  return notes.some((n, i) => n !== data.notes[i]) ||
    todos.some((t, i) => t !== data.todos[i])
    ? { ...data, notes, todos }
    : data;
}
