import { validatePhotos } from '../photos/model';
import { validatePlanning } from '../planning/validation';
import { calculatedLaborCents, jobTotalCents, legacySettlement, materialUnits, materialsTotalCents, paidCents, roundLaborTo50Cents, sumCents, toCents, type Data, type Job, type Payment } from '../domain';
import { createDemoData } from './demo';

// Preserve the original key so existing browser data are found after updating.
export const STORAGE_KEY = 'garden-manager:v1';
export const STORAGE_VERSION = 6;
export const LEGACY_BACKUP_KEY = 'garden-manager:backup:v1';
export const V2_BACKUP_KEY = 'garden-manager:backup:v2';
export const V3_BACKUP_KEY = 'garden-manager:backup:v3';
export const V4_BACKUP_KEY = 'garden-manager:backup:v4';
export const V5_BACKUP_KEY = 'garden-manager:backup:v5';

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

function validatePayments(data: Data, legacy = false) {
  if (!Array.isArray(data.payments) || !data.payments.every(payment => record(payment)
    && strings(payment, ['id', 'jobId', 'receivedDate', 'method', 'note'])
    && Number.isSafeInteger(payment.amountCents) && payment.amountCents > 0
    && validDate(payment.receivedDate) && ['cash', 'transfer', 'blik', 'other'].includes(payment.method)
    && data.jobs.some(job => job.id === payment.jobId)) || !unique(data.payments)) {
    throw new Error('Nieprawidłowy rejestr płatności. Oryginalny zapis nie został zmieniony.');
  }
  for (const job of data.jobs) {
    const total = legacy ? sumCents([calculatedLaborCents(job, Date.now(), data.timer), materialsTotalCents(job)]) : jobTotalCents(job, Date.now(), data.timer);
    if (paidCents(job.id, data.payments) > total) {
      throw new Error('Suma płatności przekracza wartość zlecenia. Oryginalny zapis nie został zmieniony.');
    }
  }
}

const cents = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

/** V3 metadata is validated separately so old records remain migratable unchanged. */
export function validateData(value: unknown): asserts value is Data {
  validateLegacyData(value);
  const data = value as Data;
  validateStage2(data);
  validatePlanning(data);
  validatePhotos(data);
  for (const job of data.jobs) {
    if (!Array.isArray(job.activities) || !job.activities.every(activity => typeof activity === 'string' && activity.trim())) {
      throw new Error('Nieprawidłowa lista czynności. Oryginalny zapis nie został zmieniony.');
    }
    if (job.settlement !== null) {
      const price = job.settlement;
      if (!record(price) || job.status !== 'completed'
        || ![price.calculatedLaborCents, price.materialsCents, price.finalLaborCents].every(cents)
        || !positive(price.approvedAt) || !['legacy', 'rounded', 'manual', 'fixed', 'exact'].includes(price.source)
        || !(price.suggestedLaborCents === null || cents(price.suggestedLaborCents))) {
        throw new Error('Nieprawidłowe zatwierdzone rozliczenie. Oryginalny zapis nie został zmieniony.');
      }
      if (price.source === 'legacy' && price.suggestedLaborCents !== null
        || price.source === 'rounded' && (price.suggestedLaborCents === null || price.finalLaborCents !== price.suggestedLaborCents || price.suggestedLaborCents !== roundLaborTo50Cents(price.calculatedLaborCents))
        || price.source === 'fixed' && price.suggestedLaborCents !== null) {
        throw new Error('Nieprawidłowe zatwierdzone rozliczenie. Oryginalny zapis nie został zmieniony.');
      }
    }
  }
  if (data.timer && (typeof data.timer.paused !== 'boolean'
    || data.timer.remainderMs !== undefined && (!Number.isSafeInteger(data.timer.remainderMs) || data.timer.remainderMs < 0 || data.timer.remainderMs >= 1000))) {
    throw new Error('Nieprawidłowy stan pomiaru wizyty. Oryginalny zapis nie został zmieniony.');
  }
  validatePayments(data);
}

function validateStage2(data: Data) {
  const fail = () => { throw new Error('Nieprawidłowe strefy lub katalog materiałów. Oryginalny zapis nie został zmieniony.'); };
  const unit = (value: unknown) => materialUnits.includes(value as typeof materialUnits[number]);
  const price = (value: unknown) => positive(value) && Number.isSafeInteger(toCents(value as number));
  for (const garden of data.gardens) {
    if (!Array.isArray(garden.zones) || !garden.zones.every(zone => record(zone)
      && strings(zone, ['id', 'name', 'type', 'plants', 'requirements', 'treatments']) && zone.name.trim() && zone.type.trim()
      && (zone.area === null || positive(zone.area)) && (zone.length === null || positive(zone.length))) || !unique(garden.zones)) fail();
  }
  if (!Array.isArray(data.materialCatalog) || !data.materialCatalog.every(item => record(item)
    && strings(item, ['id', 'name', 'category', 'unit', 'packageName', 'notes']) && item.name.trim() && item.category.trim()
    && unit(item.unit) && price(item.purchaseUnitPrice)
    && (item.packageQuantity === null || positive(item.packageQuantity) && item.packageQuantity > 0)) || !unique(data.materialCatalog)) fail();
  for (const job of data.jobs) for (const item of job.materials) {
    if (item.unit !== undefined && !unit(item.unit)
      || item.purchaseUnitPrice !== undefined && !price(item.purchaseUnitPrice)
      || !['catalogId', 'zoneId', 'zoneName'].every(key => (item as unknown as Record<string, unknown>)[key] === undefined || typeof (item as unknown as Record<string, unknown>)[key] === 'string')) fail();
  }
}

function withStage2(data: Data): Data {
  return { ...data, gardens: data.gardens.map(garden => ({ ...garden, zones: garden.zones ?? [] })), materialCatalog: data.materialCatalog ?? [] };
}

function migrateLegacyData(value: Omit<Data, 'payments'>, payments: Payment[]): Data {
  const now = Date.now();
  return {
    ...value,
    jobs: value.jobs.map(old => {
      const job: Job = { ...old, activities: [old.title], settlement: null };
      return job.status === 'completed' ? { ...job, settlement: legacySettlement(job, now) } : job;
    }),
    payments,
    timer: value.timer ? { ...value.timer, paused: false } : null,
  };
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
    if (!record(parsed) || ![1, 2, 3, 4, 5, STORAGE_VERSION].includes(parsed.version as number)) throw new Error('Nieobsługiwana wersja danych lokalnych. Oryginalny zapis nie został zmieniony.');
    if (parsed.version !== STORAGE_VERSION) {
      validateLegacyData(parsed.data);
      const payments = parsed.version === 1 ? [] : (parsed.data as Data).payments;
      if (parsed.version === 2) validatePayments(parsed.data as Data, true);
      const base = withStage2((parsed.version as number) >= 3 ? parsed.data as Data : migrateLegacyData(parsed.data, payments));
      const migrated: Data = { ...base, taskSchedules: base.taskSchedules ?? [], taskOccurrences: base.taskOccurrences ?? [], photos: base.photos ?? [], photoRestoreId: base.photoRestoreId ?? null };
      validateData(migrated);
      const backupKey = parsed.version === 1 ? LEGACY_BACKUP_KEY : parsed.version === 2 ? V2_BACKUP_KEY : parsed.version === 3 ? V3_BACKUP_KEY : parsed.version === 4 ? V4_BACKUP_KEY : V5_BACKUP_KEY;
      try {
        if (this.storage.getItem(backupKey) === null) this.storage.setItem(backupKey, raw);
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
