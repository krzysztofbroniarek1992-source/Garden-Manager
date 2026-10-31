import { describe, expect, it } from 'vitest';
import { area, convertQuantity, dose, formatQuantity, hedge, materialCostCents, packageCount, volume } from './gardening';
import { createDemoData } from './data/demo';
import { GardenStore } from './data/store';
import { LocalRepository, STORAGE_KEY, STORAGE_VERSION, V3_BACKUP_KEY, type StoragePort } from './data/repository';
import { jobTotalCents, startWork, type CatalogMaterial, type GardenZone } from './domain';

class MemoryStorage implements StoragePort {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}
const zone: GardenZone = { id: 'z', name: 'Rabata', type: 'rabata', area: 12.34567, length: null, plants: 'Róże', requirements: 'Podlewanie', treatments: 'Cięcie 2026-10-30' };
const material: CatalogMaterial = { id: 'c', name: 'Kora', category: 'Podłoża', unit: 'l', purchaseUnitPrice: 0.5, packageName: 'worek', packageQuantity: 80, notes: '' };
function fixture() {
  const storage = new MemoryStorage(), repository = new LocalRepository(storage), store = new GardenStore(repository);
  return { storage, repository, store };
}

describe('kalkulatory i jednostki', () => {
  it('oblicza wszystkie kształty i zachowuje dokładność koła', () => {
    expect(area('rectangle', 2.3, 4.7)).toBeCloseTo(10.81);
    expect(area('circle', 3)).toBe(Math.PI * 9);
    expect(area('triangle', 5, 7)).toBe(17.5);
    expect(area('manual', 0.123456789)).toBe(0.123456789);
    expect(formatQuantity(area('circle', 3))).toBe('28,274');
    expect(formatQuantity(0.00001234)).not.toBe('0');
  });
  it('przelicza cm warstwy na m³ i litry oraz bryłę żywopłotu', () => {
    expect(volume(125, 5)).toBe(6.25);
    expect(convertQuantity(volume(125, 5), 'm³', 'l')).toBe(6250);
    expect(hedge(12, 1.5, 0.6)).toBeCloseTo(10.8);
  });
  it('skaluje dawki i konwertuje masę lub objętość bez ich mieszania', () => {
    expect(convertQuantity(dose(250, 30, 1), 'g', 'kg')).toBe(7.5);
    expect(convertQuantity(dose(250, 150, 100), 'ml', 'l')).toBe(0.375);
    expect(convertQuantity(1, 'l', 'ml')).toBe(1000);
    expect(() => convertQuantity(1, 'kg', 'l')).toThrow('Jednostka');
    expect(() => convertQuantity(1, 'm²', 'm')).toThrow('Jednostka');
  });
  it('rozlicza kwoty w groszach i podaje liczbę opakowań bez zaokrąglania zużycia', () => {
    expect(materialCostCents(0.125, 19.99)).toBe(250);
    expect(materialCostCents(2.5, 0.1)).toBe(25);
    expect(packageCount(160.01, 80)).toBe(3);
    expect(packageCount(160, 80)).toBe(2);
    expect(() => packageCount(1, 0)).toThrow();
  });
  it.each([-1, NaN, Infinity, Number.MAX_VALUE])('odrzuca niepoprawny wymiar %s', value => {
    expect(() => area('manual', value)).toThrow();
    expect(() => volume(10, value)).toThrow();
    expect(() => dose(100, value, 100)).toThrow();
    expect(() => hedge(10, 2, value)).toThrow();
    expect(() => materialCostCents(1, value)).toThrow();
  });
  it('odrzuca przepełnienie wyniku i kwot', () => {
    expect(() => area('rectangle', 1e12, 1e12)).toThrow();
    expect(() => materialCostCents(1e12, 1e12)).toThrow();
  });
});

