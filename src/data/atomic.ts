import { pendingWrite } from "./pending";
import type { Data } from "../domain";
import {
  LocalRepository,
  STORAGE_KEY,
  STORAGE_VERSION,
  validateData,
} from "./repository";
import { GardenStore } from "./store";

export const STATE_DATABASE = "garden-manager-state";
export const STATE_STORE = "state";
interface State {
  revision: number;
  data: Data;
}
export type StorePort = {
  [K in keyof GardenStore]: GardenStore[K] extends (...args: infer A) => infer R
    ? (...args: A) => R | Promise<Awaited<R>>
    : GardenStore[K];
};
export type AsyncStore = {
  [K in keyof GardenStore]: GardenStore[K] extends (...args: infer A) => infer R
    ? (...args: A) => Promise<Awaited<R>>
    : GardenStore[K];
};
const unavailable = () =>
  new Error(
    "Bezpieczny zapis IndexedDB jest niedostępny. Zapis zablokowano; dotychczasowe dane pozostają zachowane. Zamknij inne wersje aplikacji i spróbuj ponownie.",
  );

/** One authoritative snapshot. Every application command runs synchronously inside
 * a single IndexedDB readwrite transaction, including report allocation/history
 * validation and import CAS. localStorage is an expendable v9 compatibility mirror. */
export class AtomicRepository {
  private connection?: Promise<IDBDatabase>;
  warning = "";
  constructor(
    private storage: Storage,
    private factory?: IDBFactory,
    private name = STATE_DATABASE,
  ) {}
  private open() {
    return (this.connection ??= new Promise<IDBDatabase>((resolve, reject) => {
      let request: IDBOpenDBRequest;
      try {
        request = (this.factory ?? globalThis.indexedDB).open(this.name, 1);
      } catch {
        reject(unavailable());
        return;
      }
      request.onupgradeneeded = () =>
        request.result.createObjectStore(STATE_STORE);
      request.onblocked = () => reject(unavailable());
      request.onerror = () => {
        this.connection = undefined;
        reject(unavailable());
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          this.connection = undefined;
        };
        resolve(db);
      };
    }));
  }
  private async transaction<T>(
    mode: IDBTransactionMode,
    action: (state: State, store: IDBObjectStore) => { state: State; value: T },
  ) {
    const db = await this.open();
    return new Promise<{ state: State; value: T }>((resolve, reject) => {
      const tx = db.transaction(STATE_STORE, mode, { durability: "strict" });
      const store = tx.objectStore(STATE_STORE);
      let result: { state: State; value: T }, failure: unknown;
      const get = store.get("current");
      get.onsuccess = () => {
        try {
          let state = get.result as State | undefined;
          if (!state) {
            if (mode !== "readwrite") throw unavailable();
            const original = this.storage.getItem(STORAGE_KEY);
            state = {
              revision: 0,
              data: new LocalRepository(this.storage).load(),
            };
            // Preserve the exact pre-cutover bytes in the same transaction.
            store.put(original, "migration-source");
            store.put(state, "current");
          }
          if (!Number.isSafeInteger(state.revision) || state.revision < 0)
            throw new Error(
              "Nieprawidłowy stan bezpiecznej pamięci. Oryginalne dane pozostają zachowane.",
            );
          validateData(state.data);
          result = action(state, store);
        } catch (e) {
          failure = e;
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(failure ?? unavailable());
      tx.onerror = () => {
        /* onabort reports failure; no localStorage fallback */
      };
    });
  }
  async initialize() {
    const { state } = await this.transaction("readwrite", (s) => ({
      state: s,
      value: undefined,
    }));
    await this.project();
    return this.read();
  }
  async read() {
    return (
      await this.transaction("readonly", (s) => ({
        state: s,
        value: undefined,
      }))
    ).state;
  }
  async command<T>(execute: (store: GardenStore) => T, clock = Date.now) {
    const at = clock();
    return pendingWrite(async () => {
      const result = await this.transaction(
        "readwrite",
        (state, objectStore) => {
          let data = state.data;
          const store = new GardenStore(
            {
              load: () => data,
              save: (next) => {
                data = next;
              },
            },
            () => at,
          );
          const value = execute(store);
          if (value instanceof Promise)
            throw new Error("Komenda transakcji musi być synchroniczna.");
          // Restoring an older backup must never make a previously issued
          // document number available again, regardless of the calling port.
          data = {
            ...data,
            reportSequence: Math.max(
              state.data.reportSequence,
              data.reportSequence,
            ),
          };
          validateData(data);
          const next = { revision: state.revision + 1, data };
          objectStore.put(next, "current");
          return { state: next, value };
        },
      );
      await this.project();
      return result;
    });
  }
  private async project() {
    try {
      // A separate serialized transaction after commit always projects the latest
      // snapshot, even when completion callbacks arrive in a different tab order.
      await this.transaction("readwrite", (s) => {
        this.storage.setItem(
          STORAGE_KEY,
          JSON.stringify({ version: STORAGE_VERSION, data: s.data }),
        );
        return { state: s, value: undefined };
      });
      this.warning = "";
    } catch {
      this.warning =
        "Dane zapisano w IndexedDB. Nie udało się odświeżyć kopii localStorage; wykonaj eksport JSON lub ZIP.";
    }
  }
  async close() {
    try {
      (await this.connection)?.close();
    } catch {
      /* failed open */
    }
    this.connection = undefined;
  }
}

export function atomicStore(
  repository: AtomicRepository,
  initial: State,
  changed: (data: Data) => void,
  warning: (text: string) => void,
): AsyncStore & { dispose(): void } {
  let revision = initial.revision;
  const update = (s: State) => {
    if (s.revision >= revision) {
      revision = s.revision;
      target.data = s.data;
      changed(s.data);
    }
    warning(repository.warning);
  };
  const channel =
    typeof BroadcastChannel !== "undefined"
      ? new BroadcastChannel("garden-manager-state")
      : null;
  const target = {
    data: initial.data,
    dispose() {
      channel?.close();
    },
    async snapshot() {
      const s = await repository.read();
      update(s);
      return s.data;
    },
    async refresh() {
      await target.snapshot();
    },
  };
  channel?.addEventListener("message", () => {
    void target.refresh().catch(() => {});
  });
  void target.refresh().catch(() => {});
  const names = new Set(
    Object.keys(
      new GardenStore({ load: () => initial.data, save: () => {} }),
    ).filter(
      (k) =>
        !["data", "snapshot", "refresh", "repository", "clock"].includes(k),
    ),
  );
  return new Proxy(target, {
    get(object, key: string) {
      if (!names.has(key)) return object[key as keyof typeof target];
      return async (...args: unknown[]) => {
        const result = await repository.command((store) =>
          (store[key as keyof GardenStore] as (...args: unknown[]) => unknown)(
            ...args,
          ),
        );
        update(result.state);
        channel?.postMessage(result.state.revision);
        return result.value;
      };
    },
  }) as AsyncStore & { dispose(): void };
}
