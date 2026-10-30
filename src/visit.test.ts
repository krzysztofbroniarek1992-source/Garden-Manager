import { describe, expect, it } from 'vitest';
import { billingBreakdown, calculatedLaborCents, clientSummary, elapsedSeconds, jobTotalCents, legacySettlement, pauseActiveTimer, resumeActiveTimer, roundLaborTo50Cents, startWork, stopActiveTimer, type Data, type Job, type Payment } from './domain';
import { createDemoData } from './data/demo';
import { LEGACY_BACKUP_KEY, LocalRepository, STORAGE_KEY, STORAGE_VERSION, V2_BACKUP_KEY, type StoragePort } from './data/repository';
import { GardenStore } from './data/store';

class MemoryStorage implements StoragePort {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

function fixture() {
  const storage = new MemoryStorage();
  let now = 100_000;
  const store = new GardenStore(new LocalRepository(storage), () => now);
  return { storage, store, advance: (ms: number) => { now += ms; }, clock: () => now };
}

const receipt = (amountCents: number, id = 'receipt'): Payment => ({ id, jobId: 'job-1', amountCents, receivedDate: '2026-10-30', method: 'transfer', note: '' });

function rawV2(data: Data) {
  return {
    ...data,
    jobs: data.jobs.map(({ activities: _activities, settlement: _settlement, ...job }) => job),
    timer: data.timer ? { jobId: data.timer.jobId, startedAt: data.timer.startedAt } : null,
  };
}

describe('wizyta, pauza i rzeczywiste sekundy', () => {
  it('pauza zapisuje czas, przerwa nie nalicza się, wznowienie i STOP dodają tylko pracę', () => {
    const { store, storage, advance, clock } = fixture();
    store.startTimer('job-1');
    advance(61_000);
    store.pauseTimer();
    expect(store.data.jobs[0].seconds).toBe(61);
    expect(store.data.timer?.paused).toBe(true);
    advance(600_000);
    const restored = new GardenStore(new LocalRepository(storage), clock);
    expect(elapsedSeconds(restored.data.jobs[0], restored.data.timer, clock())).toBe(61);
    expect(() => restored.startTimer('job-2')).toThrow('zatrzymaj');
    restored.resumeTimer();
    advance(39_000);
    restored.stopTimer();
    expect(restored.data.timer).toBeNull();
    expect(restored.data.jobs[0].seconds).toBe(100);
    const final = new LocalRepository(storage).load();
    expect(final.jobs[0].seconds).toBe(100);
  });

  it('nie gubi ułamków sekund przy kolejnych pauzach i ponowne pauzowanie jest idempotentne', () => {
    const started = startWork(createDemoData(), 'job-1', 1000);
    const paused = pauseActiveTimer(started, 1750);
    expect(paused.jobs[0].seconds).toBe(0);
    expect(paused.timer?.remainderMs).toBe(750);
    expect(pauseActiveTimer(paused, 9000)).toBe(paused);
    const resumed = resumeActiveTimer(paused, 10_000);
    expect(elapsedSeconds(resumed.jobs[0], resumed.timer, 10_750)).toBe(1);
    expect(stopActiveTimer(resumed, 10_750).jobs[0].seconds).toBe(1);
  });

  it('STOP podczas pauzy i zakończenie zlecenia nie doliczają przerwy', () => {
    const { store, advance } = fixture();
    store.startTimer('job-1');
    advance(30_000); store.pauseTimer();
    advance(50_000); store.stopTimer();
    expect(store.data.jobs[0].seconds).toBe(30);
    store.startTimer('job-1'); advance(15_000); store.pauseTimer();
    advance(100_000); store.completeJob('job-1');
    expect(store.data.jobs[0]).toMatchObject({ status: 'completed', seconds: 45, settlement: null });
    expect(store.data.timer).toBeNull();
  });

  it('ręczna korekta ma dokładność sekundy i wymaga zakończenia pomiaru', () => {
    const { store, storage } = fixture();
    store.startTimer('job-1');
    expect(() => store.correctJobTime('job-1', 100)).toThrow('zakończ pomiar');
    store.pauseTimer();
    expect(() => store.correctJobTime('job-1', 100)).toThrow('zakończ pomiar');
    store.stopTimer();
    for (const seconds of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => store.correctJobTime('job-1', seconds)).toThrow('pełnych sekundach');
    }
    store.correctJobTime('job-1', 11_333, 0);
    expect(store.data.jobs[0].seconds).toBe(11_333);
    expect(new LocalRepository(storage).load().jobs[0].seconds).toBe(11_333);
    expect(() => store.correctJobTime('job-1', 10, 0)).toThrow('innej karcie');
  });

  it('kilka czynności należy do jednego zlecenia i nie resetuje stopera', () => {
    const { store, advance, clock } = fixture();
    store.startTimer('job-1'); advance(30_000);
    store.saveJob({ ...store.data.jobs[0], activities: ['Cięcie żywopłotu', 'Koszenie', 'Oprysk', 'Sprzątanie'] });
    advance(30_000);
    expect(elapsedSeconds(store.data.jobs[0], store.data.timer, clock())).toBe(60);
    expect(store.data.jobs[0].activities).toHaveLength(4);
    store.stopTimer();
    expect(store.data.jobs[0].seconds).toBe(60);
  });

  it('zwykła edycja notatek lub czynności nie nadpisuje nowszej ręcznej korekty czasu', () => {
    const { store, storage } = fixture();
    const stale = structuredClone(store.data.jobs[0]);
    const other = new GardenStore(new LocalRepository(storage));
    other.correctJobTime('job-1', 1337);
    store.saveJob({ ...stale, notes: 'Zmieniona notatka', activities: ['Koszenie', 'Sprzątanie'] });
    expect(store.data.jobs[0]).toMatchObject({ seconds: 1337, notes: 'Zmieniona notatka', activities: ['Koszenie', 'Sprzątanie'] });
    expect(new LocalRepository(storage).load().jobs[0].seconds).toBe(1337);
  });
});

