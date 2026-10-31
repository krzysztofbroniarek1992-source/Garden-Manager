import { test as base, expect, type Page } from '@playwright/test';
import { createDemoData } from '../src/data/demo';
import { STORAGE_VERSION } from '../src/data/repository';
import type { Data } from '../src/domain';
import { occurrenceId, type TaskOccurrence, type TaskSchedule } from '../src/planning/model';

const test = base.extend<{ browserErrors: string[] }>({
  browserErrors: [async ({ page }, use) => {
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await use(errors); expect(errors).toEqual([]);
  }, { auto: true }],
});
test.use({ timezoneId: 'Europe/Warsaw' });
const clock = new Date('2026-10-31T09:00:00+01:00');
const schedule = (patch: Partial<TaskSchedule> = {}): TaskSchedule => ({ id: 's-1', title: 'Stałe koszenie', notes: 'Plan bez należności', startDate: '2026-10-31', endDate: null, time: '09:00',
  clientId: 'client-1', gardenId: 'garden-1', zoneId: 'zone-1', zoneName: 'Trawnik przed domem', recurrence: { frequency: 'weeks', interval: 2, months: [1,2,3,4,5,6,7,8,9,10,11,12] }, endedOn: null, revision: 1, updatedAt: 1000, ...patch });
function fixture(): Data {
  const data = createDemoData(clock);
  data.gardens[0].zones = [{ id: 'zone-1', name: 'Trawnik przed domem', type: 'trawnik', area: 100, length: null, plants: 'Trawa', requirements: '', treatments: '' }];
  data.payments = [{ id: 'old-payment', jobId: 'job-5', amountCents: 1000, receivedDate: '2026-10-30', method: 'cash', note: 'Zachowana wpłata' }];
  return data;
}
async function seed(page: Page, data = fixture()) {
  await page.clock.install({ time: clock }); await page.goto('/');
  await page.evaluate(({ data, version }) => localStorage.setItem('garden-manager:v1', JSON.stringify({ version, data })), { data, version: STORAGE_VERSION });
  await page.reload();
}
async function snapshot(page: Page): Promise<{ version: number; data: Data }> { return page.evaluate(() => JSON.parse(localStorage.getItem('garden-manager:v1')!)); }
async function calendar(page: Page) { await page.getByRole('navigation', { name: 'Nawigacja główna' }).getByRole('button', { name: 'Kalendarz', exact: true }).click(); }
async function day(page: Page, date: string) { await page.getByLabel('Przejdź do dnia', { exact: true }).fill(date); }
async function openTask(page: Page, title = 'Stałe koszenie') {
  await page.locator('.calendar-agenda').getByRole('button', { name: title, exact: true }).click();
  return page.getByRole('dialog', { name: 'Szczegóły zadania', exact: true });
}

