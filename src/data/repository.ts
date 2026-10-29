import type { Data } from '../domain';
import { createDemoData } from './demo';

export const STORAGE_KEY = 'garden-manager:v1';

/** Local persistence boundary. Future cloud synchronization can exchange this
 * versioned snapshot through a separate authenticated synchronization service. */
export interface DataRepository {
  load(): Data;
  save(data: Data): void;
}

export interface StoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const strings = (value: Record<string, unknown>, keys: string[]) => keys.every(key => typeof value[key] === 'string');
const positive = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const unique = (items: { id: string }[]) => new Set(items.map(item => item.id)).size === items.length && items.every(item => item.id.trim());

/** Validate persisted and imported data rather than trusting JSON casts. */
export function validateData(value: unknown): asserts value is Data {
  const fail = () => { throw new Error('Dane lokalne są nieprawidłowe. Zachowano oryginalny zapis; odzyskaj kopię danych przed wyczyszczeniem pamięci przeglądarki.'); };
  if (!record(value) || !Array.isArray(value.clients) || !Array.isArray(value.gardens) || !Array.isArray(value.jobs) || !record(value.settings) || !positive(value.settings.hourlyRate)) fail();
  const data = value as unknown as Data;
  if (!data.clients.every(item => record(item) && strings(item, ['id', 'name', 'phone', 'email', 'notes']) && item.name.trim()) || !unique(data.clients)) fail();
  if (!data.gardens.every(item => record(item) && strings(item, ['id', 'clientId', 'name', 'address', 'notes']) && item.name.trim() && positive(item.area) && data.clients.some(client => client.id === item.clientId)) || !unique(data.gardens)) fail();
  if (!data.jobs.every(item => record(item) && strings(item, ['id', 'gardenId', 'title', 'date', 'time', 'status', 'billing', 'notes']) && item.title.trim()
    && /^\d{4}-\d{2}-\d{2}$/.test(item.date) && !Number.isNaN(Date.parse(`${item.date}T12:00:00`))
    && /^([01]\d|2[0-3]):[0-5]\d$/.test(item.time)
    && ['planned', 'in-progress', 'completed'].includes(item.status) && ['hourly', 'fixed'].includes(item.billing)
    && [item.rate, item.fixedPrice, item.seconds].every(positive)
    && data.gardens.some(garden => garden.id === item.gardenId)
    && Array.isArray(item.materials) && item.materials.every(material => record(material) && strings(material, ['id', 'name']) && material.name.trim() && positive(material.quantity) && positive(material.unitPrice))
    && unique(item.materials)) || !unique(data.jobs)) fail();
  if (data.timer !== null && (!record(data.timer) || !strings(data.timer, ['jobId']) || !positive(data.timer.startedAt) || !data.jobs.some(job => job.id === data.timer?.jobId && job.status === 'in-progress'))) fail();
}

export class LocalRepository implements DataRepository {
  constructor(private readonly storage: StoragePort, private readonly seed: () => Data = createDemoData) {}

  load(): Data {
    let raw: string | null;
    try { raw = this.storage.getItem(STORAGE_KEY); }
    catch { throw new Error('Przeglądarka blokuje odczyt danych lokalnych. Zezwól na pamięć witryny, aby korzystać z aplikacji.'); }
    if (raw === null) {
      const data = this.seed();
      this.save(data);
      return data;
    }
    let parsed: unknown;
    try { parsed = JSON.parse(raw); }
    catch { throw new Error('Nie można odczytać danych lokalnych. Oryginalny zapis nie został zmieniony.'); }
    if (!record(parsed) || parsed.version !== 1) throw new Error('Nieobsługiwana wersja danych lokalnych. Oryginalny zapis nie został zmieniony.');
    validateData(parsed.data);
    return parsed.data;
  }

  save(data: Data): void {
    validateData(data);
    try { this.storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, data })); }
    catch { throw new Error('Nie udało się zapisać zmian. Pamięć przeglądarki jest niedostępna lub pełna. Zmiany nie zostały przyjęte.'); }
  }
}
