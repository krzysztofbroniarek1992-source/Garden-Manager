import * as checklists from '../checklists/commands';
import type { Checklist, ChecklistItem, ChecklistTarget, WorkTemplate } from '../checklists/model';
import * as desk from '../desk/commands';
import type { Note, Todo, ReminderStatus } from '../desk/model';
import { resolvePhotoScope, type PhotoDetails, type PhotoMetadata } from '../photos/model';
import * as planning from '../planning/commands';
import type { OccurrenceVersion, TaskSchedule } from '../planning/model';
import { calculatedLaborCents, finishWork, jobTotalCents, materialsTotalCents, paidCents, pauseActiveTimer, resumeActiveTimer, roundLaborTo50Cents, startWork, stopActiveTimer, sumCents, type Client, type Data, type Garden, type Job, type Payment, type SettlementApprovalSource } from '../domain';
import { validDate, type DataRepository } from './repository';
import type { CatalogMaterial, GardenZone, Material } from '../domain';

function upsert<T extends { id: string }>(items: T[], item: T): T[] {
  return items.some(existing => existing.id === item.id) ? items.map(existing => existing.id === item.id ? item : existing) : [...items, item];
}

function samePayment(left: Payment, right: Payment): boolean {
  return left.id === right.id && left.jobId === right.jobId && left.amountCents === right.amountCents
    && left.receivedDate === right.receivedDate && left.method === right.method && left.note === right.note;
}

function samePricingJob(left: Job, right: Job): boolean {
  const terms = (job: Job) => [job.id, job.gardenId, job.status, job.billing, job.rate, job.fixedPrice, job.seconds,
    job.materials.map(item => [item.id, item.name, item.quantity, item.unitPrice]), job.settlement];
  return JSON.stringify(terms(left)) === JSON.stringify(terms(right));
}

const paymentConflict = () => new Error('Płatność została zmieniona lub usunięta w innej karcie. Zamknij i otwórz ponownie szczegóły zlecenia, aby wczytać aktualne dane.');

/** Application commands live outside React and can be tested with any repository. */
export class GardenStore {
  data: Data;
  constructor(private readonly repository: DataRepository, private readonly clock = Date.now) {
    this.data = repository.load();
  }

  refresh() { this.data = this.repository.load(); }

  private commit(transform: (data: Data) => Data) {
    // Read latest snapshot for changes made by another tab before this command.
    const next = checklists.reconcileChecklistLinks(desk.reconcileDeskLinks(transform(this.repository.load()), this.clock()), this.clock());
    this.repository.save(next);
    this.data = next;
  }

  saveClient = (client: Client) => this.commit(data => ({ ...data, clients: upsert(data.clients, { ...client, name: client.name.trim() }) }));

  deleteClient = (id: string) => this.commit(data => {
    if (data.gardens.some(garden => garden.clientId === id)) throw new Error('Klient ma przypisane ogrody. Najpierw usuń lub przenieś jego ogrody.');
    if (data.taskSchedules.some(item => item.clientId === id) || data.taskOccurrences.some(item => item.clientId === id)) throw new Error('Klient ma zaplanowane zadania. Zachowaj go, aby nie utracić ich historii.');
    return { ...data, clients: data.clients.filter(client => client.id !== id), photos: data.photos.map(p => p.clientId === id ? { ...p, clientId: null, gardenId: null, zoneId: null, jobId: null, deletedAt: this.clock(), updatedAt: this.clock(), revision: p.revision + 1 } : p) };
  });

  saveGarden = (garden: Garden) => this.commit(data => {
    const existing = data.gardens.find(item => item.id === garden.id);
    if (existing && existing.clientId !== garden.clientId && data.jobs.some(job => job.gardenId === garden.id && data.payments.some(payment => payment.jobId === job.id))) {
      throw new Error('Ogród ma zlecenia z płatnościami. Nie można zmienić ich właściciela.');
    }
    if (existing && existing.clientId !== garden.clientId && (data.taskSchedules.some(item => item.gardenId === garden.id) || data.taskOccurrences.some(item => item.gardenId === garden.id))) throw new Error('Ogród ma harmonogramy zadań. Nie można zmienić ich właściciela.');
    return { ...data, gardens: upsert(data.gardens, { ...garden, name: garden.name.trim(), zones: existing?.zones ?? garden.zones }), photos: data.photos.map(p => p.deletedAt === null && p.gardenId === garden.id && p.clientId !== garden.clientId ? { ...p, clientId: garden.clientId, clientName: data.clients.find(c => c.id === garden.clientId)?.name.slice(0,300) ?? '', updatedAt: this.clock(), revision: p.revision + 1 } : p) };
  });

