import { test as base, expect, type Locator, type Page } from '@playwright/test';

const test = base.extend<{ browserErrors: string[] }>({
  browserErrors: [async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await use(errors);
    expect(errors, 'Brak nieobsłużonych błędów aplikacji').toEqual([]);
  }, { auto: true }],
});

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-29T10:00:00+01:00') });
});

const storageKey = 'garden-manager:v1';
const backupKey = 'garden-manager:backup:v1';
const clientName = 'Klient z archiwum 0.1';

function legacyFixture() {
  return {
    clients: [
      { id: 'legacy-client', name: clientName, phone: '600 111 222', email: 'archiwum@example.com', notes: 'Istniejący klient — nie usuwać.' },
      { id: 'other-client', name: 'Inny klient', phone: '', email: '', notes: '' },
    ],
    gardens: [
      { id: 'legacy-garden-a', clientId: 'legacy-client', name: 'Ogród A z archiwum', address: 'ul. Archiwalna 1', area: 100, notes: 'Ogród sprzed aktualizacji.' },
      { id: 'legacy-garden-b', clientId: 'legacy-client', name: 'Ogród B z archiwum', address: 'ul. Archiwalna 2', area: 200, notes: '' },
      { id: 'other-garden', clientId: 'other-client', name: 'Obcy ogród', address: '', area: 300, notes: '' },
    ],
    jobs: [
      ...Array.from({ length: 12 }, (_, index) => ({
        id: `legacy-job-${index + 1}`,
        gardenId: index % 2 ? 'legacy-garden-b' : 'legacy-garden-a',
        title: `Archiwalna praca ${String(index + 1).padStart(2, '0')}`,
        date: `2026-10-${String(index + 1).padStart(2, '0')}`,
        time: '09:00',
        status: index < 10 ? 'completed' : 'planned',
        billing: 'fixed', rate: 120, fixedPrice: index < 10 ? 100 : 1000,
        seconds: index < 10 ? 3600 : 0,
        materials: [], notes: 'Zachowana notatka z wersji 0.1.',
      })),
      { id: 'other-job', gardenId: 'other-garden', title: 'Nie należy do tego klienta', date: '2026-10-01', time: '09:00', status: 'completed', billing: 'fixed', rate: 120, fixedPrice: 9999, seconds: 3600, materials: [], notes: '' },
    ],
    settings: { hourlyRate: 135 },
    timer: null as { jobId: string; startedAt: number } | null,
  };
}

async function seedLegacy(page: Page, data = legacyFixture()) {
  const original = JSON.stringify({ version: 1, data });
  await page.addInitScript(({ key, original }) => {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, original);
  }, { key: storageKey, original });
  await page.goto('/');
  return original;
}

async function snapshot(page: Page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)!), storageKey);
}

async function navigate(page: Page, name: string) {
  await page.getByRole('navigation', { name: 'Nawigacja główna' }).getByRole('button', { name: new RegExp(`^${name}`) }).click();
}

async function openClient(page: Page) {
  await navigate(page, 'Klienci');
  if (!(await page.locator('.client-details-page').isVisible())) {
    await page.getByRole('button', { name: clientName, exact: true }).click();
  }
  await expect(page.getByRole('heading', { name: clientName, exact: true })).toBeVisible();
}

async function openFirstJob(page: Page) {
  await page.getByRole('button', { name: 'Szczegóły zlecenia Archiwalna praca 01', exact: true }).click();
  const detail = page.getByRole('dialog');
  await expect(detail.getByRole('heading', { name: 'Archiwalna praca 01', exact: true })).toBeVisible();
  return detail;
}

async function addPayment(detail: Locator, amount: string, method = 'transfer', note = '') {
  await detail.getByRole('button', { name: 'Dodaj płatność', exact: true }).click();
  await detail.getByLabel('Kwota (zł)', { exact: true }).fill(amount);
  await detail.getByLabel('Data otrzymania', { exact: true }).fill('2026-10-29');
  await detail.getByRole('combobox', { name: /Metoda płatności/ }).selectOption(method);
  await detail.getByLabel('Notatka (opcjonalnie)', { exact: true }).fill(note);
  await detail.getByRole('button', { name: 'Zapisz płatność', exact: true }).click();
  await expect(detail.getByLabel('Kwota (zł)', { exact: true })).toHaveCount(0);
}

