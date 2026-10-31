import type { Data } from '../domain';

export interface TemplateItem {
  id: string;
  title: string;
}
export interface WorkTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  items: TemplateItem[];
  createdAt: number;
  updatedAt: number;
  revision: number;
  archivedAt: number | null;
}
export type ItemStatus = 'pending' | 'done' | 'not-applicable';
export const itemStatusLabels = {
  pending: 'Do wykonania',
  done: 'Wykonane',
  'not-applicable': 'Nie dotyczy',
} as const;
export interface ChecklistItem extends TemplateItem {
  status: ItemStatus;
  note: string;
  completedAt: number | null;
  photoId: string | null;
  photoName: string | null;
  createdAt: number;
  updatedAt: number;
  revision: number;
}
export type ChecklistTarget =
  | { kind: 'visit'; jobId: string; zoneId?: string | null }
  | { kind: 'plan'; gardenId: string; zoneId: string | null };
export interface Checklist {
  id: string;
  kind: 'plan' | 'visit';
  name: string;
  description: string;
  category: string;
  jobId: string | null;
  gardenId: string | null;
  zoneId: string | null;
  gardenName: string;
  zoneName: string | null;
  jobTitle: string | null;
  templateId: string | null;
  templateName: string | null;
  templateRevision: number | null;
  sourcePlanId: string | null;
  assignmentKey: string | null;
  items: ChecklistItem[];
  createdAt: number;
  updatedAt: number;
  revision: number;
}
export interface ChecklistTombstone {
  id: string;
  kind: 'template' | 'checklist';
  deletedAt: number;
  revision: number;
}
export const checklistLimits = {
  templateItems: 200,
  items: 500,
  title: 150,
  description: 5000,
  note: 2000,
  category: 100,
};
export function checklistProgress(items: ChecklistItem[]) {
  const total = items.filter((i) => i.status !== 'not-applicable').length;
  const done = items.filter((i) => i.status === 'done').length;
  return {
    done,
    total,
    excluded: items.length - total,
    percent: total ? (done / total) * 100 : null,
  };
}
export function incompleteVisitChecklists(data: Data, jobId: string) {
  return data.checklists.filter(
    (c) =>
      c.kind === 'visit' &&
      c.jobId === jobId &&
      (!c.items.length || c.items.some((i) => i.status === 'pending')),
  );
}
export function resolveChecklistTarget(data: Data, target: ChecklistTarget) {
  const job =
    target.kind === 'visit'
      ? data.jobs.find((j) => j.id === target.jobId)
      : undefined;
  const garden = data.gardens.find(
    (g) => g.id === (target.kind === 'plan' ? target.gardenId : job?.gardenId),
  );
  const zone = target.zoneId
    ? garden?.zones.find((z) => z.id === target.zoneId)
    : undefined;
  if (!garden || (target.kind === 'visit' && !job) || (target.zoneId && !zone))
    throw new Error('Wybierz istniejący ogród, strefę lub wizytę.');
  return {
    kind: target.kind,
    gardenId: garden.id,
    jobId: job?.id ?? null,
    zoneId: zone?.id ?? null,
    gardenName: garden.name.slice(0, 300),
    zoneName: zone?.name.slice(0, 300) ?? null,
    jobTitle: job?.title.slice(0, 300) ?? null,
  };
}
export function newWorkTemplate(): WorkTemplate {
  return {
    id: crypto.randomUUID(),
    name: '',
    description: '',
    category: 'Inne',
    items: [{ id: crypto.randomUUID(), title: '' }],
    createdAt: 0,
    updatedAt: 0,
    revision: 0,
    archivedAt: null,
  };
}
export function newChecklistItem(title: string, now: number): ChecklistItem {
  return {
    id: crypto.randomUUID(),
    title: title.trim(),
    status: 'pending',
    note: '',
    completedAt: null,
    photoId: null,
    photoName: null,
    createdAt: now,
    updatedAt: now,
    revision: 1,
  };
}
