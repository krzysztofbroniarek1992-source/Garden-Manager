import { describe, expect, it } from 'vitest';
import { clientSummary, jobLaborCents, jobTotalCents, materialsTotalCents, moneyCents, paidCents, remainingCents, settlementStatus, startWork, toCents, type Data, type Job, type Payment } from './domain';
import { createDemoData } from './data/demo';
import { LEGACY_BACKUP_KEY, LocalRepository, STORAGE_KEY, STORAGE_VERSION, validateData, type StoragePort } from './data/repository';
import { GardenStore } from './data/store';

class MemoryStorage implements StoragePort {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}
const payment = (amountCents: number, id = 'p1', jobId = 'job-6'): Payment => ({ id, jobId, amountCents, receivedDate: '2026-10-29', method: 'transfer', note: 'Wpłata testowa' });
function fixture() {
  const storage = new MemoryStorage();
  const repository = new LocalRepository(storage);
  const store = new GardenStore(repository, () => 100_000);
  return { storage, repository, store };
}
function legacySnapshot(data = createDemoData()) {
  const { payments: _payments, ...legacy } = data;
  return JSON.stringify({ version: 1, data: legacy }, null, 2);
}

describe('kwoty w pełnych groszach', () => {
  it('liczy wartości dziesiętne bez artefaktów zmiennoprzecinkowych', () => {
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents('1.005')).toBe(101);
    expect(toCents('1,99')).toBe(199);
    expect(toCents('1e-2')).toBe(1);
    expect(toCents(1e-7)).toBe(0);
    const job: Job = { ...createDemoData().jobs[0], rate: 120, seconds: 1, materials: [
      { id: 'm1', name: 'Pierwszy', quantity: 3, unitPrice: 0.1 },
      { id: 'm2', name: 'Drugi', quantity: 1, unitPrice: 0.2 },
    ] };
    expect(jobLaborCents(job)).toBe(3);
    expect(materialsTotalCents(job)).toBe(50);
    expect(jobTotalCents(job)).toBe(53);
  });

  it('sumuje dokładne ułamki materiałów, potem zaokrągla subtotal oraz czas do grosza', () => {
    const job: Job = { ...createDemoData().jobs[0], seconds: 5400, rate: 100.01, materials: [
      { id: 'm1', name: 'Pierwszy', quantity: 0.5, unitPrice: 0.01 },
      { id: 'm2', name: 'Drugi', quantity: 0.5, unitPrice: 0.01 },
    ] };
    expect(jobLaborCents(job)).toBe(15002);
    expect(materialsTotalCents(job)).toBe(1);
    expect(jobTotalCents(job)).toBe(15003);
    expect(jobTotalCents({ ...job, billing: 'fixed', fixedPrice: 10.99 })).toBe(1100);
  });

  it('zachowuje wartość v0.1 dla kilku materiałów z ułamkową ilością', () => {
    const job: Job = { ...createDemoData().jobs[0], billing: 'fixed', fixedPrice: 100, materials: [
      { id: 'm1', name: 'Pierwszy', quantity: 1.5, unitPrice: 1.05 },
      { id: 'm2', name: 'Drugi', quantity: 1.5, unitPrice: 1.05 },
    ] };
    expect(materialsTotalCents(job)).toBe(315);
    expect(jobTotalCents(job)).toBe(10315);
  });

  it('formatuje pełne grosze dokładnie także na granicy bezpiecznych liczb', () => {
    expect(moneyCents(Number.MAX_SAFE_INTEGER).replace(/[^\d,-]/g, '')).toBe('90071992547409,91');
    expect(moneyCents(-Number.MAX_SAFE_INTEGER).replace(/[^\d,-]/g, '')).toBe('-90071992547409,91');
    expect(moneyCents(-1).replace(/[^\d,-]/g, '')).toBe('-0,01');
    expect(moneyCents(1).replace(/[^\d,-]/g, '')).toBe('0,01');
  });

  it('odrzuca kwoty niefinitywne lub przekraczające bezpieczny zakres', () => {
    expect(() => toCents(Number.NaN)).toThrow();
    expect(() => toCents(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => toCents('nie kwota')).toThrow();
    expect(() => toCents('9007199254740992')).toThrow('bezpieczny zakres');
  });
});

