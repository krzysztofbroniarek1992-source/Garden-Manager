import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createDemoData } from '../data/demo';
import { GardenStore } from '../data/store';
import {
  LocalRepository,
  STORAGE_KEY,
  STORAGE_VERSION,
  V6_BACKUP_KEY,
  validateData,
  type StoragePort,
} from '../data/repository';
import type { Data } from '../domain';
import {
  deadlineGroup,
  emptyScope,
  newNote,
  newTodo,
  resolveDeskScope,
} from './model';
import { deskEventsBetween } from './events';
import { IndexedDbPhotoRepository } from '../photos/assets';
import { PhotoService } from '../photos/service';
import { readFullBackup } from '../photos/backup';
import { sha256 } from '../photos/images';
import type { PhotoProcessor } from '../photos/model';

class MemoryStorage implements StoragePort {
  values = new Map<string, string>();
  fail = false;
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.fail) throw new Error('QuotaExceededError');
    this.values.set(key, value);
  }
}
const day = '2026-10-31';
const jpeg = new Blob(
  [
    new Uint8Array([
      255, 216, 255, 192, 0, 17, 8, 0, 2, 0, 3, 3, 1, 17, 0, 2, 17, 0, 3, 17, 0,
      255, 217,
    ]),
  ],
  { type: 'image/jpeg' },
);
function fixture() {
  const storage = new MemoryStorage();
  let now = 1000;
  const seed = createDemoData(new Date(`${day}T12:00:00`));
  seed.gardens[0].zones = [
    {
      id: 'zone',
      name: 'Rabata',
      type: 'rabata',
      area: 5,
      length: null,
      plants: 'Róże',
      requirements: '',
      treatments: '',
    },
  ];
  const repo = new LocalRepository(storage, () => seed),
    store = new GardenStore(repo, () => now);
  return {
    storage,
    repo,
    store,
    tick: () => {
      now += 1000;
    },
    note: (scope = {}) => ({
      ...newNote(store.data, scope),
      title: 'Obserwacja róż',
      body: 'Sprawdzić liście',
    }),
    todo: (scope = {}) => ({
      ...newTodo(store.data, scope),
      title: 'Zadzwonić do klienta',
    }),
  };
}
function legacy6(data: Data) {
  const raw = JSON.parse(JSON.stringify(data));
  delete raw.notes;
  delete raw.todos;
  delete raw.deskTombstones;
  return raw;
}
async function photoFixture() {
  const f = fixture(),
    assets = new IndexedDbPhotoRepository(new IDBFactory()),
    hash = await sha256(jpeg);
  const processor: PhotoProcessor = {
    process: async () => ({
      image: jpeg,
      thumbnail: jpeg,
      width: 3,
      height: 2,
      thumbnailWidth: 3,
      thumbnailHeight: 2,
      sha256: hash,
      thumbnailSha256: hash,
    }),
  };
  const service = new PhotoService(f.store, assets, processor);
  const [photo] = await service.add([{ blob: jpeg, name: 'roze.jpg' }], {
    clientId: 'client-1',
    gardenId: 'garden-1',
    zoneId: 'zone',
    jobId: 'job-1',
    category: 'problem',
    description: 'Liście',
    capturedDate: day,
  });
  return { ...f, assets, service, photo };
}