function metric(page: Page, label: string) {
  return page.locator('.client-metric').filter({ hasText: label });
}

async function assertMetrics(page: Page, received: string, remaining: string) {
  await expect(metric(page, 'WARTOŚĆ WYKONANYCH PRAC')).toContainText(/1\s?000,00\s*zł/);
  await expect(metric(page, 'OTRZYMANE PŁATNOŚCI')).toContainText(received);
  await expect(metric(page, 'POZOSTAŁO DO ZAPŁATY')).toContainText(remaining);
  await expect(metric(page, 'ŁĄCZNY CZAS PRACY')).toContainText('10:00:00');
}

test('migracja 0.1 zachowuje dane: wiele ogrodów, kilkanaście zleceń, filtry i sumy klienta', async ({ page }) => {
  const original = await seedLegacy(page);
  const migrated = await snapshot(page);
  expect(migrated.version).toBe(2);
  expect(migrated.data.clients).toHaveLength(2);
  expect(migrated.data.gardens).toHaveLength(3);
  expect(migrated.data.jobs).toHaveLength(13);
  expect(migrated.data.payments).toEqual([]);
  expect(await page.evaluate(key => localStorage.getItem(key), backupKey)).toBe(original);
  await openClient(page);
  await expect(page.getByText('600 111 222', { exact: true })).toBeVisible();
  await expect(page.locator('.client-jobs-table tbody tr')).toHaveCount(12);
  await expect(page.getByText('Nie należy do tego klienta', { exact: true })).toHaveCount(0);
  await assertMetrics(page, '0,00', '1000,00');
  await expect(page.locator('.client-jobs-table tbody tr').filter({ hasText: 'NIEROZLICZONE' })).toHaveCount(12);
  await page.getByLabel('Filtr ogrodu', { exact: true }).selectOption('legacy-garden-b');
  await expect(page.locator('.client-jobs-table tbody tr')).toHaveCount(6);
  await page.getByLabel('Filtr statusu wykonania', { exact: true }).selectOption('completed');
  await expect(page.locator('.client-jobs-table tbody tr')).toHaveCount(5);
  await page.getByLabel('Okres od', { exact: true }).fill('2026-10-04');
  await page.getByLabel('Okres do', { exact: true }).fill('2026-10-08');
  await expect(page.locator('.client-jobs-table tbody tr')).toHaveCount(3);
  await page.getByLabel('Filtr statusu płatności', { exact: true }).selectOption('paid');
  await expect(page.locator('.client-jobs-table tbody tr')).toHaveCount(0);
  await assertMetrics(page, '0,00', '1000,00');
  await page.reload();
  const restored = await snapshot(page);
  expect(restored.data.clients).toEqual(migrated.data.clients);
  expect(restored.data.gardens).toEqual(migrated.data.gardens);
  expect(restored.data.jobs).toEqual(migrated.data.jobs);
  expect(restored.data.settings.hourlyRate).toBe(135);
  expect(await page.evaluate(key => localStorage.getItem(key), backupKey)).toBe(original);
});

