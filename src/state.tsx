import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Client, Data, Garden, Job, Payment, SettlementApprovalSource } from './domain';
import { createDemoData } from './data/demo';
import { LocalRepository, STORAGE_KEY } from './data/repository';
import { GardenStore } from './data/store';

interface GardenContextValue {
  data: Data;
  error: string | null;
  saveClient(client: Client): void;
  deleteClient(id: string): void;
  saveGarden(garden: Garden): void;
  deleteGarden(id: string): void;
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
  const run = useCallback((command: (store: GardenStore) => void) => {
    try {
      if (!initial.store) throw new Error(initial.error ?? 'Zapis lokalny jest niedostępny.');
      command(initial.store);
      setData(initial.store.data);
      setError(null);
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
    saveClient: client => run(store => store.saveClient(client)),
    deleteClient: id => run(store => store.deleteClient(id)),
    saveGarden: garden => run(store => store.saveGarden(garden)),
    deleteGarden: id => run(store => store.deleteGarden(id)),
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
  }}>{children}</GardenContext.Provider>;
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
