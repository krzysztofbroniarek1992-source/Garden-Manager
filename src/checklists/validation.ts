import type { Data } from '../domain';
import { checklistLimits as limits, itemStatusLabels } from './model';
export function validateChecklists(data: Data): void {
  const fail = (): never => {
    throw new Error(
      'Nieprawidłowe szablony lub checklisty. Oryginalny zapis nie został zmieniony.',
    );
  };
  const object = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === 'object' && !Array.isArray(v);
  const text = (v: unknown, max: number) =>
    typeof v === 'string' && v.length <= max;
  const title = (v: unknown, max: number) =>
    text(v, max) && (v as string).trim().length > 0;
  const id = (v: unknown) =>
    typeof v === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(v);
  const timestamp = (v: unknown) =>
    Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= 8.64e15;
  const revision = (v: unknown) =>
    Number.isSafeInteger(v) && (v as number) >= 1;
  const common = (v: unknown) =>
    object(v) &&
    id(v.id) &&
    title(v.name, limits.title) &&
    text(v.description, limits.description) &&
    title(v.category, limits.category) &&
    timestamp(v.createdAt) &&
    timestamp(v.updatedAt) &&
    revision(v.revision);
  const item = (v: unknown) =>
    object(v) && id(v.id) && title(v.title, limits.title);
  if (
    !Array.isArray(data.workTemplates) ||
    !Array.isArray(data.checklists) ||
    !Array.isArray(data.checklistTombstones)
  )
    fail();
  for (const t of data.workTemplates)
    if (
      !common(t) ||
      !(t.archivedAt === null || timestamp(t.archivedAt)) ||
      !Array.isArray(t.items) ||
      !t.items.length ||
      t.items.length > limits.templateItems ||
      !t.items.every(item) ||
      new Set(t.items.map((i) => i.id)).size !== t.items.length
    )
      fail();
  for (const c of data.checklists) {
    if (
      !common(c) ||
      !['plan', 'visit'].includes(c.kind) ||
      !text(c.gardenName, 300) ||
      !(c.zoneName === null || text(c.zoneName, 300)) ||
      !(c.jobTitle === null || text(c.jobTitle, 300)) ||
      !(c.assignmentKey === null || title(c.assignmentKey, 1000)) ||
      !(c.sourcePlanId === null || id(c.sourcePlanId)) ||
      !(c.templateId === null
        ? c.templateName === null && c.templateRevision === null
        : id(c.templateId) &&
          title(c.templateName, limits.title) &&
          revision(c.templateRevision)) ||
      !Array.isArray(c.items) ||
      c.items.length > limits.items
    )
      fail();
    const garden = data.gardens.find((g) => g.id === c.gardenId),
      job = data.jobs.find((j) => j.id === c.jobId);
    if (
      !(c.gardenId === null || garden) ||
      !(c.zoneId === null || garden?.zones.some((z) => z.id === c.zoneId)) ||
      !(c.jobId === null || (job && job.gardenId === c.gardenId)) ||
      (c.kind === 'plan' && c.jobId !== null)
    )
      fail();
    for (const i of c.items)
      if (
        !item(i) ||
        !Object.hasOwn(itemStatusLabels, i.status) ||
        !text(i.note, limits.note) ||
        !timestamp(i.createdAt) ||
        !timestamp(i.updatedAt) ||
        !revision(i.revision) ||
        !(i.status === 'done'
          ? timestamp(i.completedAt)
          : i.completedAt === null) ||
        !(
          i.photoId === null ||
          data.photos.some((p) => p.id === i.photoId && p.deletedAt === null)
        ) ||
        !(i.photoName === null || text(i.photoName, 200))
      )
        fail();
    if (new Set(c.items.map((i) => i.id)).size !== c.items.length) fail();
  }
  for (const t of data.checklistTombstones)
    if (
      !object(t) ||
      !id(t.id) ||
      !['template', 'checklist'].includes(t.kind) ||
      !timestamp(t.deletedAt) ||
      !revision(t.revision) ||
      (t.kind === 'template' ? data.workTemplates : data.checklists).some(
        (r) => r.id === t.id,
      )
    )
      fail();
  for (const s of data.taskSchedules)
    if (
      s.checklistTemplateId !== undefined &&
      s.checklistTemplateId !== null &&
      !data.workTemplates.some((t) => t.id === s.checklistTemplateId)
    )
      fail();
  if (
    new Set(data.workTemplates.map((t) => t.id)).size !==
      data.workTemplates.length ||
    new Set(data.checklists.map((c) => c.id)).size !== data.checklists.length ||
    new Set(
      data.checklists
        .filter((c) => c.assignmentKey !== null)
        .map((c) => c.assignmentKey),
    ).size !== data.checklists.filter((c) => c.assignmentKey !== null).length ||
    new Set(data.checklistTombstones.map((t) => `${t.kind}:${t.id}`)).size !==
      data.checklistTombstones.length
  )
    fail();
}
