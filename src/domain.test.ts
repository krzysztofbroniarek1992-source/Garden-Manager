import { describe, expect, it } from 'vitest';
import { duration, elapsedSeconds, finishWork, jobLabor, jobTotal, localDate, materialsTotal, startWork, stopActiveTimer } from './domain';
import { createDemoData } from './data/demo';
import { LocalRepository, STORAGE_KEY, validateData, type StoragePort } from './data/repository';
import { GardenStore } from './data/store';

class MemoryStorage implements StoragePort {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

function fixture() {
  const storage = new MemoryStorage();
  const repository = new LocalRepository(storage);
  let now = 10_000;
  const store = new GardenStore(repository, () => now);
  return { storage, repository, store, advance: (milliseconds: number) => { now += milliseconds; } };
}

describe('rozliczenia i czas', () => {
  it('rozlicza godzinowo i osobno dolicza materiały z zaokrągleniem do groszy', () => {
    const job = { ...createDemoData().jobs[0], seconds: 5400, materials: [{ id: 'm', name: 'Kora', quantity: 3, unitPrice: 24.5 }] };
    expect(jobLabor(job)).toBe(180);
    expect(materialsTotal(job)).toBe(73.5);
    expect(jobTotal(job)).toBe(253.5);
    expect(jobLabor({ ...job, seconds: 1 })).toBe(0.03);
  });

  it('rozliczenie ryczałtowe nie zależy od czasu', () => {
    const job = { ...createDemoData().jobs[0], billing: 'fixed' as const, fixedPrice: 450, seconds: 50_000 };
    expect(jobLabor(job)).toBe(450);
  });

  it('liczy aktywny stoper z utrwalonego znacznika czasu i nie dodaje go do innych zleceń', () => {
    const data = startWork(createDemoData(), 'job-1', 1000);
    expect(elapsedSeconds(data.jobs[0], data.timer, 5500)).toBe(4);
    expect(elapsedSeconds(data.jobs[1], data.timer, 5500)).toBe(0);
    expect(elapsedSeconds(data.jobs[0], data.timer, 500)).toBe(0);
    expect(duration(90_061)).toBe('25:01:01');
  });

  it('zatrzymanie jest idempotentne, a wznowienie zachowuje poprzedni czas', () => {
    const running = startWork(createDemoData(), 'job-1', 1000);
    const stopped = stopActiveTimer(running, 11_000);
    expect(stopped.timer).toBeNull();
    expect(stopped.jobs[0].seconds).toBe(10);
    expect(stopActiveTimer(stopped, 30_000).jobs[0].seconds).toBe(10);
    const resumed = startWork(stopped, 'job-1', 40_000);
    expect(stopActiveTimer(resumed, 45_000).jobs[0].seconds).toBe(15);
    expect(running.jobs[0].seconds).toBe(0);
  });

  it('blokuje jednoczesny pomiar drugiego zlecenia i podwójny START nie resetuje czasu', () => {
    const data = startWork(createDemoData(), 'job-1', 1000);
    expect(startWork(data, 'job-1', 9000)).toBe(data);
    expect(() => startWork(data, 'job-2', 9000)).toThrow('Najpierw zatrzymaj');
  });

  it('zakończenie zlecenia zatrzymuje i utrwala jego stoper', () => {
    const data = finishWork(startWork(createDemoData(), 'job-1', 1000), 'job-1', 61_000);
    expect(data.timer).toBeNull();
    expect(data.jobs[0]).toMatchObject({ status: 'completed', seconds: 60 });
    expect(() => startWork(data, 'job-1')).toThrow('zakończonego');
  });

  it('formatuje dzień lokalnie, a demo zawiera poprawne powiązania', () => {
    expect(localDate(new Date(2026, 0, 2, 0, 5))).toBe('2026-01-02');
    expect(() => validateData(createDemoData())).not.toThrow();
  });
});

describe('trwałość i komendy aplikacji', () => {
  it('odtwarza działający stoper po utworzeniu nowej instancji repozytorium', () => {
    const { storage, store } = fixture();
    store.startTimer('job-1');
    const restored = new GardenStore(new LocalRepository(storage));
    expect(restored.data.timer).toEqual({ jobId: 'job-1', startedAt: 10_000, paused: false });
    expect(elapsedSeconds(restored.data.jobs[0], restored.data.timer, 130_000)).toBe(120);
  });

  it('zapisuje klientów, wiele ogrodów klienta, edycję i bezpieczne usuwanie', () => {
    const { store, repository } = fixture();
    const client = { id: 'new-client', name: 'Test', phone: '', email: '', notes: '' };
    store.saveClient(client);
    store.saveClient({ ...client, name: 'Po edycji' });
    const garden = { id: 'new-garden', clientId: client.id, name: 'Pierwszy', address: '', area: 10, notes: '', zones: [] };
    store.saveGarden(garden);
    store.saveGarden({ ...garden, id: 'second-garden', name: 'Drugi' });
    expect(repository.load().gardens.filter(item => item.clientId === client.id)).toHaveLength(2);
    expect(() => store.deleteClient(client.id)).toThrow('przypisane ogrody');
    store.deleteGarden(garden.id);
    store.deleteGarden('second-garden');
    store.deleteClient(client.id);
    expect(repository.load().clients.some(item => item.id === client.id)).toBe(false);
  });

  it('chroni obiekt z historią i aktywne zlecenie przed usunięciem', () => {
    const { store } = fixture();
    expect(() => store.deleteGarden('garden-1')).toThrow('przypisane zlecenia');
    store.startTimer('job-1');
    expect(() => store.deleteJob('job-1')).toThrow('zatrzymaj stoper');
  });

  it('zakończenie przez formularz edycji także zapisuje naliczony czas', () => {
    const { store, advance } = fixture();
    store.startTimer('job-1');
    advance(90_000);
    store.saveJob({ ...store.data.jobs[0], status: 'completed' });
    expect(store.data.jobs[0]).toMatchObject({ status: 'completed', seconds: 90 });
    expect(store.data.timer).toBeNull();
  });

  it('zmiana stawki domyślnej nie zmienia ustalonych stawek istniejących zleceń', () => {
    const { store, repository } = fixture();
    store.setRate(150);
    expect(repository.load().settings.hourlyRate).toBe(150);
    expect(repository.load().jobs[0].rate).toBe(120);
    expect(() => store.setRate(-1)).toThrow();
  });

  it('nie nadpisuje uszkodzonego ani nieobsługiwanego zapisu danymi demonstracyjnymi', () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, '{broken');
    expect(() => new LocalRepository(storage).load()).toThrow('Oryginalny zapis');
    expect(storage.getItem(STORAGE_KEY)).toBe('{broken');
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 999, data: createDemoData() }));
    expect(() => new LocalRepository(storage).load()).toThrow('Nieobsługiwana wersja');
  });

  it('odrzuca nieistniejące powiązania oraz ujemne wartości materiałów', () => {
    const data = createDemoData();
    data.gardens[0].clientId = 'missing';
    expect(() => validateData(data)).toThrow();
    const another = createDemoData();
    another.jobs[0].materials = [{ id: 'm', name: 'Kora', quantity: -1, unitPrice: 20 }];
    expect(() => validateData(another)).toThrow();
  });

  it('błąd pełnej pamięci nie przyjmuje zmiany w stanie aplikacji', () => {
    const { storage, store } = fixture();
    storage.setItem = () => { throw new Error('Quota exceeded'); };
    expect(() => store.setRate(150)).toThrow('Nie udało się zapisać');
    expect(store.data.settings.hourlyRate).toBe(120);
  });

  it('operacja czyta świeży zapis z drugiej karty zamiast nadpisywać jej zmiany', () => {
    const { storage, store } = fixture();
    const other = new GardenStore(new LocalRepository(storage));
    other.setRate(155);
    store.saveClient({ id: 'concurrent', name: 'Nowy klient', phone: '', email: '', notes: '' });
    expect(store.data.settings.hourlyRate).toBe(155);
  });
});
