import { closeOpenDialogs } from '../tests/navigation-helpers';
import { test, expect } from '@playwright/test';
import type { Data } from '../src/domain';

test('checklisty i biblioteka otwierają się po raz pierwszy offline, zapisują postęp i odtwarzają pełny ZIP', async ({
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
  const nav = page.getByRole('navigation', { name: 'Nawigacja główna' }),
    snapshot = (): Promise<Data> =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('garden-manager:v1')!).data,
      );
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await closeOpenDialogs(page);
  await expect(page.locator('.connection')).toHaveText('Tryb offline');
  await nav.getByRole('button', { name: 'Szablony prac', exact: true }).click();
  await expect(page.locator('.work-template-card')).toHaveCount(4);
  await page
    .getByRole('button', { name: 'Dodaj szablon', exact: true })
    .click();
  const form = page.getByRole('dialog', {
    name: 'Nowy szablon prac',
    exact: true,
  });
  await form
    .getByLabel('Nazwa szablonu', { exact: true })
    .fill('Standard offline');
  await form.getByLabel('Czynność 1', { exact: true }).fill('Kontrola offline');
  await form
    .getByRole('button', { name: 'Dodaj czynność szablonu', exact: true })
    .click();
  await form
    .getByLabel('Czynność 2', { exact: true })
    .fill('Sprzątanie offline');
  await form
    .getByRole('button', { name: 'Zapisz szablon', exact: true })
    .click();
  const template = (await snapshot()).workTemplates.find(
    (t) => t.name === 'Standard offline',
  )!;
  await nav.getByRole('button', { name: /^Zlecenia/ }).click();
  await page
    .locator('.job-title-button')
    .filter({ hasText: 'Pielęgnacja ogrodu' })
    .click();
  let detail = page.getByRole('dialog', {
      name: 'Szczegóły zlecenia',
      exact: true,
    }),
    panel = detail.getByRole('region', {
      name: 'Checklisty wizyty',
      exact: true,
    });
  await panel
    .getByRole('combobox', { name: 'Szablon do zastosowania', exact: true })
    .selectOption(template.id);
  await panel
    .getByRole('button', { name: 'Zastosuj szablon', exact: true })
    .click();
  let checklist = page.getByRole('dialog', {
    name: 'Checklista: Standard offline',
    exact: true,
  });
  await checklist
    .getByRole('checkbox', { name: 'Wykonano: Kontrola offline', exact: true })
    .check();
  await checklist
    .getByLabel('Uwagi: Kontrola offline', { exact: true })
    .fill('Wykonano bez internetu');
  await checklist
    .getByRole('combobox', { name: 'Status: Sprzątanie offline', exact: true })
    .selectOption('not-applicable');
  await expect(checklist.locator('.checklist-progress strong')).toHaveText(
    '100%',
  );
  await checklist
    .getByRole('button', { name: 'Zamknij okno', exact: true })
    .click();
  const gallery = detail.getByRole('region', {
    name: 'Galeria zlecenia i wizyty',
    exact: true,
  });
  const bytes = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 80;
    c.height = 60;
    c.getContext('2d')!.fillRect(0, 0, 80, 60);
    const b = await new Promise<Blob>((r) =>
      c.toBlob((b) => r(b!), 'image/png'),
    );
    return [...new Uint8Array(await b.arrayBuffer())];
  });
  await gallery
    .getByRole('button', { name: 'Dodaj zdjęcia', exact: true })
    .click();
  await gallery
    .getByLabel('Zdjęcia z urządzenia', { exact: true })
    .setInputFiles({
      name: 'checklista-offline.png',
      mimeType: 'image/png',
      buffer: Buffer.from(bytes),
    });
  await gallery
    .getByRole('button', { name: 'Zapisz zdjęcia', exact: true })
    .click();
  await expect(gallery.locator('.photo-card img')).toBeVisible();
  const photo = (await snapshot()).photos[0];
  await panel
    .getByRole('button', { name: 'Standard offline', exact: true })
    .click();
  checklist = page.getByRole('dialog', {
    name: 'Checklista: Standard offline',
    exact: true,
  });
  await checklist
    .locator('.checklist-item')
    .first()
    .getByText('Edytuj czynność, kolejność i zdjęcie', { exact: true })
    .click();
  await checklist
    .getByRole('combobox', { name: 'Zdjęcie: Kontrola offline', exact: true })
    .selectOption(photo.id);
  await expect(checklist.locator('.checklist-photo img')).toBeVisible();
  const original = await snapshot();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await closeOpenDialogs(page);
  await page
    .locator('.job-title-button')
    .filter({ hasText: 'Pielęgnacja ogrodu' })
    .click();
  detail = page.getByRole('dialog', {
    name: 'Szczegóły zlecenia',
    exact: true,
  });
  panel = detail.getByRole('region', {
    name: 'Checklisty wizyty',
    exact: true,
  });
  await expect(panel.locator('.checklist-summary')).toHaveCount(1);
  await expect(panel.locator('.checklist-progress strong')).toHaveText('100%');
  await detail
    .getByRole('button', { name: 'Zamknij okno', exact: true })
    .click();
  await page
    .getByRole('button', {
      name: 'Ustawienia konta demonstracyjnego',
      exact: true,
    })
    .click();
  const settings = page.getByRole('dialog', {
      name: 'Ustawienia',
      exact: true,
    }),
    event = page.waitForEvent('download');
  await settings
    .getByRole('button', { name: 'Pobierz pełną kopię ZIP', exact: true })
    .click();
  const stream = await (await event).createReadStream(),
    chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  await settings
    .getByLabel('Wczytaj pełną kopię ZIP', { exact: true })
    .setInputFiles({
      name: 'checklists-offline.zip',
      mimeType: 'application/zip',
      buffer: Buffer.concat(chunks),
    });
  await settings
    .getByRole('checkbox', {
      name: 'Rozumiem, że bieżący zestaw zostanie zastąpiony.',
      exact: true,
    })
    .check();
  await settings.getByLabel('Wpisz ODTWÓRZ', { exact: true }).fill('ODTWÓRZ');
  await settings
    .getByRole('button', { name: 'Odtwórz dane i zdjęcia', exact: true })
    .click();
  await expect(
    settings.getByText(/Dane i zdjęcia zostały odtworzone/).last(),
  ).toBeVisible();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await closeOpenDialogs(page);
  const restored = await snapshot();
  expect(restored.checklists).toEqual(original.checklists);
  expect(restored.workTemplates).toEqual(original.workTemplates);
  expect(restored.jobs).toEqual(original.jobs);
  expect(restored.payments).toEqual(original.payments);
  expect(restored.timer).toEqual(original.timer);
  await page
    .locator('.job-title-button')
    .filter({ hasText: 'Pielęgnacja ogrodu' })
    .click();
  detail = page.getByRole('dialog', {
    name: 'Szczegóły zlecenia',
    exact: true,
  });
  await detail
    .getByRole('region', { name: 'Checklisty wizyty', exact: true })
    .getByRole('button', { name: 'Standard offline', exact: true })
    .click();
  checklist = page.getByRole('dialog', {
    name: 'Checklista: Standard offline',
    exact: true,
  });
  await checklist
    .locator('.checklist-item')
    .first()
    .getByText('Edytuj czynność, kolejność i zdjęcie', { exact: true })
    .click();
  await expect(checklist.locator('.checklist-photo img')).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem('garden-manager:v1')),
  ).not.toMatch(/base64|data:image/);
  expect(errors).toEqual([]);
});
