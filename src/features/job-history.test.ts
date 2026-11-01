import { describe, expect, it } from 'vitest';
import { createDemoData } from '../data/demo';
import { GardenStore } from '../data/store';
import {
  LocalRepository,
  STORAGE_KEY,
  STORAGE_VERSION,
  type StoragePort,
} from '../data/repository';
import {
  clientSummary,
  legacySettlement,
  type Data,
  type Job,
} from '../domain';
import {
  groupJobHistory,
  gardenSummary,
  jobDeletionReview,
} from './job-history';
import { newNote } from '../desk/model';
import { ReportService } from '../reports/service';
import { defaultReportOptions } from '../reports/model';
import type { PhotoAssetRepository, PhotoMetadata } from '../photos/model';

const now = new Date('2026-11-01T10:00:00+01:00').getTime();
function fixture() {
  const d = createDemoData(new Date(now));
  d.timer = null;
  d.taskSchedules = [];
  d.taskOccurrences = [];
  d.payments = [];
  d.checklists = [];
  d.photos = [];
  d.notes = [];
  d.jobs = d.jobs
    .slice(0, 1)
    .map((j) => ({
      ...j,
      status: 'planned' as const,
      seconds: 0,
      settlement: null,
    }));
  return d;
}
function job(id: string, date: string, changes: Partial<Job> = {}): Job {
  return {
    ...fixture().jobs[0],
    id,
    date,
    materials: [],
    activities: ['Pielęgnacja'],
    ...changes,
  };
}
function approved(
  id: string,
  date: string,
  labor: number,
  materials = 0,
  changes: Partial<Job> = {},
): Job {
  const j = job(id, date, { status: 'completed', seconds: 3601, ...changes });
  return {
    ...j,
    settlement: {
      calculatedLaborCents: 45400,
      suggestedLaborCents: 45000,
      finalLaborCents: labor,
      materialsCents: materials,
      source: 'manual',
      approvedAt: now,
    },
  };
}
class MemoryStorage implements StoragePort {
  values = new Map<string, string>();
  getItem(k: string) {
    return this.values.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.values.set(k, v);
  }
}
function storeFixture(d = fixture()) {
  const storage = new MemoryStorage(),
    store = new GardenStore(new LocalRepository(storage, () => d), () => now);
  return { storage, store };
}