  saveZone = (gardenId: string, zone: GardenZone) => this.commit(data => {
    const garden = data.gardens.find(item => item.id === gardenId);
    if (!garden) throw new Error('Nie znaleziono ogrodu.');
    return { ...data, gardens: upsert(data.gardens, { ...garden, zones: upsert(garden.zones, { ...zone, name: zone.name.trim() }) }) };
  });

  deleteZone = (gardenId: string, zoneId: string) => this.commit(data => ({ ...data,
    gardens: data.gardens.map(garden => garden.id === gardenId ? { ...garden, zones: garden.zones.filter(zone => zone.id !== zoneId) } : garden),
    photos: data.photos.map(p => p.gardenId === gardenId && p.zoneId === zoneId ? { ...p, zoneId: null, updatedAt: this.clock(), revision: p.revision + 1 } : p),
  }));

  saveCatalogMaterial = (item: CatalogMaterial) => this.commit(data => ({ ...data,
    materialCatalog: upsert(data.materialCatalog, { ...item, name: item.name.trim(), category: item.category.trim() }),
  }));

  /** Append to the latest job; never replace visit, settlement or payment data. */
  addJobMaterial = (jobId: string, gardenId: string, material: Material) => this.commit(data => {
    const job = data.jobs.find(item => item.id === jobId);
    if (!job || job.gardenId !== gardenId) throw new Error('Zlecenie nie należy już do wybranego ogrodu. Wybierz je ponownie.');
    if (job.materials.some(item => item.id === material.id)) throw new Error('Ten wynik jest już zapisany w zleceniu.');
    return { ...data, jobs: upsert(data.jobs, { ...job, materials: [...job.materials, material] }) };
  });

  deleteGarden = (id: string) => this.commit(data => {
    if (data.jobs.some(job => job.gardenId === id)) throw new Error('Ogród ma przypisane zlecenia. Najpierw usuń lub przenieś jego zlecenia.');
    if (data.taskSchedules.some(item => item.gardenId === id) || data.taskOccurrences.some(item => item.gardenId === id)) throw new Error('Ogród ma harmonogramy zadań. Zachowaj go, aby nie utracić ich historii.');
    return { ...data, gardens: data.gardens.filter(garden => garden.id !== id), photos: data.photos.map(p => p.gardenId === id ? { ...p, gardenId: null, zoneId: null, jobId: null, updatedAt: this.clock(), revision: p.revision + 1 } : p) };
  });

  saveJob = (job: Job) => this.commit(data => {
    let next = data;
    const existing = data.jobs.find(item => item.id === job.id);
    if (existing?.settlement && job.status !== 'completed') throw new Error('Zlecenie ma zatwierdzoną cenę i musi pozostać zakończone.');
    let updated = { ...job, seconds: existing?.seconds ?? job.seconds, title: job.title.trim(), activities: job.activities.map(activity => activity.trim()).filter(Boolean), settlement: existing?.settlement ?? null };
    if (data.timer?.jobId === job.id) {
      if (job.status === 'completed') {
        next = stopActiveTimer(data, this.clock());
        updated = { ...updated, seconds: next.jobs.find(item => item.id === job.id)!.seconds };
      } else {
        // An active timer owns its timing fields until it is stopped.
        updated = { ...updated, status: 'in-progress', seconds: data.jobs.find(item => item.id === job.id)!.seconds };
      }
    }
    const received = paidCents(job.id, data.payments);
    if (received > 0 && existing && existing.gardenId !== job.gardenId) {
      throw new Error('Zlecenie ma płatności. Nie można przenieść go do innego ogrodu.');
    }
    if (received > jobTotalCents(updated, this.clock(), next.timer)) {
      throw new Error('Wartość zlecenia nie może być niższa od otrzymanych płatności. Najpierw skoryguj błędną płatność.');
    }
    return { ...next, jobs: upsert(next.jobs, updated), photos: next.photos.map(p => p.deletedAt === null && p.jobId === job.id && p.gardenId !== job.gardenId ? { ...p, ...resolvePhotoScope(next, { clientId: null, gardenId: job.gardenId, zoneId: null, jobId: null }), jobId: job.id, jobTitle: job.title, updatedAt: this.clock(), revision: p.revision + 1 } : p) };
  });