describe('rejestr płatności i niezależny status rozliczenia', () => {
  it('stare zakończone zlecenie bez płatności pozostaje nierozliczone', () => {
    const { store } = fixture();
    const job = store.data.jobs.find(item => item.id === 'job-6')!;
    expect(job.status).toBe('completed');
    expect(settlementStatus(job, store.data.payments)).toBe('unpaid');
    expect(remainingCents(job, store.data.payments)).toBe(30000);
    expect(paidCents(job.id, store.data.payments)).toBe(0);
  });

  it('zakończenie pracy nie dopisuje płatności ani nie rozlicza zlecenia', () => {
    const { store } = fixture();
    store.completeJob('job-2');
    const job = store.data.jobs.find(item => item.id === 'job-2')!;
    expect(settlementStatus(job, store.data.payments)).toBe('unpaid');
    expect(store.data.payments).toEqual([]);
    expect(remainingCents(job, store.data.payments)).toBe(45000);
  });

  it('rozlicza zlecenie w dwóch częściach i odtwarza wpłaty po odświeżeniu', () => {
    const { store, storage } = fixture();
    const job = store.data.jobs.find(item => item.id === 'job-6')!;
    store.savePayment(payment(10000));
    expect(settlementStatus(job, store.data.payments)).toBe('partial');
    expect(remainingCents(job, store.data.payments)).toBe(20000);
    store.savePayment(payment(20000, 'p2'));
    const restored = new GardenStore(new LocalRepository(storage));
    expect(restored.data.payments).toHaveLength(2);
    expect(paidCents(job.id, restored.data.payments)).toBe(30000);
    expect(settlementStatus(job, restored.data.payments)).toBe('paid');
    expect(remainingCents(job, restored.data.payments)).toBe(0);
  });

  it('edytuje płatność bez podwójnego doliczania i pozwala usunąć błędny wpis', () => {
    const { store } = fixture();
    store.savePayment(payment(10000));
    store.savePayment(payment(20000, 'p2'));
    store.savePayment({ ...payment(15000, 'p2'), method: 'cash', note: ' Poprawiono kwotę ' });
    expect(store.data.payments).toHaveLength(2);
    expect(paidCents('job-6', store.data.payments)).toBe(25000);
    expect(store.data.payments[1]).toMatchObject({ method: 'cash', note: 'Poprawiono kwotę' });
    store.deletePayment('p1');
    expect(paidCents('job-6', store.data.payments)).toBe(15000);
    store.deletePayment('p2');
    expect(paidCents('job-6', store.data.payments)).toBe(0);
    expect(() => store.deletePayment('missing')).toThrow('Nie znaleziono');
  });

  it('blokuje ujemne, zerowe, niecałkowite, zbyt duże i przekraczające należność kwoty', () => {
    const { store, storage } = fixture();
    for (const amount of [-1, 0, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1, 30001]) {
      const before = storage.getItem(STORAGE_KEY);
      expect(() => store.savePayment(payment(amount))).toThrow();
      expect(storage.getItem(STORAGE_KEY)).toBe(before);
    }
    store.savePayment(payment(10000));
    expect(() => store.savePayment(payment(20001, 'p2'))).toThrow('przekracza należność');
    store.savePayment(payment(20000, 'p2'));
    expect(() => store.savePayment(payment(10001))).toThrow('przekracza należność');
    expect(paidCents('job-6', store.data.payments)).toBe(30000);
  });

  it('weryfikuje datę, metodę, zlecenie i nie zmienia zlecenia istniejącej wpłaty', () => {
    const { store } = fixture();
    expect(() => store.savePayment({ ...payment(100), receivedDate: '2026-02-30' })).toThrow('datę');
    expect(() => store.savePayment({ ...payment(100), method: 'wire' as Payment['method'] })).toThrow('metodę');
    expect(() => store.savePayment(payment(100, 'p1', 'missing'))).toThrow('Nie znaleziono');
    store.savePayment(payment(100));
    expect(() => store.savePayment(payment(100, 'p1', 'job-2'))).toThrow('właściwym zleceniu');
  });

  it('chroni zapłacone zlecenie przed obniżeniem wartości, usunięciem i zmianą właściciela', () => {
    const { store } = fixture();
    store.savePayment(payment(30000));
    const job = store.data.jobs.find(item => item.id === 'job-6')!;
    expect(() => store.saveJob({ ...job, rate: 1 })).toThrow('niższa');
    expect(() => store.deleteJob(job.id)).toThrow('ma płatności');
    expect(() => store.saveJob({ ...job, gardenId: 'garden-2' })).toThrow('innego ogrodu');
    const garden = store.data.gardens.find(item => item.id === job.gardenId)!;
    expect(() => store.saveGarden({ ...garden, clientId: 'client-2' })).toThrow('właściciela');
    store.saveJob({ ...job, notes: 'Korekta notatki bez zmiany rozliczenia' });
    expect(paidCents(job.id, store.data.payments)).toBe(30000);
  });

  it('nie odtwarza usuniętej w innej karcie płatności ze starego formularza edycji', () => {
    const { store, storage } = fixture();
    const entry = payment(10000);
    store.savePayment(entry, null);
    const other = new GardenStore(new LocalRepository(storage));
    other.deletePayment(entry.id, entry);
    const before = storage.getItem(STORAGE_KEY);
    expect(() => store.savePayment({ ...entry, amountCents: 15000 }, entry)).toThrow('innej karcie');
    expect(storage.getItem(STORAGE_KEY)).toBe(before);
    expect(new LocalRepository(storage).load().payments).toEqual([]);
  });

  it('nie nadpisuje ani nie usuwa nowszej korekty i odrzuca ponowne utworzenie ID', () => {
    const { store, storage } = fixture();
    const entry = payment(10000);
    store.savePayment(entry, null);
    const other = new GardenStore(new LocalRepository(storage));
    const corrected = { ...entry, amountCents: 12000, note: 'Nowsza korekta' };
    other.savePayment(corrected, entry);
    const before = storage.getItem(STORAGE_KEY);
    expect(() => store.savePayment({ ...entry, amountCents: 9000 }, entry)).toThrow('innej karcie');
    expect(() => store.deletePayment(entry.id, entry)).toThrow('innej karcie');
    expect(() => store.savePayment(entry, null)).toThrow('innej karcie');
    expect(storage.getItem(STORAGE_KEY)).toBe(before);
    expect(new LocalRepository(storage).load().payments).toEqual([corrected]);
    store.deletePayment(corrected.id, corrected);
    expect(store.data.payments).toEqual([]);
  });

  it('akceptuje zaliczkę na zaplanowany ryczałt bez oznaczania pracy jako wykonanej', () => {
    const { store } = fixture();
    store.savePayment(payment(5000, 'advance', 'job-2'));
    const job = store.data.jobs.find(item => item.id === 'job-2')!;
    expect(job.status).toBe('planned');
    expect(settlementStatus(job, store.data.payments)).toBe('partial');
    expect(clientSummary(store.data, 'client-2').completedValueCents).toBe(0);
    expect(clientSummary(store.data, 'client-2').receivedCents).toBe(5000);
    expect(clientSummary(store.data, 'client-2').outstandingCents).toBe(0);
  });

  it('nie dubluje identyfikatorów w sumowaniu, a magazyn odrzuca powtórzone wpisy', () => {
    const entry = payment(100);
    expect(paidCents('job-6', [entry, entry])).toBe(100);
    const data = createDemoData();
    data.payments = [entry, entry];
    expect(() => validateData(data)).toThrow('rejestr płatności');
  });
});

