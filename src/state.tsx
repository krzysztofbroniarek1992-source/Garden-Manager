import { PhotoProvider } from "./photos/state";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Data } from "./domain";
import { LocalRepository, STORAGE_KEY } from "./data/repository";
import { AtomicRepository, atomicStore, type AsyncStore } from "./data/atomic";
import { GardenStore } from "./data/store";

type GardenContextValue = AsyncStore & { error: string | null };
const GardenContext = createContext<GardenContextValue | null>(null);
const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : "Wystąpił błąd zapisu danych.";

export function GardenProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<AsyncStore | null>(null);
  const [data, setData] = useState<Data>();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    let active: ReturnType<typeof atomicStore> | undefined;
    const repository = new AtomicRepository({
      getItem: (key) => window.localStorage.getItem(key),
      setItem: (key, value) => window.localStorage.setItem(key, value),
    });
    repository
      .initialize()
      .then((initial) => {
        if (cancelled) {
          void repository.close();
          return;
        }
        active = atomicStore(repository, initial, setData, (text) =>
          setError(text || null),
        );
        setData(initial.data);
        setStore(active);
        setError(repository.warning || null);
      })
      .catch((e) => {
        if (cancelled) return;
        // Read-only recovery view: migration/seed writes remain in memory on failure.
        const memory = new Map<string, string>();
        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          if (raw) memory.set(STORAGE_KEY, raw);
        } catch {
          /* error shown below */
        }
        try {
          setData(
            new LocalRepository({
              getItem: (k) => memory.get(k) ?? null,
              setItem: (k, v) => {
                memory.set(k, v);
              },
            }).load(),
          );
        } catch {
          /* Corrupt data are never replaced with a demo snapshot on disk. */
        }
        setError(messageOf(e));
      });
    return () => {
      cancelled = true;
      active?.dispose();
      void repository.close();
    };
  }, []);
  useEffect(() => {
    const refresh = () => {
      if (store) void store.refresh().catch((e) => setError(messageOf(e)));
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [store]);
  if (!data)
    return (
      <main>
        <p role={error ? "alert" : "status"}>
          {error || "Wczytywanie danych…"}
        </p>
      </main>
    );
  const names = Object.keys(
    new GardenStore({ load: () => data, save: () => {} }),
  ).filter((k) => !["data", "repository", "clock"].includes(k));
  const api = Object.fromEntries(
    names.map((name) => [
      name,
      async (...args: unknown[]) => {
        try {
          if (!store)
            throw new Error(
              error ||
                "Bezpieczny zapis IndexedDB jest niedostępny. Zapis zablokowano.",
            );
          return await (
            store[name as keyof AsyncStore] as (
              ...args: unknown[]
            ) => Promise<unknown>
          )(...args);
        } catch (e) {
          setError(messageOf(e));
          throw e;
        }
      },
    ]),
  );
  return (
    <GardenContext.Provider
      value={{ ...api, data, error } as GardenContextValue}
    >
      <PhotoProvider store={store} metadata={data.photos} onChange={setData}>
        {children}
      </PhotoProvider>
    </GardenContext.Provider>
  );
}
export function useGarden(): GardenContextValue {
  const context = useContext(GardenContext);
  if (!context) throw new Error("Brak GardenProvider.");
  return context;
}
export function useNow(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const update = () => setNow(Date.now());
    const timer = window.setInterval(update, 1000);
    window.addEventListener("focus", update);
    window.addEventListener("pageshow", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", update);
      window.removeEventListener("pageshow", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  return now;
}