test('miesiąc, tydzień i dzień pokazują zlecenia i zadania; wydarzenia otwierają szczegóły', async ({ page }) => {
  const data = fixture(); data.taskSchedules = [schedule()]; await seed(page, data); await calendar(page);
  await expect(page.locator('.calendar-month .calendar-event').filter({ hasText: 'Stałe koszenie' })).toHaveCount(1);
  const switcher = page.getByRole('group', { name: 'Widok kalendarza' });
  await switcher.getByRole('button', { name: 'Tydzień', exact: true }).click();
  await expect(page.locator('.planning-grid-week>.calendar-day')).toHaveCount(7);
  await expect(page.locator('.calendar-week .calendar-event').filter({ hasText: 'Stałe koszenie' })).toHaveCount(1);
  await switcher.getByRole('button', { name: 'Dzień', exact: true }).click();
  await expect(page.locator('.planning-grid-day>.calendar-day')).toHaveCount(1);
  await page.locator('.calendar-day.card .calendar-event').filter({ hasText: 'Stałe koszenie' }).click();
  await expect(page.getByRole('dialog', { name: 'Szczegóły zadania', exact: true })).toContainText('Trawnik przed domem');
  await page.getByRole('button', { name: 'Zamknij okno', exact: true }).click();
  await page.locator('.calendar-agenda').getByRole('button', { name: 'Pielęgnacja ogrodu', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Szczegóły zlecenia', exact: true })).toBeVisible();
});

test('dodanie zadania z dnia zapisuje klienta, ogród, strefę i rytm bez tworzenia zleceń', async ({ page }) => {
  await seed(page); const before = (await snapshot(page)).data; await calendar(page); await day(page, '2026-11-03');
  await page.getByRole('button', { name: '+ Nowe zadanie na ten dzień', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Nowe zadanie', exact: true });
  await expect(form.getByLabel('Data rozpoczęcia', { exact: true })).toHaveValue('2026-11-03');
  await form.getByLabel('Nazwa zadania', { exact: true }).fill('Koszenie co 14 dni');
  await form.getByRole('combobox', { name: 'Klient (opcjonalnie)', exact: true }).selectOption('client-1');
  await form.getByRole('combobox', { name: 'Ogród (opcjonalnie)', exact: true }).selectOption('garden-1');
  await form.getByRole('combobox', { name: 'Strefa (opcjonalnie)', exact: true }).selectOption('zone-1');
  await form.getByRole('combobox', { name: 'Powtarzanie', exact: true }).selectOption('days');
  await form.getByLabel('Powtarzaj co').fill('14');
  await form.getByLabel('Data zakończenia').fill('2027-01-01');
  await form.getByRole('button', { name: 'Zapisz harmonogram' }).click();
  const saved = (await snapshot(page)).data;
  expect(saved.taskSchedules[0]).toMatchObject({ clientId: 'client-1', gardenId: 'garden-1', zoneId: 'zone-1', startDate: '2026-11-03', recurrence: { frequency: 'days', interval: 14 } });
  expect(saved.jobs).toEqual(before.jobs); expect(saved.payments).toEqual(before.payments); expect(saved.timer).toBeNull(); expect(saved.taskOccurrences).toEqual([]);
  await day(page, '2026-11-17'); await expect(page.locator('.calendar-agenda')).toContainText('Koszenie co 14 dni');
  await page.reload(); await day(page, '2026-11-18'); await expect(page.locator('.calendar-agenda')).not.toContainText('Koszenie co 14 dni');
});

test('miesięczne powtarzanie i wybrane miesiące sezonu działają z formularza', async ({ page }) => {
  await seed(page); await calendar(page); await day(page, '2026-01-31');
  await page.getByRole('button', { name: '+ Nowe zadanie na ten dzień', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Nowe zadanie', exact: true });
  await form.getByLabel('Nazwa zadania', { exact: true }).fill('Kontrola sezonowa');
  await form.getByRole('combobox', { name: 'Powtarzanie', exact: true }).selectOption('months');
  for (const month of ['Styczeń', 'Marzec', 'Maj', 'Czerwiec', 'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień']) await form.getByRole('checkbox', { name: month, exact: true }).uncheck();
  await form.getByRole('button', { name: 'Zapisz harmonogram' }).click();
  await day(page, '2026-02-28'); await expect(page.locator('.calendar-agenda')).toContainText('Kontrola sezonowa');
  await day(page, '2026-03-31'); await expect(page.locator('.calendar-agenda')).not.toContainText('Kontrola sezonowa');
  await day(page, '2026-04-30'); await expect(page.locator('.calendar-agenda')).toContainText('Kontrola sezonowa');
});

test('przesunięcie i pominięcie jednego terminu zachowuje serię i stałą tożsamość', async ({ page }) => {
  const data = fixture(); data.taskSchedules = [schedule()]; await seed(page, data); await calendar(page);
  let detail = await openTask(page);
  await detail.getByRole('button', { name: 'Przesuń ten termin' }).click();
  await detail.getByLabel('Nowa data terminu').fill('2026-11-02'); await detail.getByLabel('Nowa godzina terminu').fill('11:30');
  await detail.getByRole('button', { name: 'Zapisz przesunięcie' }).click();
  await expect(page.locator('.calendar-agenda')).not.toContainText('Stałe koszenie');
  await day(page, '2026-11-02'); detail = await openTask(page);
  await expect(detail).toContainText('Termin pierwotny: 2026-10-31');
  await detail.getByRole('button', { name: 'Pomiń ten termin' }).click();
  await detail.getByRole('button', { name: 'Anuluj pominięcie' }).click();
  await detail.getByRole('button', { name: 'Pomiń ten termin' }).click();
  await detail.getByRole('button', { name: 'Potwierdź pominięcie' }).click();
  await expect(page.locator('.calendar-agenda')).toContainText('Odwołane');
  const saved = (await snapshot(page)).data;
  expect(saved.taskOccurrences).toHaveLength(1); expect(saved.taskOccurrences[0]).toMatchObject({ id: occurrenceId('s-1', '2026-10-31'), date: '2026-11-02', time: '11:30', status: 'cancelled' });
  expect(saved.jobs).toEqual(data.jobs);
  await day(page, '2026-11-14'); await expect(page.locator('.calendar-agenda')).toContainText('Stałe koszenie');
});

test('edycja i zakończenie całej serii zachowują wcześniejsze zlecenia', async ({ page }) => {
  const data = fixture(); data.taskSchedules = [schedule()]; await seed(page, data); await calendar(page);
  await page.locator('.schedule-manager>summary').click();
  await page.getByRole('button', { name: 'Edytuj harmonogram Stałe koszenie', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Edytuj harmonogram', exact: true });
  await form.getByLabel('Nazwa zadania', { exact: true }).fill('Koszenie po zmianie');
  await form.getByLabel('Powtarzaj co').fill('1');
  await form.getByRole('button', { name: 'Zapisz harmonogram' }).click();
  await day(page, '2026-11-07'); await expect(page.locator('.calendar-agenda')).toContainText('Koszenie po zmianie');
  await page.getByRole('button', { name: 'Zakończ serię Koszenie po zmianie', exact: true }).click();
  await page.getByRole('dialog', { name: 'Zakończyć serię?', exact: true }).getByLabel('Ostatni dzień serii').fill('2026-11-07');
  await page.getByRole('button', { name: 'Potwierdź zakończenie serii' }).click();
  await day(page, '2026-11-14'); await expect(page.locator('.calendar-agenda')).not.toContainText('Koszenie po zmianie');
  expect((await snapshot(page)).data.jobs).toEqual(data.jobs); expect((await snapshot(page)).data.payments).toEqual(data.payments);
});

test('rozpoczęcie zadania tworzy jedną wizytę z istniejącym stoperem i rozliczeniem', async ({ page }) => {
  const data = fixture(); data.taskSchedules = [schedule()]; await seed(page, data); await calendar(page);
  const task = await openTask(page); await task.getByRole('button', { name: 'Rozpocznij pracę', exact: true }).click();
  const detail = page.getByRole('dialog', { name: 'Szczegóły zlecenia', exact: true });
  await expect(detail).toContainText('Stałe koszenie'); await page.clock.fastForward(13000);
  await detail.getByRole('button', { name: 'PAUZA — Przerwa bez naliczania', exact: true }).click();
  let saved = (await snapshot(page)).data;
  const newJob = saved.jobs.find(job => job.taskOccurrenceId === occurrenceId('s-1', '2026-10-31'))!;
  expect(saved.jobs).toHaveLength(data.jobs.length + 1); expect(newJob.seconds).toBe(13); expect(newJob.settlement).toBeNull(); expect(saved.payments).toEqual(data.payments);
  await detail.getByRole('button', { name: 'Zamknij okno', exact: true }).click(); await page.reload();
  await expect(page.locator('.calendar-month .calendar-event').filter({ hasText: 'Stałe koszenie' })).toHaveCount(1);
  await page.locator('.calendar-agenda').getByRole('button', { name: 'Stałe koszenie', exact: true }).click();
  await expect(detail.getByTestId('job-actual-time')).toHaveText('00:00:13');
  await detail.getByRole('button', { name: 'Zakończ', exact: true }).click();
  await expect(detail.getByRole('region', { name: 'Zatwierdzenie rozliczenia', exact: true })).toBeVisible();
  await detail.getByRole('button', { name: 'Zamknij okno', exact: true }).click();
  await expect(page.locator('.calendar-agenda').getByText('Wykonane', { exact: true })).toBeVisible();
  saved = (await snapshot(page)).data; expect(saved.jobs.filter(j => j.taskOccurrenceId)).toHaveLength(1); expect(saved.jobs.filter(j => !j.taskOccurrenceId)).toEqual(data.jobs); expect(saved.payments).toEqual(data.payments);
});

test('aktywny inny stoper blokuje rozpoczęcie bez pozostawienia częściowego zlecenia', async ({ page }) => {
  const data = fixture(); data.taskSchedules = [schedule()]; data.jobs[0].status = 'in-progress'; data.timer = { jobId: 'job-1', startedAt: clock.getTime(), paused: false };
  await seed(page, data); await calendar(page); const before = (await snapshot(page)).data;
  const detail = await openTask(page); await detail.getByRole('button', { name: 'Rozpocznij pracę', exact: true }).click();
  await expect(detail.getByRole('alert')).toContainText('Najpierw zatrzymaj aktywny stoper');
  const after = (await snapshot(page)).data; expect(after.jobs).toEqual(before.jobs); expect(after.taskOccurrences).toEqual([]); expect(after.timer).toEqual(before.timer);
});

test('przypomnienia wykluczają pominięte i wykonane terminy, a zaległe wymagają uwagi', async ({ page }) => {
  const data = fixture(); const series = schedule({ startDate: '2026-10-01' }); data.taskSchedules = [series];
  const occurrence = (date: string): TaskOccurrence => ({ id: occurrenceId(series.id, date), scheduleId: series.id, originalDate: date, date, time: series.time, title: series.title, notes: series.notes,
    clientId: series.clientId, gardenId: series.gardenId, zoneId: series.zoneId, zoneName: series.zoneName, status: 'planned', jobId: null, revision: 1, updatedAt: 1000 });
  const completed = occurrence('2026-10-01'); completed.jobId = 'job-5'; data.jobs.find(j => j.id === 'job-5')!.taskOccurrenceId = completed.id;
  data.taskOccurrences = [completed, { ...occurrence('2026-10-15'), status: 'cancelled' }];
  await seed(page, data);
  const overdue = page.locator('.overdue-reminders'); await expect(overdue.locator('.planning-reminder-row')).toHaveCount(1); await expect(overdue).toContainText('2026-10-29');
  await overdue.getByRole('button').click(); await expect(page.getByRole('dialog', { name: 'Szczegóły zadania', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Zamknij okno', exact: true }).click(); await calendar(page); await day(page, '2026-10-29');
  await expect(page.locator('.calendar-agenda')).toContainText('Termin zaległy — wymaga uwagi');
});

test('migracja v4 i eksport v5 zachowują dane, stoper i harmonogram z wyjątkiem', async ({ page }) => {
  await seed(page); const { taskSchedules: _s, taskOccurrences: _o, ...old } = fixture();
  old.jobs[0].status = 'in-progress'; old.timer = { jobId: 'job-1', startedAt: clock.getTime(), paused: true, remainderMs: 123 };
  const original = JSON.stringify({ version: 4, data: old }); await page.evaluate(raw => localStorage.setItem('garden-manager:v1', raw), original); await page.reload();
  const migrated = (await snapshot(page)); expect(migrated.version).toBe(STORAGE_VERSION); expect(migrated.data.jobs).toEqual(old.jobs); expect(migrated.data.payments).toEqual(old.payments); expect(migrated.data.timer).toEqual(old.timer);
  expect(await page.evaluate(() => localStorage.getItem('garden-manager:backup:v4'))).toBe(original);
  await calendar(page); await page.getByRole('button', { name: '+ Nowe zadanie na ten dzień', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Nowe zadanie', exact: true }); await form.getByLabel('Nazwa zadania', { exact: true }).fill('Plan w kopii'); await form.getByRole('button', { name: 'Zapisz harmonogram' }).click();
  const detail = await openTask(page, 'Plan w kopii'); await detail.getByRole('button', { name: 'Pomiń ten termin' }).click(); await detail.getByRole('button', { name: 'Potwierdź pominięcie' }).click();
  const before = (await snapshot(page)); await page.getByRole('button', { name: 'Ustawienia konta demonstracyjnego' }).click(); const downloadEvent = page.waitForEvent('download'); await page.getByRole('button', { name: 'Eksportuj dane' }).click();
  const stream = await (await downloadEvent).createReadStream(); const chunks: Buffer[] = []; for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const exported = JSON.parse(Buffer.concat(chunks).toString('utf8')); expect(exported).toEqual(before);
  await page.evaluate(raw => localStorage.setItem('garden-manager:v1', raw), JSON.stringify(exported)); await page.reload(); expect(await snapshot(page)).toEqual(before);
});

test('telefon: formularz sezonu, przełączanie widoków i rozpoczęcie zadania bez przypisanego ogrodu', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); const data = fixture(); data.taskSchedules = [schedule({ gardenId: null, zoneId: null, zoneName: null })]; await seed(page, data);
  await page.getByRole('navigation', { name: 'Nawigacja mobilna' }).getByRole('button', { name: 'Kalendarz', exact: true }).click();
  const switcher = page.getByRole('group', { name: 'Widok kalendarza' });
  await switcher.getByRole('button', { name: 'Tydzień', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await switcher.getByRole('button', { name: 'Dzień', exact: true }).click(); const task = await openTask(page);
  await expect(task.getByRole('button', { name: 'Rozpocznij pracę', exact: true })).toBeDisabled();
  await task.getByRole('button', { name: 'Edytuj całą serię' }).click();
  const form = page.getByRole('dialog', { name: 'Edytuj harmonogram', exact: true }); expect(await form.evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true); await form.getByRole('button', { name: 'Anuluj', exact: true }).click();
  await task.getByRole('combobox', { name: 'Ogród do wykonania pracy', exact: true }).selectOption('garden-1');
  await task.getByRole('button', { name: 'Rozpocznij pracę', exact: true }).click();
  const job = page.getByRole('dialog', { name: 'Szczegóły zlecenia', exact: true }); await expect(job).toBeVisible(); expect(await job.evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
