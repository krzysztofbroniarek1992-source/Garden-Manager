import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Client, Data, Garden, Job } from './domain';
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
  startTimer(jobId: string): void;
  stopTimer(): void;
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
    startTimer: id => run(store => store.startTimer(id)),
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
