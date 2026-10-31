import type { Note, Todo, ReminderStatus } from './desk/model';
import { PhotoProvider } from './photos/state';
import type { OccurrenceVersion, TaskSchedule } from './planning/model';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { CatalogMaterial, Client, Data, Garden, GardenZone, Job, Material, Payment, SettlementApprovalSource } from './domain';
import { createDemoData } from './data/demo';
import { LocalRepository, STORAGE_KEY } from './data/repository';
import { GardenStore } from './data/store';

interface GardenContextValue {
  saveWorkTemplate: GardenStore['saveWorkTemplate'];
  copyWorkTemplate: GardenStore['copyWorkTemplate'];
  archiveWorkTemplate: GardenStore['archiveWorkTemplate'];
  deleteWorkTemplate: GardenStore['deleteWorkTemplate'];
  createBlankChecklist: GardenStore['createBlankChecklist'];
  applyWorkTemplate: GardenStore['applyWorkTemplate'];
  applyGardenPlan: GardenStore['applyGardenPlan'];
  editChecklist: GardenStore['editChecklist'];
  addChecklistItem: GardenStore['addChecklistItem'];
  editChecklistItem: GardenStore['editChecklistItem'];
  moveChecklistItem: GardenStore['moveChecklistItem'];
  removeChecklistItem: GardenStore['removeChecklistItem'];
  deleteChecklist: GardenStore['deleteChecklist'];

  data: Data;
  error: string | null;
  saveNote(note: Note): void;
  archiveNote(id: string, revision: number, archived: boolean): void;
  changeReminder(id: string, revision: number, status: ReminderStatus, date?: string, time?: string | null): void;
  saveTodo(todo: Todo): void;
  changeTodoStatus(id: string, revision: number, status: Todo['status']): void;
  deleteDeskRecord(kind: 'note' | 'todo', id: string, revision: number): void;
  saveClient(client: Client): void;
  deleteClient(id: string): void;
  saveGarden(garden: Garden): void;
  deleteGarden(id: string): void;
  saveZone(gardenId: string, zone: GardenZone): void;
  deleteZone(gardenId: string, zoneId: string): void;
  saveCatalogMaterial(material: CatalogMaterial): void;
  addJobMaterial(jobId: string, gardenId: string, material: Material): void;
  saveJob(job: Job): void;
  deleteJob(id: string): void;
  savePayment(payment: Payment, expected?: Payment | null): void;
  deletePayment(id: string, expected?: Payment): void;
  startTimer(jobId: string): void;
  pauseTimer(): void;
  resumeTimer(): void;
  stopTimer(): void;
  correctJobTime(jobId: string, seconds: number, expectedSeconds?: number): void;
  approveSettlement(jobId: string, finalLaborCents: number, source: SettlementApprovalSource, expectedJob?: Job): void;
  completeJob(jobId: string): void;
  setRate(rate: number): void;
  saveTaskSchedule(schedule: TaskSchedule): void;
  moveTaskOccurrence(id: string, date: string, target: string, time: string, expected?: OccurrenceVersion): void;
  skipTaskOccurrence(id: string, date: string, expected?: OccurrenceVersion): void;
  endTaskSchedule(id: string, date: string, revision?: number): void;
  beginTaskOccurrence(id: string, date: string, gardenId?: string, expected?: OccurrenceVersion, applyChecklist?: boolean): string;
}

const GardenContext = createContext<GardenContextValue | null>(null);
const messageOf = (error: unknown) => error instanceof Error ? error.message : 'Wystąpił błąd zapisu danych.';

