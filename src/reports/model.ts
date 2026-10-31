import {
  elapsedSeconds,
  jobTotalCents,
  paidCents,
  remainingCents,
  type Data,
  type Job,
} from '../domain';
import { photoDate, type PhotoMetadata } from '../photos/model';
import type { ItemStatus } from '../checklists/model';

export interface VisitDetails {
  publicWork: string;
  clientRemarks: string;
  zoneId: string | null;
  zoneName: string | null;
  updatedAt: number;
  revision: number;
}
export type TimeEventKind =
  'started' | 'paused' | 'resumed' | 'stopped' | 'completed' | 'corrected';
export interface VisitTimeEvent {
  id: string;
  kind: TimeEventKind;
  at: number;
  beforeSeconds: number;
  afterSeconds: number;
  pauseDurationMs: number | null;
}
export const timeEventLabels: Record<TimeEventKind, string> = {
  started: 'Rozpoczęcie pomiaru',
  paused: 'Pauza',
  resumed: 'Wznowienie pomiaru',
  stopped: 'Zatrzymanie pomiaru',
  completed: 'Zakończenie wizyty',
  corrected: 'Ręczna korekta czasu',
};
export interface ReportOptions {
  showTime: boolean;
  showFinance: boolean;
  showMaterials: boolean;
  showChecklists: boolean;
  showPhotos: boolean;
  showRemarks: boolean;
  photoIds: string[];
  logoPhotoId: string | null;
}
export const defaultReportOptions = (): ReportOptions => ({
  showTime: true,
  showFinance: false,
  showMaterials: true,
  showChecklists: false,
  showPhotos: false,
  showRemarks: false,
  photoIds: [],
  logoPhotoId: null,
});
export const reportLimits = {
  photos: 6,
  imageBytes: 12 * 1024 ** 2,
  pdfBytes: 20 * 1024 ** 2,
  pages: 60,
  checklistItems: 1000,
  workText: 8000,
  remarks: 5000,
};
export interface ReportImage {
  photoId: string;
  sha256: string;
  width: number;
  height: number;
  size: number;
  category: 'before' | 'after' | 'other';
  date: string;
}
/** A public allowlist, deliberately separate from Job, Payment and PhotoMetadata. */
export interface ReportSnapshot {
  company: 'BRONIAREK OGRODY';
  clientName: string;
  gardenName: string;
  address: string;
  zoneName: string | null;
  visitDate: string;
  workDescription: string;
  time: {
    workSeconds: number;
    recordedPauseMs: number;
    historySince: number | null;
    corrections: { at: number; beforeSeconds: number; afterSeconds: number }[];
  } | null;
  materials: { name: string; quantity: number; unit: string }[] | null;
  checklists:
    | {
        name: string;
        items: {
          title: string;
          status: ItemStatus;
          completedAt: number | null;
        }[];
      }[]
    | null;
  remarks: string | null;
  finance: {
    laborCents: number;
    materialsCents: number;
    totalCents: number;
    paidCents: number;
    remainingCents: number;
    billing: 'hourly' | 'fixed';
  } | null;
  photos: ReportImage[];
  logo: ReportImage | null;
}
export interface VisitReport {
  id: string;
  number: string;
  version: number;
  generatedAt: number;
  rendererVersion: 1;
  fingerprint: string;
  options: ReportOptions;
  snapshot: ReportSnapshot;
}
export function visitZone(data: Data, job: Job): string | null {
  if (job.visitDetails) return job.visitDetails.zoneName;
  const occurrence = data.taskOccurrences.find(
    (o) => o.id === job.taskOccurrenceId && o.gardenId === job.gardenId,
  );
  return occurrence?.zoneName ?? null;
}
export function visitTime(data: Data, job: Job, now = Date.now()) {
  const history = job.timeHistory ?? [];
  return {
    workSeconds: elapsedSeconds(job, data.timer, now),
    recordedPauseMs: history.reduce(
      (sum, e) => sum + (e.pauseDurationMs ?? 0),
      0,
    ),
    historySince: history[0]?.at ?? null,
    corrections: history
      .filter((e) => e.kind === 'corrected')
      .map((e) => ({
        at: e.at,
        beforeSeconds: e.beforeSeconds,
        afterSeconds: e.afterSeconds,
      })),
  };
}
export function eligibleReportPhoto(data: Data, job: Job, p: PhotoMetadata) {
  return (
    p.deletedAt === null &&
    (p.jobId === job.id || (p.jobId === null && p.gardenId === job.gardenId))
  );
}
export function buildReportSnapshot(
  data: Data,
  jobId: string,
  options: ReportOptions,
): ReportSnapshot {
  const job = data.jobs.find((j) => j.id === jobId),
    garden = data.gardens.find((g) => g.id === job?.gardenId),
    client = data.clients.find((c) => c.id === garden?.clientId);
  if (!job || !garden || !client)
    throw new Error('Nie znaleziono danych wizyty.');
  if (job.status !== 'completed' || data.timer?.jobId === jobId)
    throw new Error(
      'Zakończ wizytę przed przygotowaniem raportu. Podgląd nie zatrzymuje stopera.',
    );
  if (options.showFinance && !job.settlement)
    throw new Error(
      'Przed dołączeniem finansów zatwierdź należność w istniejącym rozliczeniu wizyty.',
    );
  if (
    options.photoIds.length > reportLimits.photos ||
    new Set(options.photoIds).size !== options.photoIds.length
  )
    throw new Error('Wybierz maksymalnie 6 różnych zdjęć PRZED/PO.');
  function image(id: string, logo = false): ReportImage {
    const p = data.photos.find(
      (p) => p.id === id && eligibleReportPhoto(data, job!, p),
    );
    if (!p || (!logo && !['before', 'after'].includes(p.category)))
      throw new Error(
        'Wybrane zdjęcie jest niedostępne lub nie należy do dokumentacji PRZED/PO tej wizyty i ogrodu. Wybierz zdjęcia ponownie.',
      );
    return {
      photoId: p.id,
      sha256: p.sha256,
      width: p.width,
      height: p.height,
      size: p.size,
      category: logo ? 'other' : (p.category as 'before' | 'after'),
      date: photoDate(p),
    };
  }
  const photos = options.showPhotos
      ? options.photoIds.map((id) => image(id))
      : [],
    logo = options.logoPhotoId ? image(options.logoPhotoId, true) : null;
  if (
    [...photos, ...(logo ? [logo] : [])].reduce((sum, p) => sum + p.size, 0) >
    reportLimits.imageBytes
  )
    throw new Error(
      'Zdjęcia i logo przekraczają limit 12 MB jednego raportu. Wybierz mniej zdjęć.',
    );
  const lists = options.showChecklists
    ? data.checklists
        .filter((c) => c.kind === 'visit' && c.jobId === job.id)
        .map((c) => ({
          name: c.name,
          items: c.items.map((i) => ({
            title: i.title,
            status: i.status,
            completedAt: i.completedAt,
          })),
        }))
    : null;
  if (
    lists &&
    lists.reduce((sum, c) => sum + c.items.length, 0) >
      reportLimits.checklistItems
  )
    throw new Error(
      'Raport może zawierać do 1000 czynności checklist. Wyłącz checklisty lub przygotuj krótszy zakres.',
    );
  const workDescription =
    job.visitDetails?.publicWork ?? job.activities.join('\n');
  if (!workDescription.trim())
    throw new Error(
      'Uzupełnij opis wykonanych prac dla klienta w podsumowaniu wizyty.',
    );
  return {
    company: 'BRONIAREK OGRODY',
    clientName: client.name,
    gardenName: garden.name,
    address: garden.address,
    zoneName: visitZone(data, job),
    visitDate: job.date,
    workDescription,
    time: options.showTime ? visitTime(data, job) : null,
    materials: options.showMaterials
      ? job.materials.map((m) => ({
          name: m.name,
          quantity: m.quantity,
          unit: m.unit ?? 'jedn.',
        }))
      : null,
    checklists: lists,
    remarks: options.showRemarks
      ? (job.visitDetails?.clientRemarks ?? '')
      : null,
    finance: options.showFinance
      ? {
          laborCents: job.settlement!.finalLaborCents,
          materialsCents: job.settlement!.materialsCents,
          totalCents: jobTotalCents(job),
          paidCents: paidCents(job.id, data.payments),
          remainingCents: remainingCents(job, data.payments),
          billing: job.billing,
        }
      : null,
    photos,
    logo,
  };
}
export function reportSourceSignature(
  data: Data,
  jobId: string,
  options: ReportOptions,
): string {
  return JSON.stringify({
    snapshot: buildReportSnapshot(data, jobId, options),
    options,
    sequence: data.reportSequence,
    history:
      data.jobs.find((j) => j.id === jobId)?.reports?.map((r) => r.id) ?? [],
  });
}