  deleteJob = (id: string) => this.commit(data => {
    if (data.timer?.jobId === id) throw new Error('Najpierw zatrzymaj stoper tego zlecenia.');
    if (data.payments.some(payment => payment.jobId === id)) throw new Error('Zlecenie ma płatności. Najpierw usuń błędne wpisy płatności.');
    if (data.taskOccurrences.some(item => item.jobId === id)) throw new Error('Zlecenie jest historią zadania z kalendarza. Zachowaj je, aby nie utworzyć powtórnej wizyty.');
    return { ...data, jobs: data.jobs.filter(job => job.id !== id), photos: data.photos.map(p => p.jobId === id ? { ...p, jobId: null, updatedAt: this.clock(), revision: p.revision + 1 } : p) };
  });

  savePayment = (payment: Payment, expected?: Payment | null) => this.commit(data => {
    const current = data.payments.find(item => item.id === payment.id);
    if ((expected === null && current) || (expected !== undefined && expected !== null && (!current || !samePayment(current, expected)))) {
      throw paymentConflict();
    }
    const job = data.jobs.find(item => item.id === payment.jobId);
    if (!job) throw new Error('Nie znaleziono zlecenia dla płatności.');
    if (!current && job.status === 'completed' && !job.settlement) throw new Error('Najpierw zatwierdź cenę zakończonego zlecenia, aby dodać płatność.');
    if (!Number.isSafeInteger(payment.amountCents) || payment.amountCents <= 0) throw new Error('Kwota płatności musi być dodatnia i podana w pełnych groszach.');
    if (!validDate(payment.receivedDate)) throw new Error('Podaj poprawną datę otrzymania płatności.');
    if (!['cash', 'transfer', 'blik', 'other'].includes(payment.method)) throw new Error('Wybierz poprawną metodę płatności.');
    const existing = data.payments.find(item => item.id === payment.id);
    if (existing && existing.jobId !== payment.jobId) throw new Error('Usuń błędną płatność i dodaj ją przy właściwym zleceniu.');
    const others = data.payments.filter(item => item.id !== payment.id);
    const available = jobTotalCents(job, this.clock(), data.timer) - paidCents(job.id, others);
    if (payment.amountCents > available) throw new Error('Kwota płatności przekracza należność za zlecenie.');
    return { ...data, payments: upsert(data.payments, { ...payment, note: payment.note.trim() }) };
  });

  deletePayment = (id: string, expected?: Payment) => this.commit(data => {
    const current = data.payments.find(payment => payment.id === id);
    if (expected && (!current || !samePayment(current, expected))) throw paymentConflict();
    if (!current) throw new Error('Nie znaleziono płatności.');
    return { ...data, payments: data.payments.filter(payment => payment.id !== id) };
  });

  correctJobTime = (jobId: string, seconds: number, expectedSeconds?: number) => this.commit(data => {
    const job = data.jobs.find(item => item.id === jobId);
    if (!job) throw new Error('Nie znaleziono zlecenia.');
    if (data.timer?.jobId === jobId) throw new Error('Najpierw zakończ pomiar wizyty, aby poprawić czas.');
    if (!Number.isSafeInteger(seconds) || seconds < 0) throw new Error('Podaj nieujemny czas w pełnych sekundach.');
    if (expectedSeconds !== undefined && job.seconds !== expectedSeconds) throw new Error('Czas został zmieniony w innej karcie. Otwórz formularz ponownie.');
    const updated = { ...job, seconds };
    if (paidCents(jobId, data.payments) > jobTotalCents(updated)) throw new Error('Czas po korekcie obniżyłby należność poniżej otrzymanych wpłat.');
    return { ...data, jobs: data.jobs.map(item => item.id === jobId ? updated : item) };
  });

