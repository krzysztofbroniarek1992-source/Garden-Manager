import { photoLimits, type PhotoInput, type PhotoProcessor, type PreparedImage } from './model';

export async function sha256(blob: Blob): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(v => v.toString(16).padStart(2, '0')).join('');
}
/** Read dimensions before decoding to reject oversized rasters and active formats. */
export function imageDimensions(bytes: Uint8Array): { width: number; height: number; mime: string } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 24 && bytes.slice(0,8).every((v,i) => v === [137,80,78,71,13,10,26,10][i])) return { width: view.getUint32(16), height: view.getUint32(20), mime: 'image/png' };
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216) {
    for (let offset = 2; offset + 4 <= bytes.length;) {
      if (bytes[offset++] !== 255) throw new Error('Nieprawidłowy plik JPEG.');
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0xd8 || marker >= 0xd0 && marker <= 0xd7 || marker === 1) continue;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker) && length >= 7) return { width: view.getUint16(offset + 5), height: view.getUint16(offset + 3), mime: 'image/jpeg' };
      offset += length;
    }
  }
  if (bytes.length >= 30 && String.fromCharCode(...bytes.slice(0,4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8,12)) === 'WEBP') {
    const kind = String.fromCharCode(...bytes.slice(12,16));
    const uint24 = (o: number) => bytes[o] | bytes[o + 1] << 8 | bytes[o + 2] << 16;
    if (kind === 'VP8X') return { width: uint24(24) + 1, height: uint24(27) + 1, mime: 'image/webp' };
    if (kind === 'VP8L' && bytes[20] === 0x2f) { const bits = view.getUint32(21, true); return { width: (bits & 0x3fff) + 1, height: (bits >>> 14 & 0x3fff) + 1, mime: 'image/webp' }; }
    if (kind === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 1 && bytes[25] === 0x2a) return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff, mime: 'image/webp' };
  }
  throw new Error('Wybierz poprawne zdjęcie JPEG, PNG lub WebP. SVG, GIF i HEIC nie są obsługiwane.');
}
export function resizedDimensions(width: number, height: number, edge: number) {
  if (!width || !height || width * height > photoLimits.pixels) throw new Error('Zdjęcie przekracza limit 50 megapikseli.');
  const scale = Math.min(1, edge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
function encode(bitmap: ImageBitmap, edge: number, quality: number): Promise<{ blob: Blob; width: number; height: number }> {
  const { width, height } = resizedDimensions(bitmap.width, bitmap.height, edge);
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Przeglądarka nie pozwala przygotować miniatury.');
  context.fillStyle = '#fff'; context.fillRect(0, 0, width, height); context.drawImage(bitmap, 0, 0, width, height);
  return new Promise((resolve, reject) => canvas.toBlob(blob => { canvas.width = canvas.height = 1; blob ? resolve({ blob, width, height }) : reject(new Error('Nie udało się przetworzyć zdjęcia.')); }, 'image/jpeg', quality));
}
export class BrowserPhotoProcessor implements PhotoProcessor {
  async process(input: PhotoInput): Promise<PreparedImage> {
    if (!input.blob.size || input.blob.size > photoLimits.inputBytes) throw new Error('Jedno zdjęcie może mieć najwyżej 25 MB.');
    const header = imageDimensions(new Uint8Array(await input.blob.slice(0, 256 * 1024).arrayBuffer()));
    resizedDimensions(header.width, header.height, photoLimits.edge);
    let bitmap: ImageBitmap;
    try { bitmap = await createImageBitmap(input.blob, { imageOrientation: 'from-image' }); } catch { throw new Error('Nie można odczytać zdjęcia. Wybierz poprawny plik JPEG, PNG lub WebP.'); }
    try {
      resizedDimensions(bitmap.width, bitmap.height, photoLimits.edge);
      let image = await encode(bitmap, photoLimits.edge, 0.82);
      if (image.blob.size > photoLimits.imageBytes) image = await encode(bitmap, photoLimits.edge, 0.6);
      const thumbnail = await encode(bitmap, photoLimits.thumbnailEdge, 0.72);
      if (image.blob.size > photoLimits.imageBytes || thumbnail.blob.size > photoLimits.thumbnailBytes) throw new Error('Nie udało się zmniejszyć zdjęcia do bezpiecznego rozmiaru.');
      return { image: image.blob, thumbnail: thumbnail.blob, width: image.width, height: image.height, thumbnailWidth: thumbnail.width, thumbnailHeight: thumbnail.height,
        sha256: await sha256(image.blob), thumbnailSha256: await sha256(thumbnail.blob) };
    } finally { bitmap.close(); }
  }
}
export async function validateStoredImage(blob: Blob, width: number, height: number): Promise<void> {
  const header = imageDimensions(new Uint8Array(await blob.slice(0, 256 * 1024).arrayBuffer()));
  if (header.mime !== 'image/jpeg' || header.width !== width || header.height !== height) throw new Error('Zdjęcie w kopii ma nieprawidłowe wymiary lub format.');
  if (typeof createImageBitmap !== 'undefined') {
    const bitmap = await createImageBitmap(blob);
    try { if (bitmap.width !== width || bitmap.height !== height) throw new Error('Nieprawidłowe wymiary zdjęcia w kopii.'); } finally { bitmap.close(); }
  }
}
