import { STORAGE_VERSION } from '../src/data/repository';
import { test as base, expect, type Locator, type Page } from '@playwright/test';
import type { Job, Payment } from '../src/domain';

const test = base.extend<{ browserErrors: string[] }>({
  browserErrors: [async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await use(errors);
    expect(errors, 'Wizyta i rozliczenia bez błędów JavaScript').toEqual([]);
  }, { auto: true }],
});

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-30T10:00:00+01:00') });
});

const key = 'garden-manager:v1';
type LegacyJob = Omit<Job, 'activities' | 'settlement'>;
const visitTitle = 'Wizyta godzinowa 0.3';
const fixedTitle = 'Wizyta ryczałtowa 0.3';
const oldTitle = 'Zakończona praca z wersji 0.2';

function fixture() {
  const job = (id: string, title: string, changes: Partial<LegacyJob> = {}): LegacyJob => ({
    id, gardenId: 'visit-garden', title, date: '2026-10-30', time: '09:00',
    status: 'planned', billing: 'hourly', rate: 120, fixedPrice: 0,
    seconds: 0, materials: [], notes: 'Zachowana notatka ze starszej wersji.', ...changes,
  });
  return {
    clients: [{ id: 'visit-client', name: 'Klient wizyt 0.3', phone: '600 222 333', email: 'wizyty@example.com', notes: 'Istniejący klient.' }],
    gardens: [{ id: 'visit-garden', clientId: 'visit-client', name: 'Istniejący ogród', address: 'ul. Testowa 3', area: 400, notes: 'Zachowany ogród.' }],
    jobs: [
      job('visit-job', visitTitle),
      job('fixed-job', fixedTitle, { billing: 'fixed', fixedPrice: 454 }),
      job('old-job', oldTitle, { status: 'completed', seconds: 13620, materials: [{ id: 'old-m', name: 'Materiały z archiwum', quantity: 1, unitPrice: 87 }] }),
    ],
    payments: [{ id: 'old-payment', jobId: 'old-job', amountCents: 10000, receivedDate: '2026-10-29', method: 'transfer', note: 'Dotychczasowa wpłata.' }] as Payment[],
    settings: { hourlyRate: 120 },
    timer: null as { jobId: string; startedAt: number } | null,
  };
}

async function seed02(page: Page, data = fixture()) {
  const original = JSON.stringify({ version: 2, data });
  await page.addInitScript(({ key, original }) => {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, original);
  }, { key, original });
  await page.goto('/');
  return original;
}

async function snapshot(page: Page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!), key);
}

async function navigate(page: Page, name: string) {
  await page.getByRole('navigation', { name: 'Nawigacja główna' }).getByRole('button', { name: new RegExp(`^${name}`) }).click();
}

function card(page: Page, title = visitTitle) {
  return page.locator('article.job-card').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
}

function detail(page: Page) {
  return page.getByRole('dialog', { name: 'Szczegóły zlecenia', exact: true });
}

async function openDetail(page: Page, title = visitTitle) {
  await card(page, title).getByRole('button', { name: 'Szczegóły i płatności', exact: true }).click();
  return detail(page);
}

async function correctTime(panel: Locator, hours: string, minutes: string, seconds: string) {
  await panel.getByRole('button', { name: 'Popraw czas pracy', exact: true }).click();
  const form = panel.getByRole('region', { name: 'Ręczna korekta czasu pracy', exact: true });
  await form.getByLabel('Godziny', { exact: true }).fill(hours);
  await form.getByLabel('Minuty', { exact: true }).fill(minutes);
  await form.getByLabel('Sekundy', { exact: true }).fill(seconds);
  await form.getByRole('button', { name: 'Zapisz korektę czasu', exact: true }).click();
  await form.getByRole('button', { name: 'Potwierdź korektę czasu', exact: true }).click();
  await expect(form).toHaveCount(0);
}

