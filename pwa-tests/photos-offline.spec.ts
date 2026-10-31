import { test, expect } from '@playwright/test';

test('zdjęcia, miniatury i pełna kopia ZIP działają offline oraz po odtworzeniu', async ({ page, context }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/'); await page.evaluate(async () => { await navigator.serviceWorker.ready; }); await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.state)).toBe('activated');
  const bytes = await page.evaluate(async () => { const canvas = document.createElement('canvas'); canvas.width = 100; canvas.height = 80; const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#448855'; ctx.fillRect(0,0,100,80); const blob = await new Promise<Blob>(resolve => canvas.toBlob(b => resolve(b!), 'image/png')); return Array.from(new Uint8Array(await blob.arrayBuffer())); });
  const file = { name: 'ogrod-offline.png', mimeType: 'image/png', buffer: Buffer.from(bytes) };
  const navigation = page.getByRole('navigation', { name: 'Nawigacja główna' }); await navigation.getByRole('button', { name: 'Obiekty i ogrody', exact: true }).click();
  const open = async () => { await page.getByRole('button', { name: 'Karta ogrodu Ogród przy Lipowej', exact: true }).click(); return page.getByRole('dialog', { name: 'Karta ogrodu: Ogród przy Lipowej', exact: true }); };
  let card = await open(); let gallery = card.getByRole('region', { name: 'Galeria i historia ogrodu', exact: true });
  await gallery.getByRole('button', { name: 'Dodaj zdjęcia', exact: true }).click(); await gallery.getByLabel('Zdjęcia z urządzenia', { exact: true }).setInputFiles(file); await gallery.getByRole('button', { name: 'Zapisz zdjęcia', exact: true }).click(); await expect(gallery.locator('.photo-card img')).toBeVisible();
  await context.setOffline(true); await page.reload({ waitUntil: 'domcontentloaded' }); card = await open(); gallery = card.getByRole('region', { name: 'Galeria i historia ogrodu', exact: true });
  await expect.poll(() => gallery.locator('img').evaluateAll(images => images.length === 1 && images.every(i => (i as HTMLImageElement).naturalWidth > 0))).toBe(true);
  await gallery.getByRole('button', { name: 'Powiększ zdjęcie ogrod-offline.png', exact: true }).click(); await expect(page.getByRole('dialog', { name: 'Podgląd zdjęcia', exact: true }).locator('img')).toBeVisible(); await page.keyboard.press('Escape');
  await card.getByRole('button', { name: 'Zamknij okno', exact: true }).click(); await page.getByRole('button', { name: 'Ustawienia konta demonstracyjnego', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Ustawienia', exact: true }), event = page.waitForEvent('download'); await settings.getByRole('button', { name: 'Pobierz pełną kopię ZIP', exact: true }).click(); const stream = await (await event).createReadStream(); const chunks: Buffer[] = []; for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  await settings.getByLabel('Wczytaj pełną kopię ZIP', { exact: true }).setInputFiles({ name: 'offline.zip', mimeType: 'application/zip', buffer: Buffer.concat(chunks) }); await expect(settings.getByLabel('Wpisz ODTWÓRZ', { exact: true })).toBeVisible();
  await settings.getByRole('checkbox', { name: 'Rozumiem, że bieżący zestaw zostanie zastąpiony.', exact: true }).check(); await settings.getByLabel('Wpisz ODTWÓRZ', { exact: true }).fill('ODTWÓRZ'); await settings.getByRole('button', { name: 'Odtwórz dane i zdjęcia', exact: true }).click(); await expect(settings.getByText(/Dane i zdjęcia zostały odtworzone/)).toBeVisible();
  await page.reload({ waitUntil: 'domcontentloaded' }); card = await open(); await expect.poll(() => card.locator('.photo-card img').evaluateAll(images => images.length === 1 && images.every(i => (i as HTMLImageElement).naturalWidth > 0))).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('garden-manager:v1'))).not.toMatch(/base64|data:image/); expect(errors).toEqual([]);
});
