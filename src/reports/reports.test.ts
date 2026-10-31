import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { IDBFactory } from 'fake-indexeddb';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument } from 'pdf-lib';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createDemoData } from '../data/demo';
import { GardenStore } from '../data/store';
import {
  LocalRepository,
  STORAGE_KEY,
  STORAGE_VERSION,
  V8_BACKUP_KEY,
  validateData,
  type StoragePort,
} from '../data/repository';
import type { Data } from '../domain';
import { newNote } from '../desk/model';
import { IndexedDbPhotoRepository } from '../photos/assets';
import { PhotoService } from '../photos/service';
import { sha256 } from '../photos/images';
import { readFullBackup } from '../photos/backup';
import type { PhotoProcessor } from '../photos/model';
import {
  buildReportSnapshot,
  defaultReportOptions,
  reportSourceSignature,
  visitTime,
  type ReportOptions,
  type VisitReport,
} from './model';
import { reportDuration, reportSections } from './presentation';
import { generateReportPdf, type ReportFonts } from './pdf';
import { ReportService, type PdfGenerator } from './service';
class MemoryStorage implements StoragePort {
  values = new Map<string, string>();
  failKey = '';
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.failKey === key) throw new Error('QuotaExceededError');
    this.values.set(key, value);
  }
}
const clock = Date.parse('2026-10-31T10:00:00+01:00'),
  day = '2026-10-31';
const fonts: ReportFonts = {
  regular: new Uint8Array(
    readFileSync(new URL('../../public/fonts/DejaVuSans.ttf', import.meta.url)),
  ),
  bold: new Uint8Array(
    readFileSync(
      new URL('../../public/fonts/DejaVuSans-Bold.ttf', import.meta.url),
    ),
  ),
};
const jpeg = new Blob(
  [readFileSync(new URL('./fixtures/garden.jpg', import.meta.url))],
  { type: 'image/jpeg' },
);
const fast: PdfGenerator = async () => new Uint8Array([37, 80, 68, 70]);
async function pdfText(bytes: Uint8Array) {
  const task = getDocument({
    data: bytes.slice(),
    useSystemFonts: false,
    isEvalSupported: false,
  });
  const pdf = await task.promise;
  let text = '';
  for (let n = 1; n <= pdf.numPages; n++)
    text +=
      (await (await pdf.getPage(n)).getTextContent()).items
        .map((i) => ('str' in i ? i.str : ''))
        .join(' ') + '\n';
  await pdf.destroy();
  return text;
}
function fixture(completed = true) {
  let now = clock;
  const seed = createDemoData(new Date(now));
  seed.clients[0] = {
    ...seed.clients[0],
    notes: 'PRIVATE_CLIENT_NOTES',
    phone: 'PRIVATE_PHONE',
    email: 'private@example.com',
  };
  seed.gardens[0].notes = 'PRIVATE_GARDEN_NOTES';
  seed.gardens[0].zones = [
    {
      id: 'zone',
      name: 'Rabata różana',
      type: 'rabata',
      area: 10,
      length: null,
      plants: 'Róże',
      requirements: 'PRIVATE_REQUIREMENTS',
      treatments: '',
    },
  ];
  seed.jobs[0] = {
    ...seed.jobs[0],
    title: 'Planowana pielęgnacja',
    date: day,
    notes: 'PRIVATE_JOB_NOTES',
    activities: ['Żółć, łąka, krzewy — Łódź. ĄĆĘŁŃÓŚŹŻ ąćęłńóśźż'],
    materials: [
      {
        id: 'm',
        name: 'Kora ogrodowa',
        quantity: 2,
        unit: 'l',
        unitPrice: 43.5,
        purchaseUnitPrice: 9.87,
      },
    ],
  };
  const storage = new MemoryStorage(),
    repo = new LocalRepository(storage, () => seed),
    store = new GardenStore(repo, () => now),
    assets = new IndexedDbPhotoRepository(new IDBFactory());
  if (completed) {
    store.correctJobTime('job-1', 13620);
    store.completeJob('job-1');
    store.approveSettlement('job-1', 45000, 'rounded');
    store.savePayment({
      id: 'payment',
      jobId: 'job-1',
      amountCents: 10000,
      receivedDate: day,
      method: 'transfer',
      note: 'PRIVATE_BANK_NOTE',
    });
  }
  const service = new ReportService(
      store,
      assets,
      (r, d, a) => generateReportPdf(r, d, a, fonts),
      () => now,
    ),
    quick = new ReportService(store, assets, fast, () => now);
  return {
    storage,
    repo,
    store,
    assets,
    service,
    quick,
    tick: (ms = 1000) => {
      now += ms;
    },
    details: () =>
      store.saveVisitDetails(
        'job-1',
        {
          publicWork: 'Wykonano pielęgnację róż i uporządkowano teren.',
          clientRemarks: 'PUBLIC_ADVICE: podlewać po posadzeniu.',
          zoneId: 'zone',
        },
        store.data.jobs[0].visitDetails?.revision ?? 0,
      ),
  };
}
async function withPhoto() {
  const f = fixture(),
    hash = await sha256(jpeg),
    processor: PhotoProcessor = {
      process: async () => ({
        image: jpeg,
        thumbnail: jpeg,
        width: 80,
        height: 60,
        thumbnailWidth: 80,
        thumbnailHeight: 60,
        sha256: hash,
        thumbnailSha256: hash,
      }),
    },
    photos = new PhotoService(f.store, f.assets, processor);
  const add = async (category: 'before' | 'after' | 'other' = 'before') =>
    (
      await photos.add([{ blob: jpeg, name: 'PRIVATE_FILENAME.jpg' }], {
        clientId: 'client-1',
        gardenId: 'garden-1',
        zoneId: 'zone',
        jobId: 'job-1',
        category,
        description: 'PRIVATE_PHOTO_DESCRIPTION',
        capturedDate: day,
      })
    )[0];
  const photo = await add();
  return { ...f, photos, add, photo };
}
function legacy(data: Data) {
  const result = JSON.parse(JSON.stringify(data));
  delete result.reportSequence;
  for (const j of result.jobs) {
    delete j.reports;
    delete j.visitDetails;
    delete j.timeHistory;
  }
  return result;
}