async function addMaterials(page: Page, title = visitTitle) {
  await card(page, title).getByRole('button', { name: `Edytuj ${title}`, exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Szczegóły zlecenia', exact: true });
  await form.getByRole('button', { name: 'Edytuj zlecenie', exact: true }).click();
  await form.getByRole('button', { name: 'Dodaj', exact: true }).click();
  await form.getByLabel('Nazwa materiału 1', { exact: true }).fill('Materiały osobno');
  await form.getByLabel('Ilość materiału 1', { exact: true }).fill('1');
  await form.getByLabel('Cena materiału 1', { exact: true }).fill('87');
  await form.getByRole('button', { name: 'Zapisz zlecenie', exact: true }).click();
  await form.getByRole('button', { name: 'Zamknij okno', exact: true }).click();
}

async function complete(page: Page, title = visitTitle) {
  await card(page, title).getByRole('button', { name: 'Zakończ', exact: true }).click();
  const panel = detail(page);
  await expect(panel.getByRole('button', { name: 'Zatwierdź cenę robocizny', exact: true })).toBeVisible();
  return panel;
}

async function addPayment(panel: Locator, amount: string) {
  await panel.getByRole('button', { name: 'Dodaj płatność', exact: true }).click();
  await panel.getByLabel('Kwota (zł)', { exact: true }).fill(amount);
  await panel.getByLabel('Data otrzymania', { exact: true }).fill('2026-10-30');
  await panel.getByRole('button', { name: 'Zapisz płatność', exact: true }).click();
  await expect(panel.getByLabel('Kwota (zł)', { exact: true })).toHaveCount(0);
}

test('wizyta ma jeden stoper dla wielu czynności, pauza i wznowienie przetrwają odświeżenie', async ({ page }) => {
  await seed02(page);
  await page.getByLabel('ZLECENIE DO REALIZACJI', { exact: true }).selectOption('visit-job');
  await page.getByRole('button', { name: 'START — Rozpocznij wizytę', exact: true }).click();
  await page.clock.fastForward(61_000);
  const running = (await snapshot(page)).data.timer;
  expect(running).toMatchObject({ jobId: 'visit-job', paused: false });
  await navigate(page, 'Zlecenia');
  await card(page).getByRole('button', { name: 'Zapisz czynności bez zatrzymywania wizyty', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Szczegóły zlecenia', exact: true });
  await form.getByRole('button', { name: 'Edytuj zlecenie', exact: true }).click();
  const activities = ['Cięcie żywopłotu', 'Koszenie trawnika', 'Oprysk', 'Sprzątanie'];
  for (let index = 0; index < activities.length; index++) {
    if (index > 0) await form.getByRole('button', { name: 'Dodaj czynność', exact: true }).click();
    await form.getByLabel(`Czynność ${index + 1}`, { exact: true }).fill(activities[index]);
  }
  await form.getByRole('button', { name: 'Zapisz zlecenie', exact: true }).click();
  await form.getByRole('button', { name: 'Zamknij okno', exact: true }).click();
  let stored = (await snapshot(page)).data;
  expect(stored.timer).toEqual(running);
  expect(stored.jobs.find((job: Job) => job.id === 'visit-job').activities).toEqual(activities);
  await navigate(page, 'Panel główny');
  await page.getByRole('button', { name: 'PAUZA — Przerwa bez naliczania', exact: true }).click();
  stored = (await snapshot(page)).data;
  const pausedSeconds = stored.jobs.find((job: Job) => job.id === 'visit-job').seconds;
  expect(stored.timer).toMatchObject({ jobId: 'visit-job', paused: true });
  expect(pausedSeconds).toBeGreaterThanOrEqual(61);
  const pausedDisplay = await page.getByTestId('timer-display').textContent();
  await page.clock.fastForward(600_000);
  await page.reload();
  await expect(page.getByTestId('timer-display')).toHaveText(pausedDisplay!);
  await expect(page.getByRole('button', { name: 'WZNÓW — Kontynuuj wizytę', exact: true })).toBeVisible();
  await page.clock.fastForward(600_000);
  await expect(page.getByTestId('timer-display')).toHaveText(pausedDisplay!);
  await page.getByRole('button', { name: 'WZNÓW — Kontynuuj wizytę', exact: true }).click();
  await page.clock.fastForward(14_000);
  await page.getByRole('button', { name: 'STOP — Zakończ pomiar', exact: true }).click();
  stored = (await snapshot(page)).data;
  expect(stored.timer).toBeNull();
  const stoppedSeconds = stored.jobs.find((job: Job) => job.id === 'visit-job').seconds;
  expect(stoppedSeconds).toBeGreaterThanOrEqual(pausedSeconds + 14);
  expect(stoppedSeconds).toBeLessThan(pausedSeconds + 20);
  await navigate(page, 'Zlecenia');
  const panel = await openDetail(page);
  await correctTime(panel, '0', '2', '7');
  expect((await snapshot(page)).data.jobs.find((job: Job) => job.id === 'visit-job').seconds).toBe(127);
  await panel.getByRole('button', { name: 'Zamknij okno', exact: true }).click();
  await page.reload();
  expect((await snapshot(page)).data.jobs.find((job: Job) => job.id === 'visit-job').seconds).toBe(127);
});

test('454 zł robocizny proponuje 450 zł, materiały 87 zł dają 537 zł bez zmiany dokładnego czasu', async ({ page }) => {
  await seed02(page);
  await navigate(page, 'Zlecenia');
  await addMaterials(page);
  let panel = await openDetail(page);
  await correctTime(panel, '3', '47', '0');
  await panel.getByRole('button', { name: 'Zamknij okno', exact: true }).click();
  panel = await complete(page);
  const pendingJob = (await snapshot(page)).data.jobs.find((job: Job) => job.id === 'visit-job');
  expect(pendingJob.settlement).toBeNull();
  expect(pendingJob.seconds).toBe(13620);
  await expect(panel.getByTestId('proposal-calculated-labor')).toHaveText(/454,00\s*zł/);
  await expect(panel.getByTestId('proposal-rounded-labor')).toHaveText(/450,00\s*zł/);
  await expect(panel.getByTestId('proposal-materials')).toHaveText(/87,00\s*zł/);
  await expect(panel.getByTestId('proposal-final-total')).toHaveText(/537,00\s*zł/);
  await panel.getByRole('button', { name: 'Zatwierdź cenę robocizny', exact: true }).click();
  const approved = (await snapshot(page)).data.jobs.find((job: Job) => job.id === 'visit-job');
  expect(approved.seconds).toBe(13620);
  expect(approved.settlement).toMatchObject({ calculatedLaborCents: 45400, suggestedLaborCents: 45000, materialsCents: 8700, finalLaborCents: 45000, source: 'rounded' });
  await expect(panel.getByTestId('payment-job-total')).toHaveText(/537,00\s*zł/);
  await addPayment(panel, '200.01');
  await addPayment(panel, '336.99');
  await expect(panel.locator('.payment-status-line .payment-badge')).toHaveText('ROZLICZONE');
  await expect(panel.getByTestId('payment-job-remaining')).toHaveText(/0,00\s*zł/);
  expect((await snapshot(page)).data.payments.filter((payment: Payment) => payment.jobId === 'visit-job').map((payment: Payment) => payment.amountCents)).toEqual([20001, 33699]);
  await panel.getByRole('button', { name: 'Zamknij okno', exact: true }).click();
  await navigate(page, 'Historia prac');
  await expect(card(page)).toContainText('03:47:00');
  await expect(card(page)).toContainText('454,00');
  await expect(card(page)).toContainText('450,00');
  await expect(card(page).locator('.job-amount strong')).toHaveText(/537,00\s*zł/);
  await page.reload();
  await expect(card(page).locator('.job-amount strong')).toHaveText(/537,00\s*zł/);
});

test('ręczna cena robocizny jest zatwierdzana osobno i pozostaje stała po korekcie czasu oraz stawki', async ({ page }) => {
  await seed02(page);
  await navigate(page, 'Zlecenia');
  await addMaterials(page);
  let panel = await openDetail(page);
  await correctTime(panel, '3', '47', '0');
  await panel.getByRole('button', { name: 'Zamknij okno', exact: true }).click();
  panel = await complete(page);
  await panel.getByLabel('Ustalona cena robocizny (zł)', { exact: true }).fill('500');
  await expect(panel.getByTestId('proposal-final-total')).toHaveText(/587,00\s*zł/);
  await panel.getByRole('button', { name: 'Zatwierdź cenę robocizny', exact: true }).click();
  const price = (await snapshot(page)).data.jobs.find((job: Job) => job.id === 'visit-job').settlement;
  expect(price).toMatchObject({ finalLaborCents: 50000, materialsCents: 8700, calculatedLaborCents: 45400, source: 'manual' });
  await correctTime(panel, '4', '0', '1');
  await expect(panel.getByTestId('payment-job-total')).toHaveText(/587,00\s*zł/);
  await panel.getByRole('button', { name: 'Zamknij okno', exact: true }).click();
  await navigate(page, 'Historia prac');
  await card(page).getByRole('button', { name: `Edytuj ${visitTitle}`, exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Szczegóły zlecenia', exact: true });
  await form.getByRole('button', { name: 'Edytuj zlecenie', exact: true }).click();
  await form.getByLabel('Stawka (zł/h)', { exact: true }).fill('200');
  await form.getByRole('button', { name: 'Zapisz zlecenie', exact: true }).click();
  await form.getByRole('button', { name: 'Zamknij okno', exact: true }).click();
  await page.reload();
  const restored = (await snapshot(page)).data.jobs.find((job: Job) => job.id === 'visit-job');
  expect(restored.rate).toBe(200);
  expect(restored.seconds).toBe(14401);
  expect(restored.settlement).toEqual(price);
  await expect(card(page).locator('.job-amount strong')).toHaveText(/587,00\s*zł/);
});

test('kwota dokładnie w połowie 475 zł jest proponowana w górę do 500 zł bez zaokrąglania sekund', async ({ page }) => {
  await seed02(page);
  await navigate(page, 'Zlecenia');
  let panel = await openDetail(page);
  await correctTime(panel, '3', '57', '30');
  await panel.getByRole('button', { name: 'Zamknij okno', exact: true }).click();
  panel = await complete(page);
  await expect(panel.getByTestId('proposal-calculated-labor')).toHaveText(/475,00\s*zł/);
  await expect(panel.getByTestId('proposal-rounded-labor')).toHaveText(/500,00\s*zł/);
  await panel.getByRole('button', { name: 'Zatwierdź cenę robocizny', exact: true }).click();
  const stored = (await snapshot(page)).data.jobs.find((job: Job) => job.id === 'visit-job');
  expect(stored.seconds).toBe(14250);
  expect(stored.settlement).toMatchObject({ calculatedLaborCents: 47500, suggestedLaborCents: 50000, finalLaborCents: 50000 });
});

test('ryczałt nie zaokrągla ceny, ale zapisuje rzeczywisty czas wizyty', async ({ page }) => {
  await seed02(page);
  await navigate(page, 'Zlecenia');
  let panel = await openDetail(page, fixedTitle);
  await correctTime(panel, '1', '2', '3');
  await panel.getByRole('button', { name: 'Zamknij okno', exact: true }).click();
  panel = await complete(page, fixedTitle);
  await expect(panel.getByTestId('proposal-calculated-labor')).toHaveText(/454,00\s*zł/);
  await expect(panel.getByTestId('proposal-rounded-labor')).toHaveText(/454,00\s*zł/);
  await expect(panel).toContainText('Ryczałt · bez zaokrąglania');
  await expect(panel.getByRole('button', { name: 'Użyj propozycji do 50 zł', exact: true })).toHaveCount(0);
  await panel.getByRole('button', { name: 'Zatwierdź cenę robocizny', exact: true }).click();
  const job = (await snapshot(page)).data.jobs.find((job: Job) => job.id === 'fixed-job');
  expect(job.seconds).toBe(3723);
  expect(job.settlement).toMatchObject({ calculatedLaborCents: 45400, suggestedLaborCents: null, finalLaborCents: 45400, source: 'fixed' });
  await expect(panel.getByTestId('payment-job-total')).toHaveText(/454,00\s*zł/);
});

test('korekta zatwierdzonej ceny nie obniża należności poniżej wpłat częściowych', async ({ page }) => {
  await seed02(page);
  await navigate(page, 'Zlecenia');
  let panel = await openDetail(page, fixedTitle);
  await correctTime(panel, '0', '30', '0');
  await panel.getByRole('button', { name: 'Zamknij okno', exact: true }).click();
  panel = await complete(page, fixedTitle);
  await panel.getByRole('button', { name: 'Zatwierdź cenę robocizny', exact: true }).click();
  await addPayment(panel, '400');
  await panel.getByRole('button', { name: 'Skoryguj cenę', exact: true }).click();
  await panel.getByLabel('Ustalona cena robocizny (zł)', { exact: true }).fill('399.99');
  await panel.getByRole('button', { name: 'Sprawdź korektę ceny', exact: true }).click();
  await expect(panel.getByRole('region', { name: 'Korekta ceny robocizny', exact: true }).getByRole('alert')).toContainText('nie może być niższa');
  expect((await snapshot(page)).data.jobs.find((job: Job) => job.id === 'fixed-job').settlement.finalLaborCents).toBe(45400);
  await panel.getByLabel('Ustalona cena robocizny (zł)', { exact: true }).fill('425');
  await panel.getByRole('button', { name: 'Sprawdź korektę ceny', exact: true }).click();
  expect((await snapshot(page)).data.jobs.find((job: Job) => job.id === 'fixed-job').settlement.finalLaborCents).toBe(45400);
  await panel.getByRole('button', { name: 'Potwierdź korektę ceny', exact: true }).click();
  await expect(panel.getByTestId('payment-job-total')).toHaveText(/425,00\s*zł/);
  await expect(panel.getByTestId('payment-job-paid')).toHaveText(/400,00\s*zł/);
  await expect(panel.getByTestId('payment-job-remaining')).toHaveText(/25,00\s*zł/);
});

test('migracja 0.2 i eksport zachowują starą należność 541 zł bez nowego zaokrąglania', async ({ page }) => {
  const original = await seed02(page);
  const migrated = await snapshot(page);
  expect(migrated.version).toBe(STORAGE_VERSION);
  expect(await page.evaluate(() => localStorage.getItem('garden-manager:backup:v2'))).toBe(original);
  const old = fixture();
  expect(migrated.data.clients).toEqual(old.clients);
  expect(migrated.data.gardens).toEqual(old.gardens.map(garden => ({ ...garden, zones: [] })));
  expect(migrated.data.payments).toEqual(old.payments);
  expect(migrated.data.settings).toEqual(old.settings);
  expect(migrated.data.jobs).toHaveLength(3);
  const preserved = migrated.data.jobs.find((job: Job) => job.id === 'old-job');
  expect(preserved.seconds).toBe(13620);
  expect(preserved.settlement).toMatchObject({ calculatedLaborCents: 45400, suggestedLaborCents: null, materialsCents: 8700, finalLaborCents: 45400, source: 'legacy' });
  await navigate(page, 'Historia prac');
  let panel = await openDetail(page, oldTitle);
  await expect(panel.getByTestId('payment-job-total')).toHaveText(/541,00\s*zł/);
  await expect(panel.getByTestId('payment-job-paid')).toHaveText(/100,00\s*zł/);
  await expect(panel.getByTestId('payment-job-remaining')).toHaveText(/441,00\s*zł/);
  await panel.getByRole('button', { name: 'Zamknij okno', exact: true }).click();
  await page.reload();
  expect((await snapshot(page)).data.jobs.find((job: Job) => job.id === 'old-job').settlement).toEqual(preserved.settlement);
  await page.getByRole('button', { name: 'Ustawienia konta demonstracyjnego', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Ustawienia', exact: true });
  const downloadEvent = page.waitForEvent('download');
  await settings.getByRole('button', { name: 'Eksportuj dane', exact: true }).click();
  const download = await downloadEvent;
  const stream = await download.createReadStream();
  expect(stream).not.toBeNull();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const exported = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  expect(exported.version).toBe(STORAGE_VERSION);
  expect(exported.data.payments).toEqual(old.payments);
  expect(exported.data.jobs.find((job: Job) => job.id === 'old-job').settlement).toEqual(preserved.settlement);
});

test('telefon obsługuje pauzę oraz zatwierdzenie ceny bez przewijania strony w poziomie', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed02(page);
  await page.getByLabel('ZLECENIE DO REALIZACJI', { exact: true }).selectOption('visit-job');
  await page.getByRole('button', { name: 'START — Rozpocznij wizytę', exact: true }).click();
  await page.clock.fastForward(15_000);
  await page.getByRole('button', { name: 'PAUZA — Przerwa bez naliczania', exact: true }).click();
  const seconds = (await snapshot(page)).data.jobs.find((job: Job) => job.id === 'visit-job').seconds;
  await page.clock.fastForward(120_000);
  await page.reload();
  expect((await snapshot(page)).data.jobs.find((job: Job) => job.id === 'visit-job').seconds).toBe(seconds);
  await page.getByRole('button', { name: 'STOP — Zakończ pomiar', exact: true }).click();
  const nav = page.getByRole('navigation', { name: 'Nawigacja mobilna' });
  await nav.getByRole('button', { name: 'Zlecenia', exact: true }).click();
  let panel = await openDetail(page);
  await correctTime(panel, '2', '15', '0');
  await panel.getByRole('button', { name: 'Zamknij okno', exact: true }).click();
  panel = await complete(page);
  await expect(panel.getByTestId('proposal-calculated-labor')).toHaveText(/270,00\s*zł/);
  await expect(panel.getByTestId('proposal-rounded-labor')).toHaveText(/250,00\s*zł/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await panel.getByRole('button', { name: 'Zatwierdź cenę robocizny', exact: true }).click();
  await expect(panel.getByTestId('payment-job-total')).toHaveText(/250,00\s*zł/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