describe('podsumowanie klienta z kilkunastoma zleceniami i wieloma ogrodami', () => {
  it('sumuje pracę i płatności raz, niezależnie od ogrodu i statusu pracy', () => {
    const data = createDemoData();
    const template = data.jobs[0];
    const completed: Job[] = Array.from({ length: 12 }, (_, index) => ({ ...template, id: `c${index}`, gardenId: index % 2 ? 'garden-6' : 'garden-1', status: 'completed', billing: 'fixed', fixedPrice: 100, seconds: 3600 }));
    const planned: Job[] = Array.from({ length: 2 }, (_, index) => ({ ...template, id: `planned${index}`, billing: 'fixed', fixedPrice: 500 }));
    const active: Job = { ...template, id: 'active', status: 'in-progress', seconds: 1800 };
    data.jobs = [...completed, ...planned, active, { ...template, id: 'other', gardenId: 'garden-2', status: 'completed', billing: 'fixed', fixedPrice: 999 }];
    data.payments = [payment(10000, 'a', 'c0'), payment(4000, 'b', 'c1'), payment(6000, 'c', 'c1'), payment(2500, 'd', 'c2'), payment(10000, 'e', 'planned0'), payment(99900, 'f', 'other')];
    expect(() => validateData(data)).not.toThrow();
    expect(clientSummary(data, 'client-1')).toEqual({ completedValueCents: 120000, receivedCents: 32500, outstandingCents: 97500, seconds: 45000, completedCount: 12, plannedCount: 2, unsettledCount: 10 });
    expect(clientSummary(data, 'client-2')).toMatchObject({ completedValueCents: 99900, receivedCents: 99900, outstandingCents: 0, completedCount: 1 });
    expect(clientSummary(data, 'missing')).toEqual({ completedValueCents: 0, receivedCents: 0, outstandingCents: 0, seconds: 0, completedCount: 0, plannedCount: 0, unsettledCount: 0 });
  });
});