describe('propozycja 50 zł i zatwierdzona cena robocizny', () => {
  it.each([[270, 250], [420, 400], [454, 450], [475, 500], [520, 500], [690, 700]])('zaokrągla %s zł do %s zł bez zmiany czasu', (amount, expected) => {
    expect(roundLaborTo50Cents(amount * 100)).toBe(expected * 100);
  });

  it('454 zł pracy + 87 zł materiałów daje po akceptacji propozycji należność 537 zł', () => {
    const { store } = fixture();
    store.correctJobTime('job-1', 13_620);
    store.saveJob({ ...store.data.jobs[0], materials: [{ id: 'material', name: 'Materiały klienta', quantity: 1, unitPrice: 87 }] });
    store.completeJob('job-1');
    expect(calculatedLaborCents(store.data.jobs[0])).toBe(45_400);
    expect(jobTotalCents(store.data.jobs[0])).toBe(54_100);
    expect(store.data.jobs[0].seconds).toBe(13_620);
    expect(store.data.jobs[0].settlement).toBeNull();
    store.approveSettlement('job-1', 45_000, 'rounded', store.data.jobs[0]);
    expect(billingBreakdown(store.data.jobs[0])).toMatchObject({ calculatedLaborCents: 45_400, suggestedLaborCents: 45_000, materialsCents: 8700, finalLaborCents: 45_000, totalCents: 53_700, actualSeconds: 13_620, approved: true });
  });

  it('nie zatwierdza ceny przez samo zakończenie i nie zalicza oczekującej wyceny do finansów', () => {
    const { store } = fixture();
    store.correctJobTime('job-1', 8100);
    store.completeJob('job-1');
    const before = clientSummary(store.data, 'client-1');
    expect(before.completedCount).toBe(2);
    expect(before.completedValueCents).toBe(30_000); // Legacy completed job only.
    expect(before.outstandingCents).toBe(30_000);
    expect(() => store.savePayment(receipt(100))).toThrow('zatwierdź cenę');
    store.approveSettlement('job-1', 25_000, 'rounded');
    expect(clientSummary(store.data, 'client-1').completedValueCents).toBe(55_000);
    expect(store.data.payments).toEqual([]);
  });

  it('własna cena jest trwała i korekta czasu, stawki lub materiałów nie przelicza jej samoczynnie', () => {
    const { store, storage } = fixture();
    store.correctJobTime('job-1', 16_500); // 550 zł.
    store.completeJob('job-1');
    store.approveSettlement('job-1', 50_000, 'manual');
    const approved = structuredClone(store.data.jobs[0].settlement);
    store.correctJobTime('job-1', 7200);
    store.saveJob({ ...store.data.jobs[0], rate: 150, materials: [{ id: 'new', name: 'Późniejszy materiał', quantity: 1, unitPrice: 12 }] });
    expect(store.data.jobs[0].settlement).toEqual(approved);
    expect(jobTotalCents(store.data.jobs[0])).toBe(50_000);
    expect(new LocalRepository(storage).load().jobs[0].settlement).toEqual(approved);
    expect(calculatedLaborCents(store.data.jobs[0])).toBe(30_000);
    store.approveSettlement('job-1', 35_000, 'manual', store.data.jobs[0]);
    expect(jobTotalCents(store.data.jobs[0])).toBe(36_200);
  });

  it('ryczałt zachowuje czas, nie proponuje 50 zł i wymaga jawnej akceptacji', () => {
    const { store } = fixture();
    store.correctJobTime('job-2', 12_345);
    store.saveJob({ ...store.data.jobs[1], fixedPrice: 475 });
    store.completeJob('job-2');
    expect(billingBreakdown(store.data.jobs[1])).toMatchObject({ actualSeconds: 12_345, calculatedLaborCents: 47_500, suggestedLaborCents: null, approved: false });
    expect(() => store.approveSettlement('job-2', 50_000, 'rounded')).toThrow('poprawny sposób');
    store.approveSettlement('job-2', 47_500, 'fixed');
    expect(jobTotalCents(store.data.jobs[1])).toBe(47_500);
    expect(store.data.jobs[1].seconds).toBe(12_345);
  });

  it('płatności częściowe zachowują grosze i zabraniają zatwierdzenia należności poniżej otrzymanych wpłat', () => {
    const { store } = fixture();
    store.correctJobTime('job-1', 13_620);
    store.saveJob({ ...store.data.jobs[0], materials: [{ id: 'm', name: 'Materiały', quantity: 1, unitPrice: 87 }] });
    store.completeJob('job-1');
    store.approveSettlement('job-1', 45_000, 'rounded');
    store.savePayment(receipt(25_001));
    store.savePayment(receipt(28_699, 'second'));
    expect(store.data.payments.map(payment => payment.amountCents)).toEqual([25_001, 28_699]);
    expect(() => store.approveSettlement('job-1', 44_999, 'manual')).toThrow('niższa');
    expect(jobTotalCents(store.data.jobs[0])).toBe(53_700);
  });

  it('odrzuca zatwierdzenie ceny z nieaktualnego formularza i nie usuwa snapshotu zwykłą edycją', () => {
    const { store, storage } = fixture();
    store.correctJobTime('job-1', 8100); store.completeJob('job-1');
    const stale = structuredClone(store.data.jobs[0]);
    const other = new GardenStore(new LocalRepository(storage));
    other.correctJobTime('job-1', 9000);
    expect(() => store.approveSettlement('job-1', 25_000, 'rounded', stale)).toThrow('innej karcie');
    store.approveSettlement('job-1', 30_000, 'rounded');
    const approved = store.data.jobs[0].settlement;
    store.saveJob({ ...store.data.jobs[0], settlement: null, notes: 'Zwykła korekta notatki' });
    expect(store.data.jobs[0].settlement).toEqual(approved);
  });
});

