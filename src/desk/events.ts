import type { Data } from '../domain';
export interface DeskEvent {
  id: string;
  recordId: string;
  kind: 'reminder' | 'todo';
  date: string;
  time: string;
  title: string;
  status: 'planned' | 'completed' | 'cancelled';
  clientId: string | null;
  gardenId: string | null;
}
export const deskKindLabels = { reminder: 'Przypomnienie', todo: 'Sprawa' };
export function deskEventsBetween(
  data: Data,
  from: string,
  to: string,
): DeskEvent[] {
  const reminders: DeskEvent[] = data.notes
    .filter(
      (n) =>
        n.archivedAt === null &&
        n.reminder &&
        n.reminder.date >= from &&
        n.reminder.date <= to,
    )
    .map((n) => ({
      id: `reminder:${n.id}`,
      recordId: n.id,
      kind: 'reminder',
      date: n.reminder!.date,
      time: n.reminder!.time ?? '',
      title: n.title,
      status: n.reminder!.status === 'active' ? 'planned' : n.reminder!.status,
      clientId: n.clientId,
      gardenId: n.gardenId,
    }));
  const todos: DeskEvent[] = data.todos
    .filter((t) => t.dueDate && t.dueDate >= from && t.dueDate <= to)
    .map((t) => ({
      id: `todo:${t.id}`,
      recordId: t.id,
      kind: 'todo',
      date: t.dueDate!,
      time: t.dueTime ?? '',
      title: t.title,
      status: t.status === 'open' ? 'planned' : t.status,
      clientId: t.clientId,
      gardenId: t.gardenId,
    }));
  return [...reminders, ...todos];
}
