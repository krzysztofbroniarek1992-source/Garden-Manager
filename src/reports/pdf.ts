import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { Data } from '../domain';
import type { PhotoAssetRepository } from '../photos/model';
import { sha256, validateStoredImage } from '../photos/images';
import { reportLimits, type ReportImage, type VisitReport } from './model';
import { reportSections } from './presentation';
import { validateReportSnapshot } from './validation';
export interface ReportFonts {
  regular: Uint8Array;
  bold: Uint8Array;
}
export async function loadReportFonts(): Promise<ReportFonts> {
  try {
    const files = await Promise.all(
      ['/fonts/DejaVuSans.ttf', '/fonts/DejaVuSans-Bold.ttf'].map(
        async (path) => {
          const response = await fetch(path);
          if (!response.ok) throw new Error();
          return new Uint8Array(await response.arrayBuffer());
        },
      ),
    );
    return { regular: files[0], bold: files[1] };
  } catch {
    throw new Error(
      'Nie można odczytać czcionki raportu. Otwórz aplikację online, aby zapisać zasoby do pracy offline, i ponów podgląd.',
    );
  }
}
export async function generateReportPdf(
  record: VisitReport,
  data: Data,
  assets: PhotoAssetRepository,
  fonts?: ReportFonts,
): Promise<Uint8Array> {
  validateReportSnapshot(record.snapshot, record.options);
  const s = record.snapshot;
  const sourceImages = [...s.photos, ...(s.logo ? [s.logo] : [])],
    images = new Map<string, Uint8Array>();
  for (const p of sourceImages) {
    const meta = data.photos.find(
      (m) => m.id === p.photoId && m.deletedAt === null,
    );
    if (!meta)
      throw new Error(
        'Zdjęcie lub logo użyte w tym raporcie jest niedostępne. Odtwórz je z pełnej kopii ZIP albo przygotuj nową wersję raportu bez niego.',
      );
    let asset;
    try {
      asset = await assets.get(meta.assetId);
    } catch {
      throw new Error(
        'Nie można odczytać zdjęć z pamięci urządzenia. Ponów dostęp w galerii przed przygotowaniem PDF.',
      );
    }
    if (
      !asset ||
      asset.image.size !== p.size ||
      (await sha256(asset.image)) !== p.sha256
    )
      throw new Error(
        'Brak lub uszkodzenie zdjęcia albo logo raportu. Odtwórz plik z pełnej kopii ZIP lub wybierz inną dokumentację.',
      );
    await validateStoredImage(asset.image, p.width, p.height);
    images.set(p.photoId, new Uint8Array(await asset.image.arrayBuffer()));
  }
  const fontBytes = fonts ?? (await loadReportFonts()),
    doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(fontBytes.regular, { subset: true }),
    bold = await doc.embedFont(fontBytes.bold, { subset: true });
  const glyphs = new Set(regular.getCharacterSet()),
    green = rgb(0.08, 0.25, 0.2),
    muted = rgb(0.38, 0.45, 0.41),
    ink = rgb(0.15, 0.2, 0.17),
    light = rgb(0.89, 0.93, 0.88);
  const clean = (value: string) => {
    const text = value
      .replace(/\t/g, '  ')
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
    for (const char of text)
      if (char !== '\n' && !glyphs.has(char.codePointAt(0)!))
        throw new Error(
          `Czcionka raportu nie obsługuje znaku „${char}”. Zastąp go w opisie lub nazwie przed wygenerowaniem PDF.`,
        );
    return text;
  };
  const W = 595.28,
    H = 841.89,
    M = 44,
    CW = W - M * 2;
  let page: PDFPage,
    y = 0;
  const newPage = () => {
    if (doc.getPageCount() >= reportLimits.pages)
      throw new Error(
        'Raport przekracza 60 stron. Skróć opis lub wyłącz checklisty.',
      );
    page = doc.addPage([W, H]);
    y = H - M;
  };
  const wrap = (value: string, font: PDFFont, size: number, width: number) => {
    const lines: string[] = [];
    for (const paragraph of clean(value).split('\n')) {
      let line = '';
      for (const word of paragraph.split(/\s+/)) {
        if (!word) continue;
        const candidate = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(candidate, size) <= width) {
          line = candidate;
          continue;
        }
        if (line) {
          lines.push(line);
          line = '';
        }
        let part = '';
        for (const ch of word) {
          if (part && font.widthOfTextAtSize(part + ch, size) > width) {
            lines.push(part);
            part = '';
          }
          part += ch;
        }
        line = part;
      }
      lines.push(line);
    }
    return lines;
  };
  const text = (
    value: string,
    size = 10.5,
    font = regular,
    color = ink,
    width = CW,
  ) => {
    for (const line of wrap(value, font, size, width)) {
      if (y < 72) newPage();
      page.drawText(line, { x: M, y: y - size, font, size, color });
      y -= size * 1.55;
    }
  };
  const section = (title: string) => {
    if (y < 120) newPage();
    y -= 16;
    text(title, 12.5, bold, green);
    page.drawLine({
      start: { x: M, y: y - 4 },
      end: { x: W - M, y: y - 4 },
      thickness: 0.8,
      color: light,
    });
    y -= 16;
  };
  newPage();
  text('BRONIAREK OGRODY', 21, bold, green, s.logo ? CW - 110 : CW);
  text('RAPORT WYKONANYCH PRAC', 9, regular, muted);
  y -= 8;
  if (s.logo) {
    const img = await doc.embedJpg(images.get(s.logo.photoId)!);
    const scale = Math.min(90 / img.width, 55 / img.height);
    page!.drawImage(img, {
      x: W - M - img.width * scale,
      y: H - M - 55,
      width: img.width * scale,
      height: img.height * scale,
    });
  }
  text(`${record.number} · wersja ${record.version}`, 11, bold);
  text(
    `Wygenerowano: ${new Date(record.generatedAt).toLocaleString('pl-PL')}`,
    8.5,
    regular,
    muted,
  );
  y -= 12;
  text(`Data wykonania prac: ${s.visitDate}`, 11, bold);
  text(`Klient: ${s.clientName}`);
  text(`Ogród: ${s.gardenName}`);
  if (s.address) text(`Adres: ${s.address}`);
  if (s.zoneName) text(`Strefa: ${s.zoneName}`);
  for (const block of reportSections(s)) {
    section(block.title);
    for (const line of block.lines) text(line);
  }
  async function photo(p: ReportImage, x: number, top: number, width: number) {
    const image = await doc.embedJpg(images.get(p.photoId)!);
    const scale = Math.min(width / image.width, 340 / image.height);
    const iw = image.width * scale,
      ih = image.height * scale;
    page.drawText(p.category === 'before' ? 'PRZED PRACĄ' : 'PO PRACY', {
      x,
      y: top,
      font: bold,
      size: 11,
      color: green,
    });
    page.drawText(p.date, {
      x,
      y: top - 19,
      font: regular,
      size: 9,
      color: muted,
    });
    page.drawImage(image, {
      x: x + (width - iw) / 2,
      y: top - 45 - ih,
      width: iw,
      height: ih,
    });
  }
  for (let i = 0; i < s.photos.length; i += 2) {
    newPage();
    text('DOKUMENTACJA FOTOGRAFICZNA', 13, bold, green);
    y -= 26;
    const width = (CW - 18) / 2;
    await photo(s.photos[i], M, y, width);
    if (s.photos[i + 1]) await photo(s.photos[i + 1], M + width + 18, y, width);
  }
  for (const [i, p] of doc.getPages().entries()) {
    p.drawLine({
      start: { x: M, y: 40 },
      end: { x: W - M, y: 40 },
      thickness: 0.7,
      color: light,
    });
    p.drawText(`${record.number} · v${record.version} | BRONIAREK OGRODY`, {
      x: M,
      y: 26,
      size: 7.5,
      font: regular,
      color: muted,
    });
    p.drawText(`${i + 1} / ${doc.getPageCount()}`, {
      x: W - M - 30,
      y: 26,
      size: 8,
      font: regular,
      color: muted,
    });
  }
  doc.setTitle(`Raport ${record.number} · wersja ${record.version}`);
  doc.setAuthor('BRONIAREK OGRODY');
  doc.setCreator('Garden Manager 0.3.6');
  doc.setProducer('Garden Manager PDF renderer 1');
  doc.setCreationDate(new Date(record.generatedAt));
  doc.setModificationDate(new Date(record.generatedAt));
  doc.setLanguage('pl-PL');
  const bytes = await doc.save();
  if (bytes.length > reportLimits.pdfBytes)
    throw new Error('PDF przekracza 20 MB. Wybierz mniej zdjęć.');
  return bytes;
}
