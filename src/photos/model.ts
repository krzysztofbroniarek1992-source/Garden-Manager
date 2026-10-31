import type { Data } from '../domain';
import { localDate } from '../domain';
import { isDate } from '../planning/dates';

export const photoCategories = { before: 'PRZED PRACĄ', during: 'W TRAKCIE', after: 'PO PRACY', problem: 'PROBLEM / CHOROBA ROŚLINY', other: 'INNE' } as const;
export type PhotoCategory = keyof typeof photoCategories;
export const photoLimits = { inputBytes: 25 * 1024 ** 2, pixels: 50_000_000, edge: 1920, thumbnailEdge: 320, imageBytes: 3 * 1024 ** 2, thumbnailBytes: 256 * 1024, batch: 20, backupBytes: 200 * 1024 ** 2, expandedBackupBytes: 250 * 1024 ** 2, jsonBytes: 10 * 1024 ** 2, entries: 10002 } as const;
export interface PhotoScope { clientId: string | null; gardenId: string | null; zoneId: string | null; jobId: string | null }
export interface PhotoDetails extends PhotoScope { category: PhotoCategory; description: string; capturedDate: string | null }
export interface PhotoMetadata extends PhotoDetails {
  id: string; assetId: string; filename: string; clientName: string; gardenName: string | null; zoneName: string | null; jobTitle: string | null;
  addedAt: number; updatedAt: number; deletedAt: number | null; revision: number;
  mimeType: 'image/jpeg'; width: number; height: number; thumbnailWidth: number; thumbnailHeight: number;
  size: number; thumbnailSize: number; sha256: string; thumbnailSha256: string;
}
export interface PhotoAsset { id: string; image: Blob; thumbnail: Blob; createdAt: number }
export interface PhotoInput { blob: Blob; name: string }
export interface PreparedImage extends Omit<PhotoAsset, 'id' | 'createdAt'> {
  width: number; height: number; thumbnailWidth: number; thumbnailHeight: number; sha256: string; thumbnailSha256: string;
}
export interface PhotoProcessor { process(input: PhotoInput): Promise<PreparedImage> }
export interface RecoveryPoint { id: string; data: Data; createdAt: number }
export interface RestoreJournal extends RecoveryPoint { stagedAssetIds: string[] }
export interface PhotoAssetRepository {
  get(id: string): Promise<PhotoAsset | undefined>;
  putMany(assets: PhotoAsset[]): Promise<void>;
  deleteMany(ids: string[]): Promise<void>;
  list(): Promise<{ id: string; createdAt: number }[]>;
  recovery(): Promise<RecoveryPoint | undefined>;
  journal(): Promise<RestoreJournal | undefined>;
  stageRestore(assets: PhotoAsset[], journal: RestoreJournal): Promise<void>;
  finishRestore(): Promise<void>;
  abortRestore(protectedIds: string[]): Promise<void>;
  clearRecovery(): Promise<void>;
}
export function resolvePhotoScope(data: Data, scope: PhotoScope) {
  const job = scope.jobId ? data.jobs.find(j => j.id === scope.jobId) : undefined;
  if (scope.jobId && !job) throw new Error('Nie znaleziono zlecenia dla zdjęcia.');
  const garden = data.gardens.find(g => g.id === (job?.gardenId ?? scope.gardenId));
  if ((job || scope.gardenId) && !garden || job && scope.gardenId && job.gardenId !== scope.gardenId) throw new Error('Wybierz właściwy ogród i zlecenie.');
  const client = data.clients.find(c => c.id === (garden?.clientId ?? scope.clientId));
  if (!client || scope.clientId && scope.clientId !== client.id) throw new Error('Wybierz właściwego klienta dla zdjęcia.');
  const zone = scope.zoneId ? garden?.zones.find(z => z.id === scope.zoneId) : undefined;
  if (scope.zoneId && !zone) throw new Error('Wybierz strefę tego ogrodu.');
  return { clientId: client.id, gardenId: garden?.id ?? null, zoneId: zone?.id ?? null, jobId: job?.id ?? null,
    clientName: client.name.slice(0, 300), gardenName: garden?.name.slice(0, 300) ?? null, zoneName: zone?.name.slice(0, 300) ?? null, jobTitle: job?.title.slice(0, 300) ?? null };
}
export const photoDate = (photo: PhotoMetadata) => photo.capturedDate ?? localDate(new Date(photo.addedAt));
export function matchesPhotoScope(photo: PhotoMetadata, scope: Partial<PhotoScope>) {
  return photo.deletedAt === null && Object.entries(scope).every(([key, value]) => !value || photo[key as keyof PhotoScope] === value);
}
export function validatePhotos(data: Data) {
  const fail = (): never => { throw new Error('Nieprawidłowe metadane zdjęć. Oryginalny zapis nie został zmieniony.'); };
  const identifier = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(v);
  const text = (v: unknown, max: number) => typeof v === 'string' && v.length <= max;
  const timestamp = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= 8.64e15;
  const dimension = (v: unknown, max: number) => Number.isInteger(v) && (v as number) > 0 && (v as number) <= max;
  const size = (v: unknown, max: number) => Number.isSafeInteger(v) && (v as number) > 0 && (v as number) <= max;
  if (!Array.isArray(data.photos) || !(data.photoRestoreId === null || identifier(data.photoRestoreId))) fail();
  for (const p of data.photos) {
    if (!p || typeof p !== 'object' || !identifier(p.id) || !identifier(p.assetId) || !text(p.filename, 200)
      || !(p.category in photoCategories) || !Object.hasOwn(photoCategories, p.category) || !text(p.description, 5000)
      || !(p.capturedDate === null || isDate(p.capturedDate)) || !timestamp(p.addedAt) || !timestamp(p.updatedAt)
      || !(p.deletedAt === null || timestamp(p.deletedAt)) || !Number.isSafeInteger(p.revision) || p.revision < 0
      || !text(p.clientName, 300) || ![p.gardenName, p.zoneName, p.jobTitle].every(v => v === null || text(v, 300))
      || ![p.clientId, p.gardenId, p.zoneId, p.jobId].every(v => v === null || typeof v === 'string' && v.trim())
      || p.mimeType !== 'image/jpeg' || !dimension(p.width, photoLimits.edge) || !dimension(p.height, photoLimits.edge)
      || !dimension(p.thumbnailWidth, photoLimits.thumbnailEdge) || !dimension(p.thumbnailHeight, photoLimits.thumbnailEdge)
      || !size(p.size, photoLimits.imageBytes) || !size(p.thumbnailSize, photoLimits.thumbnailBytes)
      || !/^[a-f0-9]{64}$/.test(p.sha256) || !/^[a-f0-9]{64}$/.test(p.thumbnailSha256)) fail();
    if (p.deletedAt === null) {
      try {
        const scope = resolvePhotoScope(data, p);
        if ((['clientId', 'gardenId', 'zoneId', 'jobId'] as const).some(key => scope[key] !== p[key])) fail();
      } catch { fail(); }
    }
  }
  if (new Set(data.photos.map(p => p.id)).size !== data.photos.length || new Set(data.photos.map(p => p.assetId)).size !== data.photos.length) fail();
}
export function photoStorageError(error: unknown): Error {
  if (error instanceof Error && /quota|disk|space|storage.*full/i.test(`${error.name} ${error.message}`)) return new Error('Brak miejsca na zdjęcia. Zwolnij pamięć urządzenia lub usuń zbędne zdjęcia po wykonaniu pełnej kopii ZIP. Pozostałe dane są zachowane.');
  return new Error(error instanceof Error ? error.message : 'Nie udało się zapisać zdjęć w IndexedDB. Spróbuj ponownie.');
}
