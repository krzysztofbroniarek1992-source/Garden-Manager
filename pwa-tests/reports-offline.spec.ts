import { closeOpenDialogs } from '../tests/navigation-helpers';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createDemoData } from '../src/data/demo';
import { STORAGE_VERSION } from '../src/data/repository';
import type { Data } from '../src/domain';
async function download(page: Page, panel: Locator, name: string) {
  const event = page.waitForEvent('download');
  await panel.getByRole('button', { name, exact: true }).click();
  const stream = await (await event).createReadStream(),
    chunks: Buffer[] = [];
  for await (const c of stream!) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks);
}
async function pdfText(bytes: Buffer) {
  const pdf = await getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
    isEvalSupported: false,
  }).promise;
  let result = '';
  for (let i = 1; i <= pdf.numPages; i++)
    result +=
      (await (await pdf.getPage(i)).getTextContent()).items
        .map((i) => ('str' in i ? i.str : ''))
        .join(' ') + '\n';
  await pdf.destroy();
  return result;
}

test('pierwszy raport PDF offline ma polskie znaki i zdjęcie, a pełny ZIP odtwarza jego historię', async ({
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
  const data = createDemoData();
  data.jobs[0] = {
    ...data.jobs[0],
    status: 'completed',
    seconds: 3661,
    settlement: null,
    activities: ['Żółć, Łódź — pielęgnacja róż i łąki. ĄĆĘŁŃÓŚŹŻ ąćęłńóśźż'],
    notes: 'PRIVATE_OFFLINE_NOTE',
  };
  await page.evaluate(
    ({ data, version }) =>
      localStorage.setItem(
        'garden-manager:v1',
        JSON.stringify({ version, data }),
      ),
    { data, version: STORAGE_VERSION },
  );
  await page.reload();
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('.connection')).toHaveText('Tryb offline');
  const snapshot = (): Promise<Data> =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('garden-manager:v1')!).data,
      ),
    nav = page.getByRole('navigation', { name: 'Nawigacja główna' });
  const open = async () => { await closeOpenDialogs(page);
    await nav
      .getByRole('button', { name: 'Historia prac', exact: true })
      .click();
    await page
      .locator('.job-title-button')
      .filter({ hasText: 'Pielęgnacja ogrodu' })
      .click();
    return page.getByRole('dialog', {
      name: 'Szczegóły zlecenia',
      exact: true,
    });
  };
  let detail = await open();
  const gallery = detail.getByRole('region', {
      name: 'Galeria zlecenia i wizyty',
      exact: true,
    }),
    bytes = await page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 100;
      c.height = 80;
      c.getContext('2d')!.fillRect(0, 0, 100, 80);
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
      name: 'raport-przed.png',
      mimeType: 'image/png',
      buffer: Buffer.from(bytes),
    });
  await gallery
    .getByRole('combobox', { name: 'Kategoria zdjęcia', exact: true })
    .selectOption('before');
  await gallery
    .getByRole('button', { name: 'Zapisz zdjęcia', exact: true })
    .click();
  await expect(gallery.locator('.photo-card img')).toBeVisible();
  await detail
    .getByRole('button', { name: 'Podsumowanie wizyty', exact: true })
    .click();
  let summary = page.getByRole('dialog', {
    name: 'Podsumowanie wizyty',
    exact: true,
  });
  await summary
    .getByRole('button', { name: 'Generuj raport PDF', exact: true })
    .click();
  let report = page.getByRole('dialog', {
    name: 'Raport PDF dla klienta',
    exact: true,
  });
  await report
    .getByRole('checkbox', {
      name: 'Dołącz wybrane zdjęcia PRZED/PO',
      exact: true,
    })
    .check();
  await report
    .getByRole('checkbox', {
      name: 'Dołącz zdjęcie raport-przed.png',
      exact: true,
    })
    .check();
  await report
    .getByRole('button', { name: 'Przygotuj podgląd raportu', exact: true })
    .click();
  await expect(
    report.getByRole('article', {
      name: 'Treść raportu dla klienta',
      exact: true,
    }),
  ).toContainText('Żółć');
  const pdf = await download(page, report, 'Zapisz raport i pobierz PDF'),
    text = await pdfText(pdf);
  expect(text).toContain('ĄĆĘŁŃÓŚŹŻ ąćęłńóśźż');
  expect(text).toContain('PRZED PRACĄ');
  expect(text).not.toMatch(/PRIVATE_OFFLINE_NOTE|Zatwierdzone rozliczenie/);
  const original = await snapshot();
  expect(original.jobs[0].reports).toHaveLength(1);
  expect(original.reportSequence).toBe(1);
  expect(original.jobs[0].seconds).toBe(3661);
  expect(original.jobs[0].settlement).toBeNull();
  await report
    .getByRole('button', { name: 'Zamknij okno', exact: true })
    .click();
  await summary
    .getByRole('button', { name: 'Zamknij okno', exact: true })
    .click();
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
    zip = await download(page, settings, 'Pobierz pełną kopię ZIP');
  await settings
    .getByLabel('Wczytaj pełną kopię ZIP', { exact: true })
    .setInputFiles({
      name: 'raporty-offline.zip',
      mimeType: 'application/zip',
      buffer: zip,
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
  expect((await snapshot()).jobs).toEqual(original.jobs);
  expect((await snapshot()).payments).toEqual(original.payments);
  detail = await open();
  await detail
    .getByRole('button', { name: 'Podsumowanie wizyty', exact: true })
    .click();
  summary = page.getByRole('dialog', {
    name: 'Podsumowanie wizyty',
    exact: true,
  });
  await summary
    .getByRole('button', { name: 'Generuj raport PDF', exact: true })
    .click();
  report = page.getByRole('dialog', {
    name: 'Raport PDF dla klienta',
    exact: true,
  });
  const regenerated = await download(page, report, 'Pobierz ponownie wersję 1');
  expect(await pdfText(regenerated)).toBe(text);
  expect((await snapshot()).jobs[0].reports).toHaveLength(1);
  expect((await snapshot()).reportSequence).toBe(1);
  expect(
    await page.evaluate(() => localStorage.getItem('garden-manager:v1')),
  ).not.toMatch(/base64|data:image|JVBER/);
  expect(errors).toEqual([]);
});
