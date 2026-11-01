import { test, expect } from '@playwright/test';

test('karty klienta i ogrodu otwierane pierwszy raz offline zapisują zlecenie i zachowują dane po odświeżeniu', async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller?.state))
    .toBe('activated');
  const before = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('garden-manager:v1')!),
  );
  await context.setOffline(true);
  await page.goto('/#clients');
  await page
    .getByRole('button', { name: before.data.clients[0].name, exact: true })
    .click();
  await page
    .getByRole('button', {
      name: `Otwórz ogród ${before.data.gardens[0].name}`,
      exact: true,
    })
    .click();
  const card = page.getByRole('dialog', {
    name: `Karta ogrodu: ${before.data.gardens[0].name}`,
    exact: true,
  });
  await card
    .getByRole('button', { name: 'Dodaj zlecenie', exact: true })
    .click();
  const form = page.getByRole('dialog', { name: 'Nowe zlecenie', exact: true });
  await expect(
    form.getByRole('combobox', { name: 'Klient', exact: true }),
  ).toHaveValue(before.data.clients[0].id);
  await expect(
    form.getByRole('combobox', { name: 'Ogród i klient', exact: true }),
  ).toHaveValue(before.data.gardens[0].id);
  await form
    .getByLabel('Nazwa pracy', { exact: true })
    .fill('Wizyta dodana offline z ogrodu');
  await form
    .getByRole('button', { name: 'Zapisz zlecenie', exact: true })
    .click();
  const visit = page.getByRole('dialog', {
    name: 'Szczegóły zlecenia',
    exact: true,
  });
  await expect(
    visit.getByRole('heading', {
      name: 'Wizyta dodana offline z ogrodu',
      exact: true,
    }),
  ).toBeVisible();
  await visit
    .getByRole('button', {
      name: `Ogród: ${before.data.gardens[0].name}`,
      exact: true,
    })
    .click();
  await expect(
    card.getByRole('tab', { name: 'Zlecenia i historia prac', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  await card
    .getByRole('button', {
      name: `Klient: ${before.data.clients[0].name}`,
      exact: true,
    })
    .click();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('garden-manager:v1')!),
  );
  expect(saved.version).toBe(before.version);
  expect(saved.data.timer).toEqual(before.data.timer);
  expect(saved.data.payments).toEqual(before.data.payments);
  expect(saved.data.jobs.slice(0, -1)).toEqual(before.data.jobs);
  expect(saved.data.jobs.at(-1).gardenId).toBe(before.data.gardens[0].id);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('.connection')).toHaveText('Tryb offline');
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem('garden-manager:v1')!),
    ),
  ).toEqual(saved);
  expect(errors).toEqual([]);
});