export function GardenProvider({ children }: { children: ReactNode }) {
  const [initial] = useState(() => {
    try {
      const store = new GardenStore(new LocalRepository(window.localStorage));
      return { store, data: store.data, error: null as string | null };
    } catch (error) {
      return { store: null, data: createDemoData(), error: messageOf(error) };
    }
  });
  const [data, setData] = useState(initial.data);
  const [error, setError] = useState(initial.error);
  const run = useCallback(<T,>(command: (store: GardenStore) => T): T => {
    try {
      if (!initial.store) throw new Error(initial.error ?? 'Zapis lokalny jest niedostępny.');
      const result = command(initial.store);
      setData(initial.store.data);
      setError(null);
      return result;
    } catch (caught) {
      setError(messageOf(caught));
      throw caught;
    }
  }, [initial]);

  useEffect(() => {
    const listener = (event: StorageEvent) => {
      if ((event.key !== STORAGE_KEY && event.key !== null) || !initial.store) return;
      try {
        initial.store.refresh();
        setData(initial.store.data);
        setError(null);
      } catch (caught) { setError(messageOf(caught)); }
    };
    window.addEventListener('storage', listener);
    return () => window.removeEventListener('storage', listener);
  }, [initial]);

  return <GardenContext.Provider value={{
    data, error,
    saveWorkTemplate: (...args) => run(store => store.saveWorkTemplate(...args)),
    copyWorkTemplate: (...args) => run(store => store.copyWorkTemplate(...args)),
    archiveWorkTemplate: (...args) => run(store => store.archiveWorkTemplate(...args)),
    deleteWorkTemplate: (...args) => run(store => store.deleteWorkTemplate(...args)),
    createBlankChecklist: (...args) => run(store => store.createBlankChecklist(...args)),
    applyWorkTemplate: (...args) => run(store => store.applyWorkTemplate(...args)),
    applyGardenPlan: (...args) => run(store => store.applyGardenPlan(...args)),
    editChecklist: (...args) => run(store => store.editChecklist(...args)),
    addChecklistItem: (...args) => run(store => store.addChecklistItem(...args)),
    editChecklistItem: (...args) => run(store => store.editChecklistItem(...args)),
    moveChecklistItem: (...args) => run(store => store.moveChecklistItem(...args)),
    removeChecklistItem: (...args) => run(store => store.removeChecklistItem(...args)),
    deleteChecklist: (...args) => run(store => store.deleteChecklist(...args)),

    saveNote: note => run(store => store.saveNote(note)),
    archiveNote: (id, revision, archived) => run(store => store.archiveNote(id, revision, archived)),
    changeReminder: (id, revision, status, date, time) => run(store => store.changeReminder(id, revision, status, date, time)),
    saveTodo: todo => run(store => store.saveTodo(todo)),
    changeTodoStatus: (id, revision, status) => run(store => store.changeTodoStatus(id, revision, status)),
    deleteDeskRecord: (kind, id, revision) => run(store => store.deleteDeskRecord(kind, id, revision)),
    saveClient: client => run(store => store.saveClient(client)),
    deleteClient: id => run(store => store.deleteClient(id)),
    saveGarden: garden => run(store => store.saveGarden(garden)),
    deleteGarden: id => run(store => store.deleteGarden(id)),
    saveZone: (id, zone) => run(store => store.saveZone(id, zone)),
    deleteZone: (id, zoneId) => run(store => store.deleteZone(id, zoneId)),
    saveCatalogMaterial: item => run(store => store.saveCatalogMaterial(item)),
    addJobMaterial: (id, gardenId, material) => run(store => store.addJobMaterial(id, gardenId, material)),
    saveJob: job => run(store => store.saveJob(job)),
    deleteJob: id => run(store => store.deleteJob(id)),
    savePayment: (payment, expected) => run(store => store.savePayment(payment, expected)),
    deletePayment: (id, expected) => run(store => store.deletePayment(id, expected)),
    startTimer: id => run(store => store.startTimer(id)),
    pauseTimer: () => run(store => store.pauseTimer()),
    resumeTimer: () => run(store => store.resumeTimer()),
    correctJobTime: (id, seconds, expected) => run(store => store.correctJobTime(id, seconds, expected)),
    approveSettlement: (id, cents, source, expected) => run(store => store.approveSettlement(id, cents, source, expected)),
    stopTimer: () => run(store => store.stopTimer()),
    completeJob: id => run(store => store.completeJob(id)),
    setRate: rate => run(store => store.setRate(rate)),
    saveTaskSchedule: item => run(store => store.saveTaskSchedule(item)),
    moveTaskOccurrence: (id, date, target, time, expected) => run(store => store.moveTaskOccurrence(id, date, target, time, expected)),
    skipTaskOccurrence: (id, date, expected) => run(store => store.skipTaskOccurrence(id, date, expected)),
    endTaskSchedule: (id, date, revision) => run(store => store.endTaskSchedule(id, date, revision)),
    beginTaskOccurrence: (id, date, gardenId, expected, applyChecklist) => run(store => store.beginTaskOccurrence(id, date, gardenId, expected, applyChecklist)),
  }}><PhotoProvider store={initial.store} metadata={data.photos} onChange={setData}>{children}</PhotoProvider></GardenContext.Provider>;
}

export function useGarden(): GardenContextValue {
  const context = useContext(GardenContext);
  if (!context) throw new Error('Brak GardenProvider.');
  return context;
}

export function useNow(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}