  approveSettlement = (jobId: string, finalLaborCents: number, source: SettlementApprovalSource, expectedJob?: Job) => this.commit(data => {
    const job = data.jobs.find(item => item.id === jobId);
    if (!job) throw new Error('Nie znaleziono zlecenia.');
    if (job.status !== 'completed' || data.timer?.jobId === jobId) throw new Error('Najpierw zakończ pracę i pomiar czasu, aby zatwierdzić cenę.');
    if (expectedJob && !samePricingJob(job, expectedJob)) throw new Error('Dane rozliczenia zmieniły się w innej karcie. Otwórz formularz ponownie.');
    if (!Number.isSafeInteger(finalLaborCents) || finalLaborCents < 0) throw new Error('Podaj nieujemną cenę robocizny w pełnych groszach.');
    const calculated = calculatedLaborCents(job);
    const suggested = job.billing === 'hourly' ? roundLaborTo50Cents(calculated) : null;
    if (!['rounded', 'manual', 'fixed', 'exact'].includes(source)
      || source === 'rounded' && (suggested === null || finalLaborCents !== suggested)
      || source === 'fixed' && (job.billing !== 'fixed' || finalLaborCents !== calculated)
      || source === 'exact' && finalLaborCents !== calculated) {
      throw new Error('Wybierz poprawny sposób zatwierdzenia ceny.');
    }
    const materials = materialsTotalCents(job);
    if (sumCents([finalLaborCents, materials]) < paidCents(jobId, data.payments)) {
      throw new Error('Zatwierdzona należność nie może być niższa od otrzymanych wpłat. Najpierw skoryguj błędną płatność.');
    }
    const settlement = { calculatedLaborCents: calculated, suggestedLaborCents: suggested, materialsCents: materials, finalLaborCents, approvedAt: this.clock(), source };
    return { ...data, jobs: data.jobs.map(item => item.id === jobId ? { ...item, settlement } : item) };
  });

  snapshot = (): Data => { this.refresh(); return this.data; };
  appendPhotos = (photos: PhotoMetadata[]) => this.commit(data => {
    if (photos.some(p => data.photos.some(old => old.id === p.id || old.assetId === p.assetId))) throw new Error('Zdjęcie zostało już zapisane.');
    return { ...data, photos: [...data.photos, ...photos] };
  });
  editPhoto = (id: string, details: PhotoDetails, revision: number) => this.commit(data => {
    const current = data.photos.find(p => p.id === id);
    if (!current || current.deletedAt !== null || current.revision !== revision) throw new Error('Zdjęcie zmieniło się w innej karcie. Otwórz je ponownie.');
    const sameScope = (['clientId', 'gardenId', 'zoneId', 'jobId'] as const).every(key => current[key] === details[key]);
    const scope = resolvePhotoScope(data, details);
    return { ...data, photos: data.photos.map(p => p.id !== id ? p : { ...p, ...scope,
      ...(sameScope ? { clientName: p.clientName, gardenName: p.gardenName, zoneName: p.zoneName, jobTitle: p.jobTitle } : {}),
      category: details.category, description: details.description, capturedDate: details.capturedDate, updatedAt: this.clock(), revision: p.revision + 1 }) };
  });
  markPhotoDeleted = (id: string, revision: number) => this.commit(data => {
    const current = data.photos.find(p => p.id === id);
    if (!current || current.revision !== revision) throw new Error('Zdjęcie zmieniło się w innej karcie. Otwórz je ponownie.');
    return { ...data, photos: data.photos.map(p => p.id !== id ? p : { ...p, deletedAt: this.clock(), updatedAt: this.clock(), revision: p.revision + 1 }) };
  });
  finalizePhotoDeletion = (ids: string[]) => this.commit(data => ({ ...data, photos: data.photos.filter(p => p.deletedAt === null || !ids.includes(p.id)) }));
  restoreSnapshot = (replacement: Data, expected: string) => this.commit(data => {
    if (JSON.stringify(data) !== expected) throw new Error('Dane zmieniły się od sprawdzenia kopii. Wczytaj kopię ponownie przed potwierdzeniem.');
    if (data.timer) throw new Error('Przed odtwarzaniem zakończ pomiar wizyty przyciskiem STOP.');
    return replacement;
  });