describe('publiczna migawka i rzeczywisty PDF', () => {
  it('domyślnie wyłącza finanse i uwagi, a DTO nie zawiera wewnętrznych pól', () => {
    const f = fixture();
    f.details();
    const snap = buildReportSnapshot(
        f.store.data,
        'job-1',
        defaultReportOptions(),
      ),
      json = JSON.stringify(snap);
    expect(snap.finance).toBeNull();
    expect(snap.remarks).toBeNull();
    expect(snap.photos).toEqual([]);
    expect(json).not.toMatch(
      /PRIVATE|PUBLIC_ADVICE|purchaseUnitPrice|unitPrice|notes|email|phone|rate/,
    );
    expect(snap.materials).toEqual([
      { name: 'Kora ogrodowa', quantity: 2, unit: 'l' },
    ]);
  });
  it('tworzy odczytywalny PDF z osadzonymi polskimi znakami i bez prywatnych danych', async () => {
    const f = fixture(),
      before = f.storage.getItem(STORAGE_KEY),
      p = await f.service.prepare('job-1', defaultReportOptions());
    expect(String.fromCharCode(...p.bytes.slice(0, 5))).toBe('%PDF-');
    const text = await pdfText(p.bytes);
    expect(text).toContain('BRONIAREK OGRODY');
    expect(text).toContain('Żółć, łąka, krzewy — Łódź. ĄĆĘŁŃÓŚŹŻ ąćęłńóśźż');
    expect(text).toContain('03:47:00');
    expect(text).not.toMatch(/PRIVATE|9,87|450,00|Pozostało do zapłaty/);
    expect(f.storage.getItem(STORAGE_KEY)).toBe(before);
  });
  it('jawnie dołącza zatwierdzone finanse oraz zalecenia, bez cen zakupu i notatek płatności', async () => {
    const f = fixture();
    f.details();
    const p = await f.service.prepare('job-1', {
        ...defaultReportOptions(),
        showFinance: true,
        showRemarks: true,
      }),
      s = p.record.snapshot;
    expect(s.finance).toMatchObject({
      laborCents: 45000,
      materialsCents: 8700,
      totalCents: 53700,
      paidCents: 10000,
      remainingCents: 43700,
    });
    const text = await pdfText(p.bytes);
    expect(text).toContain('450,00');
    expect(text).toContain('437,00');
    expect(text).toContain('PUBLIC_ADVICE');
    expect(text).not.toMatch(/PRIVATE|9,87/);
  });
  it('zdjęcia PRZED/PO i logo pochodzą z IndexedDB, bez kopii w głównym modelu', async () => {
    const f = await withPhoto(),
      after = await f.add('after'),
      logo = await f.add('other'),
      before = structuredClone(f.store.data);
    const p = await f.service.prepare('job-1', {
      ...defaultReportOptions(),
      showPhotos: true,
      photoIds: [f.photo.id, after.id],
      logoPhotoId: logo.id,
    });
    expect((await PDFDocument.load(p.bytes)).getPageCount()).toBeGreaterThan(1);
    expect(await pdfText(p.bytes)).toMatch(/PRZED PRACĄ.*PO PRACY/s);
    expect(await pdfText(p.bytes)).not.toMatch(/PRIVATE/);
    await f.service.save('job-1', p);
    expect(f.storage.getItem(STORAGE_KEY)).not.toMatch(
      /base64|data:image|JVBER/,
    );
    expect(await f.assets.list()).toHaveLength(3);
    expect(f.store.data.photos).toEqual(before.photos);
  });
  it('wyłączenie zdjęć i materiałów usuwa te sekcje z PDF', async () => {
    const f = await withPhoto(),
      p = await f.service.prepare('job-1', {
        ...defaultReportOptions(),
        showTime: false,
        showMaterials: false,
        photoIds: [f.photo.id],
      });
    const text = await pdfText(p.bytes);
    expect(text).not.toMatch(
      /Czas pracy|Kora ogrodowa|DOKUMENTACJA FOTOGRAFICZNA/,
    );
    expect(p.record.snapshot.photos).toEqual([]);
  });
  it('checklisty eksportują statusy i daty, pomijając ich wewnętrzne uwagi', async () => {
    const f = fixture(),
      id = f.store.applyWorkTemplate('starter-lawn-v1', {
        kind: 'visit',
        jobId: 'job-1',
      });
    const c = f.store.data.checklists[0];
    f.store.editChecklistItem(id, c.revision, c.items[0].id, {
      status: 'done',
      note: 'PRIVATE_CHECKLIST_NOTE',
    });
    const p = await f.service.prepare('job-1', {
        ...defaultReportOptions(),
        showChecklists: true,
      }),
      text = await pdfText(p.bytes);
    expect(text).toContain('Checklista: Koszenie trawnika');
    expect(text).toContain('Wykonane: Kontrola terenu i przeszkód');
    expect(text).not.toContain('PRIVATE_CHECKLIST_NOTE');
  });
  it('chroni przed zbyt wieloma zdjęciami, duplikatami i fotografią innego klienta', async () => {
    const f = await withPhoto();
    expect(() =>
      buildReportSnapshot(f.store.data, 'job-1', {
        ...defaultReportOptions(),
        showPhotos: true,
        photoIds: Array(7).fill(f.photo.id),
      }),
    ).toThrow('6');
    expect(() =>
      buildReportSnapshot(f.store.data, 'job-1', {
        ...defaultReportOptions(),
        showPhotos: true,
        photoIds: [f.photo.id, f.photo.id],
      }),
    ).toThrow();
    expect(() =>
      buildReportSnapshot(f.store.data, 'job-5', {
        ...defaultReportOptions(),
        showPhotos: true,
        photoIds: [f.photo.id],
      }),
    ).toThrow('zdjęcie');
  });
  it('brak pliku lub błąd IndexedDB nie tworzą uszkodzonego PDF ani historii', async () => {
    const f = await withPhoto(),
      options = {
        ...defaultReportOptions(),
        showPhotos: true,
        photoIds: [f.photo.id],
      };
    await f.assets.deleteMany([f.photo.assetId]);
    await expect(f.service.prepare('job-1', options)).rejects.toThrow(
      'Brak lub uszkodzenie',
    );
    expect(f.store.data.jobs[0].reports).toBeUndefined();
    const failing = new ReportService(
      f.store,
      {
        ...f.assets,
        get: async () => {
          throw new Error('IndexedDB unavailable');
        },
      } as unknown as IndexedDbPhotoRepository,
      (r, d, a) => generateReportPdf(r, d, a, fonts),
    );
    await expect(failing.prepare('job-1', options)).rejects.toThrow(
      'pamięci urządzenia',
    );
  });
  it('wykrywa uszkodzone bajty wybranego obrazu', async () => {
    const f = await withPhoto(),
      asset = (await f.assets.get(f.photo.assetId))!;
    await f.assets.deleteMany([asset.id]);
    await f.assets.putMany([
      { ...asset, image: new Blob(['broken'], { type: 'image/jpeg' }) },
    ]);
    await expect(
      f.service.prepare('job-1', {
        ...defaultReportOptions(),
        showPhotos: true,
        photoIds: [f.photo.id],
      }),
    ).rejects.toThrow('uszkodzenie');
  });
  it('bez zdjęć działa także wtedy, gdy IndexedDB jest niedostępne', async () => {
    const f = fixture(),
      service = new ReportService(
        f.store,
        {
          get: async () => {
            throw new Error();
          },
        } as unknown as IndexedDbPhotoRepository,
        (r, d, a) => generateReportPdf(r, d, a, fonts),
      );
    expect(
      (await service.prepare('job-1', defaultReportOptions())).bytes.length,
    ).toBeGreaterThan(1000);
  });
  it('zawija długie słowa i paginuje dokument bez utraty polskich znaków', async () => {
    const f = fixture();
    f.store.saveVisitDetails(
      'job-1',
      {
        publicWork: 'Ł'.repeat(5000) + '\nKONIEC PRAC',
        clientRemarks: '',
        zoneId: null,
      },
      0,
    );
    const p = await f.service.prepare('job-1', defaultReportOptions());
    expect((await PDFDocument.load(p.bytes)).getPageCount()).toBeGreaterThan(1);
    expect(await pdfText(p.bytes)).toContain('KONIEC PRAC');
  });
  it('nieobsługiwany znak daje komunikat i nie zapisuje raportu', async () => {
    const f = fixture();
    f.store.saveVisitDetails(
      'job-1',
      { publicWork: 'Praca 🚜', clientRemarks: '', zoneId: null },
      0,
    );
    await expect(
      f.service.prepare('job-1', defaultReportOptions()),
    ).rejects.toThrow('nie obsługuje');
    expect(f.store.data.jobs[0].reports).toBeUndefined();
  });
  it('nie zaokrągla historycznych ułamków sekund w prezentacji', () => {
    expect(reportDuration(454.125)).toBe('00:07:34,125');
    expect(reportDuration(454)).toBe('00:07:34');
  });
  it('wymaga zakończenia wizyty, a finanse wymagają jawnego zatwierdzenia należności', async () => {
    const f = fixture(false);
    await expect(
      f.quick.prepare('job-1', defaultReportOptions()),
    ).rejects.toThrow('Zakończ');
    f.store.completeJob('job-1');
    await expect(
      f.quick.prepare('job-1', {
        ...defaultReportOptions(),
        showFinance: true,
      }),
    ).rejects.toThrow('zatwierdź');
    expect(
      (await f.quick.prepare('job-1', defaultReportOptions())).record.snapshot
        .finance,
    ).toBeNull();
  });
});

