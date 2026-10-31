import { test, expect } from '@playwright/test';

test('karta klienta: wspólne formularze i ograniczenie ogrodów do klienta', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Nawigacja główna' }).getByRole('button', { name: /^Klienci/ }).click();
  await page.locator('.client-name-button').first().click();
  await page.getByRole('button', { name: 'Edytuj klienta', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Edytuj klienta' })).toBeVisible();
  await page.getByRole('button', { name: 'Anuluj', exact: true }).click();
  await page.getByRole('button', { name: 'Dodaj ogród', exact: true }).click();
  const garden = page.getByRole('dialog', { name: 'Nowy ogród' });
  const owner = await garden.getByLabel('Klient *').inputValue();
  await garden.getByLabel('Nazwa ogrodu').fill('Ogród z karty');
  await garden.getByLabel('Adres *').fill('Testowa 1');
  await garden.getByRole('button', { name: 'Dodaj ogród', exact: true }).click();
  await expect(page.locator('.client-garden').filter({ hasText: 'Ogród z karty' })).toBeVisible();
  await page.getByRole('button', { name: 'Nowe zlecenie', exact: true }).click();
  const job = page.getByRole('dialog', { name: 'Nowe zlecenie' });
  await expect(job.getByRole('combobox', { name: 'Klient', exact: true })).toHaveValue(owner);
  await expect(job.getByLabel('Ogród i klient').locator('option')).toContainText(['Wybierz ogród']);
  await job.getByRole('button', { name: 'Anuluj', exact: true }).click();
  const created = page.locator('.client-garden').filter({ hasText: 'Ogród z karty' });
  await created.getByRole('button', { name: 'Edytuj ogród' }).click();
  await page.getByRole('dialog', { name: 'Edytuj ogród' }).getByLabel('Adres *').fill('Zmieniona 2');
  await page.getByRole('button', { name: 'Zapisz zmiany', exact: true }).click();
  await expect(created).toContainText('Zmieniona 2');
});

test('kalendarz: wybrana data i wspólna karta nowego zlecenia', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Nawigacja główna' }).getByRole('button', { name: /^Kalendarz/ }).click();
  await page.getByRole('button', { name: 'Następny miesiąc' }).click();
  await page.locator('.calendar-day:not(.outside)').nth(9).click();
  await page.getByRole('button', { name: '+ Nowe zlecenie na ten dzień', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Nowe zlecenie' });
  const date = await form.getByLabel('Data', { exact: true }).inputValue();
  expect(date.endsWith('-10')).toBeTruthy();
  await form.getByLabel('Nazwa pracy').fill('Wizyta z kalendarza');
  await form.getByRole('button', { name: 'Zapisz zlecenie' }).click();
  const card = page.getByRole('dialog', { name: 'Szczegóły zlecenia', exact: true });
  await expect(card.getByRole('button', { name: 'Edytuj zlecenie' })).toBeVisible();
  await card.getByRole('button', { name: 'Zamknij okno' }).click();
  await page.locator('.calendar-agenda').getByRole('button', { name: 'Wizyta z kalendarza', exact: true }).click();
  await expect(card).toBeVisible();
});