describe('roczna i miesięczna historia istniejących zleceń', () => {
  it('grupuje lata i miesiące, sortując pełne daty, godziny i identyfikatory', () => {
    const jobs = [
      job('a', '2025-12-01'),
      job('b', '2026-11-01', { time: '08:00' }),
      job('c', '2026-10-31'),
      job('d', '2026-11-01', { time: '12:00' }),
    ];
    const before = structuredClone(jobs),
      groups = groupJobHistory(jobs, null, now);
    expect(groups.map((m) => m.key)).toEqual(['2026-11', '2026-10', '2025-12']);
    expect(groups[0].jobs.map((j) => j.id)).toEqual(['d', 'b']);
    expect(groups.map((m) => m.year)).toEqual(['2026', '2026', '2025']);
    expect(jobs).toEqual(before);
  });
  it('sortuje chronologicznie również rosnąco', () => {
    const g = groupJobHistory(
      [job('a', '2026-11-01'), job('b', '2025-12-10'), job('c', '2026-11-02')],
      null,
      now,
      'asc',
    );
    expect(g.map((m) => m.key)).toEqual(['2025-12', '2026-11']);
    expect(g[1].jobs.map((j) => j.id)).toEqual(['a', 'c']);
  });
  it('sumuje zatwierdzone kwoty robocizny i materiałów bez ponownego wyceniania czasu', () => {
    const j = approved('manual', '2026-11-01', 45000, 8700, {
      rate: 99999,
      seconds: 17,
      materials: [
        { id: 'm', name: 'Zmieniony materiał', quantity: 999, unitPrice: 1 },
      ],
    });
    const g = groupJobHistory([j], null, now);
    expect(g[0].approvedValueCents).toBe(53700);
    expect(g[0].seconds).toBe(17);
  });
  it('zachowuje historyczne 541 zł i ryczałt 454 zł', () => {
    const a = approved('legacy', '2026-10-31', 54100),
      b = approved('fixed', '2026-10-30', 45400, 0, {
        billing: 'fixed',
        fixedPrice: 454,
      });
    a.settlement!.source = 'legacy';
    b.settlement!.source = 'fixed';
    expect(groupJobHistory([a, b], null, now)[0].approvedValueCents).toBe(
      99500,
    );
  });
  it('plan, praca w toku i cena niezatwierdzona nie zwiększają wartości wykonanych prac', () => {
    const jobs = [
      job('plan', '2026-11-01', { fixedPrice: 1000, billing: 'fixed' }),
      job('work', '2026-11-01', { status: 'in-progress', seconds: 60 }),
      job('pending', '2026-11-01', { status: 'completed', seconds: 30 }),
    ];
    expect(groupJobHistory(jobs, null, now)[0]).toMatchObject({
      approvedValueCents: 0,
      pendingPrices: 1,
      seconds: 90,
    });
  });
  it('sumuje czas bez zaokrąglania również dla historycznych ułamków', () => {
    const j = [
      job('a', '2026-11-01', { seconds: 0.75 }),
      job('b', '2026-11-02', { seconds: 0.75 }),
    ];
    expect(groupJobHistory(j, null, now)[0].seconds).toBe(1.5);
  });
  it('odczytuje aktywny pomiar ze znaczników i nie dolicza pauzy', () => {
    const j = job('active', '2026-11-01', {
        seconds: 15,
        status: 'in-progress',
      }),
      timer = {
        jobId: 'active',
        startedAt: now - 10250,
        paused: false,
        remainderMs: 750,
      };
    expect(groupJobHistory([j], timer, now)[0].seconds).toBe(26);
    expect(
      groupJobHistory([j], { ...timer, paused: true }, now)[0].seconds,
    ).toBe(15);
  });
  it('agregacja uwzględnia tylko zlecenia przekazane po filtrze statusu', () => {
    const j = [
      approved('done', '2026-11-01', 45000),
      job('planned', '2026-11-01'),
    ];
    expect(
      groupJobHistory(
        j.filter((j) => j.status === 'planned'),
        null,
        now,
      )[0],
    ).toMatchObject({ approvedValueCents: 0, seconds: 0 });
    expect(groupJobHistory([], null, now)).toEqual([]);
  });
  it('duża historia nie gubi zleceń ani groszy', () => {
    const j = Array.from({ length: 1000 }, (_, i) =>
      approved(
        String(i),
        `202${(i % 3) + 4}-${String((i % 12) + 1).padStart(2, '0')}-01`,
        1,
        2,
      ),
    );
    const g = groupJobHistory(j, null, now);
    expect(g.flatMap((m) => m.jobs)).toHaveLength(1000);
    expect(g.reduce((s, m) => s + m.approvedValueCents, 0)).toBe(3000);
    expect(new Set(g.flatMap((m) => m.jobs.map((j) => j.id))).size).toBe(1000);
  });
  it('rozliczenie ogrodu korzysta z podsumowania klienta ograniczonego do jego ogrodu', () => {
    const d = fixture(),
      garden = d.gardens[0];
    d.jobs = [
      approved('first', '2026-11-01', 45000, 8700),
      approved('second', '2026-11-01', 45400, 0, { gardenId: d.gardens[1].id }),
    ];
    d.payments = [
      {
        id: 'p',
        jobId: 'first',
        amountCents: 20000,
        receivedDate: '2026-11-01',
        method: 'cash',
        note: '',
      },
    ];
    const before = structuredClone(d);
    expect(gardenSummary(d, garden.id, now)).toEqual(
      clientSummary({ ...d, gardens: [garden] }, garden.clientId, now),
    );
    expect(gardenSummary(d, garden.id, now)).toMatchObject({
      completedValueCents: 53700,
      receivedCents: 20000,
      outstandingCents: 33700,
    });
    expect(d).toEqual(before);
  });
});

