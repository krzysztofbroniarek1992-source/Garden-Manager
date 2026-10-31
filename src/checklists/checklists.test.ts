import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { createDemoData } from '../data/demo';
import { GardenStore } from '../data/store';
import {
  LocalRepository,
  STORAGE_KEY,
  STORAGE_VERSION,
  V7_BACKUP_KEY,
  validateData,
  type StoragePort,
} from '../data/repository';
import type { Data } from '../domain';
import {
  checklistProgress,
  incompleteVisitChecklists,
  newWorkTemplate,
} from './model';
import type { TaskSchedule } from '../planning/model';
import { taskOccurrencesBetween } from '../planning/occurrences';
import { IndexedDbPhotoRepository } from '../photos/assets';
import { PhotoService } from '../photos/service';
import { readFullBackup } from '../photos/backup';
import { sha256 } from '../photos/images';
import type { PhotoProcessor } from '../photos/model';

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
const day = '2026-10-31';
const visit = { kind: 'visit' as const, jobId: 'job-1' };
const plan = { kind: 'plan' as const, gardenId: 'garden-1', zoneId: 'zone' };
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
  let now = 1000;
  const storage = new MemoryStorage(),
    seed = createDemoData(new Date(`${day}T12:00:00`));
  seed.gardens[0].zones = [
    {
      id: 'zone',
      name: 'Rabata różana',
      type: 'rabata',
      area: 15,
      length: null,
      plants: 'Róże',
      requirements: '',
      treatments: '',
    },
  ];
  seed.payments = [
    {
      id: 'payment',
      jobId: 'job-5',
      amountCents: 1000,
      receivedDate: day,
      method: 'cash',
      note: 'Zachować',
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
    template: () => ({
      ...newWorkTemplate(),
      name: 'Moja pielęgnacja',
      category: 'Rabaty',
      description: 'Własny standard',
      items: [
        { id: 'a', title: 'Kontrola' },
        { id: 'b', title: 'Pielęgnacja' },
        { id: 'c', title: 'Sprzątanie' },
      ],
    }),
  };
}
function legacy(data: Data, version = 7) {
  const value = JSON.parse(JSON.stringify(data));
  delete value.workTemplates;
  delete value.checklists;
  delete value.checklistTombstones;
  if (version === 6) {
    delete value.notes;
    delete value.todos;
    delete value.deskTombstones;
  }
  return value;
}
async function photoFixture() {
  const f = fixture(),
    assets = new IndexedDbPhotoRepository(new IDBFactory()),
    hash = await sha256(jpeg),
    processor: PhotoProcessor = {
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
  const [photo] = await service.add([{ blob: jpeg, name: 'rabata.jpg' }], {
    clientId: 'client-1',
    gardenId: 'garden-1',
    zoneId: 'zone',
    jobId: 'job-1',
    category: 'after',
    description: 'Efekt pracy',
    capturedDate: day,
  });
  return { ...f, assets, service, photo };
}
const schedule = (): TaskSchedule => ({
  id: 'schedule',
  title: 'Koszenie cykliczne',
  notes: '',
  startDate: day,
  endDate: null,
  time: '09:00',
  clientId: 'client-1',
  gardenId: 'garden-1',
  zoneId: 'zone',
  zoneName: 'Rabata różana',
  recurrence: {
    frequency: 'days',
    interval: 14,
    months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  },
  endedOn: null,
  revision: 0,
  updatedAt: 0,
  checklistTemplateId: 'starter-lawn-v1',
});

describe('szablony i niezależne checklisty', () => {
  it('udostępnia cztery edytowalne przykłady z pełną kolejnością bez dawek', () => {
    const f = fixture();
    expect(f.store.data.workTemplates.map((t) => t.name)).toEqual([
      'Koszenie trawnika',
      'Cięcie żywopłotu',
      'Pielęgnacja drzew i krzewów',
      'Zabieg ochrony roślin',
    ]);
    expect(f.store.data.workTemplates.map((t) => t.items.length)).toEqual([
      6, 7, 6, 7,
    ]);
    const t = f.store.data.workTemplates[0];
    f.store.saveWorkTemplate({ ...t, name: 'Moje koszenie' });
    expect(f.store.data.workTemplates[0].name).toBe('Moje koszenie');
    expect(f.store.data.workTemplates[3].description).toContain('etykiety');
  });
  it('tworzy, edytuje i zmienia kolejność szablonu, zachowując datę utworzenia', () => {
    const f = fixture(),
      draft = f.template();
    f.store.saveWorkTemplate(draft);
    const t = f.store.data.workTemplates.at(-1)!;
    f.tick();
    f.store.saveWorkTemplate({
      ...t,
      name: 'Nowy standard',
      items: [t.items[2], t.items[0]],
    });
    expect(f.repo.load().workTemplates.at(-1)).toMatchObject({
      name: 'Nowy standard',
      createdAt: 1000,
      updatedAt: 2000,
      revision: 2,
      items: [{ id: 'c' }, { id: 'a' }],
    });
  });
  it('kopiuje szablon z nowymi identyfikatorami i bez archiwizacji', () => {
    const f = fixture(),
      t = f.store.data.workTemplates[0];
    f.store.archiveWorkTemplate(t.id, t.revision, true);
    const archived = f.store.data.workTemplates[0],
      id = f.store.copyWorkTemplate(archived.id, archived.revision),
      copy = f.store.data.workTemplates.find((t) => t.id === id)!;
    expect(copy).toMatchObject({
      name: 'Koszenie trawnika — kopia',
      archivedAt: null,
      revision: 1,
      createdAt: 1000,
    });
    expect(copy.items.map((i) => i.title)).toEqual(t.items.map((i) => i.title));
    expect(copy.items.map((i) => i.id)).not.toEqual(t.items.map((i) => i.id));
  });
  it('archiwizacja i usuwanie szablonu nie zmieniają istniejącej checklisty', () => {
    const f = fixture(),
      t = f.store.data.workTemplates[0],
      id = f.store.applyWorkTemplate(t.id, visit),
      original = structuredClone(f.store.data.checklists);
    f.store.archiveWorkTemplate(t.id, t.revision, true);
    expect(f.store.data.checklists).toEqual(original);
    const archived = f.store.data.workTemplates[0];
    f.store.archiveWorkTemplate(t.id, archived.revision, false);
    f.store.deleteWorkTemplate(t.id, f.store.data.workTemplates[0].revision);
    expect(f.store.data.checklists).toEqual(original);
    expect(f.store.applyWorkTemplate(t.id, visit)).toBe(id);
    expect(() => f.store.saveWorkTemplate({ ...t, revision: 0 })).toThrow(
      'innej karcie',
    );
  });
  it('edycja szablonu nie zmienia kopii tytułów, opisu ani postępu wizyty', () => {
    const f = fixture(),
      t = f.store.data.workTemplates[0],
      id = f.store.applyWorkTemplate(t.id, visit),
      c = f.store.data.checklists[0];
    f.store.editChecklistItem(id, c.revision, c.items[0].id, {
      status: 'done',
      note: 'Wykonane',
    });
    const original = structuredClone(f.store.data.checklists);
    f.store.saveWorkTemplate({
      ...t,
      name: 'Zmieniony',
      description: 'Inna treść',
      items: [{ id: 'only', title: 'Inna czynność' }],
    });
    expect(f.store.data.checklists).toEqual(original);
  });
  it('przypisuje kilka różnych szablonów do wizyty, a ponowne zastosowanie nie duplikuje', () => {
    const f = fixture(),
      a = f.store.applyWorkTemplate('starter-lawn-v1', visit),
      again = f.store.applyWorkTemplate('starter-lawn-v1', {
        ...visit,
        zoneId: 'zone',
      }),
      b = f.store.applyWorkTemplate('starter-hedge-v1', visit);
    expect(a).toBe(again);
    expect(a).not.toBe(b);
    expect(f.store.data.checklists).toHaveLength(2);
    expect(new GardenStore(f.repo).data.checklists).toHaveLength(2);
  });
  it('ręczna checklista może powstać od zera z nowymi czynnościami', () => {
    const f = fixture(),
      id = f.store.createBlankChecklist(visit, 'Dodatkowe prace');
    f.store.addChecklistItem(id, 1, 'Oczyścić obrzeża');
    let c = f.store.data.checklists[0];
    f.store.addChecklistItem(id, c.revision, 'Kontrola bramy');
    c = f.store.data.checklists[0];
    f.store.moveChecklistItem(id, c.revision, c.items[1].id, -1);
    c = f.store.data.checklists[0];
    expect(c.items.map((i) => i.title)).toEqual([
      'Kontrola bramy',
      'Oczyścić obrzeża',
    ]);
    f.store.removeChecklistItem(id, c.revision, c.items[0].id);
    expect(f.store.data.checklists[0].items).toHaveLength(1);
  });
  it('zapisuje status, datę wykonania oraz uwagi; edycja uwagi zachowuje datę', () => {
    const f = fixture(),
      id = f.store.applyWorkTemplate('starter-lawn-v1', visit);
    let c = f.store.data.checklists[0];
    f.store.editChecklistItem(id, c.revision, c.items[0].id, {
      status: 'done',
    });
    f.tick();
    c = f.store.data.checklists[0];
    f.store.editChecklistItem(id, c.revision, c.items[0].id, {
      note: 'Teren sprawdzony',
    });
    expect(f.store.data.checklists[0].items[0]).toMatchObject({
      status: 'done',
      completedAt: 1000,
      note: 'Teren sprawdzony',
      updatedAt: 2000,
    });
    c = f.store.data.checklists[0];
    f.store.editChecklistItem(id, c.revision, c.items[0].id, {
      status: 'pending',
    });
    expect(f.store.data.checklists[0].items[0].completedAt).toBeNull();
  });
  it('wyłącza Nie dotyczy z mianownika i nie zapisuje zaokrąglonego postępu', () => {
    const f = fixture();
    f.store.saveWorkTemplate(f.template());
    const id = f.store.applyWorkTemplate(
      f.store.data.workTemplates.at(-1)!.id,
      visit,
    );
    let c = f.store.data.checklists[0];
    f.store.editChecklistItem(id, c.revision, c.items[0].id, {
      status: 'done',
    });
    c = f.store.data.checklists[0];
    expect(checklistProgress(c.items).percent).toBeCloseTo(100 / 3, 12);
    f.store.editChecklistItem(id, c.revision, c.items[1].id, {
      status: 'not-applicable',
    });
    c = f.store.data.checklists[0];
    expect(checklistProgress(c.items)).toEqual({
      done: 1,
      total: 2,
      excluded: 1,
      percent: 50,
    });
    expect(c.items[1].completedAt).toBeNull();
  });
  it('puste listy i listy składające się tylko z Nie dotyczy nie udają 100%', () => {
    const f = fixture(),
      id = f.store.createBlankChecklist(visit, 'Pusta');
    expect(checklistProgress([]).percent).toBeNull();
    expect(incompleteVisitChecklists(f.store.data, 'job-1')).toHaveLength(1);
    f.store.addChecklistItem(id, 1, 'Opcjonalna');
    const c = f.store.data.checklists[0];
    f.store.editChecklistItem(id, c.revision, c.items[0].id, {
      status: 'not-applicable',
    });
    expect(
      checklistProgress(f.store.data.checklists[0].items).percent,
    ).toBeNull();
    expect(incompleteVisitChecklists(f.store.data, 'job-1')).toEqual([]);
  });
  it('zmienia metadane checklisty bez modyfikowania szablonu', () => {
    const f = fixture(),
      before = structuredClone(f.store.data.workTemplates),
      id = f.store.applyWorkTemplate('starter-lawn-v1', visit);
    f.store.editChecklist(id, 1, {
      name: 'Moja lista',
      category: 'Dodatkowe',
      description: 'Inne warunki',
    });
    expect(f.store.data.checklists[0]).toMatchObject({
      name: 'Moja lista',
      category: 'Dodatkowe',
      description: 'Inne warunki',
    });
    expect(f.store.data.workTemplates).toEqual(before);
  });
  it('usuwa checklistę ze znacznikiem usunięcia, zachowując wizytę i szablon', () => {
    const f = fixture(),
      before = structuredClone(f.store.data),
      id = f.store.applyWorkTemplate('starter-lawn-v1', visit);
    f.store.deleteChecklist(id, 1);
    expect(f.store.data.checklists).toEqual([]);
    expect(f.store.data.checklistTombstones[0]).toMatchObject({
      id,
      kind: 'checklist',
      revision: 2,
    });
    expect(f.store.data.jobs).toEqual(before.jobs);
    expect(f.store.data.workTemplates).toEqual(before.workTemplates);
    expect(() => f.store.addChecklistItem(id, 1, 'Nie przywróci')).toThrow(
      'innej karcie',
    );
  });
  it('wykrywa nieaktualny zapis szablonu i czynności z drugiej karty', () => {
    const f = fixture(),
      id = f.store.applyWorkTemplate('starter-lawn-v1', visit),
      c = f.store.data.checklists[0],
      other = new GardenStore(f.repo);
    other.editChecklistItem(id, c.revision, c.items[0].id, { status: 'done' });
    expect(() =>
      f.store.editChecklistItem(id, c.revision, c.items[1].id, {
        status: 'done',
      }),
    ).toThrow('innej karcie');
    const t = f.store.data.workTemplates[0];
    other.saveWorkTemplate({ ...t, name: 'Nowy' });
    expect(() => f.store.saveWorkTemplate(t)).toThrow('innej karcie');
  });
  it('awaria localStorage zachowuje ostatni zapis i postęp', () => {
    const f = fixture(),
      id = f.store.applyWorkTemplate('starter-lawn-v1', visit),
      before = f.storage.getItem(STORAGE_KEY);
    f.storage.failKey = STORAGE_KEY;
    const c = f.store.data.checklists[0];
    expect(() =>
      f.store.editChecklistItem(id, c.revision, c.items[0].id, {
        status: 'done',
      }),
    ).toThrow('pełna');
    expect(f.storage.getItem(STORAGE_KEY)).toBe(before);
    expect(f.store.data.checklists[0].items[0].status).toBe('pending');
  });
  it.each([
    { name: ' ' },
    { category: '' },
    { items: [] },
    {
      items: [
        { id: 'a', title: 'A' },
        { id: 'a', title: 'B' },
      ],
    },
  ])('waliduje szablon %j', (patch) => {
    const f = fixture(),
      before = f.storage.getItem(STORAGE_KEY);
    expect(() =>
      f.store.saveWorkTemplate({ ...f.template(), ...patch }),
    ).toThrow();
    expect(f.storage.getItem(STORAGE_KEY)).toBe(before);
  });
});

describe('plany ogrodów i harmonogramy', () => {
  it('plan strefy i ogrodu nie tworzy zlecenia ani należności', () => {
    const f = fixture(),
      before = structuredClone(f.store.data);
    f.store.applyWorkTemplate('starter-lawn-v1', plan);
    f.store.applyWorkTemplate('starter-lawn-v1', { ...plan, zoneId: null });
    expect(f.store.data.checklists).toHaveLength(2);
    expect(f.store.data.checklists[0]).toMatchObject({
      kind: 'plan',
      gardenId: 'garden-1',
      zoneId: 'zone',
      zoneName: 'Rabata różana',
      jobId: null,
    });
    expect(f.store.data.jobs).toEqual(before.jobs);
    expect(f.store.data.payments).toEqual(before.payments);
    expect(f.store.data.timer).toBeNull();
  });
  it('kopiuje plan do wizyty z wyzerowanym postępem, zachowując uwagi i niezależność', () => {
    const f = fixture(),
      id = f.store.applyWorkTemplate('starter-lawn-v1', plan);
    let c = f.store.data.checklists[0];
    f.store.editChecklistItem(id, c.revision, c.items[0].id, {
      status: 'done',
      note: 'Zalecenie',
    });
    const original = structuredClone(f.store.data.checklists[0]),
      visitId = f.store.applyGardenPlan(id, 'job-1');
    const copy = f.store.data.checklists.find((c) => c.id === visitId)!;
    expect(copy.items[0]).toMatchObject({
      status: 'pending',
      completedAt: null,
      note: 'Zalecenie',
    });
    expect(copy.items[0].id).not.toBe(original.items[0].id);
    expect(f.store.applyGardenPlan(id, 'job-1')).toBe(visitId);
    f.store.deleteChecklist(id, original.revision);
    expect(f.store.data.checklists).toEqual([copy]);
  });
  it('odrzuca plan obcego ogrodu i nieistniejącą strefę', () => {
    const f = fixture(),
      id = f.store.applyWorkTemplate('starter-lawn-v1', plan);
    expect(() => f.store.applyGardenPlan(id, 'job-2')).toThrow('tego ogrodu');
    expect(() =>
      f.store.applyWorkTemplate('starter-lawn-v1', {
        ...plan,
        zoneId: 'missing',
      }),
    ).toThrow('istniejący');
  });
  it('wskazanie szablonu harmonogramu nie materializuje przyszłych checklist', () => {
    const f = fixture();
    f.store.saveTaskSchedule(schedule());
    expect(
      taskOccurrencesBetween(f.store.data, day, '2030-10-31').length,
    ).toBeGreaterThan(100);
    expect(f.store.data.checklists).toEqual([]);
    expect(f.store.data.taskOccurrences).toEqual([]);
  });
  it('rozpoczęcie terminu może zastosować jedną listę, a ponowne otwarcie nie duplikuje i nie restartuje stopera', () => {
    const f = fixture();
    f.store.saveTaskSchedule(schedule());
    const id = f.store.beginTaskOccurrence(
        'schedule',
        day,
        undefined,
        undefined,
        true,
      ),
      before = structuredClone(f.store.data);
    f.tick();
    expect(
      f.store.beginTaskOccurrence('schedule', day, undefined, undefined, true),
    ).toBe(id);
    expect(f.store.data.checklists).toEqual(before.checklists);
    expect(f.store.data.timer).toEqual(before.timer);
    expect(f.store.data.checklists[0]).toMatchObject({
      jobId: id,
      zoneId: 'zone',
    });
    expect(
      f.store.applyWorkTemplate('starter-lawn-v1', {
        kind: 'visit',
        jobId: id,
      }),
    ).toBe(before.checklists[0].id);
  });
  it('rozpoczyna wizytę z checklistą również po usunięciu historycznej strefy harmonogramu', () => {
    const f = fixture();
    f.store.saveTaskSchedule(schedule());
    f.store.deleteZone('garden-1', 'zone');
    const jobId = f.store.beginTaskOccurrence(
      'schedule',
      day,
      undefined,
      undefined,
      true,
    );
    expect(f.store.data.checklists[0]).toMatchObject({
      jobId,
      gardenId: 'garden-1',
      zoneId: null,
    });
  });
  it('rozpoczęcie bez zastosowania szablonu tworzy tylko wizytę i nie dodaje listy po odświeżeniu', () => {
    const f = fixture();
    f.store.saveTaskSchedule(schedule());
    f.store.beginTaskOccurrence('schedule', day);
    expect(new GardenStore(f.repo).data.checklists).toEqual([]);
  });
  it('archiwizacja szablonu pozostawia istniejącą listę, a usunięcie odłącza go od harmonogramu', () => {
    const f = fixture();
    f.store.saveTaskSchedule(schedule());
    const t = f.store.data.workTemplates[0];
    f.store.archiveWorkTemplate(t.id, t.revision, true);
    expect(() =>
      f.store.beginTaskOccurrence('schedule', day, undefined, undefined, true),
    ).toThrow('zarchiwizowany');
    expect(f.store.data.timer).toBeNull();
    f.store.deleteWorkTemplate(t.id, f.store.data.workTemplates[0].revision);
    expect(f.store.data.taskSchedules[0].checklistTemplateId).toBeNull();
    f.store.beginTaskOccurrence('schedule', day, undefined, undefined, true);
    expect(f.store.data.checklists).toEqual([]);
  });
  it('zmiana szablonu harmonogramu nie zmienia listy poprzedniej wizyty', () => {
    const f = fixture();
    f.store.saveTaskSchedule(schedule());
    f.store.beginTaskOccurrence('schedule', day, undefined, undefined, true);
    const before = structuredClone(f.store.data.checklists);
    f.store.saveTaskSchedule({
      ...f.store.data.taskSchedules[0],
      checklistTemplateId: 'starter-hedge-v1',
    });
    expect(f.store.data.checklists).toEqual(before);
  });
  it('usunięcie strefy i zlecenia zachowuje historię checklisty i nazwy', () => {
    const f = fixture(),
      id = f.store.applyWorkTemplate('starter-lawn-v1', {
        ...visit,
        zoneId: 'zone',
      });
    f.store.deleteZone('garden-1', 'zone');
    f.store.deleteJob('job-1');
    expect(f.store.data.checklists[0]).toMatchObject({
      id,
      kind: 'visit',
      zoneId: null,
      jobId: null,
      zoneName: 'Rabata różana',
      jobTitle: 'Pielęgnacja ogrodu',
      gardenId: 'garden-1',
    });
  });
  it('usunięcie pustego ogrodu odłącza plan i zachowuje go w historii biblioteki', () => {
    const f = fixture();
    f.store.saveGarden({
      id: 'empty',
      clientId: 'client-1',
      name: 'Historyczny ogród',
      address: '',
      area: 1,
      notes: '',
      zones: [],
    });
    f.store.applyWorkTemplate('starter-lawn-v1', {
      kind: 'plan',
      gardenId: 'empty',
      zoneId: null,
    });
    f.store.deleteGarden('empty');
    expect(f.store.data.checklists[0]).toMatchObject({
      kind: 'plan',
      gardenId: null,
      gardenName: 'Historyczny ogród',
    });
  });
  it('przeniesienie wizyty aktualizuje ogród i odłącza poprzednią strefę', () => {
    const f = fixture();
    f.store.applyWorkTemplate('starter-lawn-v1', { ...visit, zoneId: 'zone' });
    f.store.saveJob({ ...f.store.data.jobs[0], gardenId: 'garden-2' });
    expect(f.store.data.checklists[0]).toMatchObject({
      gardenId: 'garden-2',
      zoneId: null,
      gardenName: f.store.data.gardens[1].name,
    });
  });
  it('operacje checklist nie zmieniają aktywnego stopera, należności, materiałów i płatności', () => {
    const f = fixture();
    f.store.startTimer('job-1');
    const before = structuredClone(f.store.data);
    f.tick();
    const id = f.store.applyWorkTemplate('starter-lawn-v1', visit);
    let c = f.store.data.checklists[0];
    f.store.editChecklistItem(id, c.revision, c.items[0].id, {
      status: 'done',
    });
    c = f.store.data.checklists[0];
    f.store.editChecklistItem(id, c.revision, c.items[1].id, {
      status: 'not-applicable',
    });
    expect(f.store.data.timer).toEqual(before.timer);
    expect(f.store.data.jobs).toEqual(before.jobs);
    expect(f.store.data.payments).toEqual(before.payments);
  });
  it('można zakończyć wizytę z niepełną checklistą bez automatycznego zatwierdzenia należności', () => {
    const f = fixture();
    f.store.applyWorkTemplate('starter-lawn-v1', visit);
    f.store.completeJob('job-1');
    expect(incompleteVisitChecklists(f.store.data, 'job-1')).toHaveLength(1);
    expect(f.store.data.jobs[0]).toMatchObject({
      status: 'completed',
      settlement: null,
      seconds: 0,
    });
    expect(f.store.data.payments).toHaveLength(1);
  });
});

describe('zdjęcia, migracje i pełne kopie', () => {
  it('wiąże istniejący identyfikator zdjęcia bez kopiowania pliku i zachowuje go po usunięciu checklisty', async () => {
    const f = await photoFixture(),
      id = f.store.applyWorkTemplate('starter-lawn-v1', visit);
    let c = f.store.data.checklists[0];
    f.store.editChecklistItem(id, c.revision, c.items[0].id, {
      photoId: f.photo.id,
    });
    expect(await f.assets.list()).toHaveLength(1);
    c = f.store.data.checklists[0];
    expect(c.items[0]).toMatchObject({
      photoId: f.photo.id,
      photoName: 'rabata.jpg',
    });
    f.store.deleteChecklist(id, c.revision);
    expect(await f.assets.list()).toHaveLength(1);
    expect(f.store.data.photos).toHaveLength(1);
  });
  it('usunięcie zdjęcia odłącza ID, zachowując uwagę, status i datę wykonania', async () => {
    const f = await photoFixture(),
      id = f.store.applyWorkTemplate('starter-lawn-v1', visit),
      c = f.store.data.checklists[0];
    f.store.editChecklistItem(id, c.revision, c.items[0].id, {
      photoId: f.photo.id,
      status: 'done',
      note: 'Wykonano',
    });
    const before = f.store.data.checklists[0].items[0];
    await f.service.remove(f.photo);
    expect(f.store.data.checklists[0].items[0]).toMatchObject({
      photoId: null,
      photoName: 'rabata.jpg',
      status: 'done',
      completedAt: before.completedAt,
      note: 'Wykonano',
    });
  });
  it('pełna kopia i punkt odzyskiwania odtwarzają postęp, zdjęcia i źródło szablonu', async () => {
    const f = await photoFixture(),
      id = f.store.applyWorkTemplate('starter-lawn-v1', visit);
    let c = f.store.data.checklists[0];
    f.store.editChecklistItem(id, c.revision, c.items[0].id, {
      status: 'done',
      note: 'Uwaga',
      photoId: f.photo.id,
    });
    const original = structuredClone(f.store.data),
      zip = await f.service.exportFull();
    c = f.store.data.checklists[0];
    f.store.deleteChecklist(id, c.revision);
    const prepared = await f.service.prepare(zip);
    await f.service.importFull(prepared.prepared, prepared.expected);
    expect(f.store.data.checklists).toEqual(original.checklists);
    expect(f.store.data.workTemplates).toEqual(original.workTemplates);
    expect(f.store.data.jobs).toEqual(original.jobs);
    expect(f.store.data.payments).toEqual(original.payments);
    const recovery = await f.service.prepareRecovery();
    await f.service.restoreRecovery(recovery.point.id, recovery.expected);
    expect(f.store.data.checklists).toEqual([]);
    expect(f.store.data.checklistTombstones[0].id).toBe(id);
  });
  it.each([6, 7])(
    'czyta poprzednią pełną kopię ZIP v%s z fotografiami',
    async (version) => {
      const f = await photoFixture(),
        files = unzipSync(
          new Uint8Array(await (await f.service.exportFull()).arrayBuffer()),
        );
      files['data.json'] = strToU8(
        JSON.stringify({ version, data: legacy(f.store.data, version) }),
      );
      const manifest = JSON.parse(strFromU8(files['manifest.json']));
      manifest.dataSha256 = await sha256(
        new Blob([files['data.json'].slice().buffer]),
      );
      files['manifest.json'] = strToU8(JSON.stringify(manifest));
      const result = await readFullBackup(
        new Blob([zipSync(files).slice().buffer]),
      );
      expect(result.data.workTemplates).toHaveLength(4);
      expect(result.data.checklists).toEqual([]);
      expect(result.assets).toHaveLength(1);
      expect(result.data.jobs).toEqual(f.store.data.jobs);
    },
  );
  it('zachowany punkt odzyskiwania v7 pozostaje deterministyczny i możliwy do odtworzenia', async () => {
    const f = await photoFixture();
    await f.assets.stageRestore([], {
      id: 'old-v7',
      data: legacy(f.store.data),
      createdAt: 1000,
      stagedAssetIds: [],
    });
    await f.assets.finishRestore();
    expect((await f.service.recovery())?.data).toEqual(
      (await f.service.recovery())?.data,
    );
    expect(
      (await readFullBackup(await f.service.exportRecovery())).data
        .workTemplates,
    ).toHaveLength(4);
    const p = await f.service.prepareRecovery();
    await f.service.restoreRecovery(p.point.id, p.expected);
    expect(f.store.data.checklists).toEqual([]);
    expect(f.store.data.photos).toHaveLength(1);
  });
  it('migruje v7 z dokładną kopią źródła i bez zmiany dotychczasowych danych', () => {
    const f = fixture(),
      old = legacy(f.store.data),
      raw = JSON.stringify({ version: 7, data: old });
    f.storage.setItem(STORAGE_KEY, raw);
    const next = f.repo.load();
    expect(f.storage.getItem(V7_BACKUP_KEY)).toBe(raw);
    expect(next).toMatchObject(old);
    expect(next.workTemplates).toHaveLength(4);
    expect(next.checklists).toEqual([]);
    expect(JSON.parse(f.storage.getItem(STORAGE_KEY)!).version).toBe(
      STORAGE_VERSION,
    );
  });
  it.each([1, 2, 3, 4, 5, 6])(
    'migruje starszy format v%s dodając nowe kolekcje',
    (version) => {
      const f = fixture(),
        old = legacy(f.store.data, 6);
      f.storage.setItem(STORAGE_KEY, JSON.stringify({ version, data: old }));
      const next = f.repo.load();
      expect(next.workTemplates).toHaveLength(4);
      expect(next.checklists).toEqual([]);
      expect(next.clients).toEqual(old.clients);
      validateData(next);
    },
  );
  it('nie odtwarza usuniętych przykładów przy ponownym uruchomieniu', () => {
    const f = fixture();
    for (const t of [...f.store.data.workTemplates])
      f.store.deleteWorkTemplate(t.id, t.revision);
    expect(f.repo.load().workTemplates).toEqual([]);
  });
  it('brak miejsca na kopię migracji pozostawia oryginał', () => {
    const f = fixture(),
      raw = JSON.stringify({ version: 7, data: legacy(f.store.data) });
    f.storage.setItem(STORAGE_KEY, raw);
    f.storage.failKey = V7_BACKUP_KEY;
    expect(() => f.repo.load()).toThrow('kopii');
    expect(f.storage.getItem(STORAGE_KEY)).toBe(raw);
  });
  it('wadliwa obecna kolekcja i brak wymaganych danych v8 nie są zastępowane pustymi listami', () => {
    const f = fixture();
    for (const [version, data] of [
      [7, { ...legacy(f.store.data), checklists: null }],
      [8, legacy(f.store.data)],
    ] as const) {
      const raw = JSON.stringify({ version, data });
      f.storage.setItem(STORAGE_KEY, raw);
      expect(() => f.repo.load()).toThrow();
      expect(f.storage.getItem(STORAGE_KEY)).toBe(raw);
    }
  });
  it('JSON zawiera szablony, statusy, daty i znaczniki usunięcia', () => {
    const f = fixture(),
      id = f.store.applyWorkTemplate('starter-lawn-v1', visit);
    f.store.editChecklistItem(id, 1, f.store.data.checklists[0].items[0].id, {
      status: 'done',
    });
    const t = f.store.data.workTemplates[1];
    f.store.deleteWorkTemplate(t.id, t.revision);
    const json = JSON.parse(f.storage.getItem(STORAGE_KEY)!);
    expect(json.data).toEqual(f.store.data);
    expect(json.data.checklists[0].items[0].completedAt).toBe(1000);
  });
  it('odrzuca duplikaty przypisań i nieprawidłowe daty wykonania', () => {
    const f = fixture();
    f.store.applyWorkTemplate('starter-lawn-v1', visit);
    const c = f.store.data.checklists[0];
    expect(() =>
      validateData({
        ...f.store.data,
        checklists: [c, { ...c, id: 'another' }],
      }),
    ).toThrow();
    expect(() =>
      validateData({
        ...f.store.data,
        checklists: [
          {
            ...c,
            items: [{ ...c.items[0], status: 'done', completedAt: null }],
          },
        ],
      }),
    ).toThrow();
  });
});