describe('notatki i sprawy — polecenia i relacje', () => {
  it('tworzy i edytuje ogólną notatkę bez zmiany daty utworzenia', () => {
    const f = fixture();
    f.store.saveNote({
      ...f.note(),
      category: 'observation',
      priority: 'urgent',
    });
    const n = f.store.data.notes[0];
    expect(n).toMatchObject({
      createdAt: 1000,
      updatedAt: 1000,
      revision: 1,
      clientId: null,
    });
    f.tick();
    f.store.saveNote({
      ...n,
      title: 'Poprawiony tytuł',
      body: 'Nowa treść',
      category: 'care',
      priority: null,
    });
    expect(f.repo.load().notes[0]).toMatchObject({
      createdAt: 1000,
      updatedAt: 2000,
      revision: 2,
      title: 'Poprawiony tytuł',
      category: 'care',
      priority: null,
    });
  });
  it('zapisuje wszystkie powiązania i historyczne nazwy', () => {
    const f = fixture();
    f.store.saveNote(f.note({ jobId: 'job-1', zoneId: 'zone' }));
    expect(f.store.data.notes[0]).toMatchObject({
      clientId: 'client-1',
      gardenId: 'garden-1',
      jobId: 'job-1',
      zoneId: 'zone',
      zoneName: 'Rabata',
    });
  });
  it('archiwizuje i przywraca notatkę bez utraty przypomnienia', () => {
    const f = fixture();
    f.store.saveNote({
      ...f.note(),
      reminder: { date: day, time: null, status: 'active', completedAt: null },
    });
    let n = f.store.data.notes[0];
    f.store.archiveNote(n.id, n.revision, true);
    n = f.store.data.notes[0];
    expect(deskEventsBetween(f.store.data, day, day)).toEqual([]);
    expect(n.reminder?.status).toBe('active');
    expect(() => f.store.changeReminder(n.id, n.revision, 'active')).toThrow(
      'archiwum',
    );
    f.store.archiveNote(n.id, n.revision, false);
    expect(deskEventsBetween(f.store.data, day, day)).toHaveLength(1);
  });
  it('usuwa notatkę i zapisuje znacznik usunięcia chroniący przed wskrzeszeniem', () => {
    const f = fixture();
    f.store.saveNote(f.note());
    const n = f.store.data.notes[0];
    f.store.deleteDeskRecord('note', n.id, n.revision);
    expect(f.store.data.notes).toEqual([]);
    expect(f.repo.load().deskTombstones).toEqual([
      { kind: 'note', id: n.id, deletedAt: 1000, revision: 2 },
    ]);
    expect(() => f.store.saveNote({ ...n, revision: 0 })).toThrow(
      'innej karcie',
    );
  });
  it('chroni edycję i status przed starym zapisem w innej karcie', () => {
    const f = fixture();
    f.store.saveNote(f.note());
    const stale = f.store.data.notes[0];
    const other = new GardenStore(f.repo);
    other.saveNote({ ...stale, title: 'Z innej karty' });
    expect(() => f.store.saveNote({ ...stale, title: 'Nadpisanie' })).toThrow(
      'innej karcie',
    );
    expect(() => f.store.archiveNote(stale.id, stale.revision, true)).toThrow(
      'innej karcie',
    );
    expect(f.repo.load().notes[0].title).toBe('Z innej karty');
  });
  it('awaria zapisu nie zmienia ostatniego stanu', () => {
    const f = fixture(),
      before = f.storage.getItem(STORAGE_KEY);
    f.storage.fail = true;
    expect(() => f.store.saveNote(f.note())).toThrow('pełna');
    expect(f.store.data.notes).toEqual([]);
    expect(f.storage.getItem(STORAGE_KEY)).toBe(before);
  });
  it('odłącza usuniętą strefę i zlecenie zachowując notatkę oraz nazwy', () => {
    const f = fixture();
    f.store.saveNote(f.note({ jobId: 'job-1', zoneId: 'zone' }));
    f.store.deleteZone('garden-1', 'zone');
    f.store.deleteJob('job-1');
    const n = f.store.data.notes[0];
    expect(n).toMatchObject({
      zoneId: null,
      jobId: null,
      zoneName: 'Rabata',
      jobTitle: 'Pielęgnacja ogrodu',
      gardenId: 'garden-1',
    });
    f.store.saveNote({ ...n, body: 'Dalsze obserwacje' });
    expect(f.store.data.notes[0].zoneName).toBe('Rabata');
  });
  it('usunięcie pustego klienta zachowuje ogólną notatkę i sprawę', () => {
    const f = fixture();
    f.store.saveClient({
      id: 'empty',
      name: 'Historyczny klient',
      email: '',
      phone: '',
      notes: '',
    });
    f.store.saveNote(f.note({ clientId: 'empty' }));
    f.store.saveTodo(f.todo({ clientId: 'empty' }));
    f.store.deleteClient('empty');
    expect(f.store.data.notes[0]).toMatchObject({
      clientId: null,
      clientName: 'Historyczny klient',
    });
    expect(f.store.data.todos[0].clientId).toBeNull();
  });
  it('przeniesienie zlecenia aktualizuje klienta i ogród bez utraty treści', () => {
    const f = fixture();
    f.store.saveNote(f.note({ jobId: 'job-1', zoneId: 'zone' }));
    f.store.saveJob({ ...f.store.data.jobs[0], gardenId: 'garden-2' });
    expect(f.store.data.notes[0]).toMatchObject({
      clientId: 'client-2',
      gardenId: 'garden-2',
      zoneId: null,
      body: 'Sprawdzić liście',
      gardenName: f.store.data.gardens[1].name,
    });
  });
  it('odrzuca niezgodne relacje zamiast przypisywać do obcego ogrodu', () => {
    const f = fixture();
    expect(() =>
      f.store.saveNote(f.note({ clientId: 'client-2', gardenId: 'garden-1' })),
    ).toThrow('zgodne');
    expect(() =>
      resolveDeskScope(f.store.data, {
        ...emptyScope,
        gardenId: 'garden-2',
        zoneId: 'zone',
      }),
    ).toThrow('zgodne');
  });
});

