import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { STORAGE_VERSION, validateData, withDeskData, withChecklistData } from '../data/repository';
import type { Data } from '../domain';
import { sha256, validateStoredImage } from './images';
import { photoLimits, type PhotoAsset, type PhotoAssetRepository } from './model';

interface BackupFile { assetId: string; image: string; thumbnail: string; imageSha256: string; thumbnailSha256: string }
interface Manifest { format: 'garden-manager-backup'; version: 1; createdAt: string; dataSha256: string; files: BackupFile[] }
export interface PreparedBackup { data: Data; assets: PhotoAsset[]; createdAt: number }
const paths = (id: string) => ({ image: `photos/${id}/image.jpg`, thumbnail: `photos/${id}/thumbnail.jpg` });
const ownedBuffer = (bytes: Uint8Array) => bytes.slice().buffer as ArrayBuffer;
export async function makeFullBackup(data: Data, repository: PhotoAssetRepository, now = Date.now()): Promise<Blob> {
  validateData(data);
  if (data.photos.some(p => p.deletedAt !== null)) throw new Error('Najpierw dokończ usuwanie zdjęć i ponów kopię.');
  const raw = strToU8(JSON.stringify({ version: STORAGE_VERSION, data }));
  if (raw.length > photoLimits.jsonBytes) throw new Error('Dane przekraczają limit 10 MB dla jednej kopii.');
  const contents: Zippable = { 'data.json': [raw, { level: 6 }] };
  const manifest: Manifest = { format: 'garden-manager-backup', version: 1, createdAt: new Date(now).toISOString(), dataSha256: await sha256(new Blob([ownedBuffer(raw)])), files: [] };
  let total = raw.length;
  for (const photo of data.photos) {
    const asset = await repository.get(photo.assetId);
    if (!asset || asset.image.size !== photo.size || asset.thumbnail.size !== photo.thumbnailSize
      || await sha256(asset.image) !== photo.sha256 || await sha256(asset.thumbnail) !== photo.thumbnailSha256) throw new Error(`Nie można utworzyć pełnej kopii: brak lub uszkodzenie pliku „${photo.filename}”. Przywróć plik z wcześniejszej pełnej kopii.`);
    total += asset.image.size + asset.thumbnail.size;
    if (total > photoLimits.backupBytes - 2 * 1024 ** 2) throw new Error('Pełna kopia przekracza limit 200 MB. Żadne dane nie zostały usunięte.');
    const path = paths(photo.assetId);
    contents[path.image] = [new Uint8Array(await asset.image.arrayBuffer()), { level: 0 }];
    contents[path.thumbnail] = [new Uint8Array(await asset.thumbnail.arrayBuffer()), { level: 0 }];
    manifest.files.push({ assetId: photo.assetId, ...path, imageSha256: photo.sha256, thumbnailSha256: photo.thumbnailSha256 });
  }
  if (manifest.files.length * 2 + 2 > photoLimits.entries) throw new Error('Kopia zawiera zbyt wiele plików (limit 5000 zdjęć).');
  contents['manifest.json'] = [strToU8(JSON.stringify(manifest)), { level: 6 }];
  const zip = zipSync(contents);
  if (zip.length > photoLimits.backupBytes) throw new Error('Pełna kopia przekracza limit 200 MB.');
  return new Blob([ownedBuffer(zip)], { type: 'application/zip' });
}
export async function readFullBackup(blob: Blob): Promise<PreparedBackup> {
  if (!blob.size || blob.size > photoLimits.backupBytes) throw new Error('Wybierz pełną kopię ZIP o rozmiarze do 200 MB.');
  let count = 0, total = 0;
  const names = new Set<string>(), declared = new Map<string, number>();
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()), { filter: file => {
    const validPath = /^(?:manifest\.json|data\.json|photos\/[A-Za-z0-9_-]{1,100}\/(?:image|thumbnail)\.jpg)$/.test(file.name);
    const max = file.name === 'data.json' ? photoLimits.jsonBytes : file.name === 'manifest.json' ? 2 * 1024 ** 2 : file.name.endsWith('/thumbnail.jpg') ? photoLimits.thumbnailBytes : photoLimits.imageBytes;
    if (!validPath || names.has(file.name) || ++count > photoLimits.entries || !Number.isSafeInteger(file.originalSize) || file.originalSize <= 0
      || file.originalSize > max || ![0,8].includes(file.compression) || (total += file.originalSize) > photoLimits.expandedBackupBytes) throw new Error('Kopia ZIP ma niedozwolone ścieżki, duplikaty lub przekracza limity rozpakowania.');
    names.add(file.name); declared.set(file.name, file.originalSize); return true;
  } });
  if (!files['manifest.json'] || !files['data.json'] || Object.entries(files).some(([name, bytes]) => bytes.length !== declared.get(name))) throw new Error('Niekompletna pełna kopia ZIP.');
  const manifest = JSON.parse(strFromU8(files['manifest.json'])) as Manifest;
  if (!manifest || manifest.format !== 'garden-manager-backup' || manifest.version !== 1 || !Array.isArray(manifest.files)
    || !Number.isFinite(Date.parse(manifest.createdAt)) || !/^[a-f0-9]{64}$/.test(manifest.dataSha256)
    || await sha256(new Blob([ownedBuffer(files['data.json'])])) !== manifest.dataSha256) throw new Error('Nieprawidłowy manifest lub suma kontrolna danych kopii.');
  const envelope = JSON.parse(strFromU8(files['data.json']));
  if (!envelope || ![6, 7, STORAGE_VERSION].includes(envelope.version)) throw new Error('Ta wersja pełnej kopii nie jest obsługiwana przez aplikację.');
  const legacy: Data = envelope.version === 6 ? withDeskData(envelope.data) : envelope.data;
  const data: Data = envelope.version < 8 ? withChecklistData(legacy) : legacy;
  validateData(data);
  if (data.photos.some(p => p.deletedAt !== null) || manifest.files.length !== data.photos.length || names.size !== 2 + data.photos.length * 2) throw new Error('Liczba zdjęć w kopii nie zgadza się z metadanymi.');
  const seen = new Set<string>(), assets: PhotoAsset[] = [];
  for (const photo of data.photos) {
    const file = manifest.files.find(f => f && f.assetId === photo.assetId);
    const path = paths(photo.assetId);
    if (!file || seen.has(file.assetId) || file.image !== path.image || file.thumbnail !== path.thumbnail || !files[path.image] || !files[path.thumbnail]
      || file.imageSha256 !== photo.sha256 || file.thumbnailSha256 !== photo.thumbnailSha256) throw new Error('Nieprawidłowe powiązania plików zdjęć w kopii.');
    seen.add(file.assetId);
    const image = new Blob([ownedBuffer(files[path.image])], { type: 'image/jpeg' });
    const thumbnail = new Blob([ownedBuffer(files[path.thumbnail])], { type: 'image/jpeg' });
    if (image.size !== photo.size || thumbnail.size !== photo.thumbnailSize || await sha256(image) !== photo.sha256 || await sha256(thumbnail) !== photo.thumbnailSha256) throw new Error('Uszkodzony plik zdjęcia lub miniatury w kopii.');
    await validateStoredImage(image, photo.width, photo.height); await validateStoredImage(thumbnail, photo.thumbnailWidth, photo.thumbnailHeight);
    assets.push({ id: photo.assetId, image, thumbnail, createdAt: Date.parse(manifest.createdAt) });
  }
  return { data, assets, createdAt: Date.parse(manifest.createdAt) };
}
