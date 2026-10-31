import type { Data } from '../domain';
import {
  newChecklistItem,
  resolveChecklistTarget,
  type Checklist,
  type ChecklistItem,
  type ChecklistTarget,
  type WorkTemplate,
} from './model';
const conflict = () =>
  new Error(
    'Checklista lub szablon zmieniły się w innej karcie. Otwórz aktualny wpis i spróbuj ponownie.',
  );
const put = <T extends { id: string }>(rows: T[], row: T) =>
  rows.some((r) => r.id === row.id)
    ? rows.map((r) => (r.id === row.id ? row : r))
    : [...rows, row];
function current<T extends { id: string; revision: number }>(
  rows: T[],
  id: string,
  revision: number,
) {
  const row = rows.find((r) => r.id === id);
  if (!row || row.revision !== revision) throw conflict();
  return row;
}
const touch = <T extends { revision: number; updatedAt: number }>(
  row: T,
  now: number,
): T => ({ ...row, revision: row.revision + 1, updatedAt: now });
export function saveWorkTemplate(
  data: Data,
  draft: WorkTemplate,
  now: number,
): Data {
  const old = data.workTemplates.find((t) => t.id === draft.id);
  if (
    data.checklistTombstones.some(
      (t) => t.kind === 'template' && t.id === draft.id,
    ) ||
    (old && old.revision !== draft.revision) ||
    (!old && draft.revision !== 0)
  )
    throw conflict();
  const next = {
    ...draft,
    name: draft.name.trim(),
    category: draft.category.trim(),
    items: draft.items.map((i) => ({ ...i, title: i.title.trim() })),
    createdAt: old?.createdAt ?? now,
    updatedAt: now,
    revision: (old?.revision ?? 0) + 1,
    archivedAt: old?.archivedAt ?? null,
  };
  return { ...data, workTemplates: put(data.workTemplates, next) };
}
export function copyWorkTemplate(
  data: Data,
  id: string,
  revision: number,
  now: number,
): { data: Data; id: string } {
  const source = current(data.workTemplates, id, revision),
    copy = {
      ...source,
      id: crypto.randomUUID(),
      name: `${source.name.slice(0, 140)} — kopia`,
      items: source.items.map((i) => ({ ...i, id: crypto.randomUUID() })),
      revision: 0,
      archivedAt: null,
    };
  return { data: saveWorkTemplate(data, copy, now), id: copy.id };
}
export function archiveWorkTemplate(
  data: Data,
  id: string,
  revision: number,
  archived: boolean,
  now: number,
): Data {
  const t = current(data.workTemplates, id, revision);
  return {
    ...data,
    workTemplates: put(
      data.workTemplates,
      touch({ ...t, archivedAt: archived ? now : null }, now),
    ),
  };
}
export function deleteWorkTemplate(
  data: Data,
  id: string,
  revision: number,
  now: number,
): Data {
  const t = current(data.workTemplates, id, revision);
  return {
    ...data,
    workTemplates: data.workTemplates.filter((t) => t.id !== id),
    checklistTombstones: [
      ...data.checklistTombstones,
      { id, kind: 'template', revision: t.revision + 1, deletedAt: now },
    ],
    taskSchedules: data.taskSchedules.map((s) =>
      s.checklistTemplateId === id
        ? {
            ...s,
            checklistTemplateId: null,
            revision: s.revision + 1,
            updatedAt: now,
          }
        : s,
    ),
  };
}
function create(
  data: Data,
  target: ChecklistTarget,
  name: string,
  description: string,
  category: string,
  items: ChecklistItem[],
  now: number,
  source: Pick<
    Checklist,
    | 'templateId'
    | 'templateName'
    | 'templateRevision'
    | 'sourcePlanId'
    | 'assignmentKey'
  >,
): { data: Data; id: string } {
  const scope = resolveChecklistTarget(data, target);
  const existing = source.assignmentKey
    ? data.checklists.find((c) => c.assignmentKey === source.assignmentKey)
    : undefined;
  if (existing) return { data, id: existing.id };
  const next: Checklist = {
    id: crypto.randomUUID(),
    ...scope,
    name: name.trim(),
    description,
    category: category.trim(),
    items,
    ...source,
    createdAt: now,
    updatedAt: now,
    revision: 1,
  };
  return {
    data: { ...data, checklists: [...data.checklists, next] },
    id: next.id,
  };
}
export function createBlankChecklist(
  data: Data,
  target: ChecklistTarget,
  name: string,
  now: number,
) {
  return create(data, target, name, '', 'Inne', [], now, {
    templateId: null,
    templateName: null,
    templateRevision: null,
    sourcePlanId: null,
    assignmentKey: null,
  });
}
export function applyWorkTemplate(
  data: Data,
  id: string,
  target: ChecklistTarget,
  now: number,
) {
  const scope = resolveChecklistTarget(data, target),
    key = JSON.stringify(
      scope.kind === 'visit'
        ? [scope.kind, scope.jobId, 'template', id]
        : [scope.kind, scope.gardenId, scope.zoneId, 'template', id],
    );
  const existing = data.checklists.find((c) => c.assignmentKey === key);
  if (existing) return { data, id: existing.id };
  const source = data.workTemplates.find(
    (t) => t.id === id && t.archivedAt === null,
  );
  if (!source)
    throw new Error(
      'Szablon został usunięty lub zarchiwizowany. Wybierz aktywny szablon.',
    );
  return create(
    data,
    target,
    source.name,
    source.description,
    source.category,
    source.items.map((i) => newChecklistItem(i.title, now)),
    now,
    {
      templateId: id,
      templateName: source.name,
      templateRevision: source.revision,
      sourcePlanId: null,
      assignmentKey: key,
    },
  );
}
export function applyGardenPlan(
  data: Data,
  planId: string,
  jobId: string,
  now: number,
) {
  const plan = data.checklists.find(
      (c) => c.id === planId && c.kind === 'plan',
    ),
    job = data.jobs.find((j) => j.id === jobId);
  if (!plan || !job || plan.gardenId !== job.gardenId)
    throw new Error('Wybierz plan tego ogrodu.');
  return create(
    data,
    { kind: 'visit', jobId, zoneId: plan.zoneId },
    plan.name,
    plan.description,
    plan.category,
    plan.items.map((i) => ({
      ...newChecklistItem(i.title, now),
      note: i.note,
      photoId: i.photoId,
      photoName: i.photoName,
    })),
    now,
    {
      templateId: plan.templateId,
      templateName: plan.templateName,
      templateRevision: plan.templateRevision,
      sourcePlanId: plan.id,
      assignmentKey: JSON.stringify(['visit', jobId, 'plan', planId]),
    },
  );
}
export function editChecklist(
  data: Data,
  id: string,
  revision: number,
  patch: Partial<Pick<Checklist, 'name' | 'description' | 'category'>>,
  now: number,
): Data {
  const c = current(data.checklists, id, revision);
  return {
    ...data,
    checklists: put(
      data.checklists,
      touch(
        {
          ...c,
          ...patch,
          name: patch.name?.trim() ?? c.name,
          category: patch.category?.trim() ?? c.category,
        },
        now,
      ),
    ),
  };
}
export function addChecklistItem(
  data: Data,
  id: string,
  revision: number,
  title: string,
  now: number,
): Data {
  const c = current(data.checklists, id, revision);
  return {
    ...data,
    checklists: put(
      data.checklists,
      touch({ ...c, items: [...c.items, newChecklistItem(title, now)] }, now),
    ),
  };
}
export function editChecklistItem(
  data: Data,
  id: string,
  revision: number,
  itemId: string,
  patch: Partial<Pick<ChecklistItem, 'title' | 'note' | 'status' | 'photoId'>>,
  now: number,
): Data {
  const c = current(data.checklists, id, revision),
    item = c.items.find((i) => i.id === itemId);
  if (!item) throw conflict();
  const photoId = patch.photoId === undefined ? item.photoId : patch.photoId,
    photo = data.photos.find((p) => p.id === photoId && p.deletedAt === null);
  if (photoId && !photo)
    throw new Error('Zdjęcie zostało usunięte. Wybierz inne zdjęcie.');
  const status = patch.status ?? item.status;
  const next = touch(
    {
      ...item,
      ...patch,
      title: patch.title?.trim() ?? item.title,
      status,
      completedAt:
        status === 'done'
          ? item.status === 'done'
            ? item.completedAt
            : now
          : null,
      photoId,
      photoName:
        photo?.filename ?? (photoId === item.photoId ? item.photoName : null),
    },
    now,
  );
  return {
    ...data,
    checklists: put(
      data.checklists,
      touch({ ...c, items: put(c.items, next) }, now),
    ),
  };
}
export function moveChecklistItem(
  data: Data,
  id: string,
  revision: number,
  itemId: string,
  direction: -1 | 1,
  now: number,
): Data {
  const c = current(data.checklists, id, revision),
    index = c.items.findIndex((i) => i.id === itemId),
    items = [...c.items];
  if (index < 0 || index + direction < 0 || index + direction >= items.length)
    throw new Error('Nie można przesunąć tej czynności.');
  [items[index], items[index + direction]] = [
    items[index + direction],
    items[index],
  ];
  return {
    ...data,
    checklists: put(data.checklists, touch({ ...c, items }, now)),
  };
}
export function removeChecklistItem(
  data: Data,
  id: string,
  revision: number,
  itemId: string,
  now: number,
): Data {
  const c = current(data.checklists, id, revision);
  if (!c.items.some((i) => i.id === itemId)) throw conflict();
  return {
    ...data,
    checklists: put(
      data.checklists,
      touch({ ...c, items: c.items.filter((i) => i.id !== itemId) }, now),
    ),
  };
}
export function deleteChecklist(
  data: Data,
  id: string,
  revision: number,
  now: number,
): Data {
  const c = current(data.checklists, id, revision);
  return {
    ...data,
    checklists: data.checklists.filter((c) => c.id !== id),
    checklistTombstones: [
      ...data.checklistTombstones,
      { id, kind: 'checklist', revision: c.revision + 1, deletedAt: now },
    ],
  };
}
/** Keep independent history after relation deletion and detach deleted photo IDs. */
export function reconcileChecklistLinks(data: Data, now: number): Data {
  const checklists = data.checklists.map((c) => {
    const job = data.jobs.find((j) => j.id === c.jobId),
      jobId = job?.id ?? null;
    const garden = data.gardens.find(
        (g) => g.id === (job?.gardenId ?? c.gardenId),
      ),
      gardenId = garden?.id ?? null;
    const zoneId =
      c.zoneId && garden?.zones.some((z) => z.id === c.zoneId)
        ? c.zoneId
        : null;
    let changed =
      jobId !== c.jobId || gardenId !== c.gardenId || zoneId !== c.zoneId;
    const items = c.items.map((i) => {
      if (
        i.photoId &&
        !data.photos.some((p) => p.id === i.photoId && p.deletedAt === null)
      ) {
        changed = true;
        return touch({ ...i, photoId: null }, now);
      }
      return i;
    });
    return changed
      ? touch(
          {
            ...c,
            jobId,
            gardenId,
            zoneId,
            gardenName:
              gardenId !== c.gardenId && garden
                ? garden.name.slice(0, 300)
                : c.gardenName,
            items,
          },
          now,
        )
      : c;
  });
  return checklists.some((c, i) => c !== data.checklists[i])
    ? { ...data, checklists }
    : data;
}