  saveWorkTemplate = (draft: WorkTemplate) => this.commit(data => checklists.saveWorkTemplate(data, draft, this.clock()));
  copyWorkTemplate = (id: string, revision: number): string => { let result = ''; this.commit(data => { const next = checklists.copyWorkTemplate(data,id,revision,this.clock()); result=next.id;return next.data; });return result; };
  archiveWorkTemplate = (id: string, revision: number, archived: boolean) => this.commit(data => checklists.archiveWorkTemplate(data,id,revision,archived,this.clock()));
  deleteWorkTemplate = (id: string, revision: number) => this.commit(data => checklists.deleteWorkTemplate(data,id,revision,this.clock()));
  createBlankChecklist = (target: ChecklistTarget, name: string): string => { let result='';this.commit(data=>{const next=checklists.createBlankChecklist(data,target,name,this.clock());result=next.id;return next.data;});return result; };
  applyWorkTemplate = (id: string, target: ChecklistTarget): string => { let result='';this.commit(data=>{const next=checklists.applyWorkTemplate(data,id,target,this.clock());result=next.id;return next.data;});return result; };
  applyGardenPlan = (planId: string, jobId: string): string => { let result='';this.commit(data=>{const next=checklists.applyGardenPlan(data,planId,jobId,this.clock());result=next.id;return next.data;});return result; };
  editChecklist = (id: string, revision: number, patch: Partial<Pick<Checklist,'name'|'description'|'category'>>) => this.commit(data=>checklists.editChecklist(data,id,revision,patch,this.clock()));
  addChecklistItem = (id: string, revision: number, title: string) => this.commit(data=>checklists.addChecklistItem(data,id,revision,title,this.clock()));
  editChecklistItem = (id: string, revision: number, itemId: string, patch: Partial<Pick<ChecklistItem,'title'|'note'|'status'|'photoId'>>) => this.commit(data=>checklists.editChecklistItem(data,id,revision,itemId,patch,this.clock()));
  moveChecklistItem = (id: string, revision: number, itemId: string, direction: -1|1) => this.commit(data=>checklists.moveChecklistItem(data,id,revision,itemId,direction,this.clock()));
  removeChecklistItem = (id: string, revision: number, itemId: string) => this.commit(data=>checklists.removeChecklistItem(data,id,revision,itemId,this.clock()));
  deleteChecklist = (id: string, revision: number) => this.commit(data=>checklists.deleteChecklist(data,id,revision,this.clock()));

  saveNote = (note: Note) => this.commit(data => desk.saveNote(data, note, this.clock()));
  archiveNote = (id: string, revision: number, archived: boolean) => this.commit(data => desk.archiveNote(data, id, revision, archived, this.clock()));
  changeReminder = (id: string, revision: number, status: ReminderStatus, date?: string, time?: string | null) => this.commit(data => desk.changeReminder(data, id, revision, status, this.clock(), date, time));
  saveTodo = (todo: Todo) => this.commit(data => desk.saveTodo(data, todo, this.clock()));
  changeTodoStatus = (id: string, revision: number, status: Todo['status']) => this.commit(data => desk.changeTodoStatus(data, id, revision, status, this.clock()));
  deleteDeskRecord = (kind: 'note' | 'todo', id: string, revision: number) => this.commit(data => desk.deleteDeskRecord(data, kind, id, revision, this.clock()));

  saveTaskSchedule = (schedule: TaskSchedule) => this.commit(data => planning.saveTaskSchedule(data, schedule, this.clock()));
  moveTaskOccurrence = (id: string, date: string, target: string, time: string, expected?: OccurrenceVersion) => this.commit(data => planning.moveTaskOccurrence(data, id, date, target, time, this.clock(), expected));
  skipTaskOccurrence = (id: string, date: string, expected?: OccurrenceVersion) => this.commit(data => planning.skipTaskOccurrence(data, id, date, this.clock(), expected));
  endTaskSchedule = (id: string, date: string, revision?: number) => this.commit(data => planning.endTaskSchedule(data, id, date, this.clock(), revision));
  beginTaskOccurrence = (id: string, date: string, gardenId?: string, expected?: OccurrenceVersion, applyChecklist = false): string => {
    let jobId = '';
    this.commit(data => { const result = planning.beginTaskOccurrence(data, id, date, this.clock(), gardenId, expected); jobId = result.jobId;
      const templateId = result.data.taskSchedules.find(s=>s.id===id)?.checklistTemplateId;
      const zoneId = result.data.taskOccurrences.find(o=>o.jobId===jobId)?.zoneId ?? null;
      const garden = result.data.gardens.find(g=>g.id===result.data.jobs.find(j=>j.id===jobId)?.gardenId);
      return applyChecklist && templateId ? checklists.applyWorkTemplate(result.data,templateId,{kind: 'visit',jobId,zoneId:garden?.zones.some(z=>z.id===zoneId)?zoneId:null},this.clock()).data : result.data; });
    return jobId;
  };

  startTimer = (jobId: string) => this.commit(data => startWork(data, jobId, this.clock()));
  pauseTimer = () => this.commit(data => pauseActiveTimer(data, this.clock()));
  resumeTimer = () => this.commit(data => resumeActiveTimer(data, this.clock()));
  stopTimer = () => this.commit(data => stopActiveTimer(data, this.clock()));
  completeJob = (jobId: string) => this.commit(data => finishWork(data, jobId, this.clock()));
  setRate = (rate: number) => this.commit(data => ({ ...data, settings: { ...data.settings, hourlyRate: rate } }));
}