describe('strefy, katalog i materiały zlecenia', () => {
  it('edycja i usunięcie strefy zachowują historię prac i płatności', () => {
    const { store } = fixture();
    const jobs = structuredClone(store.data.jobs), payments = structuredClone(store.data.payments);
    store.saveZone('garden-1', zone);
    store.saveZone('garden-1', { ...zone, length: 5, treatments: 'Nowy zabieg' });
    expect(store.data.gardens[0].zones).toHaveLength(1);
    expect(store.data.gardens[0].zones[0].treatments).toBe('Nowy zabieg');
    store.deleteZone('garden-1', zone.id);
    expect(store.data.gardens[0].zones).toEqual([]);
    expect(store.data.jobs).toEqual(jobs);
    expect(store.data.payments).toEqual(payments);
  });
  it('zapis starszego formularza ogrodu nie kasuje nowszej strefy', () => {
    const { store, repository } = fixture();
    const stale = store.data.gardens[0];
    const other = new GardenStore(repository);
    other.saveZone(stale.id, zone);
    store.saveGarden({ ...stale, address: 'Nowy adres' });
    expect(store.data.gardens[0]).toMatchObject({ address: 'Nowy adres', zones: [zone] });
  });
  it('katalog i obie ceny przechodzą przez zapis oraz eksport JSON', () => {
    const { store, storage } = fixture();
    store.saveCatalogMaterial(material);
    store.saveCatalogMaterial({ ...material, purchaseUnitPrice: 0.7 });
    store.addJobMaterial('job-1', 'garden-1', { id: 'm', name: material.name, quantity: 0.123456789, unit: 'l', unitPrice: 1, purchaseUnitPrice: 0.7, catalogId: 'c', zoneId: 'z', zoneName: 'Rabata' });
    const exported = JSON.parse(storage.getItem(STORAGE_KEY)!);
    expect(exported.version).toBe(STORAGE_VERSION);
    expect(exported.data.materialCatalog).toHaveLength(1);
    expect(new LocalRepository(storage).load()).toEqual(exported.data);
    store.saveCatalogMaterial({ ...material, purchaseUnitPrice: 99 });
    expect(store.data.jobs[0].materials[0]).toMatchObject({ quantity: 0.123456789, unitPrice: 1, purchaseUnitPrice: 0.7 });
  });
  it('dodanie do najnowszego zlecenia zachowuje zamrożoną należność, czas i wpłatę', () => {
    const { store, repository } = fixture();
    const approved = store.data.jobs.find(job => job.id === 'job-5')!;
    store.savePayment({ id: 'p', jobId: approved.id, amountCents: 100, receivedDate: '2026-10-30', method: 'cash', note: '' });
    const other = new GardenStore(repository);
    other.saveJob({ ...approved, notes: 'Nowa notatka' });
    store.addJobMaterial(approved.id, approved.gardenId, { id: 'm', name: 'Ziemia', quantity: 2, unitPrice: 10, purchaseUnitPrice: 10, unit: 'kg' });
    const updated = store.data.jobs.find(job => job.id === approved.id)!;
    expect(updated.notes).toBe('Nowa notatka');
    expect(updated.seconds).toBe(approved.seconds);
    expect(updated.settlement).toEqual(approved.settlement);
    expect(jobTotalCents(updated)).toBe(jobTotalCents(approved));
    expect(store.data.payments).toHaveLength(1);
    expect(() => store.addJobMaterial(approved.id, 'garden-1', { id: 'other', name: 'X', quantity: 1, unitPrice: 0 })).toThrow('ogrodu');
    expect(() => store.addJobMaterial(approved.id, approved.gardenId, updated.materials.at(-1)!)).toThrow('już zapisany');
  });
});

describe('migracja etapu 1 i starszych zapisów', () => {
  it('v3 zachowuje wizytę, pauzę, rozliczenia i wpłaty; tworzy kopię tylko raz', () => {
    const { storage } = fixture();
    const data = startWork(createDemoData(), 'job-1', 1000);
    data.timer!.paused = true;
    data.timer!.remainderMs = 321;
    data.payments = [{ id: 'p', jobId: 'job-5', amountCents: 100, receivedDate: '2026-10-30', method: 'cash', note: 'Historia' }];
    const { materialCatalog: _catalog, ...old } = data;
    const v3 = { ...old, gardens: old.gardens.map(({ zones: _zones, ...garden }) => garden) };
    const original = JSON.stringify({ version: 3, data: v3 });
    storage.setItem(STORAGE_KEY, original);
    const repository = new LocalRepository(storage), migrated = repository.load();
    expect(storage.getItem(V3_BACKUP_KEY)).toBe(original);
    expect(migrated).toEqual(data);
    expect(repository.load()).toEqual(data);
    expect(storage.getItem(V3_BACKUP_KEY)).toBe(original);
  });
  it.each([1, 2])('migruje prawdziwe dane v%s bez stref i katalogu', version => {
    const storage = new MemoryStorage(), data = createDemoData();
    const old = { ...data, gardens: data.gardens.map(({ zones: _z, ...g }) => g), jobs: data.jobs.map(({ activities: _a, settlement: _s, ...j }) => j) };
    storage.setItem(STORAGE_KEY, JSON.stringify({ version, data: old }));
    const migrated = new LocalRepository(storage).load();
    expect(migrated.gardens.every(g => g.zones.length === 0)).toBe(true);
    expect(migrated.materialCatalog).toEqual([]);
    expect(migrated.jobs.find(j => j.id === 'job-5')!.settlement!.finalLaborCents).toBe(48000);
  });
  it('błąd kopii v3 zachowuje oryginał', () => {
    const storage = new MemoryStorage(), original = JSON.stringify({ version: 3, data: createDemoData() });
    storage.setItem(STORAGE_KEY, original);
    storage.setItem = () => { throw new Error('Brak miejsca'); };
    expect(() => new LocalRepository(storage).load()).toThrow('kopii');
    expect(storage.getItem(STORAGE_KEY)).toBe(original);
  });
  it('nie nadpisuje uszkodzonych nowych danych', () => {
    const storage = new MemoryStorage(), data = createDemoData();
    data.gardens[0].zones = [zone, zone];
    const original = JSON.stringify({ version: STORAGE_VERSION, data });
    storage.setItem(STORAGE_KEY, original);
    expect(() => new LocalRepository(storage).load()).toThrow('strefy');
    expect(storage.getItem(STORAGE_KEY)).toBe(original);
  });
});
