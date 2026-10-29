import { jobTotalCents, paidCents, type Data } from '../domain';
import { createDemoData } from './demo';

// Preserve the original key so existing browser data are found after updating.
export const STORAGE_KEY = 'garden-manager:v1';
export const STORAGE_VERSION = 2;
export const LEGACY_BACKUP_KEY = 'garden-manager:backup:v1';

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
function validateLegacyData(value: unknown): asserts value is Omit<Data, 'payments'> {
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

export function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** A snapshot is accepted only when payment references and balances are sound. */
export function validateData(value: unknown): asserts value is Data {
  validateLegacyData(value);
  const data = value as Data;
  if (!Array.isArray(data.payments) || !data.payments.every(payment => record(payment)
    && strings(payment, ['id', 'jobId', 'receivedDate', 'method', 'note'])
    && Number.isSafeInteger(payment.amountCents) && payment.amountCents > 0
    && validDate(payment.receivedDate) && ['cash', 'transfer', 'blik', 'other'].includes(payment.method)
    && data.jobs.some(job => job.id === payment.jobId)) || !unique(data.payments)) {
    throw new Error('Nieprawidłowy rejestr płatności. Oryginalny zapis nie został zmieniony.');
  }
  for (const job of data.jobs) {
    if (paidCents(job.id, data.payments) > jobTotalCents(job, Date.now(), data.timer)) {
      throw new Error('Suma płatności przekracza wartość zlecenia. Oryginalny zapis nie został zmieniony.');
    }
  }
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
    if (!record(parsed) || (parsed.version !== 1 && parsed.version !== STORAGE_VERSION)) throw new Error('Nieobsługiwana wersja danych lokalnych. Oryginalny zapis nie został zmieniony.');
    if (parsed.version === 1) {
      validateLegacyData(parsed.data);
      // Never infer historical payments. The v1 source is backed up byte-for-byte.
      const migrated: Data = { ...parsed.data, payments: [] };
      validateData(migrated);
      try {
        if (this.storage.getItem(LEGACY_BACKUP_KEY) === null) this.storage.setItem(LEGACY_BACKUP_KEY, raw);
      } catch { throw new Error('Nie udało się utworzyć kopii danych przed aktualizacją. Oryginalny zapis nie został zmieniony.'); }
      this.save(migrated);
      return migrated;
    }
    validateData(parsed.data);
    return parsed.data;
  }

  save(data: Data): void {
    validateData(data);
    try { this.storage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, data })); }
    catch { throw new Error('Nie udało się zapisać zmian. Pamięć przeglądarki jest niedostępna lub pełna. Zmiany nie zostały przyjęte.'); }
  }
}