describe('bezstratna aktualizacja istniejącego zapisu lokalnego', () => {
  it('zachowuje wszystkie rekordy, ustawienia i aktywny stoper oraz kopię dokładnego v1', () => {
    const storage = new MemoryStorage();
    const old = startWork(createDemoData(), 'job-1', 1000);
    const original = legacySnapshot(old);
    storage.setItem(STORAGE_KEY, original);
    const migrated = new LocalRepository(storage).load();
    expect(migrated).toEqual(old);
    expect(migrated.payments).toEqual([]);
    expect(storage.getItem(LEGACY_BACKUP_KEY)).toBe(original);
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!)).toEqual({ version: STORAGE_VERSION, data: migrated });
    expect(settlementStatus(migrated.jobs.find(job => job.id === 'job-6')!, migrated.payments)).toBe('unpaid');
    const again = new LocalRepository(storage).load();
    expect(again).toEqual(migrated);
    expect(storage.getItem(LEGACY_BACKUP_KEY)).toBe(original);
  });

  it('nie nadpisuje istniejącej kopii v1 przy ponownym imporcie starego zapisu', () => {
    const storage = new MemoryStorage();
    storage.setItem(LEGACY_BACKUP_KEY, 'pierwsza kopia');
    storage.setItem(STORAGE_KEY, legacySnapshot());
    new LocalRepository(storage).load();
    expect(storage.getItem(LEGACY_BACKUP_KEY)).toBe('pierwsza kopia');
  });

  it('błąd kopii lub zapisu aktualizacji zachowuje oryginalny zapis i zgłasza problem', () => {
    for (const failedKey of [LEGACY_BACKUP_KEY, STORAGE_KEY]) {
      const storage = new MemoryStorage();
      const original = legacySnapshot();
      storage.setItem(STORAGE_KEY, original);
      const set = storage.setItem.bind(storage);
      storage.setItem = (key, value) => { if (key === failedKey) throw new Error('Quota exceeded'); set(key, value); };
      expect(() => new LocalRepository(storage).load()).toThrow();
      expect(storage.getItem(STORAGE_KEY)).toBe(original);
    }
  });

  it('uszkodzonego v1 nie zastępuje demonstracją ani nie zapisuje jako v2', () => {
    const storage = new MemoryStorage();
    const legacy = JSON.parse(legacySnapshot());
    legacy.data.gardens[0].clientId = 'missing';
    const original = JSON.stringify(legacy);
    storage.setItem(STORAGE_KEY, original);
    expect(() => new LocalRepository(storage).load()).toThrow();
    expect(storage.getItem(STORAGE_KEY)).toBe(original);
    expect(storage.getItem(LEGACY_BACKUP_KEY)).toBeNull();
  });

  it('w v2 sprawdza powiązania, płatności i brak nadpłaty bez naruszenia źródła', () => {
    const storage = new MemoryStorage();
    const data: Data = createDemoData();
    data.payments = [payment(30001)];
    const original = JSON.stringify({ version: STORAGE_VERSION, data });
    storage.setItem(STORAGE_KEY, original);
    expect(() => new LocalRepository(storage).load()).toThrow('przekracza wartość');
    expect(storage.getItem(STORAGE_KEY)).toBe(original);
  });
});
