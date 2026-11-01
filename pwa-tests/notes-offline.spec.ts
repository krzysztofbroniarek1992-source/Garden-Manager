import { test, expect } from '@playwright/test';
import type { Data } from '../src/domain';

test('notatki, zdjęcia, odroczenia i sprawy działają offline wraz z pełną kopią ZIP', async ({
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
  const nav = page.getByRole('navigation', { name: 'Nawigacja główna' });
  const snapshot = (): Promise<Data> =>
    page.evaluate(
      () => JSON.parse(localStorage.getItem('garden-manager:v1')!).data,
    );
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
  await nav
    .getByRole('button', { name: 'Obiekty i ogrody', exact: true })
    .click();
  await page
    .getByRole('button', {
      name: 'Karta ogrodu Ogród przy Lipowej',
      exact: true,
    })
    .click();
  const card = page.getByRole('dialog', {
      name: 'Karta ogrodu: Ogród przy Lipowej',
      exact: true,
    }),
    gallery = card.getByRole('region', {
      name: 'Galeria i historia ogrodu',
      exact: true,
    });
  await card.getByRole('tab',{name:'Galeria',exact:true}).click();
  await gallery
    .getByRole('button', { name: 'Dodaj zdjęcia', exact: true })
    .click();
  await gallery
    .getByLabel('Zdjęcia z urządzenia', { exact: true })
    .setInputFiles({
      name: 'notatka-offline.png',
      mimeType: 'image/png',
      buffer: Buffer.from(bytes),
    });
  await gallery
    .getByRole('button', { name: 'Zapisz zdjęcia', exact: true })
    .click();
  await expect(gallery.locator('.photo-card img')).toBeVisible();
  await gallery
    .getByRole('button', {
      name: 'Notatka do zdjęcia notatka-offline.png',
      exact: true,
    })
    .click();
  let form = page.getByRole('dialog', { name: 'Nowa notatka', exact: true });
  await form
    .getByLabel('Tytuł notatki', { exact: true })
    .fill('Obserwacja offline');
  await form
    .getByRole('checkbox', {
      name: 'Dodaj przypomnienie do notatki',
      exact: true,
    })
    .check();
  await form
    .getByLabel('Data przypomnienia', { exact: true })
    .fill('2026-11-02');
  await form
    .getByRole('button', { name: 'Zapisz notatkę', exact: true })
    .click();
  await card.getByRole('button', { name: 'Zamknij okno', exact: true }).click();
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('.connection')).toHaveText('Tryb offline');
  await nav.getByRole('button', { name: 'Notatki', exact: true }).click();
  await page
    .locator('.desk-card')
    .getByRole('button', { name: 'Obserwacja offline', exact: true })
    .click();
  let detail = page.getByRole('dialog', {
    name: 'Szczegóły notatki',
    exact: true,
  });
  await expect(detail.locator('.desk-linked-photo img')).toBeVisible();
  await detail
    .getByRole('button', { name: 'Odrocz przypomnienie', exact: true })
    .click();
  await detail
    .getByLabel('Nowa data przypomnienia', { exact: true })
    .fill('2026-11-05');
  await detail
    .getByRole('button', { name: 'Zapisz odroczenie', exact: true })
    .click();
  await detail
    .getByRole('button', { name: 'Zamknij okno', exact: true })
    .click();
  await nav.getByRole('button', { name: 'Do zrobienia', exact: true }).click();
  await page.getByRole('button', { name: 'Dodaj sprawę', exact: true }).click();
  form = page.getByRole('dialog', {
    name: 'Nowa sprawa do załatwienia',
    exact: true,
  });
  await form
    .getByLabel('Tytuł sprawy', { exact: true })
    .fill('Kontakt offline');
  await form
    .getByRole('button', { name: 'Zapisz sprawę', exact: true })
    .click();
  await page
    .getByRole('button', {
      name: 'Wykonaj sprawę Kontakt offline',
      exact: true,
    })
    .click();
  const original = await snapshot();
  expect(original.notes[0].reminder?.date).toBe('2026-11-05');
  expect(original.todos[0].status).toBe('completed');
  await page
    .getByRole('button', {
      name: 'Ustawienia konta demonstracyjnego',
      exact: true,
    })
    .click();
  const settings = page.getByRole('dialog', {
    name: 'Ustawienia',
    exact: true,
  });
  const event = page.waitForEvent('download');
  await settings
    .getByRole('button', { name: 'Pobierz pełną kopię ZIP', exact: true })
    .click();
  const stream = await (await event).createReadStream(),
    chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  await settings
    .getByRole('button', { name: 'Zamknij okno', exact: true })
    .click();
  await nav.getByRole('button', { name: 'Notatki', exact: true }).click();
  await page
    .locator('.desk-card')
    .getByRole('button', { name: 'Obserwacja offline', exact: true })
    .click();
  detail = page.getByRole('dialog', { name: 'Szczegóły notatki', exact: true });
  await detail
    .getByRole('button', { name: 'Usuń notatkę', exact: true })
    .click();
  await detail
    .getByRole('button', { name: 'Potwierdź usunięcie wpisu', exact: true })
    .click();
  await page
    .getByRole('button', {
      name: 'Ustawienia konta demonstracyjnego',
      exact: true,
    })
    .click();
  await settings
    .getByLabel('Wczytaj pełną kopię ZIP', { exact: true })
    .setInputFiles({
      name: 'notatki.zip',
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
  const restored = await snapshot();
  expect(restored.notes).toEqual(original.notes);
  expect(restored.todos).toEqual(original.todos);
  expect(restored.jobs).toEqual(original.jobs);
  expect(restored.payments).toEqual(original.payments);
  await nav.getByRole('button', { name: 'Notatki', exact: true }).click();
  await page
    .locator('.desk-card')
    .getByRole('button', { name: 'Obserwacja offline', exact: true })
    .click();
  await expect(
    page
      .getByRole('dialog', { name: 'Szczegóły notatki', exact: true })
      .locator('.desk-linked-photo img'),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
