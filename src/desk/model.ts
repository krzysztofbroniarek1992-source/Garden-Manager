import type { Data } from '../domain';
import { localDate } from '../domain';
import { isDate } from '../planning/dates';

export const noteCategories = {
  observation: 'Obserwacja',
  problem: 'Problem',
  idea: 'Pomysł',
  care: 'Zalecenie pielęgnacyjne',
  contact: 'Kontakt z klientem',
  other: 'Inne',
} as const;
export const priorities = {
  low: 'Niski',
  normal: 'Normalny',
  high: 'Wysoki',
  urgent: 'Pilny',
} as const;
export type Priority = keyof typeof priorities;
export type ReminderStatus = 'active' | 'completed' | 'cancelled';
export interface DeskScope {
  clientId: string | null;
  gardenId: string | null;
  zoneId: string | null;
  jobId: string | null;
}
export interface DeskRecord extends DeskScope {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  revision: number;
  priority: Priority | null;
  clientName: string | null;
  gardenName: string | null;
  zoneName: string | null;
  jobTitle: string | null;
}
export interface NoteReminder {
  date: string;
  time: string | null;
  status: ReminderStatus;
  completedAt: number | null;
}
export interface Note extends DeskRecord {
  body: string;
  category: keyof typeof noteCategories | null;
  archivedAt: number | null;
  reminder: NoteReminder | null;
  photoId: string | null;
  photoName: string | null;
}
export interface Todo extends DeskRecord {
  description: string;
  dueDate: string | null;
  dueTime: string | null;
  status: 'open' | 'completed' | 'cancelled';
  completedAt: number | null;
}
export interface DeskTombstone {
  id: string;
  kind: 'note' | 'todo';
  deletedAt: number;
  revision: number;
}
export const emptyScope: DeskScope = {
  clientId: null,
  gardenId: null,
  zoneId: null,
  jobId: null,
};
export const reminderLabels = {
  active: 'Aktywne',
  completed: 'Wykonane',
  cancelled: 'Anulowane',
} as const;
export const todoLabels = {
  open: 'Do zrobienia',
  completed: 'Wykonane',
  cancelled: 'Anulowane',
} as const;
export type DeadlineGroup = 'today' | 'upcoming' | 'overdue' | 'none';
export function deadlineGroup(
  date: string | null,
  time: string | null,
  now = new Date(),
): DeadlineGroup {
  if (!date) return 'none';
  const today = localDate(now),
    clock = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  if (date < today || (date === today && time !== null && time < clock))
    return 'overdue';
  return date === today ? 'today' : 'upcoming';
}
export function resolveDeskScope(data: Data, scope: DeskScope) {
  const job = scope.jobId
    ? data.jobs.find((j) => j.id === scope.jobId)
    : undefined;
  const garden = data.gardens.find(
    (g) => g.id === (job?.gardenId ?? scope.gardenId),
  );
  const client = data.clients.find(
    (c) => c.id === (garden?.clientId ?? scope.clientId),
  );
  const zone = scope.zoneId
    ? garden?.zones.find((z) => z.id === scope.zoneId)
    : undefined;
  if (
    (scope.jobId && !job) ||
    (scope.gardenId && (!garden || garden.id !== scope.gardenId)) ||
    (scope.clientId && (!client || client.id !== scope.clientId)) ||
    (scope.zoneId && !zone)
  )
    throw new Error(
      'Wybierz zgodne powiązania klienta, ogrodu, strefy i zlecenia.',
    );
  return {
    clientId: client?.id ?? null,
    gardenId: garden?.id ?? null,
    zoneId: zone?.id ?? null,
    jobId: job?.id ?? null,
    clientName: client?.name.slice(0, 300) ?? null,
    gardenName: garden?.name.slice(0, 300) ?? null,
    zoneName: zone?.name.slice(0, 300) ?? null,
    jobTitle: job?.title.slice(0, 300) ?? null,
  };
}
export const matchesDeskScope = (
  record: DeskScope,
  scope: Partial<DeskScope>,
) =>
  Object.entries(scope).every(
    ([key, value]) => !value || record[key as keyof DeskScope] === value,
  );