test('dwie części płatności, korekta z potwierdzeniem, usunięcie i trwałe saldo', async ({ page }) => {
  await seedLegacy(page);
  await openClient(page);
  const detail = await openFirstJob(page);
  await expect(detail.locator('.payment-status-line .payment-badge')).toHaveText('NIEROZLICZONE');
  await addPayment(detail, '60', 'transfer', 'Pierwsza część');
  await expect(detail.locator('.payment-status-line .payment-badge')).toHaveText('CZĘŚCIOWO ROZLICZONE');
  expect((await snapshot(page)).data.payments).toHaveLength(1);
  await addPayment(detail, '40', 'blik', 'Druga część');
  await expect(detail.locator('.payment-status-line .payment-badge')).toHaveText('ROZLICZONE');
  let stored = await snapshot(page);
  expect(stored.data.payments.map((payment: { amountCents: number }) => payment.amountCents)).toEqual([6000, 4000]);
  await detail.locator('.payment-history tbody tr').filter({ hasText: 'Pierwsza część' }).getByRole('button', { name: /Edytuj płatność/ }).click();
  await detail.getByLabel('Kwota (zł)', { exact: true }).fill('50');
  await detail.getByRole('button', { name: 'Sprawdź zmianę', exact: true }).click();
  expect((await snapshot(page)).data.payments[0].amountCents).toBe(6000);
  await detail.getByRole('button', { name: 'Potwierdź zmianę', exact: true }).click();
  await expect(detail.locator('.payment-status-line .payment-badge')).toHaveText('CZĘŚCIOWO ROZLICZONE');
  expect((await snapshot(page)).data.payments[0].amountCents).toBe(5000);
  await detail.locator('.payment-history tbody tr').filter({ hasText: 'Druga część' }).getByRole('button', { name: /Usuń płatność/ }).click();
  expect((await snapshot(page)).data.payments).toHaveLength(2);
  await detail.getByRole('button', { name: 'Potwierdź usunięcie', exact: true }).click();
  stored = await snapshot(page);
  expect(stored.data.payments).toHaveLength(1);
  expect(stored.data.payments[0]).toMatchObject({ amountCents: 5000, method: 'transfer', receivedDate: '2026-10-29', note: 'Pierwsza część' });
  await detail.getByRole('button', { name: 'Zamknij okno', exact: true }).click();
  await assertMetrics(page, '50,00', '950,00');
  await page.reload();
  await openClient(page);
  await assertMetrics(page, '50,00', '950,00');
  expect((await snapshot(page)).data.payments).toEqual(stored.data.payments);
  await navigate(page, 'Panel główny');
  await expect(page.getByTestId('dashboard-received')).toContainText('50,00');
  // Includes this client's 950 zł and the other client's independent 9999 zł.
  await expect(page.getByTestId('dashboard-outstanding')).toContainText(/10\s?949,00/);
});

test('ujemna płatność i nadpłata są blokowane, zakończenie nie oznacza zapłaty', async ({ page }) => {
  await seedLegacy(page);
  await openClient(page);
  const detail = await openFirstJob(page);
  await detail.getByRole('button', { name: 'Dodaj płatność', exact: true }).click();
  const amount = detail.getByLabel('Kwota (zł)', { exact: true });
  await amount.fill('-1');
  expect(await amount.evaluate(input => (input as HTMLInputElement).validity.rangeUnderflow)).toBe(true);
  await detail.getByRole('button', { name: 'Zapisz płatność', exact: true }).click();
  expect((await snapshot(page)).data.payments).toEqual([]);
  await expect(amount).toBeVisible();
  await amount.fill('100.01');
  expect(await amount.evaluate(input => (input as HTMLInputElement).validity.rangeOverflow)).toBe(true);
  await detail.getByRole('button', { name: 'Zapisz płatność', exact: true }).click();
  expect((await snapshot(page)).data.payments).toEqual([]);
  await expect(amount).toBeVisible();
  await detail.getByRole('button', { name: 'Anuluj', exact: true }).click();
  await detail.getByRole('button', { name: 'Zamknij okno', exact: true }).click();
  await navigate(page, 'Zlecenia');
  const planned = page.locator('article.job-card').filter({ has: page.getByRole('heading', { name: 'Archiwalna praca 11', exact: true }) });
  await planned.getByRole('button', { name: 'Zakończ', exact: true }).click();
  expect((await snapshot(page)).data.payments).toEqual([]);
  await navigate(page, 'Historia prac');
  const completed = page.locator('article.job-card').filter({ has: page.getByRole('heading', { name: 'Archiwalna praca 11', exact: true }) });
  await expect(completed.locator('.payment-badge')).toHaveText('NIEROZLICZONE');
  await expect(completed).toContainText('Zakończone');
});