describe('przypomnienia, sprawy i kalendarz', () => {
  it('odracza ten sam wpis, bez duplikatu i zmiany identyfikatora wydarzenia', () => {
    const f = fixture();
    f.store.saveNote({
      ...f.note(),
      reminder: {
        date: day,
        time: '10:30',
        status: 'active',
        completedAt: null,
      },
    });
    const old = deskEventsBetween(f.store.data, day, '2026-11-05')[0],
      n = f.store.data.notes[0];
    f.tick();
    f.store.changeReminder(n.id, n.revision, 'active', '2026-11-02', null);
    expect(deskEventsBetween(f.store.data, day, day)).toEqual([]);
    expect(deskEventsBetween(f.store.data, '2026-11-02', '2026-11-02')).toEqual(
      [{ ...old, date: '2026-11-02', time: '' }],
    );
    expect(f.store.data.notes).toHaveLength(1);
  });
  it.each(['completed', 'cancelled', 'active'] as const)(
    'zmienia status przypomnienia na %s',
    (status) => {
      const f = fixture();
      f.store.saveNote({
        ...f.note(),
        reminder: {
          date: day,
          time: null,
          status: 'active',
          completedAt: null,
        },
      });
      const n = f.store.data.notes[0];
      f.store.changeReminder(n.id, n.revision, status);
      expect(f.store.data.notes[0].reminder).toMatchObject({
        status,
        completedAt: status === 'completed' ? 1000 : null,
      });
      expect(deskEventsBetween(f.store.data, day, day)[0].status).toBe(
        status === 'active' ? 'planned' : status,
      );
    },
  );
  it('tworzy niezależną sprawę bez terminu, edytuje i szybko wykonuje', () => {
    const f = fixture();
    f.store.saveTodo(f.todo());
    let t = f.store.data.todos[0];
    expect(t.dueDate).toBeNull();
    f.tick();
    f.store.saveTodo({
      ...t,
      dueDate: day,
      dueTime: '14:00',
      description: 'Uzgodnić termin',
    });
    t = f.store.data.todos[0];
    f.store.changeTodoStatus(t.id, t.revision, 'completed');
    t = f.store.data.todos[0];
    expect(t).toMatchObject({
      createdAt: 1000,
      completedAt: 2000,
      status: 'completed',
    });
    f.store.changeTodoStatus(t.id, t.revision, 'open');
    expect(f.store.data.todos[0].completedAt).toBeNull();
  });
  it('anuluje i usuwa sprawę, zachowując znacznik usunięcia', () => {
    const f = fixture();
    f.store.saveTodo(f.todo());
    let t = f.store.data.todos[0];
    f.store.changeTodoStatus(t.id, t.revision, 'cancelled');
    t = f.store.data.todos[0];
    f.store.deleteDeskRecord('todo', t.id, t.revision);
    expect(f.store.data.todos).toEqual([]);
    expect(() => f.store.saveTodo(t)).toThrow('innej karcie');
  });
  it('wydarzenia powstają tylko z terminów, mają osobne przestrzenie ID i nie zapisują się jako zlecenia', () => {
    const f = fixture(),
      before = structuredClone(f.store.data);
    f.store.saveNote({
      ...f.note(),
      reminder: { date: day, time: null, status: 'active', completedAt: null },
    });
    f.store.saveTodo({
      ...f.todo(),
      id: f.store.data.notes[0].id,
      dueDate: day,
    });
    f.store.saveTodo(f.todo());
    const events = deskEventsBetween(f.store.data, day, day);
    expect(events).toHaveLength(2);
    expect(new Set(events.map((e) => e.id)).size).toBe(2);
    expect(f.store.data.jobs).toEqual(before.jobs);
    expect(f.store.data.payments).toEqual(before.payments);
    expect(f.store.data.timer).toEqual(before.timer);
    expect(f.store.data.taskOccurrences).toEqual(before.taskOccurrences);
  });
  it.each([
    [null, null, 'none'],
    ['2026-10-30', null, 'overdue'],
    [day, null, 'today'],
    [day, '09:59', 'overdue'],
    [day, '10:00', 'today'],
    [day, '11:00', 'today'],
    ['2026-11-01', null, 'upcoming'],
  ] as const)('grupuje termin %s %s jako %s', (date, time, group) =>
    expect(deadlineGroup(date, time, new Date(2026, 9, 31, 10, 0))).toBe(group),
  );
  it.each([
    { title: '   ' },
    { category: 'invalid' },
    { priority: 'invalid' },
    {
      reminder: {
        date: '2026-02-30',
        time: null,
        status: 'active',
        completedAt: null,
      },
    },
    {
      reminder: {
        date: day,
        time: '25:00',
        status: 'active',
        completedAt: null,
      },
    },
    {
      reminder: {
        date: day,
        time: null,
        status: 'completed',
        completedAt: null,
      },
    },
  ])('waliduje notatkę przed zapisem: %j', (patch) => {
    const f = fixture(),
      before = f.storage.getItem(STORAGE_KEY);
    expect(() =>
      f.store.saveNote({ ...f.note(), ...patch } as ReturnType<typeof f.note>),
    ).toThrow();
    expect(f.storage.getItem(STORAGE_KEY)).toBe(before);
  });
  it('odrzuca godzinę sprawy bez daty', () => {
    const f = fixture();
    expect(() => f.store.saveTodo({ ...f.todo(), dueTime: '10:00' })).toThrow();
  });
});