describe('bezpieczne zarządzanie zleceniami z ogrodu', () => {
  it('usuwa niechronione zlecenie dopiero przy zgodnym podglądzie dokumentacji', () => {
    const f = storeFixture(),
      r = jobDeletionReview(f.store.data, 'job-1');
    f.store.deleteJob('job-1', r.signature);
    expect(f.store.data.jobs).toEqual([]);
  });
  it('zablokowane zatwierdzone rozliczenie pozostaje zachowane także bez wpłat', () => {
    const d = fixture();
    d.jobs[0] = { ...d.jobs[0], status: 'completed' };
    d.jobs[0].settlement = legacySettlement(d.jobs[0], now);
    const f = storeFixture(d),
      before = f.storage.getItem(STORAGE_KEY);
    expect(() => f.store.deleteJob('job-1')).toThrow(
      'zatwierdzone rozliczenie',
    );
    expect(f.storage.getItem(STORAGE_KEY)).toBe(before);
  });
  it('blokuje wpłatę, aktywny pomiar i powiązanie z kalendarzem', () => {
    const f = storeFixture();
    f.store.startTimer('job-1');
    expect(() => f.store.deleteJob('job-1')).toThrow('stoper');
    f.store.stopTimer();
    f.store.correctJobTime('job-1', 3600);
    f.store.savePayment({
      id: 'p',
      jobId: 'job-1',
      amountCents: 1,
      receivedDate: '2026-11-01',
      method: 'cash',
      note: '',
    });
    expect(() => f.store.deleteJob('job-1')).toThrow('ma płatności');
  });
  it('chroni raport bez finansów przed utratą jego historii', async () => {
    const d = fixture();
    d.jobs[0].status = 'completed';
    const f = storeFixture(d),
      service = new ReportService(
        {
          snapshot: f.store.snapshot,
          saveVisitReport: f.store.saveVisitReport,
        },
        {} as PhotoAssetRepository,
        async () => new Uint8Array([1]),
        () => now,
      );
    const r = await service.prepare('job-1', defaultReportOptions());
    await service.save('job-1', r);
    expect(() => f.store.deleteJob('job-1')).toThrow('raporty');
    expect(f.store.data.jobs[0].reports).toHaveLength(1);
  });
  it('zachowuje notatki i checklisty po świadomym usunięciu niezatwierdzonej wizyty', () => {
    const f = storeFixture();
    f.store.saveNote({
      ...newNote(f.store.data, { jobId: 'job-1' }),
      title: 'Obserwacja',
      body: 'Zachowana',
    });
    f.store.createBlankChecklist({ kind: 'visit', jobId: 'job-1' }, 'Lista');
    const review = jobDeletionReview(f.store.data, 'job-1');
    expect(review).toMatchObject({ notes: 1, checklists: 1 });
    f.store.deleteJob('job-1', review.signature);
    expect(f.store.data.notes[0]).toMatchObject({
      jobId: null,
      gardenId: 'garden-1',
      jobTitle: 'Pielęgnacja ogrodu',
      body: 'Zachowana',
    });
    expect(f.store.data.checklists[0]).toMatchObject({
      jobId: null,
      gardenId: 'garden-1',
      jobTitle: 'Pielęgnacja ogrodu',
    });
  });
  it('liczy dokumentację w potwierdzeniu, bez usuwania plików przez sam podgląd', () => {
    const d = fixture();
    d.photos = [
      { id: 'photo', jobId: 'job-1', deletedAt: null } as PhotoMetadata,
    ];
    const before = structuredClone(d);
    expect(jobDeletionReview(d, 'job-1').photos).toBe(1);
    expect(d).toEqual(before);
  });
  it('nowa notatka po otwarciu potwierdzenia blokuje usunięcie z nieaktualnym opisem skutków', () => {
    const f = storeFixture(),
      r = jobDeletionReview(f.store.data, 'job-1');
    f.store.saveNote({
      ...newNote(f.store.data, { jobId: 'job-1' }),
      title: 'Nowa',
      body: 'Ważna',
    });
    const before = f.storage.getItem(STORAGE_KEY);
    expect(() => f.store.deleteJob('job-1', r.signature)).toThrow(
      'dokumentacja zmieniły',
    );
    expect(f.storage.getItem(STORAGE_KEY)).toBe(before);
  });
  it('edycja formularza nie nadpisuje materiału dopisanego w innej karcie', () => {
    const f = storeFixture(),
      original = structuredClone(f.store.data.jobs[0]);
    f.store.addJobMaterial('job-1', 'garden-1', {
      id: 'later',
      name: 'Kora',
      quantity: 1,
      unitPrice: 20,
    });
    expect(() =>
      f.store.saveJob({ ...original, title: 'Poprawiony' }, original),
    ).toThrow('innej karcie');
    expect(f.store.data.jobs[0].materials.some((m) => m.id === 'later')).toBe(
      true,
    );
  });
  it('zapis nie odtwarza zlecenia usuniętego po otwarciu formularza', () => {
    const f = storeFixture(),
      j = structuredClone(f.store.data.jobs[0]);
    f.store.deleteJob(j.id);
    expect(() => f.store.saveJob({ ...j, title: 'Odświeżony' }, j)).toThrow(
      'usunięte',
    );
    expect(f.store.data.jobs).toHaveLength(0);
  });
  it('prawidłowa edycja chroni zatwierdzoną kwotę i wpłaty', () => {
    const d = fixture();
    d.jobs[0] = approved('job-1', '2026-11-01', 45000);
    d.payments = [
      {
        id: 'paid',
        jobId: 'job-1',
        amountCents: 10000,
        receivedDate: '2026-11-01',
        method: 'cash',
        note: '',
      },
    ];
    const f = storeFixture(d),
      j = structuredClone(f.store.data.jobs[0]);
    f.store.saveJob({ ...j, title: 'Nowy opis', rate: 9999 }, j);
    expect(f.store.data.jobs[0].settlement).toEqual(j.settlement);
    expect(f.store.data.payments).toEqual(d.payments);
  });
  it('nie dodaje migracji ani pól do istniejącego formatu v9', () => {
    const f = storeFixture(),
      before = f.storage.getItem(STORAGE_KEY);
    groupJobHistory(f.store.data.jobs, null, now);
    gardenSummary(f.store.data, 'garden-1', now);
    jobDeletionReview(f.store.data, 'job-1');
    expect(f.storage.getItem(STORAGE_KEY)).toBe(before);
    expect(JSON.parse(before!).version).toBe(9);
    expect(STORAGE_VERSION).toBe(9);
  });
});
