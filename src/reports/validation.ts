import type { Data } from '../domain';
import { isDate } from '../planning/dates';
import { itemStatusLabels } from '../checklists/model';
import {
  reportLimits,
  timeEventLabels,
  type ReportOptions,
  type ReportSnapshot,
} from './model';
const fail = (): never => {
  throw new Error(
    'Nieprawidłowe podsumowanie wizyty lub historia raportów. Oryginalny zapis nie został zmieniony.',
  );
};
const obj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: unknown, names: string[]) =>
  obj(v) &&
  Object.keys(v).length === names.length &&
  names.every((k) => Object.hasOwn(v, k));
const text = (v: unknown, max: number) =>
  typeof v === 'string' && v.length <= max;
const id = (v: unknown) =>
  typeof v === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(v);
const num = (v: unknown) =>
  typeof v === 'number' &&
  Number.isFinite(v) &&
  v >= 0 &&
  v <= Number.MAX_SAFE_INTEGER;
const integer = (v: unknown) => num(v) && Number.isSafeInteger(v);
const stamp = (v: unknown) => integer(v) && (v as number) <= 8.64e15;
const rev = (v: unknown) => integer(v) && (v as number) >= 1;
export function validateReportOptions(o: ReportOptions) {
  if (
    !keys(o, [
      'showTime',
      'showFinance',
      'showMaterials',
      'showChecklists',
      'showPhotos',
      'showRemarks',
      'photoIds',
      'logoPhotoId',
    ]) ||
    ![
      o.showTime,
      o.showFinance,
      o.showMaterials,
      o.showChecklists,
      o.showPhotos,
      o.showRemarks,
    ].every((v) => typeof v === 'boolean') ||
    !Array.isArray(o.photoIds) ||
    o.photoIds.length > reportLimits.photos ||
    !o.photoIds.every(id) ||
    new Set(o.photoIds).size !== o.photoIds.length ||
    !(o.logoPhotoId === null || id(o.logoPhotoId))
  )
    fail();
}
export function validateReportSnapshot(s: ReportSnapshot, o: ReportOptions) {
  validateReportOptions(o);
  if (
    !keys(s, [
      'company',
      'clientName',
      'gardenName',
      'address',
      'zoneName',
      'visitDate',
      'workDescription',
      'time',
      'materials',
      'checklists',
      'remarks',
      'finance',
      'photos',
      'logo',
    ]) ||
    s.company !== 'BRONIAREK OGRODY' ||
    !text(s.clientName, 300) ||
    !text(s.gardenName, 300) ||
    !text(s.address, 1000) ||
    !(s.zoneName === null || text(s.zoneName, 300)) ||
    !isDate(s.visitDate) ||
    !text(s.workDescription, reportLimits.workText) ||
    !s.workDescription.trim()
  )
    fail();
  if (o.showTime) {
    const t = s.time;
    if (
      !keys(t, [
        'workSeconds',
        'recordedPauseMs',
        'historySince',
        'corrections',
      ]) ||
      !t ||
      !num(t.workSeconds) ||
      !integer(t.recordedPauseMs) ||
      !(t.historySince === null || stamp(t.historySince)) ||
      !Array.isArray(t.corrections) ||
      t.corrections.some(
        (c) =>
          !keys(c, ['at', 'beforeSeconds', 'afterSeconds']) ||
          !stamp(c.at) ||
          !num(c.beforeSeconds) ||
          !num(c.afterSeconds),
      )
    )
      fail();
  } else if (s.time !== null) fail();
  if (o.showMaterials) {
    if (
      !Array.isArray(s.materials) ||
      s.materials.some(
        (m) =>
          !keys(m, ['name', 'quantity', 'unit']) ||
          !text(m.name, 300) ||
          !num(m.quantity) ||
          !text(m.unit, 30),
      )
    )
      fail();
  } else if (s.materials !== null) fail();
  if (o.showChecklists) {
    if (
      !Array.isArray(s.checklists) ||
      s.checklists.reduce(
        (sum, c) =>
          sum +
          (Array.isArray(c?.items)
            ? c.items.length
            : reportLimits.checklistItems + 1),
        0,
      ) > reportLimits.checklistItems
    )
      fail();
    for (const c of s.checklists!) {
      if (
        !keys(c, ['name', 'items']) ||
        !text(c.name, 150) ||
        !Array.isArray(c.items) ||
        c.items.some(
          (i) =>
            !keys(i, ['title', 'status', 'completedAt']) ||
            !text(i.title, 150) ||
            !Object.hasOwn(itemStatusLabels, i.status) ||
            !(i.status === 'done'
              ? stamp(i.completedAt)
              : i.completedAt === null),
        )
      )
        fail();
    }
  } else if (s.checklists !== null) fail();
  if (
    o.showRemarks ? !text(s.remarks, reportLimits.remarks) : s.remarks !== null
  )
    fail();
  if (o.showFinance) {
    const f = s.finance;
    if (
      !keys(f, [
        'laborCents',
        'materialsCents',
        'totalCents',
        'paidCents',
        'remainingCents',
        'billing',
      ]) ||
      !f ||
      ![
        f.laborCents,
        f.materialsCents,
        f.totalCents,
        f.paidCents,
        f.remainingCents,
      ].every(integer) ||
      !['hourly', 'fixed'].includes(f.billing) ||
      f.laborCents + f.materialsCents !== f.totalCents ||
      f.totalCents - f.paidCents !== f.remainingCents
    )
      fail();
  } else if (s.finance !== null) fail();
  const image = (p: ReportSnapshot['logo'], logo: boolean) =>
    p &&
    keys(p, [
      'photoId',
      'sha256',
      'width',
      'height',
      'size',
      'category',
      'date',
    ]) &&
    id(p.photoId) &&
    typeof p.sha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(p.sha256) &&
    [p.width, p.height].every(
      (n) => Number.isInteger(n) && n > 0 && n <= 1920,
    ) &&
    integer(p.size) &&
    p.size > 0 &&
    p.size <= 3 * 1024 ** 2 &&
    (logo
      ? p.category === 'other'
      : ['before', 'after'].includes(p.category)) &&
    isDate(p.date);
  if (
    !Array.isArray(s.photos) ||
    s.photos.length > reportLimits.photos ||
    s.photos.some((p) => !image(p, false)) ||
    (!o.showPhotos && s.photos.length) ||
    (o.showPhotos &&
      JSON.stringify(s.photos.map((p) => p.photoId)) !==
        JSON.stringify(o.photoIds)) ||
    !(o.logoPhotoId === null
      ? s.logo === null
      : image(s.logo, true) && s.logo!.photoId === o.logoPhotoId) ||
    [...s.photos, ...(s.logo ? [s.logo] : [])].reduce(
      (sum, p) => sum + p.size,
      0,
    ) > reportLimits.imageBytes
  )
    fail();
}
export function validateReports(data: Data) {
  if (!integer(data.reportSequence)) fail();
  const ids = new Set<string>(),
    families = new Map<string, string>();
  let maxSequence = 0;
  for (const j of data.jobs) {
    const v = j.visitDetails;
    if (
      v !== undefined &&
      (!keys(v, [
        'publicWork',
        'clientRemarks',
        'zoneId',
        'zoneName',
        'updatedAt',
        'revision',
      ]) ||
        !text(v.publicWork, reportLimits.workText) ||
        !text(v.clientRemarks, reportLimits.remarks) ||
        !(
          v.zoneId === null ||
          data.gardens
            .find((g) => g.id === j.gardenId)
            ?.zones.some((z) => z.id === v.zoneId)
        ) ||
        !(v.zoneName === null || text(v.zoneName, 300)) ||
        !stamp(v.updatedAt) ||
        !rev(v.revision))
    )
      fail();
    if (j.timeHistory !== undefined) {
      if (!Array.isArray(j.timeHistory)) fail();
      for (const e of j.timeHistory!) {
        if (
          !keys(e, [
            'id',
            'kind',
            'at',
            'beforeSeconds',
            'afterSeconds',
            'pauseDurationMs',
          ]) ||
          !id(e.id) ||
          ids.has(e.id) ||
          !Object.hasOwn(timeEventLabels, e.kind) ||
          !stamp(e.at) ||
          !num(e.beforeSeconds) ||
          !num(e.afterSeconds) ||
          !(e.pauseDurationMs === null || integer(e.pauseDurationMs))
        )
          fail();
        ids.add(e.id);
      }
    }
    if (j.reports !== undefined) {
      if (!Array.isArray(j.reports)) fail();
      for (const [index, r] of j.reports!.entries()) {
        if (
          !keys(r, [
            'id',
            'number',
            'version',
            'generatedAt',
            'rendererVersion',
            'fingerprint',
            'options',
            'snapshot',
          ]) ||
          !id(r.id) ||
          ids.has(r.id) ||
          typeof r.number !== 'string' ||
          !/^BO\/\d{4}\/\d{6,16}$/.test(r.number) ||
          r.version !== index + 1 ||
          !stamp(r.generatedAt) ||
          r.rendererVersion !== 1 ||
          typeof r.fingerprint !== 'string' ||
          !/^[a-f0-9]{64}$/.test(r.fingerprint) ||
          r.number !== j.reports![0].number
        )
          fail();
        ids.add(r.id);
        const owner = families.get(r.number);
        if (owner && owner !== j.id) fail();
        families.set(r.number, j.id);
        maxSequence = Math.max(maxSequence, Number(r.number.split('/')[2]));
        validateReportSnapshot(r.snapshot, r.options);
      }
    }
  }
  if (data.reportSequence < maxSequence) fail();
}