describe('zdjęcia, kopie i migracje', () => {
  it('łączy notatkę przez ID bez kopiowania plików i nie kasuje zdjęcia z notatką', async () => {
    const f = await photoFixture();
    f.store.saveNote({
      ...f.note({ jobId: 'job-1', zoneId: 'zone' }),
      photoId: f.photo.id,
    });
    const n = f.store.data.notes[0];
    expect(n.photoName).toBe('roze.jpg');
    expect(await f.assets.list()).toHaveLength(1);
    f.store.deleteDeskRecord('note', n.id, n.revision);
    expect(f.store.data.photos).toHaveLength(1);
    expect(await f.assets.list()).toHaveLength(1);
  });
  it('usunięcie zdjęcia odłącza referencję, zachowując notatkę i nazwę historyczną', async () => {
    const f = await photoFixture();
    f.store.saveNote({ ...f.note(), photoId: f.photo.id });
    await f.service.remove(f.photo);
    expect(f.store.data.notes[0]).toMatchObject({
      photoId: null,
      photoName: 'roze.jpg',
      body: 'Sprawdzić liście',
    });
    expect(await f.assets.list()).toEqual([]);
  });
  it('eksport i import ZIP odtwarza nowe dane i powiązanie zdjęcia, zachowując punkt odzyskiwania', async () => {
    const f = await photoFixture();
    f.store.saveNote({
      ...f.note(),
      photoId: f.photo.id,
      reminder: {
        date: day,
        time: '15:00',
        status: 'active',
        completedAt: null,
      },
    });
    f.store.saveTodo({ ...f.todo(), dueDate: day });
    const original = structuredClone(f.store.data),
      zip = await f.service.exportFull();
    const n = f.store.data.notes[0];
    f.store.deleteDeskRecord('note', n.id, n.revision);
    const changed = structuredClone(f.store.data);
    const prepared = await f.service.prepare(zip);
    await f.service.importFull(prepared.prepared, prepared.expected);
    expect(f.store.data.notes).toEqual(original.notes);
    expect(f.store.data.todos).toEqual(original.todos);
    expect(f.store.data.photos[0].id).toBe(f.photo.id);
    expect((await f.service.recovery())?.data.notes).toEqual(changed.notes);
    const recovery = await f.service.prepareRecovery();
    await f.service.restoreRecovery(recovery.point.id, recovery.expected);
    expect(f.store.data.deskTombstones).toEqual(changed.deskTombstones);
  });
  it('czyta pełną kopię ZIP v6 z fotografiami po aktualizacji do v7', async () => {
    const f = await photoFixture(),
      zip = await f.service.exportFull(),
      files = unzipSync(new Uint8Array(await zip.arrayBuffer()));
    const envelope = { version: 6, data: legacy6(f.store.data) };
    files['data.json'] = strToU8(JSON.stringify(envelope));
    const manifest = JSON.parse(strFromU8(files['manifest.json']));
    manifest.dataSha256 = await sha256(
      new Blob([files['data.json'].slice().buffer]),
    );
    files['manifest.json'] = strToU8(JSON.stringify(manifest));
    const imported = await readFullBackup(
      new Blob([zipSync(files).slice().buffer]),
    );
    expect(imported.data.notes).toEqual([]);
    expect(imported.data.jobs).toEqual(f.store.data.jobs);
    expect(imported.assets).toHaveLength(1);
  });
  it('stary punkt odzyskiwania IndexedDB v6 nadal można wyeksportować i przywrócić', async () => {
    const f = await photoFixture(),
      raw = legacy6(f.store.data);
    await f.assets.stageRestore([], {
      id: 'old-recovery',
      data: raw,
      createdAt: 1000,
      stagedAssetIds: [],
    });
    await f.assets.finishRestore();
    const point = await f.service.recovery();
    expect(point?.data.notes).toEqual([]);
    expect(
      (await readFullBackup(await f.service.exportRecovery())).assets,
    ).toHaveLength(1);
    const prepared = await f.service.prepareRecovery();
    await f.service.restoreRecovery(prepared.point.id, prepared.expected);
    expect(f.store.data.photos).toHaveLength(1);
    expect(f.store.data.todos).toEqual([]);
  });
  it('migruje v6, zachowując oryginał, płatności, zdjęcia i pozostałe kolekcje', () => {
    const f = fixture(),
      old = legacy6(f.store.data),
      raw = JSON.stringify({ version: 6, data: old });
    f.storage.setItem(STORAGE_KEY, raw);
    const migrated = f.repo.load();
    expect(migrated).toEqual({
      ...old,
      notes: [],
      todos: [],
      deskTombstones: [],
    });
    expect(f.storage.getItem(V6_BACKUP_KEY)).toBe(raw);
    expect(JSON.parse(f.storage.getItem(STORAGE_KEY)!).version).toBe(
      STORAGE_VERSION,
    );
  });
  it.each([1, 2, 3, 4, 5])(
    'dodaje nowe kolekcje również podczas migracji formatu v%s',
    (version) => {
      const f = fixture(),
        old = legacy6(f.store.data);
      f.storage.setItem(STORAGE_KEY, JSON.stringify({ version, data: old }));
      const migrated = f.repo.load();
      expect(migrated.notes).toEqual([]);
      expect(migrated.todos).toEqual([]);
      expect(migrated.deskTombstones).toEqual([]);
      expect(migrated.clients).toEqual(old.clients);
      expect(migrated.gardens).toEqual(old.gardens);
      validateData(migrated);
    },
  );
  it('brak miejsca na kopię migracji pozostawia poprzedni zapis', () => {
    const f = fixture(),
      raw = JSON.stringify({ version: 6, data: legacy6(f.store.data) });
    f.storage.setItem(STORAGE_KEY, raw);
    f.storage.fail = true;
    expect(() => f.repo.load()).toThrow('kopii');
    expect(f.storage.getItem(STORAGE_KEY)).toBe(raw);
  });
  it('nie zastępuje wadliwej obecnej kolekcji pustą tablicą podczas migracji', () => {
    const f = fixture(),
      raw = JSON.stringify({
        version: 6,
        data: { ...legacy6(f.store.data), notes: null },
      });
    f.storage.setItem(STORAGE_KEY, raw);
    expect(() => f.repo.load()).toThrow();
    expect(f.storage.getItem(STORAGE_KEY)).toBe(raw);
  });
  it('JSON v7 zawiera komplet nowych danych oraz znaczników usunięcia', () => {
    const f = fixture();
    f.store.saveNote(f.note());
    f.store.saveTodo(f.todo());
    const t = f.store.data.todos[0];
    f.store.deleteDeskRecord('todo', t.id, t.revision);
    const copy = JSON.parse(f.storage.getItem(STORAGE_KEY)!);
    validateData(copy.data);
    expect(copy.data).toEqual(f.store.data);
  });
  it('waliduje brak kolekcji v7 i duplikaty bez nadpisania oryginału', () => {
    const f = fixture();
    f.store.saveNote(f.note());
    const bad = {
      ...f.store.data,
      notes: [...f.store.data.notes, ...f.store.data.notes],
    };
    expect(() => validateData(bad)).toThrow();
    const raw = JSON.stringify({ version: 7, data: legacy6(f.store.data) });
    f.storage.setItem(STORAGE_KEY, raw);
    expect(() => f.repo.load()).toThrow();
    expect(f.storage.getItem(STORAGE_KEY)).toBe(raw);
  });
});
