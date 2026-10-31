import { describe, expect, it } from 'vitest';
import { createDemoData } from '../data/demo';
import { GardenStore } from '../data/store';
import { LocalRepository, STORAGE_KEY, STORAGE_VERSION, V4_BACKUP_KEY, type StoragePort } from '../data/repository';
import { jobTotalCents, type Data } from '../domain';
import { addDays, addMonths, scheduleDates, weekStart } from './dates';
import { occurrenceId, taskStatus, type TaskSchedule } from './model';
import { resolveOccurrence, taskOccurrencesBetween } from './occurrences';

const allMonths = Array.from({ length: 12 }, (_, i) => i + 1);
const schedule = (patch: Partial<TaskSchedule> = {}): TaskSchedule => ({ id: 'schedule-1', title: 'Koszenie', notes: 'Stała opieka', clientId: 'client-1', gardenId: 'garden-1', zoneId: null, zoneName: null,
  startDate: '2026-01-31', endDate: null, time: '09:00', endedOn: null, recurrence: { frequency: 'months', interval: 1, months: allMonths }, revision: 0, updatedAt: 1000, ...patch });
const dates = (s: TaskSchedule, from = '2026-01-01', to = '2026-12-31') => [...scheduleDates(s, from, to)];
class MemoryStorage implements StoragePort {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}
function fixture() {
  const storage = new MemoryStorage(), repository = new LocalRepository(storage);
  let now = 10000;
  const store = new GardenStore(repository, () => now);
  return { storage, repository, store, advance: (ms: number) => { now += ms; } };
}

