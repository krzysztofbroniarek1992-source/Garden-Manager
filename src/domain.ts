export interface Client {
  id: string;
  name: string;
  phone: string;
  email: string;
  notes: string;
}

export interface Garden {
  id: string;
  clientId: string;
  name: string;
  address: string;
  area: number;
  notes: string;
}

export interface Material {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
}

export interface Job {
  id: string;
  gardenId: string;
  title: string;
  date: string;
  time: string;
  status: 'planned' | 'in-progress' | 'completed';
  billing: 'hourly' | 'fixed';
  rate: number;
  fixedPrice: number;
  seconds: number;
  materials: Material[];
  notes: string;
}

export interface Timer {
  jobId: string;
  startedAt: number;
}

export interface Payment {
  id: string;
  jobId: string;
  amountCents: number;
  receivedDate: string;
  method: 'cash' | 'transfer' | 'blik' | 'other';
  note: string;
}

export interface Data {
  clients: Client[];
  gardens: Garden[];
  jobs: Job[];
  payments: Payment[];
  settings: { hourlyRate: number };
  timer: Timer | null;
}

/** YYYY-MM-DD in the device's local timezone, without UTC date shifts. */
export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function elapsedSeconds(job: Job, timer: Timer | null = null, now = Date.now()): number {
  return job.seconds + (timer?.jobId === job.id ? Math.max(0, Math.floor((now - timer.startedAt) / 1000)) : 0);
}

/** Decimal values are converted through strings, never by multiplying floats. */
function decimalRatio(value: number | string): [bigint, bigint] {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Podaj poprawną kwotę.');
  const input = String(value).trim().replace(',', '.');
  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(input);
  if (!match) throw new Error('Podaj poprawną kwotę.');
  const exponent = Number(match[4] ?? 0) - (match[3]?.length ?? 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1000) throw new Error('Kwota jest zbyt duża.');
  const numerator = BigInt(`${match[2]}${match[3] ?? ''}`) * (match[1] === '-' ? -1n : 1n);
  return exponent >= 0 ? [numerator * 10n ** BigInt(exponent), 1n] : [numerator, 10n ** BigInt(-exponent)];
}

function safeCents(value: bigint): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error('Kwota przekracza bezpieczny zakres rozliczeń.');
  return result;
}

function roundedRatio(numerator: bigint, denominator: bigint): number {
  const sign = numerator < 0n ? -1n : 1n;
  const absolute = numerator < 0n ? -numerator : numerator;
  return safeCents(sign * ((absolute + denominator / 2n) / denominator));
}

export function toCents(value: number | string): number {
  const [numerator, denominator] = decimalRatio(value);
  return roundedRatio(numerator * 100n, denominator);
}

/** Integer sum also rejects totals outside JavaScript's safe integer range. */
export function sumCents(values: Iterable<number>): number {
  let sum = 0n;
  for (const value of values) {
    if (!Number.isSafeInteger(value)) throw new Error('Kwoty muszą być zapisane w pełnych groszach.');
    sum += BigInt(value);
  }
  return safeCents(sum);
}

export function jobLaborCents(job: Job, now = Date.now(), timer: Timer | null = null): number {
  if (job.billing === 'fixed') return toCents(job.fixedPrice);
  const [seconds, scale] = decimalRatio(elapsedSeconds(job, timer, now));
  return roundedRatio(seconds * BigInt(toCents(job.rate)), scale * 3600n);
}

export function materialsTotalCents(job: Job): number {
  // v0.1 rounded the material subtotal once. Preserve those legitimate balances:
  // retain exact decimal fractions while summing, then round the total to cents.
  let numerator = 0n;
  let denominator = 1n;
  for (const item of job.materials) {
    const [quantity, scale] = decimalRatio(item.quantity);
    const commonScale = denominator > scale ? denominator : scale;
    numerator = numerator * (commonScale / denominator)
      + quantity * BigInt(toCents(item.unitPrice)) * (commonScale / scale);
    denominator = commonScale;
  }
  return roundedRatio(numerator, denominator);
}

export function jobTotalCents(job: Job, now = Date.now(), timer: Timer | null = null): number {
  return sumCents([jobLaborCents(job, now, timer), materialsTotalCents(job)]);
}

