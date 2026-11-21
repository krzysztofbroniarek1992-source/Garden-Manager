import { LocalRepository, STORAGE_KEY } from "../data/repository";
import { photoLimits, type PhotoAssetRepository } from "./model";
import { sha256, validateStoredImage } from "./images";
import type { PreparedBackup } from "./backup";

/** JSON never supplies image bytes. Restore it only when every referenced asset
 * already exists and verifies locally; a full ZIP is required for transfer. */
export async function readJsonBackup(blob: Blob, repository: PhotoAssetRepository, now = Date.now()): Promise<PreparedBackup> {
  if (!blob.size || blob.size > photoLimits.jsonBytes) throw Error("Wybierz kopię JSON o rozmiarze do 10 MB.");
  const raw = (await blob.text()).replace(/^\uFEFF/, "");
  let data;
  try {
    data = new LocalRepository({ getItem: key => key === STORAGE_KEY ? raw : null, setItem: () => {} }).load();
  } catch (e) {
    throw Error("Nie można odczytać lub zweryfikować kopii JSON: " + (e as Error).message);
  }
  if (data.timer && !data.timer.paused) throw Error("Ta kopia JSON ma aktywny stoper, ale nie zawiera daty wykonania kopii. Do odtworzenia pomiaru użyj pełnej kopii ZIP.");
  if (data.photos.some(p => p.deletedAt !== null)) throw Error("JSON zawiera niedokończone usuwanie zdjęć. Użyj pełnej, sprawdzonej kopii ZIP.");
  const assets: PreparedBackup["assets"] = [];
  let bytes = 0;
  for (const photo of data.photos) {
    const asset = await repository.get(photo.assetId);
    if (!asset || asset.image.size !== photo.size || asset.thumbnail.size !== photo.thumbnailSize ||
      await sha256(asset.image) !== photo.sha256 || await sha256(asset.thumbnail) !== photo.thumbnailSha256)
      throw Error("JSON nie zawiera plików zdjęć, a któregoś pliku brakuje na tym urządzeniu. Do przeniesienia danych i zdjęć użyj pełnej kopii ZIP.");
    if ((bytes += asset.image.size + asset.thumbnail.size) > photoLimits.backupBytes) throw Error("Pliki zdjęć przekraczają limit odtwarzania 200 MB.");
    await validateStoredImage(asset.image, photo.width, photo.height);
    await validateStoredImage(asset.thumbnail, photo.thumbnailWidth, photo.thumbnailHeight);
    assets.push(asset);
  }
  return { data, assets, createdAt: now };
}