describe('migracja istniejących należności 0.2', () => {
  it('kopiuje oryginał v2, zachowuje dane i wpłaty oraz zamraża dawne należności bez zaokrąglenia', () => {
    const storage = new MemoryStorage();
    const data = createDemoData();
    data.jobs[0] = { ...data.jobs[0], status: 'completed', seconds: 13_620, materials: [{ id: 'm', name: 'Materiał', quantity: 1, unitPrice: 87 }] };
    data.payments = [receipt(20_001)];
    const old = rawV2(data);
    const original = JSON.stringify({ version: 2, data: old }, null, 2);
    storage.setItem(STORAGE_KEY, original);
    const migrated = new LocalRepository(storage).load();
    expect(storage.getItem(V2_BACKUP_KEY)).toBe(original);
    expect(migrated.clients).toEqual(old.clients);
    expect(migrated.gardens).toEqual(old.gardens);
    expect(migrated.payments).toEqual(old.payments);
    expect(migrated.settings).toEqual(old.settings);
    expect(migrated.jobs.map(({ activities: _activities, settlement: _settlement, ...job }) => job)).toEqual(old.jobs);
    expect(migrated.jobs[0].activities).toEqual([old.jobs[0].title]);
    expect(migrated.jobs[0].settlement).toMatchObject({ source: 'legacy', calculatedLaborCents: 45_400, suggestedLaborCents: null, finalLaborCents: 45_400, materialsCents: 8700 });
    expect(jobTotalCents(migrated.jobs[0])).toBe(54_100);
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!).version).toBe(STORAGE_VERSION);
    const second = new LocalRepository(storage).load();
    expect(second).toEqual(migrated);
    expect(storage.getItem(V2_BACKUP_KEY)).toBe(original);
  });

  it('zachowuje działający stoper v2 i oddzielną poprzednią kopię v1', () => {
    const storage = new MemoryStorage();
    const data = startWork(createDemoData(), 'job-1', 1000);
    const original = JSON.stringify({ version: 2, data: rawV2(data) });
    storage.setItem(LEGACY_BACKUP_KEY, 'starsza kopia v1');
    storage.setItem(STORAGE_KEY, original);
    const result = new LocalRepository(storage).load();
    expect(result.timer).toEqual({ jobId: 'job-1', startedAt: 1000, paused: false });
    expect(elapsedSeconds(result.jobs[0], result.timer, 66_000)).toBe(65);
    expect(storage.getItem(LEGACY_BACKUP_KEY)).toBe('starsza kopia v1');
    expect(storage.getItem(V2_BACKUP_KEY)).toBe(original);
  });

  it('błąd kopii lub zapisu v3 nie zmienia źródła, a kolejne uruchomienie nie nadpisuje kopii', () => {
    for (const failure of [V2_BACKUP_KEY, STORAGE_KEY]) {
      const storage = new MemoryStorage();
      const original = JSON.stringify({ version: 2, data: rawV2(createDemoData()) });
      storage.setItem(STORAGE_KEY, original);
      const write = storage.setItem.bind(storage);
      storage.setItem = (key, value) => { if (key === failure) throw new Error('Quota'); write(key, value); };
      expect(() => new LocalRepository(storage).load()).toThrow();
      expect(storage.getItem(STORAGE_KEY)).toBe(original);
    }
    const storage = new MemoryStorage();
    storage.setItem(V2_BACKUP_KEY, 'pierwsza kopia');
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, data: rawV2(createDemoData()) }));
    new LocalRepository(storage).load();
    expect(storage.getItem(V2_BACKUP_KEY)).toBe('pierwsza kopia');
  });

  it('nie migruje uszkodzonego rejestru ani nadpłaty v2 pod pozorem nowej ceny', () => {
    const storage = new MemoryStorage();
    const data = rawV2(createDemoData());
    data.payments = [receipt(1_000_000)];
    const original = JSON.stringify({ version: 2, data });
    storage.setItem(STORAGE_KEY, original);
    expect(() => new LocalRepository(storage).load()).toThrow('przekracza wartość');
    expect(storage.getItem(STORAGE_KEY)).toBe(original);
    expect(storage.getItem(V2_BACKUP_KEY)).toBeNull();
  });
});
