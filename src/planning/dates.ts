import type { TaskSchedule } from './model';

export function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function dateNumber(date: string): number {
  if (!isDate(date)) throw new Error('Podaj poprawną datę.');
  return Date.parse(`${date}T00:00:00Z`) / 86_400_000;
}
export function addDays(date: string, days: number): string {
  const result = new Date((dateNumber(date) + days) * 86_400_000).toISOString().slice(0, 10);
  if (!isDate(result)) throw new Error('Data wykracza poza obsługiwany zakres.');
  return result;
}
export function weekStart(date: string): string {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((weekday + 6) % 7));
}
const monthIndex = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
/** Clamp to month end, always using the original anchor (31 Jan → 28 Feb → 31 Mar). */
export function addMonths(date: string, months: number): string | null {
  if (!isDate(date)) throw new Error('Podaj poprawną datę.');
  const index = monthIndex(date) + months;
  const year = Math.floor(index / 12), month = index % 12;
  if (year < 0 || year > 9999) return null;
  const end = new Date(0);
  end.setUTCFullYear(year, month + 1, 0);
  return `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(Math.min(Number(date.slice(8)), end.getUTCDate())).padStart(2, '0')}`;
}
export function validateRule(schedule: TaskSchedule): void {
  if (!isDate(schedule.startDate) || schedule.endDate !== null && (!isDate(schedule.endDate) || schedule.endDate < schedule.startDate)
    || schedule.endedOn !== null && !isDate(schedule.endedOn)
    || !/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.time)) throw new Error('Sprawdź daty harmonogramu i godzinę.');
  const rule = schedule.recurrence;
  if (!rule || !['once', 'days', 'weeks', 'months', 'years'].includes(rule.frequency)
    || !Number.isSafeInteger(rule.interval) || rule.interval < 1 || rule.interval > 1000
    || !Array.isArray(rule.months) || !rule.months.length || new Set(rule.months).size !== rule.months.length
    || !rule.months.every(month => Number.isInteger(month) && month >= 1 && month <= 12)) {
    throw new Error('Wybierz poprawny rytm powtarzania i przynajmniej jeden miesiąc sezonu.');
  }
}
/** Civil dates only: DST and the device timezone never change recurrence arithmetic. */
export function* scheduleDates(schedule: TaskSchedule, from: string, to: string): Generator<string> {
  validateRule(schedule);
  if (!isDate(from) || !isDate(to)) throw new Error('Podaj poprawny zakres dat.');
  const end = [to, schedule.endDate, schedule.endedOn].filter((value): value is string => value !== null).sort()[0];
  const start = from > schedule.startDate ? from : schedule.startDate;
  if (end < start) return;
  const { frequency, interval, months } = schedule.recurrence;
  const allowed = (date: string) => date >= start && date <= end && (frequency === 'once' || months.includes(Number(date.slice(5, 7))));
  if (frequency === 'once') { if (allowed(schedule.startDate)) yield schedule.startDate; return; }
  if (frequency === 'days' || frequency === 'weeks') {
    const step = interval * (frequency === 'weeks' ? 7 : 1);
    const first = Math.max(0, Math.ceil((dateNumber(start) - dateNumber(schedule.startDate)) / step));
    const anchor = dateNumber(schedule.startDate), last = dateNumber(end);
    for (let day = anchor + first * step; day <= last; day += step) {
      const date = new Date(day * 86_400_000).toISOString().slice(0, 10);
      if (allowed(date)) yield date;
    }
  } else {
    const step = interval * (frequency === 'years' ? 12 : 1);
    const first = Math.max(0, Math.floor((monthIndex(start) - monthIndex(schedule.startDate)) / step) - 1);
    for (let index = first; ; index++) {
      const date = addMonths(schedule.startDate, index * step);
      if (!date || date > end) break;
      if (allowed(date)) yield date;
    }
  }
}
