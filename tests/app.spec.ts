import { closeOpenDialogs } from './navigation-helpers';
import { test as base, expect, type Page } from '@playwright/test';

const test = base.extend<{ browserErrors: string[] }>({
  browserErrors: [async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await use(errors);
    expect(errors, 'Nieoczekiwane błędy JavaScript w przeglądarce').toEqual([]);
  }, { auto: true }],
});

async function navigate(page: Page, name: string) {
  await closeOpenDialogs(page);
  await page.getByRole('navigation', { name: 'Nawigacja główna' }).getByRole('button', { name: new RegExp(`^${name}`) }).click();
}
async function readData(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('garden-manager:v1')!).data);
}
async function addClient(page: Page, name: string) {
  await page.getByRole('button', { name: 'Dodaj klienta', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Nowy klient' });
  await dialog.getByLabel('Imię i nazwisko / nazwa firmy').fill(name);
  await dialog.getByLabel('Telefon', { exact: true }).fill('600 123 456');
  await dialog.getByLabel('Adres e-mail').fill('test@example.com');
  await dialog.getByRole('button', { name: 'Dodaj klienta', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}
async function addGarden(page: Page, name: string, client: string) {
  await page.getByRole('button', { name: 'Dodaj ogród', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Nowy ogród' });
  await dialog.getByLabel('Nazwa ogrodu').fill(name);
  await dialog.getByLabel('Klient', { exact: false }).selectOption({ label: client });
  await dialog.getByLabel('Adres', { exact: false }).fill('ul. Testowa 10, Warszawa');
  await dialog.getByLabel('Powierzchnia').fill('120');
  await dialog.getByRole('button', { name: 'Dodaj ogród', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

test('klienci i wiele ogrodów: tworzenie, edycja, trwałość i bezpieczne usuwanie', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('DEMO · DANE TESTOWE', { exact: true })).toBeVisible();
  await navigate(page, 'Klienci');
  await addClient(page, 'Klient testowy E2E');
  await page.getByRole('button', { name: 'Edytuj klienta Klient testowy E2E', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Edytuj klienta' });
  await dialog.getByLabel('Imię i nazwisko / nazwa firmy').fill('Klient E2E po edycji');
  await dialog.getByRole('button', { name: 'Zapisz zmiany' }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Klient E2E po edycji', exact: true })).toBeVisible();
  await navigate(page, 'Obiekty i ogrody');
  await addGarden(page, 'Pierwszy ogród E2E', 'Klient E2E po edycji');
  await addGarden(page, 'Drugi ogród E2E', 'Klient E2E po edycji');
  await page.getByRole('button', { name: 'Edytuj ogród Pierwszy ogród E2E', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Edytuj ogród' });
  await dialog.getByLabel('Powierzchnia').fill('250');
  await dialog.getByRole('button', { name: 'Zapisz zmiany' }).click();
  await page.reload();
  const garden = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Pierwszy ogród E2E' }) });
  await expect(garden).toContainText('250');
  await expect(garden).toContainText('Klient E2E po edycji');
  await navigate(page, 'Klienci');
  const clientCard = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Klient E2E po edycji' }) });
  await expect(clientCard).toContainText('2 ogrody');
  await page.getByRole('button', { name: 'Usuń klienta Klient E2E po edycji', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Usunąć klienta?' });
  await dialog.getByRole('button', { name: 'Usuń klienta', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Klient ma przypisane ogrody');
  await dialog.getByRole('button', { name: 'Anuluj' }).click();
  await navigate(page, 'Obiekty i ogrody');
  for (const name of ['Pierwszy ogród E2E', 'Drugi ogród E2E']) {
    await page.getByRole('button', { name: `Usuń ogród ${name}`, exact: true }).click();
    await page.getByRole('dialog', { name: 'Usunąć ogród?' }).getByRole('button', { name: 'Usuń ogród', exact: true }).click();
    await expect(page.getByRole('heading', { name, exact: true })).toHaveCount(0);
  }
  await navigate(page, 'Klienci');
  await page.getByRole('button', { name: 'Usuń klienta Klient E2E po edycji', exact: true }).click();
  await page.getByRole('dialog', { name: 'Usunąć klienta?' }).getByRole('button', { name: 'Usuń klienta', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Klient E2E po edycji', exact: true })).toHaveCount(0);
});

test('zlecenie ryczałtowe, materiały, kalendarz, edycja i historia', async ({ page }) => {
  await page.goto('/');
  await navigate(page, 'Zlecenia');
  await page.getByRole('button', { name: 'Nowe zlecenie', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Nowe zlecenie' });
  await dialog.getByLabel('Nazwa pracy').fill('Ryczałt z materiałami E2E');
  await dialog.getByLabel('Sposób rozliczenia').selectOption('fixed');
  await dialog.getByLabel('Kwota ryczałtu').fill('500');
  await dialog.getByRole('button', { name: 'Dodaj', exact: true }).click();
  await dialog.getByLabel('Nazwa materiału 1', { exact: true }).fill('Nawóz testowy');
  await dialog.getByLabel('Ilość materiału 1', { exact: true }).fill('2');
  await dialog.getByLabel('Cena materiału 1', { exact: true }).fill('25');
  await expect(dialog.locator('.materials-total')).toContainText(/50,00\s*zł/);
  await dialog.getByRole('button', { name: 'Zapisz zlecenie' }).click();
  const job = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Ryczałt z materiałami E2E', exact: true }) });
  await expect(job.locator('.job-amount strong')).toHaveText(/550,00\s*zł/);
  await page.reload();
  await expect(job).toBeVisible();
  await navigate(page, 'Kalendarz');
  await expect(page.locator('.calendar-agenda').getByRole('heading', { name: 'Ryczałt z materiałami E2E', exact: true })).toBeVisible();
  await navigate(page, 'Zlecenia');
  await job.getByRole('button', { name: 'Edytuj Ryczałt z materiałami E2E', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Szczegóły zlecenia', exact: true });
  await dialog.getByRole('button', { name: 'Edytuj zlecenie', exact: true }).click();
  await dialog.getByLabel('Kwota ryczałtu').fill('600');
  await dialog.getByRole('button', { name: 'Zapisz zlecenie' }).click();
  await dialog.getByRole('button', { name: 'Zamknij okno', exact: true }).click();
  await expect(job.locator('.job-amount strong')).toHaveText(/650,00\s*zł/);
  await job.getByRole('button', { name: 'Zakończ', exact: true }).click();
  await expect(job).toHaveCount(0);
  const pricing = page.getByRole('dialog', { name: 'Szczegóły zlecenia', exact: true });
  await expect(pricing.getByTestId('proposal-calculated-labor')).toHaveText(/600,00\s*zł/);
  await expect(pricing.getByTestId('proposal-final-total')).toHaveText(/650,00\s*zł/);
  await pricing.getByRole('button', { name: 'Zatwierdź cenę robocizny', exact: true }).click();
  await pricing.getByRole('button', { name: 'Zamknij okno', exact: true }).click();
  await navigate(page, 'Historia prac');
  await expect(job).toBeVisible();
  await expect(job).toContainText('Zakończone');
  await expect(job.locator('.job-amount strong')).toHaveText(/650,00\s*zł/);
  await page.reload();
  await expect(job).toBeVisible();
});

test('stoper kontynuuje po odświeżeniu i zapisuje rozliczenie godzinowe po STOP', async ({ page }) => {
  const start = new Date('2026-11-03T09:00:00+01:00');
  // Keep Date deterministic while intervals/rendering still run under browser load.
  await page.clock.setFixedTime(start);
  await page.goto('/');
  await page.getByLabel('ZLECENIE DO REALIZACJI', { exact: true }).selectOption('job-1');
  await page.getByRole('button', { name: 'START — Rozpocznij wizytę', exact: true }).click();
  await page.clock.setFixedTime(new Date(start.getTime() + 65_000));
  await expect(page.getByTestId('timer-display')).toHaveText('00:01:05');
  const running = await readData(page);
  expect(running.timer.jobId).toBe('job-1');
  await page.reload();
  await expect(page.getByRole('button', { name: 'STOP — Zakończ pomiar', exact: true })).toBeVisible();
  await expect(page.getByTestId('timer-display')).toHaveText(/00:01:0[5-9]/);
  await page.getByRole('button', { name: 'STOP — Zakończ pomiar', exact: true }).click();
  const stopped = await readData(page);
  expect(stopped.timer).toBeNull();
  const job = stopped.jobs.find((item: { id: string }) => item.id === 'job-1');
  expect(job.seconds).toBeGreaterThanOrEqual(65);
  expect(job.seconds).toBeLessThan(70);
  expect(job.rate).toBe(120);
  const displayed = await page.getByTestId('timer-display').textContent();
  await page.clock.setFixedTime(new Date(start.getTime() + 75_000));
  await expect(page.getByTestId('timer-display')).toHaveText(displayed!);
  await page.reload();
  await expect(page.getByTestId('timer-display')).toHaveText(displayed!);
  await navigate(page, 'Zlecenia');
  const jobCard = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Pielęgnacja ogrodu', exact: true }) });
  const expectedAmount = (job.seconds / 3600 * 120).toLocaleString('pl-PL', { style: 'currency', currency: 'PLN' });
  await expect(jobCard.locator('.job-amount strong')).toHaveText(expectedAmount);
  // A resumed timer for another job must keep that job selected after STOP.
  await navigate(page, 'Panel główny');
  await page.getByLabel('ZLECENIE DO REALIZACJI', { exact: true }).selectOption('job-3');
  await page.getByRole('button', { name: 'START — Rozpocznij wizytę', exact: true }).click();
  await page.clock.setFixedTime(new Date(start.getTime() + 105_000));
  await page.reload();
  await page.getByRole('button', { name: 'STOP — Zakończ pomiar', exact: true }).click();
  await expect(page.getByLabel('ZLECENIE DO REALIZACJI', { exact: true })).toHaveValue('job-3');
  await expect(page.getByTestId('timer-display')).toHaveText(/00:00:3[0-4]/);
});

test('domyślna stawka jest trwała i dotyczy nowych zleceń', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Ustawienia konta demonstracyjnego', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Ustawienia', exact: true });
  await settings.getByLabel('Domyślna stawka godzinowa').fill('150');
  await settings.getByRole('button', { name: 'Zapisz ustawienia' }).click();
  await expect(settings.getByRole('status')).toContainText('Zapisano');
  await page.keyboard.press('Escape');
  await page.reload();
  await navigate(page, 'Zlecenia');
  await page.getByRole('button', { name: 'Nowe zlecenie', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Nowe zlecenie' });
  await expect(dialog.getByLabel('Stawka (zł/h)')).toHaveValue('150');
  await dialog.getByLabel('Nazwa pracy').fill('Godzinowe ze zmienioną stawką');
  await dialog.getByRole('button', { name: 'Zapisz zlecenie' }).click();
  const stored = await readData(page);
  expect(stored.jobs.find((item: {title:string}) => item.title === 'Godzinowe ze zmienioną stawką').rate).toBe(150);
  expect(stored.jobs.find((item: {id:string}) => item.id === 'job-1').rate).toBe(120);
});

test('telefon: dolna nawigacja, formularz klienta i brak przewijania w poziomie', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const mobileNav = page.getByRole('navigation', { name: 'Nawigacja mobilna' });
  await expect(mobileNav).toBeVisible();
  await expect(page.locator('.sidebar')).toBeHidden();
  const noOverflow = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await noOverflow();
  await mobileNav.getByRole('button', { name: 'Klienci', exact: true }).click();
  await addClient(page, 'Klient mobilny E2E');
  await expect(page.getByRole('heading', { name: 'Klient mobilny E2E', exact: true })).toBeVisible();
  await noOverflow();
  await mobileNav.getByRole('button', { name: 'Ogrody', exact: true }).click();
  await noOverflow();
  await mobileNav.getByRole('button', { name: 'Zlecenia', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Zlecenia', exact: true })).toBeVisible();
  await noOverflow();
  await mobileNav.getByRole('button', { name: 'Kalendarz', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Kalendarz prac', exact: true })).toBeVisible();
  await noOverflow();
  await mobileNav.getByRole('button', { name: 'Więcej', exact: true }).click();
  await page.locator('.mobile-more').getByRole('button', { name: 'Historia prac', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Historia zleceń', exact: true })).toBeVisible();
  await noOverflow();
});