export function newNote(
  data: Data,
  scope: Partial<DeskScope> = {},
  reminderDate?: string,
  photoId: string | null = null,
): Note {
  return {
    id: crypto.randomUUID(),
    title: '',
    body: '',
    category: null,
    priority: 'normal',
    createdAt: 0,
    updatedAt: 0,
    revision: 0,
    ...resolveDeskScope(data, { ...emptyScope, ...scope }),
    archivedAt: null,
    photoId,
    photoName: data.photos.find((p) => p.id === photoId)?.filename ?? null,
    reminder: reminderDate
      ? { date: reminderDate, time: null, status: 'active', completedAt: null }
      : null,
  };
}
export function newTodo(
  data: Data,
  scope: Partial<DeskScope> = {},
  date: string | null = null,
): Todo {
  return {
    id: crypto.randomUUID(),
    title: '',
    description: '',
    priority: 'normal',
    createdAt: 0,
    updatedAt: 0,
    revision: 0,
    ...resolveDeskScope(data, { ...emptyScope, ...scope }),
    dueDate: date,
    dueTime: null,
    status: 'open',
    completedAt: null,
  };
}
export function validateDeskData(data: Data) {
  const fail = (): never => {
    throw new Error(
      'Nieprawidłowe notatki, przypomnienia lub sprawy. Oryginalny zapis nie został zmieniony.',
    );
  };
  const id = (v: unknown): v is string =>
    typeof v === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(v);
  const timestamp = (v: unknown) =>
    Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= 8.64e15;
  const optionalTime = (v: unknown) =>
    v === null ||
    (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v));
  const text = (v: unknown, max: number) =>
    typeof v === 'string' && v.length <= max;
  const common = (r: DeskRecord) => {
    if (
      !r ||
      typeof r !== 'object' ||
      !id(r.id) ||
      !text(r.title, 150) ||
      !r.title.trim() ||
      !timestamp(r.createdAt) ||
      !timestamp(r.updatedAt) ||
      !Number.isSafeInteger(r.revision) ||
      r.revision < 1 ||
      !(r.priority === null || Object.hasOwn(priorities, r.priority)) ||
      ![r.clientName, r.gardenName, r.zoneName, r.jobTitle].every(
        (v) => v === null || text(v, 300),
      ) ||
      ![r.clientId, r.gardenId, r.zoneId, r.jobId].every(
        (v) => v === null || (typeof v === 'string' && v.trim()),
      )
    )
      fail();
    const resolved = resolveDeskScope(data, r);
    if (
      (['clientId', 'gardenId', 'zoneId', 'jobId'] as const).some(
        (key) => r[key] !== resolved[key],
      )
    )
      fail();
  };
  if (
    !Array.isArray(data.notes) ||
    !Array.isArray(data.todos) ||
    !Array.isArray(data.deskTombstones)
  )
    fail();
  for (const note of data.notes) {
    common(note);
    if (
      !text(note.body, 10000) ||
      !(
        note.category === null || Object.hasOwn(noteCategories, note.category)
      ) ||
      !(note.archivedAt === null || timestamp(note.archivedAt)) ||
      !(
        note.photoId === null ||
        (typeof note.photoId === 'string' &&
          data.photos.some(
            (p) => p.id === note.photoId && p.deletedAt === null,
          ))
      ) ||
      !(note.photoName === null || text(note.photoName, 200))
    )
      fail();
    if (note.reminder !== null) {
      const r = note.reminder;
      if (
        !r ||
        !isDate(r.date) ||
        !optionalTime(r.time) ||
        !Object.hasOwn(reminderLabels, r.status) ||
        !(r.status === 'completed'
          ? timestamp(r.completedAt)
          : r.completedAt === null)
      )
        fail();
    }
  }
  for (const todo of data.todos) {
    common(todo);
    if (
      !text(todo.description, 10000) ||
      !(todo.dueDate === null || isDate(todo.dueDate)) ||
      !optionalTime(todo.dueTime) ||
      (todo.dueDate === null && todo.dueTime !== null) ||
      !Object.hasOwn(todoLabels, todo.status) ||
      !(todo.status === 'completed'
        ? timestamp(todo.completedAt)
        : todo.completedAt === null)
    )
      fail();
  }
  for (const t of data.deskTombstones)
    if (
      !t ||
      !id(t.id) ||
      !['note', 'todo'].includes(t.kind) ||
      !timestamp(t.deletedAt) ||
      !Number.isSafeInteger(t.revision) ||
      t.revision < 1 ||
      (t.kind === 'note' ? data.notes : data.todos).some((r) => r.id === t.id)
    )
      fail();
  if (
    new Set(data.notes.map((n) => n.id)).size !== data.notes.length ||
    new Set(data.todos.map((n) => n.id)).size !== data.todos.length ||
    new Set(data.deskTombstones.map((t) => `${t.kind}:${t.id}`)).size !==
      data.deskTombstones.length
  )
    fail();
}