describe('wersje, historia i nienaruszanie rozliczeń', () => {
  it('podgląd nie zapisuje historii, zapis dopisuje wyłącznie raport i licznik', async () => {
    const f = fixture(),
      before = structuredClone(f.store.data),
      p = await f.quick.prepare('job-1', defaultReportOptions());
    expect(f.store.data).toEqual(before);
    await f.quick.save('job-1', p);
    const after = structuredClone(f.store.data);
    delete after.jobs[0].reports;
    after.reportSequence = before.reportSequence;
    expect(after).toEqual(before);
    expect(f.store.data.jobs[0].reports?.[0].id).toBe(p.record.id);
  });
  it('ponowne generowanie zachowuje ID, numer, wersję, datę i liczbę raportów', async () => {
    const f = fixture(),
      p = await f.quick.prepare('job-1', defaultReportOptions());
    await f.quick.save('job-1', p);
    f.tick();
    const before = f.storage.getItem(STORAGE_KEY),
      again = await f.quick.prepare('job-1', defaultReportOptions());
    expect(again.reused).toBe(true);
    expect(again.record).toEqual(p.record);
    await f.quick.save('job-1', again);
    expect(f.storage.getItem(STORAGE_KEY)).toBe(before);
  });
  it('zmiana treści daje nową wersję tego samego numeru, pozostawiając wcześniejszą migawkę', async () => {
    const f = fixture(),
      one = await f.quick.prepare('job-1', defaultReportOptions());
    await f.quick.save('job-1', one);
    f.details();
    f.tick();
    const two = await f.quick.prepare('job-1', defaultReportOptions());
    await f.quick.save('job-1', two);
    expect(two.record).toMatchObject({ number: one.record.number, version: 2 });
    expect(two.record.id).not.toBe(one.record.id);
    expect(f.store.data.jobs[0].reports?.[0]).toEqual(one.record);
    expect(f.store.data.reportSequence).toBe(1);
  });
  it('historyczny PDF odtwarza zapisane dane po zmianie klienta i podsumowania', async () => {
    const f = fixture(),
      one = await f.service.prepare('job-1', defaultReportOptions());
    await f.service.save('job-1', one);
    f.store.saveClient({
      ...f.store.data.clients[0],
      name: 'NOWA NAZWA KLIENTA',
    });
    f.details();
    const text = await pdfText(await f.service.regenerate(one.record));
    expect(text).toContain('Anna Kowalska');
    expect(text).not.toContain('NOWA NAZWA KLIENTA');
    expect(text).toContain('Żółć');
  });
  it('zmiana wewnętrznych notatek nie tworzy nowej publicznej wersji i nie jest nadpisywana zapisem raportu', async () => {
    const f = fixture(),
      one = await f.quick.prepare('job-1', defaultReportOptions());
    f.store.saveJob({
      ...f.store.data.jobs[0],
      notes: 'NOWA_PRYWATNA_NOTATKA',
    });
    await f.quick.save('job-1', one);
    expect(f.store.data.jobs[0].notes).toBe('NOWA_PRYWATNA_NOTATKA');
    expect(
      (await f.quick.prepare('job-1', defaultReportOptions())).reused,
    ).toBe(true);
  });
  it('chroni finanse zmienione po podglądzie przed zapisaniem nieaktualnej wersji', async () => {
    const f = fixture(),
      p = await f.quick.prepare('job-1', {
        ...defaultReportOptions(),
        showFinance: true,
      });
    f.store.savePayment({
      id: 'second',
      jobId: 'job-1',
      amountCents: 1000,
      receivedDate: day,
      method: 'cash',
      note: '',
    });
    await expect(f.quick.save('job-1', p)).rejects.toThrow('zmieniły');
    expect(f.store.data.jobs[0].reports).toBeUndefined();
    expect(f.store.data.payments).toHaveLength(2);
  });
  it('numery są unikalne przy raportach różnych wizyt i konflikcie dwóch kart', async () => {
    const f = fixture();
    f.store.completeJob('job-2');
    const a = await f.quick.prepare('job-1', defaultReportOptions()),
      b = await f.quick.prepare('job-2', defaultReportOptions());
    await f.quick.save('job-1', a);
    await expect(f.quick.save('job-2', b)).rejects.toThrow('zmieniły');
    const next = await f.quick.prepare('job-2', defaultReportOptions());
    await f.quick.save('job-2', next);
    expect(next.record.number).not.toBe(a.record.number);
    expect(f.store.data.reportSequence).toBe(2);
  });
  it('równoczesne zapisy dwóch generatorów zachowują unikalną numerację i odrzucają nieaktualny podgląd', async () => {
    const f = fixture();
    f.store.completeJob('job-2');
    const other = new ReportService(
      new GardenStore(f.repo),
      f.assets,
      fast,
      () => clock,
    );
    const a = await f.quick.prepare('job-1', defaultReportOptions()),
      b = await other.prepare('job-2', defaultReportOptions());
    const results = await Promise.allSettled([
      f.quick.save('job-1', a),
      other.save('job-2', b),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(f.repo.load().reportSequence).toBe(1);
  });
  it('ponowiony ten sam zapis podglądu nie tworzy drugiej wersji ani nowego numeru', async () => {
    const f = fixture(),
      p = await f.quick.prepare('job-1', defaultReportOptions());
    await Promise.all([f.quick.save('job-1', p), f.quick.save('job-1', p)]);
    expect(f.repo.load().jobs[0].reports).toHaveLength(1);
    expect(f.repo.load().reportSequence).toBe(1);
  });
  it('stary formularz zlecenia nie usuwa raportów, podsumowania i historii czasu', async () => {
    const f = fixture(),
      old = structuredClone(f.store.data.jobs[0]);
    f.details();
    const p = await f.quick.prepare('job-1', defaultReportOptions());
    await f.quick.save('job-1', p);
    const saved = structuredClone(f.store.data.jobs[0]);
    f.store.saveJob({ ...old, title: 'Zmieniona nazwa' });
    expect(f.store.data.jobs[0]).toMatchObject({
      visitDetails: saved.visitDetails,
      timeHistory: saved.timeHistory,
      reports: saved.reports,
    });
  });
  it('nie przelicza zatwierdzonej należności po zmianie listy materiałów', async () => {
    const f = fixture(),
      before = structuredClone(f.store.data.jobs[0].settlement);
    f.store.addJobMaterial('job-1', 'garden-1', {
      id: 'new',
      name: 'Ziemia',
      quantity: 20,
      unit: 'l',
      unitPrice: 10,
      purchaseUnitPrice: 7,
    });
    const p = await f.quick.prepare('job-1', {
      ...defaultReportOptions(),
      showFinance: true,
    });
    expect(p.record.snapshot.finance?.totalCents).toBe(53700);
    await f.quick.save('job-1', p);
    expect(f.store.data.jobs[0].settlement).toEqual(before);
  });
  it('ryczałt pozostaje zatwierdzonym ryczałtem bez nowego zaokrąglenia', async () => {
    const f = fixture();
    f.store.saveJob({
      ...f.store.data.jobs[1],
      billing: 'fixed',
      fixedPrice: 463.25,
    });
    f.store.completeJob('job-2');
    f.store.approveSettlement('job-2', 46325, 'fixed');
    const p = await f.quick.prepare('job-2', {
      ...defaultReportOptions(),
      showFinance: true,
    });
    expect(p.record.snapshot.finance).toMatchObject({
      laborCents: 46325,
      billing: 'fixed',
    });
  });
  it('awaria zapisu nie zmienia historii, licznika ani płatności', async () => {
    const f = fixture(),
      p = await f.quick.prepare('job-1', defaultReportOptions()),
      before = f.storage.getItem(STORAGE_KEY);
    f.storage.failKey = STORAGE_KEY;
    await expect(f.quick.save('job-1', p)).rejects.toThrow('pełna');
    expect(f.storage.getItem(STORAGE_KEY)).toBe(before);
  });
});

describe('podsumowanie oraz obserwacja stopera', () => {
  it('zapisuje publiczną treść i strefę bez zmiany czasu, cen i notatek', () => {
    const f = fixture(),
      before = structuredClone(f.store.data);
    f.details();
    const next = structuredClone(f.store.data);
    delete next.jobs[0].visitDetails;
    expect(next).toEqual(before);
    expect(f.store.data.jobs[0].visitDetails).toMatchObject({
      zoneId: 'zone',
      zoneName: 'Rabata różana',
      revision: 1,
    });
  });
  it('chroni podsumowanie przed nieaktualnym zapisem i obcą strefą', () => {
    const f = fixture();
    f.details();
    expect(() =>
      f.store.saveVisitDetails(
        'job-1',
        { publicWork: 'Inny', clientRemarks: '', zoneId: null },
        0,
      ),
    ).toThrow('zmieniły');
    expect(() =>
      f.store.saveVisitDetails(
        'job-1',
        { publicWork: 'Inny', clientRemarks: '', zoneId: 'missing' },
        1,
      ),
    ).toThrow('strefę');
  });
  it('rejestruje start, pauzę, wznowienie i stop bez zmiany dokładnych sekund i reszty ms', () => {
    const f = fixture(false);
    f.store.startTimer('job-1');
    f.tick(11750);
    f.store.pauseTimer();
    expect(f.store.data.jobs[0].seconds).toBe(11);
    expect(f.store.data.timer?.remainderMs).toBe(750);
    f.tick(120250);
    f.store.resumeTimer();
    f.tick(12250);
    f.store.stopTimer();
    expect(f.store.data.jobs[0].seconds).toBe(24);
    expect(f.store.data.jobs[0].timeHistory?.map((e) => e.kind)).toEqual([
      'started',
      'paused',
      'resumed',
      'stopped',
    ]);
    expect(visitTime(f.store.data, f.store.data.jobs[0]).recordedPauseMs).toBe(
      120250,
    );
  });
  it('zakończenie wizyty na pauzie zapisuje przerwę i nie dolicza jej do pracy', () => {
    const f = fixture(false);
    f.store.startTimer('job-1');
    f.tick(5000);
    f.store.pauseTimer();
    f.tick(30000);
    f.store.completeJob('job-1');
    expect(f.store.data.jobs[0].seconds).toBe(5);
    expect(f.store.data.jobs[0].timeHistory?.at(-1)).toMatchObject({
      kind: 'completed',
      pauseDurationMs: 30000,
    });
  });
  it('korekta czasu zapisuje wartości przed/po, zachowując zatwierdzoną należność', () => {
    const f = fixture(),
      before = structuredClone(f.store.data.jobs[0].settlement);
    f.store.correctJobTime('job-1', 14001);
    expect(f.store.data.jobs[0].timeHistory?.at(-1)).toMatchObject({
      kind: 'corrected',
      beforeSeconds: 13620,
      afterSeconds: 14001,
    });
    expect(f.store.data.jobs[0].settlement).toEqual(before);
  });
  it('ponowne kliknięcia start/pauza bez zmiany stanu nie powielają zdarzeń', () => {
    const f = fixture(false);
    f.store.startTimer('job-1');
    f.store.startTimer('job-1');
    f.store.pauseTimer();
    f.store.pauseTimer();
    expect(f.store.data.jobs[0].timeHistory?.map((e) => e.kind)).toEqual([
      'started',
      'paused',
    ]);
  });
  it('podgląd raportu i zapis podsumowania nie dopisują zdarzeń stopera', async () => {
    const f = fixture(),
      history = structuredClone(f.store.data.jobs[0].timeHistory);
    f.details();
    const p = await f.quick.prepare('job-1', defaultReportOptions());
    await f.quick.save('job-1', p);
    expect(f.store.data.jobs[0].timeHistory).toEqual(history);
  });
  it('usunięta strefa zachowuje nazwę historyczną, a przeniesienie wizyty usuwa aktualne wskazanie', () => {
    const f = fixture();
    f.details();
    f.store.deleteZone('garden-1', 'zone');
    expect(f.store.data.jobs[0].visitDetails).toMatchObject({
      zoneId: null,
      zoneName: 'Rabata różana',
    });
  });
});

describe('migracja i pełne kopie', () => {
  it('v8 zachowuje dokładną kopię źródła oraz dotychczasowe dane bez fabrykowania historii', () => {
    const f = fixture(),
      old = legacy(f.store.data),
      raw = JSON.stringify({ version: 8, data: old });
    f.storage.setItem(STORAGE_KEY, raw);
    const migrated = f.repo.load();
    expect(migrated).toEqual({ ...old, reportSequence: 0 });
    expect(f.storage.getItem(V8_BACKUP_KEY)).toBe(raw);
    expect(migrated.jobs[0].timeHistory).toBeUndefined();
    expect(migrated.jobs[0].reports).toBeUndefined();
  });
  it.each([1, 2, 3, 4, 5, 6, 7])(
    'obsługuje migrację starszego formatu v%s',
    (version) => {
      const f = fixture(false),
        old = legacy(f.store.data);
      f.storage.setItem(STORAGE_KEY, JSON.stringify({ version, data: old }));
      const value = f.repo.load();
      expect(value.reportSequence).toBe(0);
      expect(value.clients).toEqual(old.clients);
      validateData(value);
    },
  );
  it('brak miejsca na kopię v8 nie nadpisuje oryginału', () => {
    const f = fixture(),
      raw = JSON.stringify({ version: 8, data: legacy(f.store.data) });
    f.storage.setItem(STORAGE_KEY, raw);
    f.storage.failKey = V8_BACKUP_KEY;
    expect(() => f.repo.load()).toThrow('kopii');
    expect(f.storage.getItem(STORAGE_KEY)).toBe(raw);
  });
  it('aktualny format wymaga licznika, a wadliwa kolekcja raportów nie jest usuwana', () => {
    const f = fixture(),
      raw = JSON.stringify({
        version: STORAGE_VERSION,
        data: legacy(f.store.data),
      });
    f.storage.setItem(STORAGE_KEY, raw);
    expect(() => f.repo.load()).toThrow();
    expect(f.storage.getItem(STORAGE_KEY)).toBe(raw);
    expect(() =>
      validateData({
        ...f.store.data,
        jobs: f.store.data.jobs.map((j, i) =>
          i ? j : { ...j, reports: null },
        ),
      }),
    ).toThrow();
  });
  it('pełny ZIP odtwarza raport, przerwy i publiczne pola oraz zdjęcia ze stabilnymi identyfikatorami', async () => {
    const f = await withPhoto();
    f.details();
    const p = await f.service.prepare('job-1', {
      ...defaultReportOptions(),
      showPhotos: true,
      photoIds: [f.photo.id],
    });
    await f.service.save('job-1', p);
    const original = structuredClone(f.store.data),
      zip = await f.photos.exportFull();
    f.store.saveVisitDetails(
      'job-1',
      { publicWork: 'Zmiana', clientRemarks: '', zoneId: null },
      1,
    );
    const prepared = await f.photos.prepare(zip);
    await f.photos.importFull(prepared.prepared, prepared.expected);
    expect(f.store.data.jobs).toEqual(original.jobs);
    expect(f.store.data.reportSequence).toBe(original.reportSequence);
    expect(
      await pdfText(
        await f.service.regenerate(f.store.data.jobs[0].reports![0]),
      ),
    ).toContain('róż');
  });
  it('odtworzenie starszej kopii nie przydziela ponownie numerów znanych na urządzeniu', async () => {
    const f = await withPhoto(),
      first = await f.quick.prepare('job-1', defaultReportOptions());
    await f.quick.save('job-1', first);
    const zip = await f.photos.exportFull();
    f.store.completeJob('job-2');
    const second = await f.quick.prepare('job-2', defaultReportOptions());
    await f.quick.save('job-2', second);
    const prepared = await f.photos.prepare(zip);
    await f.photos.importFull(prepared.prepared, prepared.expected);
    expect(f.store.data.reportSequence).toBe(2);
    expect(f.store.data.jobs[1].reports).toBeUndefined();
    f.store.completeJob('job-2');
    const next = await f.quick.prepare('job-2', defaultReportOptions());
    expect(next.record.number).not.toBe(second.record.number);
    expect(next.record.number.endsWith('/000003')).toBe(true);
  });
  it.each([6, 7, 8])(
    'odczytuje wcześniejszy pełny ZIP v%s',
    async (version) => {
      const f = await withPhoto(),
        files = unzipSync(
          new Uint8Array(await (await f.photos.exportFull()).arrayBuffer()),
        ),
        data = legacy(f.store.data);
      files['data.json'] = strToU8(JSON.stringify({ version, data }));
      const manifest = JSON.parse(strFromU8(files['manifest.json']));
      manifest.dataSha256 = await sha256(
        new Blob([files['data.json'].slice().buffer]),
      );
      files['manifest.json'] = strToU8(JSON.stringify(manifest));
      const value = await readFullBackup(
        new Blob([zipSync(files).slice().buffer]),
      );
      expect(value.data.reportSequence).toBe(0);
      expect(value.assets).toHaveLength(1);
    },
  );
  it('stary punkt odzyskiwania v8 można wyeksportować i przywrócić', async () => {
    const f = await withPhoto();
    await f.assets.stageRestore([], {
      id: 'old-v8',
      data: legacy(f.store.data),
      createdAt: clock,
      stagedAssetIds: [],
    });
    await f.assets.finishRestore();
    expect(
      (await readFullBackup(await f.photos.exportRecovery())).data
        .reportSequence,
    ).toBe(0);
    const p = await f.photos.prepareRecovery();
    await f.photos.restoreRecovery(p.point.id, p.expected);
    expect(f.store.data.jobs[0].timeHistory).toBeUndefined();
  });
  it('usunięcie zdjęcia nie zmienia migawki historii, a regeneracja zgłasza brak obrazu', async () => {
    const f = await withPhoto(),
      p = await f.quick.prepare('job-1', {
        ...defaultReportOptions(),
        showPhotos: true,
        photoIds: [f.photo.id],
      });
    await f.quick.save('job-1', p);
    const before = structuredClone(f.store.data.jobs[0].reports);
    await f.photos.remove(f.photo);
    expect(f.store.data.jobs[0].reports).toEqual(before);
    await expect(f.service.regenerate(p.record)).rejects.toThrow('niedostępne');
  });
  it('walidacja odrzuca dodatkowe prywatne pola w migawce i nieprawidłową numerację', async () => {
    const f = fixture(),
      p = await f.quick.prepare('job-1', defaultReportOptions());
    await f.quick.save('job-1', p);
    for (const r of [
      { ...p.record, snapshot: { ...p.record.snapshot, notes: 'PRIVATE' } },
      { ...p.record, version: 4 },
    ])
      expect(() =>
        validateData({
          ...f.store.data,
          jobs: f.store.data.jobs.map((j, i) =>
            i ? j : { ...j, reports: [r as VisitReport] },
          ),
        }),
      ).toThrow();
  });
});