test('migracja zachowuje aktywny stoper oraz klienta i płatności na telefonie', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const data = legacyFixture();
  data.jobs[10].status = 'in-progress';
  data.timer = { jobId: 'legacy-job-11', startedAt: new Date('2026-10-29T09:59:00+01:00').getTime() };
  const original = await seedLegacy(page, data);
  await expect(page.getByTestId('timer-display')).toHaveText('00:01:00');
  await page.reload();
  await expect(page.getByTestId('timer-display')).toHaveText(/00:01:0[0-4]/);
  await page.getByRole('button', { name: 'STOP — zatrzymaj pomiar', exact: true }).click();
  expect((await snapshot(page)).data.timer).toBeNull();
  expect(await page.evaluate(key => localStorage.getItem(key), backupKey)).toBe(original);
  await page.getByRole('navigation', { name: 'Nawigacja mobilna' }).getByRole('button', { name: 'Klienci', exact: true }).click();
  await page.getByRole('button', { name: clientName, exact: true }).click();
  const noOverflow = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await noOverflow();
  const detail = await openFirstJob(page);
  await addPayment(detail, '25.01', 'cash', 'Płatność na telefonie');
  await noOverflow();
  await detail.getByRole('button', { name: 'Zamknij okno', exact: true }).click();
  await page.reload();
  expect((await snapshot(page)).data.payments[0].amountCents).toBe(2501);
  expect((await snapshot(page)).data.jobs).toHaveLength(13);
});


test('zaliczka za zaplanowane zlecenie jest wpływem, nie wartością wykonanych prac ani spłatą innych zleceń', async ({ page }) => {
  await seedLegacy(page);
  await openClient(page);
  await page.getByRole('button', { name: 'Szczegóły zlecenia Archiwalna praca 11', exact: true }).click();
  const detail = page.getByRole('dialog', { name: 'Szczegóły zlecenia', exact: true });
  await expect(detail).toContainText('Zaplanowane');
  await addPayment(detail, '200', 'transfer', 'Zaliczka na planowaną pracę');
  await expect(detail.locator('.payment-status-line .payment-badge')).toHaveText('CZĘŚCIOWO ROZLICZONE');
  await expect(detail.getByTestId('payment-job-paid')).toHaveText(/200,00\s*zł/);
  await expect(detail.getByTestId('payment-job-remaining')).toHaveText(/800,00\s*zł/);
  await detail.getByRole('button', { name: 'Zamknij okno', exact: true }).click();
  await assertMetrics(page, '200,00', '1000,00');
  await navigate(page, 'Panel główny');
  await expect(page.getByTestId('dashboard-received')).toContainText('200,00');
  await expect(page.getByTestId('dashboard-outstanding')).toContainText(/10\s?999,00/);
  const stored = await snapshot(page);
  expect(stored.data.payments).toHaveLength(1);
  expect(stored.data.jobs.find((job: { id: string }) => job.id === 'legacy-job-11').status).toBe('planned');
});

test('korekta z nieaktualnej karty nie odtwarza płatności usuniętej w drugiej karcie', async ({ page }) => {
  await seedLegacy(page);
  await openClient(page);
  const detail = await openFirstJob(page);
  await addPayment(detail, '60', 'transfer', 'Wpis do kontroli konfliktu');
  await detail.locator('.payment-history tbody tr').filter({ hasText: 'Wpis do kontroli konfliktu' }).getByRole('button', { name: /Edytuj płatność/ }).click();
  await detail.getByLabel('Kwota (zł)', { exact: true }).fill('50');

  // Both tabs share the same origin/storage, but the first retains its original edit snapshot.
  const otherPage = await page.context().newPage();
  const otherErrors: string[] = [];
  otherPage.on('pageerror', error => otherErrors.push(error.message));
  await otherPage.goto('/');
  await openClient(otherPage);
  const otherDetail = await openFirstJob(otherPage);
  await otherDetail.locator('.payment-history tbody tr').filter({ hasText: 'Wpis do kontroli konfliktu' }).getByRole('button', { name: /Usuń płatność/ }).click();
  await otherDetail.getByRole('button', { name: 'Potwierdź usunięcie', exact: true }).click();
  expect((await snapshot(otherPage)).data.payments).toEqual([]);

  await detail.getByRole('button', { name: 'Sprawdź zmianę', exact: true }).click();
  await detail.getByRole('button', { name: 'Potwierdź zmianę', exact: true }).click();
  await expect(detail.getByRole('alert')).toContainText('Płatność została zmieniona lub usunięta w innej karcie');
  expect((await snapshot(page)).data.payments).toEqual([]);
  await detail.getByRole('button', { name: 'Zamknij okno', exact: true }).click();
  await assertMetrics(page, '0,00', '1000,00');
  await page.reload();
  expect((await snapshot(page)).data.payments).toEqual([]);
  expect(otherErrors).toEqual([]);
  await otherPage.close();
});