describe('daty kalendarzowe i powtarzanie', () => {
  it('codziennie i co N dni przechodzą przez granicę roku i zmianę czasu', () => {
    expect(dates(schedule({ startDate: '2025-12-30', recurrence: { frequency: 'days', interval: 1, months: allMonths } }), '2025-12-30', '2026-01-02')).toEqual(['2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02']);
    expect(dates(schedule({ startDate: '2026-03-28', recurrence: { frequency: 'days', interval: 1, months: allMonths } }), '2026-03-28', '2026-03-31')).toEqual(['2026-03-28', '2026-03-29', '2026-03-30', '2026-03-31']);
    expect(dates(schedule({ startDate: '2026-10-24', recurrence: { frequency: 'days', interval: 2, months: allMonths } }), '2026-10-24', '2026-10-30')).toEqual(['2026-10-24', '2026-10-26', '2026-10-28', '2026-10-30']);
  });
  it('co kilka tygodni zachowuje kotwicę, także w sezonie po zimowej przerwie', () => {
    const s = schedule({ startDate: '2026-04-27', recurrence: { frequency: 'weeks', interval: 2, months: [5, 6, 7, 8, 9, 10] } });
    expect(dates(s, '2026-04-01', '2026-05-31')).toEqual(['2026-05-11', '2026-05-25']);
    const next = dates(s, '2027-05-01', '2027-05-31');
    expect(next).toEqual(['2027-05-10', '2027-05-24']);
    expect(dates(schedule({ startDate: '2026-10-19', recurrence: { frequency: 'weeks', interval: 1, months: allMonths } }), '2026-10-19', '2026-11-02')).toEqual(['2026-10-19', '2026-10-26', '2026-11-02']);
  });
  it('kotwiczy miesięczny termin na 31. dniu bez dryfowania po lutym', () => {
    expect(dates(schedule(), '2026-01-01', '2026-04-30')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
    expect(dates(schedule({ recurrence: { frequency: 'months', interval: 3, months: allMonths } }), '2026-01-01', '2026-10-31')).toEqual(['2026-01-31', '2026-04-30', '2026-07-31', '2026-10-31']);
  });
  it('29 lutego wraca w kolejnym roku przestępnym', () => {
    expect(dates(schedule({ startDate: '2024-02-29', recurrence: { frequency: 'years', interval: 1, months: allMonths } }), '2024-01-01', '2028-12-31')).toEqual(['2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29']);
  });
  it('wybrane miesiące pozwalają zaplanować pracę dwa razy w roku', () => {
    expect(dates(schedule({ startDate: '2026-01-15', recurrence: { frequency: 'months', interval: 1, months: [4, 10] } }))).toEqual(['2026-04-15', '2026-10-15']);
  });
  it('uwzględnia obie granice i termin jednorazowy, także poza sezonem', () => {
    expect(dates(schedule({ endDate: '2026-03-31' }))).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
    expect(dates(schedule({ endedOn: '2026-02-01' }))).toEqual(['2026-01-31']);
    expect(dates(schedule({ recurrence: { frequency: 'once', interval: 1, months: [7] } }))).toEqual(['2026-01-31']);
    expect(dates(schedule(), '2027-01-01', '2026-01-01')).toEqual([]);
  });
  it('obsługuje odległe zakresy i poniedziałkowy początek tygodnia', () => {
    expect(dates(schedule({ startDate: '1900-01-31' }), '2026-02-01', '2026-03-31')).toEqual(['2026-02-28', '2026-03-31']);
    expect(weekStart('2026-11-01')).toBe('2026-10-26');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(dates(schedule({ startDate: '9999-12-31' }), '9999-12-01', '9999-12-31')).toEqual(['9999-12-31']);
  });
  it.each([0, -1, 1.5, NaN, 1001])('odrzuca niepoprawny odstęp %s', interval => {
    expect(() => dates(schedule({ recurrence: { frequency: 'days', interval, months: allMonths } }))).toThrow();
  });
  it('odrzuca nieistniejące daty i pusty sezon', () => {
    expect(() => dates(schedule({ startDate: '2026-02-30' }))).toThrow();
    expect(() => dates(schedule({ endDate: '2025-12-31' }))).toThrow();
    expect(() => dates(schedule({ recurrence: { frequency: 'months', interval: 1, months: [] } }))).toThrow();
  });
});

describe('wyjątki, serie i zlecenia', () => {
  it('samo planowanie i przeglądanie terminów nie tworzy należności, zleceń ani czasu', () => {
    const { store } = fixture();
    const before = structuredClone(store.data);
    store.saveTaskSchedule(schedule());
    expect(taskOccurrencesBetween(store.data, '2026-01-01', '2026-12-31')).toHaveLength(12);
    expect(store.data.jobs).toEqual(before.jobs);
    expect(store.data.payments).toEqual(before.payments);
    expect(store.data.timer).toBeNull();
    expect(store.data.taskOccurrences).toEqual([]);
  });
  it('przesuwa tylko jeden termin także poza widoczny miesiąc i pomija go bez duplikatów', () => {
    const { store, repository } = fixture();
    store.saveTaskSchedule(schedule());
    store.moveTaskOccurrence('schedule-1', '2026-01-31', '2026-02-02', '11:00');
    expect(taskOccurrencesBetween(store.data, '2026-01-01', '2026-01-31')).toEqual([]);
    const february = taskOccurrencesBetween(store.data, '2026-02-01', '2026-02-28');
    expect(february.map(o => o.date)).toEqual(['2026-02-02', '2026-02-28']);
    expect(february[0].id).toBe(occurrenceId('schedule-1', '2026-01-31'));
    store.skipTaskOccurrence('schedule-1', '2026-01-31');
    expect(taskOccurrencesBetween(store.data, '2026-02-01', '2026-02-28', true)).toHaveLength(1);
    expect(repository.load().taskOccurrences[0].status).toBe('cancelled');
  });
  it('dwa przesunięcia na ten sam dzień pozostają odrębnymi wystąpieniami', () => {
    const { store } = fixture(); store.saveTaskSchedule(schedule());
    store.moveTaskOccurrence('schedule-1', '2026-01-31', '2026-03-01', '09:00');
    store.moveTaskOccurrence('schedule-1', '2026-02-28', '2026-03-01', '10:00');
    expect(taskOccurrencesBetween(store.data, '2026-03-01', '2026-03-01')).toHaveLength(2);
  });
  it('edycja reguły zachowuje zapisane wyjątki oraz istniejące prace', () => {
    const { store } = fixture(); store.saveTaskSchedule(schedule());
    store.moveTaskOccurrence('schedule-1', '2026-01-31', '2026-02-02', '11:00');
    const jobs = structuredClone(store.data.jobs);
    store.saveTaskSchedule({ ...store.data.taskSchedules[0], startDate: '2026-02-15', title: 'Nowe koszenie' });
    expect(taskOccurrencesBetween(store.data, '2026-02-01', '2026-02-28').map(o => o.date)).toEqual(['2026-02-02', '2026-02-15']);
    expect(store.data.taskOccurrences[0]).toMatchObject({ originalDate: '2026-01-31', date: '2026-02-02', time: '11:00', title: 'Nowe koszenie' });
    expect(store.data.jobs).toEqual(jobs);
  });
  it('zakończenie serii zachowuje historię oraz odwołuje przyszły wyjątek', () => {
    const { store } = fixture(); store.saveTaskSchedule(schedule());
    store.moveTaskOccurrence('schedule-1', '2026-01-31', '2026-03-01', '11:00');
    store.beginTaskOccurrence('schedule-1', '2026-02-28'); store.stopTimer();
    const before = structuredClone(store.data.jobs);
    store.endTaskSchedule('schedule-1', '2026-02-01');
    expect(taskOccurrencesBetween(store.data, '2026-04-01', '2026-12-31')).toEqual([]);
    expect(store.data.taskOccurrences.find(o => o.originalDate === '2026-01-31')!.status).toBe('cancelled');
    expect(store.data.jobs).toEqual(before);
  });
  it('koniec serii nie odwołuje wystąpienia przesuniętego wcześniej przed datę końca', () => {
    const { store } = fixture(); store.saveTaskSchedule(schedule());
    store.moveTaskOccurrence('schedule-1', '2026-02-28', '2026-01-30', '09:00');
    store.endTaskSchedule('schedule-1', '2026-01-31');
    expect(store.data.taskOccurrences[0].status).toBe('planned');
  });
  it('skrócenie daty końca harmonogramu odwołuje przyszły wyjątek bez kasowania go', () => {
    const { store } = fixture(); store.saveTaskSchedule(schedule());
    store.moveTaskOccurrence('schedule-1', '2026-01-31', '2026-03-01', '09:00');
    store.saveTaskSchedule({ ...store.data.taskSchedules[0], endDate: '2026-02-01' });
    expect(store.data.taskOccurrences[0]).toMatchObject({ date: '2026-03-01', status: 'cancelled' });
  });
  it('usunięcie strefy zachowuje jej opis w planie i późniejszej wizycie', () => {
    const { store } = fixture();
    store.saveZone('garden-1', { id: 'zone', name: 'Trawnik', type: 'trawnik', area: 100, length: null, plants: '', requirements: '', treatments: '' });
    store.saveTaskSchedule(schedule({ zoneId: 'zone', zoneName: 'Trawnik' }));
    store.deleteZone('garden-1', 'zone');
    const id = store.beginTaskOccurrence('schedule-1', '2026-01-31');
    expect(store.data.jobs.find(job => job.id === id)!.notes).toContain('Strefa: Trawnik');
  });
  it('rozpoczęcie tworzy jedną rzeczywistą wizytę; kolejne kliknięcie nie resetuje ani nie wznawia pomiaru', () => {
    const { store, repository, advance } = fixture(); store.saveTaskSchedule(schedule());
    const count = store.data.jobs.length;
    const id = store.beginTaskOccurrence('schedule-1', '2026-01-31');
    expect(store.data.jobs).toHaveLength(count + 1);
    expect(store.data.jobs.at(-1)).toMatchObject({ id, seconds: 0, settlement: null, status: 'in-progress', taskOccurrenceId: occurrenceId('schedule-1', '2026-01-31') });
    expect(jobTotalCents(store.data.jobs.at(-1)!)).toBe(0);
    advance(10000); store.pauseTimer();
    const paused = structuredClone(store.data.timer);
    const other = new GardenStore(repository);
    expect(other.beginTaskOccurrence('schedule-1', '2026-01-31')).toBe(id);
    expect(other.data.jobs).toHaveLength(count + 1);
    expect(other.data.timer).toEqual(paused);
    store.completeJob(id);
    expect(taskStatus(store.data, resolveOccurrence(store.data, 'schedule-1', '2026-01-31'))).toBe('completed');
    expect(store.data.jobs.at(-1)!.seconds).toBe(10);
  });
  it('zajęty stoper blokuje całą transakcję bez tworzenia częściowego zlecenia', () => {
    const { store } = fixture(); store.saveTaskSchedule(schedule()); store.startTimer('job-1');
    const before = structuredClone(store.data);
    expect(() => store.beginTaskOccurrence('schedule-1', '2026-01-31')).toThrow('stoper');
    expect(store.data).toEqual(before);
  });
  it('zmiana daty rzeczywistego zlecenia przenosi wydarzenie bez odtworzenia starego zadania', () => {
    const { store } = fixture(); store.saveTaskSchedule(schedule());
    const id = store.beginTaskOccurrence('schedule-1', '2026-01-31'); store.stopTimer();
    const job = store.data.jobs.find(item => item.id === id)!;
    store.saveJob({ ...job, date: '2026-02-05', time: '12:30' });
    expect(taskOccurrencesBetween(store.data, '2026-01-31', '2026-01-31')).toEqual([]);
    expect(taskOccurrencesBetween(store.data, '2026-02-05', '2026-02-05')).toHaveLength(1);
    expect(store.beginTaskOccurrence('schedule-1', '2026-01-31')).toBe(id);
  });
  it('zadanie bez ogrodu wymaga przypisania ogrodu właściwego klienta', () => {
    const { store } = fixture(); store.saveTaskSchedule(schedule({ gardenId: null }));
    expect(() => store.beginTaskOccurrence('schedule-1', '2026-01-31')).toThrow('ogród');
    expect(() => store.beginTaskOccurrence('schedule-1', '2026-01-31', 'garden-2')).toThrow('klienta');
    const id = store.beginTaskOccurrence('schedule-1', '2026-01-31', 'garden-1');
    expect(store.data.jobs.find(j => j.id === id)!.gardenId).toBe('garden-1');
  });
  it('nie uruchamia pominiętego terminu i chroni istniejące powiązane zlecenie', () => {
    const { store } = fixture(); store.saveTaskSchedule(schedule());
    store.skipTaskOccurrence('schedule-1', '2026-01-31');
    expect(() => store.beginTaskOccurrence('schedule-1', '2026-01-31')).toThrow('pominięty');
    const id = store.beginTaskOccurrence('schedule-1', '2026-02-28'); store.stopTimer();
    expect(() => store.deleteJob(id)).toThrow('historią');
    expect(() => store.moveTaskOccurrence('schedule-1', '2026-02-28', '2026-03-01', '10:00')).toThrow('zlecenie');
  });
  it('chroni przed zapisem nieaktualnego harmonogramu i wyjątku', () => {
    const { store, repository } = fixture(); store.saveTaskSchedule(schedule());
    const stale = store.data.taskSchedules[0];
    const other = new GardenStore(repository); other.saveTaskSchedule({ ...stale, title: 'Nowy tytuł' });
    expect(() => store.saveTaskSchedule({ ...stale, title: 'Stary tytuł' })).toThrow('innej karcie');
    expect(() => store.skipTaskOccurrence('schedule-1', '2026-01-31', { scheduleRevision: stale.revision, occurrenceRevision: 0 })).toThrow('innej karcie');
    store.refresh();
    const expected = { scheduleRevision: store.data.taskSchedules[0].revision, occurrenceRevision: 0 };
    other.moveTaskOccurrence('schedule-1', '2026-01-31', '2026-02-01', '08:00');
    expect(() => store.moveTaskOccurrence('schedule-1', '2026-01-31', '2026-02-02', '08:00', expected)).toThrow('innej karcie');
  });
  it('zaległości pomijają odwołane i wykonane zadania, a limit zachowuje najstarsze', () => {
    const { store } = fixture(); store.saveTaskSchedule(schedule({ startDate: '2026-01-01', recurrence: { frequency: 'days', interval: 1, months: allMonths } }));
    store.skipTaskOccurrence('schedule-1', '2026-01-01');
    const id = store.beginTaskOccurrence('schedule-1', '2026-01-02'); store.completeJob(id);
    expect(taskOccurrencesBetween(store.data, '2026-01-01', '2026-12-31', true, 3).map(o => o.date)).toEqual(['2026-01-03', '2026-01-04', '2026-01-05']);
  });
});

describe('migracje i kopie planowania', () => {
  it.each([1, 2, 3, 4])('migruje v%s z zachowaniem danych i właściwej kopii', version => {
    const { storage } = fixture(); const current = createDemoData();
    current.payments = version === 1 ? [] : [{ id: 'p', jobId: 'job-5', amountCents: 1000, receivedDate: '2026-10-30', method: 'cash', note: '' }];
    const { taskSchedules: _s, taskOccurrences: _o, ...old } = current;
    const data = version <= 2 ? { ...old, jobs: old.jobs.map(({ activities: _a, settlement: _s, ...job }) => job) } : old;
    const raw = JSON.stringify({ version, data }); storage.setItem(STORAGE_KEY, raw);
    const migrated = new LocalRepository(storage).load();
    expect(migrated.clients).toEqual(current.clients); expect(migrated.gardens).toEqual(current.gardens);
    expect(migrated.payments).toEqual(current.payments); expect(migrated.taskSchedules).toEqual([]); expect(migrated.taskOccurrences).toEqual([]);
    if (version >= 3) expect(migrated.jobs).toEqual(current.jobs);
    expect(storage.getItem(`garden-manager:backup:v${version}`)).toBe(raw);
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!).version).toBe(STORAGE_VERSION);
  });
  it('pełny eksport v5 odtwarza wyjątki, reguły i powiązanie rzeczywistej wizyty', () => {
    const { store, storage } = fixture(); store.saveTaskSchedule(schedule());
    store.moveTaskOccurrence('schedule-1', '2026-01-31', '2026-02-02', '12:00');
    store.beginTaskOccurrence('schedule-1', '2026-02-28');
    const exported = storage.getItem(STORAGE_KEY)!;
    const restored = new MemoryStorage(); restored.setItem(STORAGE_KEY, exported);
    expect(new LocalRepository(restored).load()).toEqual(store.data);
  });
  it.each([V4_BACKUP_KEY, STORAGE_KEY])('błąd zapisu %s nie nadpisuje oryginału v4', failure => {
    const storage = new MemoryStorage(); const { taskSchedules: _s, taskOccurrences: _o, ...old } = createDemoData();
    const raw = JSON.stringify({ version: 4, data: old }); storage.setItem(STORAGE_KEY, raw);
    const write = storage.setItem.bind(storage); storage.setItem = (key, value) => { if (key === failure) throw new Error('Brak miejsca'); write(key, value); };
    expect(() => new LocalRepository(storage).load()).toThrow(); expect(storage.getItem(STORAGE_KEY)).toBe(raw);
  });
  it.each<[string, (data: Data) => void]>([
    ['duplikat serii', data => { data.taskSchedules.push(data.taskSchedules[0]); }],
    ['duplikat wystąpienia', data => { data.taskOccurrences.push(data.taskOccurrences[0]); }],
    ['nieistniejące zlecenie', data => { data.taskOccurrences[0].jobId = 'brak'; }],
    ['błędna tożsamość wyjątku', data => { data.taskOccurrences[0].originalDate = '2026-02-28'; }],
  ])('zachowuje uszkodzony oryginał: %s', (_name, corrupt) => {
    const { store, storage } = fixture(); store.saveTaskSchedule(schedule()); store.skipTaskOccurrence('schedule-1', '2026-01-31');
    const data = structuredClone(store.data); corrupt(data);
    const raw = JSON.stringify({ version: STORAGE_VERSION, data }); storage.setItem(STORAGE_KEY, raw);
    expect(() => new LocalRepository(storage).load()).toThrow(); expect(storage.getItem(STORAGE_KEY)).toBe(raw);
  });
});
