import { expect, test } from '@playwright/test';

test('manifest, ikony PNG i aplikacja offline zachowują klienta oraz aktywny stoper', async ({ page, context, request }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const manifestResponse = await request.get('/manifest.webmanifest');
  expect(manifestResponse.ok()).toBe(true);
  const manifest = await manifestResponse.json();
  expect(manifest).toMatchObject({ name: 'Garden Manager', display: 'standalone', lang: 'pl', start_url: '/' });
  expect(manifest.icons).toHaveLength(2);
  for (const icon of manifest.icons) {
    const response = await request.get(icon.src);
    expect(response.ok()).toBe(true);
    expect(response.headers()['content-type']).toContain('image/png');
    const png = await response.body();
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`).toBe(icon.sizes);
  }

  await page.clock.install({ time: new Date('2026-11-03T09:00:00+01:00') });
  await page.goto('/');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.state)).toBe('activated');

  const navigation = page.getByRole('navigation', { name: 'Nawigacja główna' });
  await navigation.getByRole('button', { name: 'Klienci', exact: true }).click();
  await page.getByRole('button', { name: 'Dodaj klienta', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Nowy klient', exact: true });
  await dialog.getByLabel('Imię i nazwisko / nazwa firmy').fill('Klient zachowany offline');
  await dialog.getByRole('button', { name: 'Dodaj klienta', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Klient zachowany offline', exact: true })).toBeVisible();

  await navigation.getByRole('button', { name: 'Panel główny', exact: true }).click();
  await page.getByLabel('ZLECENIE DO REALIZACJI', { exact: true }).selectOption('job-1');
  await page.getByRole('button', { name: 'START — Rozpocznij wizytę', exact: true }).click();
  await page.clock.fastForward(12_000);
  await expect(page.getByTestId('timer-display')).toHaveText('00:00:12');

  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: /Dzień dobry, Ogrodniku/ })).toBeVisible();
  await expect(page.locator('.connection')).toHaveText('Tryb offline');
  await expect(page.getByRole('button', { name: 'STOP — Zakończ pomiar', exact: true })).toBeVisible();
  await expect(page.getByTestId('timer-display')).toHaveText(/00:00:1[2-9]/);
  await page.clock.fastForward(18_000);
  await page.getByRole('button', { name: 'PAUZA — Przerwa bez naliczania', exact: true }).click();
  const pausedDisplay = await page.getByTestId('timer-display').textContent();
  const paused = await page.evaluate(() => JSON.parse(localStorage.getItem('garden-manager:v1')!).data);
  expect(paused.timer).toMatchObject({ jobId: 'job-1', paused: true });
  await page.clock.fastForward(120_000);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('timer-display')).toHaveText(pausedDisplay!);
  await page.getByRole('button', { name: 'WZNÓW — Kontynuuj wizytę', exact: true }).click();
  await page.clock.fastForward(15_000);
  await page.getByRole('button', { name: 'STOP — Zakończ pomiar', exact: true }).click();
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('garden-manager:v1')!).data);
  expect(persisted.timer).toBeNull();
  const pausedSeconds = paused.jobs.find((job: { id: string }) => job.id === 'job-1').seconds;
  const stoppedSeconds = persisted.jobs.find((job: { id: string }) => job.id === 'job-1').seconds;
  expect(stoppedSeconds).toBeGreaterThanOrEqual(pausedSeconds + 15);
  expect(stoppedSeconds).toBeLessThan(pausedSeconds + 20);

  await navigation.getByRole('button', { name: 'Klienci', exact: true }).click();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Klient zachowany offline', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