// Compatibility for existing views: calculations above stay in integer cents.
export function jobLabor(job: Job, now = Date.now(), timer: Timer | null = null): number {
  return jobLaborCents(job, now, timer) / 100;
}
export function materialsTotal(job: Job): number { return materialsTotalCents(job) / 100; }
export function jobTotal(job: Job, now = Date.now(), timer: Timer | null = null): number {
  return jobTotalCents(job, now, timer) / 100;
}
export function money(value: number): string { return moneyCents(toCents(value)); }
export function moneyCents(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new Error('Nieprawidłowa kwota w groszach.');
  const amount = BigInt(cents);
  const absolute = amount < 0n ? -amount : amount;
  const whole = absolute / 100n;
  const signedWhole = amount < 0n ? (whole === 0n ? -0 : -whole) : whole;
  const fraction = String(absolute % 100n).padStart(2, '0');
  return new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .formatToParts(signedWhole).map(part => part.type === 'fraction' ? fraction : part.value).join('');
}

export const settlementLabels = {
  unpaid: 'NIEROZLICZONE',
  partial: 'CZĘŚCIOWO ROZLICZONE',
  paid: 'ROZLICZONE',
} as const;
export type SettlementStatus = keyof typeof settlementLabels;

export function paidCents(jobId: string, payments: Payment[]): number {
  const ids = new Set<string>();
  return sumCents(payments.filter(payment => {
    if (payment.jobId !== jobId || ids.has(payment.id)) return false;
    ids.add(payment.id);
    return true;
  }).map(payment => payment.amountCents));
}
export function remainingCents(job: Job, payments: Payment[], now = Date.now(), timer: Timer | null = null): number {
  return Math.max(0, sumCents([jobTotalCents(job, now, timer), -paidCents(job.id, payments)]));
}
export function settlementStatus(job: Job, payments: Payment[], now = Date.now(), timer: Timer | null = null): SettlementStatus {
  const paid = paidCents(job.id, payments);
  if (paid === 0) return 'unpaid';
  return paid >= jobTotalCents(job, now, timer) ? 'paid' : 'partial';
}

export function clientSummary(data: Data, clientId: string, now = Date.now()) {
  const gardenIds = new Set(data.gardens.filter(garden => garden.clientId === clientId).map(garden => garden.id));
  const jobs = data.jobs.filter(job => gardenIds.has(job.gardenId));
  const complete = jobs.filter(job => job.status === 'completed');
  return {
    completedValueCents: sumCents(complete.map(job => jobTotalCents(job, now, data.timer))),
    receivedCents: sumCents(jobs.map(job => paidCents(job.id, data.payments))),
    outstandingCents: sumCents(complete.map(job => remainingCents(job, data.payments, now, data.timer))),
    seconds: jobs.reduce((sum, job) => sum + elapsedSeconds(job, data.timer, now), 0),
    completedCount: complete.length,
    plannedCount: jobs.filter(job => job.status === 'planned').length,
    unsettledCount: complete.filter(job => remainingCents(job, data.payments, now, data.timer) > 0).length,
  };
}

export function duration(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return [Math.floor(whole / 3600), Math.floor((whole % 3600) / 60), whole % 60].map(value => String(value).padStart(2, '0')).join(':');
}

/** Stop commits elapsed wall time; no interval or open browser tab is required. */
export function stopActiveTimer(data: Data, now = Date.now()): Data {
  const timer = data.timer;
  if (!timer) return data;
  return {
    ...data,
    timer: null,
    jobs: data.jobs.map(job => job.id === timer.jobId ? { ...job, seconds: elapsedSeconds(job, timer, now) } : job),
  };
}

export function startWork(data: Data, jobId: string, now = Date.now()): Data {
  const job = data.jobs.find(item => item.id === jobId);
  if (!job) throw new Error('Nie znaleziono zlecenia.');
  if (job.status === 'completed') throw new Error('Nie można uruchomić stopera zakończonego zlecenia.');
  if (data.timer?.jobId === jobId) return data;
  if (data.timer) throw new Error('Najpierw zatrzymaj aktywny stoper.');
  return {
    ...data,
    jobs: data.jobs.map(item => item.id === jobId ? { ...item, status: 'in-progress' } : item),
    timer: { jobId, startedAt: now },
  };
}

export function finishWork(data: Data, jobId: string, now = Date.now()): Data {
  if (!data.jobs.some(job => job.id === jobId)) throw new Error('Nie znaleziono zlecenia.');
  const stopped = data.timer?.jobId === jobId ? stopActiveTimer(data, now) : data;
  return { ...stopped, jobs: stopped.jobs.map(job => job.id === jobId ? { ...job, status: 'completed' } : job) };
}
