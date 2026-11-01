import { test as base, expect, type Page, type Locator } from '@playwright/test';
import { createDemoData } from '../src/data/demo';
import { STORAGE_VERSION } from '../src/data/repository';
import type { Data } from '../src/domain';

const test = base.extend<{ browserErrors: string[] }>({
  browserErrors: [async ({ page }, use) => { const errors: string[] = []; page.on('pageerror', e => errors.push(e.message)); await use(errors); expect(errors).toEqual([]); }, { auto: true }],
});
function fixture() {
  const data = createDemoData();
  data.gardens[0].zones = [{ id: 'zone-1', name: 'Rabata różana', type: 'rabata', area: 12, length: null, plants: 'Róże', requirements: '', treatments: 'Cięcie' }];
  data.payments = [{ id: 'p', jobId: 'job-5', amountCents: 1000, receivedDate: '2026-10-30', method: 'cash', note: 'Zachowana wpłata' }];
  return data;
}
async function seed(page: Page, data = fixture()) {
  await page.goto('/'); await page.evaluate(({ data, version }) => localStorage.setItem('garden-manager:v1', JSON.stringify({ version, data })), { data, version: STORAGE_VERSION }); await page.reload();
}
async function snapshot(page: Page): Promise<Data> { return page.evaluate(() => JSON.parse(localStorage.getItem('garden-manager:v1')!).data); }
async function assets(page: Page): Promise<{ id: string; bytes: number; thumb: number; blob: boolean }[]> {
  return page.evaluate(() => new Promise((resolve, reject) => { const request = indexedDB.open('garden-manager-photos', 1); request.onerror = () => reject(request.error); request.onsuccess = () => { const db = request.result; const tx = db.transaction('assets', 'readonly'); const r = tx.objectStore('assets').getAll(); r.onsuccess = () => resolve(r.result.map(a => ({ id: a.id, bytes: a.image.size, thumb: a.thumbnail.size, blob: a.image instanceof Blob && a.thumbnail instanceof Blob }))); tx.oncomplete = () => db.close(); }; }));
}
async function image(page: Page, name = 'ogrod.png', color = '#337755', width = 120, height = 80) {
  const bytes = await page.evaluate(async ({ color, width, height }) => { const c = document.createElement('canvas'); c.width = width; c.height = height; const ctx = c.getContext('2d')!; ctx.fillStyle = color; ctx.fillRect(0,0,width,height); const blob = await new Promise<Blob>(resolve => c.toBlob(b => resolve(b!), 'image/png')); return Array.from(new Uint8Array(await blob.arrayBuffer())); }, { color, width, height });
  return { name, mimeType: 'image/png', buffer: Buffer.from(bytes) };
}
async function garden(page: Page) {
  await page.getByRole('navigation', { name: 'Nawigacja główna' }).getByRole('button', { name: 'Obiekty i ogrody', exact: true }).click();
  await page.getByRole('button', { name: 'Karta ogrodu Ogród przy Lipowej', exact: true }).click();
  const card=page.getByRole('dialog', { name: 'Karta ogrodu: Ogród przy Lipowej', exact: true });
  await card.getByRole('tab',{name:'Galeria',exact:true}).click();
  return card;
}
async function upload(gallery: Locator, files: Awaited<ReturnType<typeof image>>[], category = 'before', description = 'Dokumentacja testowa') {
  await gallery.getByRole('button', { name: 'Dodaj zdjęcia', exact: true }).click();
  await gallery.getByLabel('Zdjęcia z urządzenia', { exact: true }).setInputFiles(files);
  await gallery.getByRole('combobox', { name: 'Kategoria zdjęcia', exact: true }).selectOption(category);
  await gallery.getByLabel('Opis zdjęcia', { exact: true }).fill(description);
  await gallery.getByRole('button', { name: 'Zapisz zdjęcia', exact: true }).click();
  await expect(gallery.getByText('Zdjęcia zapisane na tym urządzeniu.', { exact: true })).toBeVisible();
  await expect(gallery.locator('.photo-card img').first()).toBeVisible();
}
async function settings(page: Page) { await page.getByRole('button', { name: 'Ustawienia konta demonstracyjnego', exact: true }).click(); return page.getByRole('dialog', { name: 'Ustawienia', exact: true }); }
async function zipDownload(page: Page, panel: Locator, label = 'Pobierz pełną kopię ZIP') {
  const event = page.waitForEvent('download'); await panel.getByRole('button', { name: label, exact: true }).click(); const stream = await (await event).createReadStream(); const chunks: Buffer[] = []; for await (const chunk of stream!) chunks.push(Buffer.from(chunk)); return Buffer.concat(chunks);
}
async function confirmRestore(panel: Locator) {
  await panel.getByRole('checkbox', { name: 'Rozumiem, że bieżący zestaw zostanie zastąpiony.', exact: true }).check();
  await panel.getByLabel('Wpisz ODTWÓRZ', { exact: true }).fill('ODTWÓRZ'); await panel.getByRole('button', { name: 'Odtwórz dane i zdjęcia', exact: true }).click();
  await expect(panel.getByText(/Dane i zdjęcia zostały odtworzone/).last()).toBeVisible();
}

test('wiele zdjęć, kompresja i miniatury w IndexedDB zachowują się po odświeżeniu', async ({ page }) => {
  await seed(page); const before = await snapshot(page); const file = await image(page, 'duzy-ogrod.png', '#36754a', 3600, 2400); const second = await image(page, 'rabata.png');
  let card = await garden(page); let gallery = card.getByRole('region', { name: 'Galeria i historia ogrodu', exact: true });
  await upload(gallery, [file, second]); await expect(gallery.locator('.photo-card')).toHaveCount(2);
  const data = await snapshot(page); expect(data.photos[0]).toMatchObject({ mimeType: 'image/jpeg', width: 1920, height: 1280, thumbnailWidth: 320, category: 'before', gardenId: 'garden-1', clientId: 'client-1' });
  expect((await assets(page)).every(a => a.blob && a.bytes > 0 && a.thumb > 0)).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('garden-manager:v1'))).not.toMatch(/base64|data:image|blob:/);
  expect(data.jobs).toEqual(before.jobs); expect(data.payments).toEqual(before.payments); expect(data.taskSchedules).toEqual(before.taskSchedules);
  await page.reload(); card = await garden(page); gallery = card.getByRole('region', { name: 'Galeria i historia ogrodu', exact: true }); await expect(gallery.locator('.photo-card img')).toHaveCount(2);
  await expect.poll(() => gallery.locator('.photo-card img').evaluateAll(images => images.every(image => (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
});

test('edycja kategorii, opisu, daty i powiązań oraz filtrowanie galerii', async ({ page }) => {
  await seed(page); const card = await garden(page); const gallery = card.getByRole('region', { name: 'Galeria i historia ogrodu', exact: true });
  await upload(gallery, [await image(page, 'przed.png'), await image(page, 'po.png', '#778844')]);
  await gallery.getByRole('button', { name: 'Edytuj zdjęcie po.png', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edytuj zdjęcie', exact: true });
  await edit.getByRole('combobox', { name: 'Kategoria zdjęcia', exact: true }).selectOption('after'); await edit.getByLabel('Opis zdjęcia', { exact: true }).fill('Po cięciu róż'); await edit.getByLabel('Data wykonania (opcjonalnie)', { exact: true }).fill('2026-10-20');
  await edit.getByRole('combobox', { name: 'Strefa zdjęcia', exact: true }).selectOption('zone-1'); await edit.getByRole('combobox', { name: 'Zlecenie zdjęcia', exact: true }).selectOption('job-1'); await edit.getByRole('button', { name: 'Zapisz opis i powiązania' }).click();
  await gallery.getByRole('combobox', { name: 'Filtr kategorii zdjęć', exact: true }).selectOption('after'); await expect(gallery.locator('.photo-card')).toHaveCount(1); await expect(gallery.locator('.photo-card')).toContainText('Po cięciu róż');
  await gallery.getByRole('combobox', { name: 'Filtr strefy zdjęć', exact: true }).selectOption('zone-1'); await gallery.getByLabel('Zdjęcia od', { exact: true }).fill('2026-10-21'); await expect(gallery.locator('.photo-card')).toHaveCount(0);
  await gallery.getByLabel('Zdjęcia od', { exact: true }).fill('2026-10-01'); await gallery.getByLabel('Zdjęcia do', { exact: true }).fill('2026-10-31'); await expect(gallery.locator('.photo-card')).toHaveCount(1);
  const data = await snapshot(page); expect(data.photos.find(p => p.filename === 'po.png')).toMatchObject({ category: 'after', zoneId: 'zone-1', jobId: 'job-1', capturedDate: '2026-10-20' }); expect(await assets(page)).toHaveLength(2);
  await card.getByRole('button', { name: 'Zamknij okno', exact: true }).click(); await page.getByRole('navigation', { name: 'Nawigacja główna' }).getByRole('button', { name: /^Zlecenia/ }).click();
  await page.locator('.job-title-button').filter({ hasText: 'Pielęgnacja ogrodu' }).click(); await expect(page.getByRole('region', { name: 'Galeria zlecenia i wizyty', exact: true }).locator('.photo-card')).toHaveCount(1);
});

test('galeria klienta i strefy pokazuje powiązane zdjęcia, w tym zdjęcia przypisane bezpośrednio do klienta', async ({ page }) => {
  await seed(page); await page.getByRole('navigation', { name: 'Nawigacja główna' }).getByRole('button', { name: 'Klienci', exact: true }).click(); await page.locator('.client-name-button').filter({ hasText: 'Anna Kowalska' }).click();
  const clientGallery = page.getByRole('region', { name: 'Galeria klienta', exact: true }); await upload(clientGallery, [await image(page, 'klient.png')], 'problem', 'Problem z rośliną');
  expect((await snapshot(page)).photos[0]).toMatchObject({ clientId: 'client-1', gardenId: null, zoneId: null, jobId: null });
  await clientGallery.getByRole('button', { name: 'Edytuj zdjęcie klient.png', exact: true }).click(); const edit = page.getByRole('dialog', { name: 'Edytuj zdjęcie', exact: true });
  await edit.getByRole('combobox', { name: 'Ogród zdjęcia', exact: true }).selectOption('garden-1'); await edit.getByRole('combobox', { name: 'Strefa zdjęcia', exact: true }).selectOption('zone-1'); await edit.getByRole('button', { name: 'Zapisz opis i powiązania' }).click();
  const card = await garden(page); await card.getByRole('tab',{name:'Strefy i rośliny',exact:true}).click(); await card.getByRole('button', { name: 'Zdjęcia strefy Rabata różana', exact: true }).click();
  const zone = page.getByRole('dialog', { name: 'Zdjęcia strefy: Rabata różana', exact: true }); await expect(zone.locator('.photo-card')).toHaveCount(1); await expect(zone).toContainText('Problem z rośliną');
});

test('powiększanie i porównanie PRZED/PO działają bez zamykania karty ogrodu', async ({ page }) => {
  await seed(page); const card = await garden(page); const gallery = card.getByRole('region', { name: 'Galeria i historia ogrodu', exact: true });
  await upload(gallery, [await image(page, 'przed.png')]); await upload(gallery, [await image(page, 'po.png', '#ccaa44')], 'after');
  await gallery.getByRole('button', { name: 'Powiększ zdjęcie przed.png', exact: true }).click(); const enlarged = page.getByRole('dialog', { name: 'Podgląd zdjęcia', exact: true }); await expect(enlarged.locator('img')).toBeVisible(); await page.keyboard.press('Escape'); await expect(enlarged).toHaveCount(0); await expect(card).toBeVisible();
  await gallery.getByRole('button', { name: 'Wybierz PRZED', exact: true }).click(); await gallery.getByRole('button', { name: 'Wybierz PO', exact: true }).click(); await gallery.getByRole('button', { name: 'Porównaj PRZED i PO', exact: true }).click();
  const compare = page.getByRole('dialog', { name: 'Porównanie PRZED i PO', exact: true }); await expect(compare.locator('img')).toHaveCount(2);
  const boxes = await compare.locator('figure').evaluateAll(elements => elements.map(e => e.getBoundingClientRect().x)); expect(boxes[1]).toBeGreaterThan(boxes[0]); await page.keyboard.press('Escape'); await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Zamknij okno', exact: true }).click(); expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
});

test('usunięcie wymaga potwierdzenia i usuwa plik oraz miniaturę', async ({ page }) => {
  await seed(page); const card = await garden(page); const gallery = card.getByRole('region', { name: 'Galeria i historia ogrodu', exact: true }); await upload(gallery, [await image(page)]);
  await gallery.getByRole('button', { name: 'Usuń zdjęcie ogrod.png', exact: true }).click(); await page.getByRole('dialog', { name: 'Usunąć zdjęcie?', exact: true }).getByRole('button', { name: 'Anuluj', exact: true }).click(); await expect(gallery.locator('.photo-card')).toHaveCount(1);
  await gallery.getByRole('button', { name: 'Usuń zdjęcie ogrod.png', exact: true }).click(); await page.getByRole('button', { name: 'Potwierdź usunięcie zdjęcia', exact: true }).click(); await expect(gallery.locator('.photo-card')).toHaveCount(0); await expect.poll(async () => (await assets(page)).length).toBe(0); expect((await snapshot(page)).photos).toEqual([]);
});

test('usunięcie strefy zachowuje zdjęcia w historii ogrodu', async ({ page }) => {
  await seed(page); const card = await garden(page); const gallery = card.getByRole('region', { name: 'Galeria i historia ogrodu', exact: true });
  await gallery.getByRole('button', { name: 'Dodaj zdjęcia', exact: true }).click(); await gallery.getByLabel('Zdjęcia z urządzenia', { exact: true }).setInputFiles(await image(page)); await gallery.getByRole('combobox', { name: 'Strefa zdjęcia', exact: true }).selectOption('zone-1'); await gallery.getByRole('button', { name: 'Zapisz zdjęcia', exact: true }).click(); await expect(gallery.locator('.photo-card')).toHaveCount(1);
  await card.getByRole('tab',{name:'Strefy i rośliny',exact:true}).click(); await card.getByRole('button', { name: 'Usuń strefę Rabata różana', exact: true }).click(); await card.getByRole('button', { name: 'Potwierdź usunięcie strefy', exact: true }).click(); await card.getByRole('tab',{name:'Galeria',exact:true}).click(); await expect(gallery.locator('.photo-card')).toHaveCount(1); expect((await snapshot(page)).photos[0]).toMatchObject({ zoneId: null, zoneName: 'Rabata różana' }); expect(await assets(page)).toHaveLength(1);
});

test('pełna kopia ZIP odtwarza zdjęcia i pozwala bezpiecznie wrócić do poprzednich danych', async ({ page, browser }) => {
  test.setTimeout(60_000);
  await seed(page); const card = await garden(page); const gallery = card.getByRole('region', { name: 'Galeria i historia ogrodu', exact: true }); await upload(gallery, [await image(page, 'z-kopii.png')]); const source = await snapshot(page); await card.getByRole('button', { name: 'Zamknij okno', exact: true }).click(); const sourceSettings = await settings(page); const buffer = await zipDownload(page, sourceSettings);
  const targetContext = await browser.newContext(); const target = await targetContext.newPage();
  try {
    await seed(target); const oldCard = await garden(target); await upload(oldCard.getByRole('region', { name: 'Galeria i historia ogrodu', exact: true }), [await image(target, 'poprzednie.png', '#cc5555')]); const previous = await snapshot(target); await oldCard.getByRole('button', { name: 'Zamknij okno', exact: true }).click(); const panel = await settings(target);
    const zip = { name: 'pelna.zip', mimeType: 'application/zip', buffer }; await panel.getByLabel('Wczytaj pełną kopię ZIP', { exact: true }).setInputFiles(zip); await expect(panel.getByRole('group', { name: 'Potwierdzenie odtworzenia pełnej kopii' })).toBeVisible(); expect((await snapshot(target)).photos).toEqual(previous.photos);
    await expect(panel.getByRole('button', { name: 'Odtwórz dane i zdjęcia', exact: true })).toBeDisabled(); await panel.getByRole('button', { name: 'Anuluj odtwarzanie', exact: true }).click(); expect((await snapshot(target)).photos).toEqual(previous.photos);
    await panel.getByLabel('Wczytaj pełną kopię ZIP', { exact: true }).setInputFiles(zip); await expect(panel.getByLabel('Wpisz ODTWÓRZ', { exact: true })).toBeVisible(); await confirmRestore(panel);
    const imported = await snapshot(target); expect(imported.photos[0].id).toBe(source.photos[0].id); expect(imported.photos[0].sha256).toBe(source.photos[0].sha256); expect(await assets(target)).toHaveLength(2);
    await panel.getByRole('button', { name: 'Przywróć poprzedni zestaw', exact: true }).click(); await confirmRestore(panel); expect((await snapshot(target)).photos).toEqual(previous.photos);
    await panel.getByRole('button', { name: 'Usuń punkt odzyskiwania', exact: true }).click(); await panel.getByRole('button', { name: 'Potwierdź usunięcie punktu', exact: true }).click(); await expect.poll(async () => (await assets(target)).length).toBe(1);
    await target.reload(); const restoredCard = await garden(target); await expect(restoredCard.locator('.photo-card')).toContainText('poprzednie.png'); await expect.poll(() => restoredCard.locator('.photo-card img').evaluateAll(images => images.every(i => (i as HTMLImageElement).naturalWidth > 0))).toBe(true);
  } finally { await targetContext.close(); }
});

test('uszkodzona kopia ZIP nie zmienia danych ani zdjęć', async ({ page }) => {
  await seed(page); const before = await snapshot(page); const panel = await settings(page);
  await panel.getByLabel('Wczytaj pełną kopię ZIP', { exact: true }).setInputFiles({ name: 'uszkodzona.zip', mimeType: 'application/zip', buffer: Buffer.from('invalid zip') });
  await expect(panel.getByRole('alert')).toContainText('Nie można odczytać'); expect(await snapshot(page)).toEqual(before); expect(await assets(page)).toEqual([]); await expect(panel.getByRole('button', { name: 'Odtwórz dane i zdjęcia', exact: true })).toHaveCount(0);
});

test('błąd quota IndexedDB nie blokuje dotychczasowych danych i nie zostawia metadanych', async ({ page }) => {
  await seed(page); const before = await snapshot(page); const file = await image(page); const card = await garden(page); const gallery = card.getByRole('region', { name: 'Galeria i historia ogrodu', exact: true });
  await page.evaluate(() => { IDBObjectStore.prototype.add = function () { throw new DOMException('Disk full', 'QuotaExceededError'); }; });
  await gallery.getByRole('button', { name: 'Dodaj zdjęcia', exact: true }).click(); await gallery.getByLabel('Zdjęcia z urządzenia', { exact: true }).setInputFiles(file); await gallery.getByRole('button', { name: 'Zapisz zdjęcia', exact: true }).click(); await expect(gallery.getByRole('alert')).toContainText('Brak miejsca'); expect(await snapshot(page)).toEqual(before); expect(await assets(page)).toEqual([]);
  await page.reload(); const again = await garden(page); await upload(again.getByRole('region', { name: 'Galeria i historia ogrodu', exact: true }), [file]); expect((await snapshot(page)).photos).toHaveLength(1);
});

test('niedostępne IndexedDB nie wyłącza klientów ani nie nadpisuje danych', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, 'indexedDB', { configurable: true, get() { throw new DOMException('Blocked', 'SecurityError'); } }); });
  await seed(page); const before = await snapshot(page); const card = await garden(page); const gallery = card.getByRole('region', { name: 'Galeria i historia ogrodu', exact: true }); await expect(gallery.getByRole('alert')).toContainText('IndexedDB'); await expect(gallery.getByRole('button', { name: 'Dodaj zdjęcia', exact: true })).toBeDisabled(); expect(await snapshot(page)).toEqual(before);
  await card.getByRole('button', { name: 'Edytuj dane ogrodu' }).click(); const form = page.getByRole('dialog', { name: 'Edytuj ogród', exact: true }); await form.getByLabel('Adres *').fill('Adres zachowany przy błędzie zdjęć'); await form.getByRole('button', { name: 'Zapisz zmiany', exact: true }).click(); expect((await snapshot(page)).gardens[0].address).toBe('Adres zachowany przy błędzie zdjęć');
});

test('migracja v5 i eksport JSON zachowują dane i metadane, bez udawania pełnej kopii', async ({ page }) => {
  await page.goto('/'); const { photos: _photos, photoRestoreId: _restore, ...old } = fixture(); const raw = JSON.stringify({ version: 5, data: old }); await page.evaluate(raw => localStorage.setItem('garden-manager:v1', raw), raw); await page.reload(); expect(await page.evaluate(() => localStorage.getItem('garden-manager:backup:v5'))).toBe(raw);
  const migrated = await snapshot(page); expect(migrated.jobs).toEqual(old.jobs); expect(migrated.payments).toEqual(old.payments); expect(migrated.taskSchedules).toEqual(old.taskSchedules); expect(migrated.photos).toEqual([]);
  const card = await garden(page); await upload(card.getByRole('region', { name: 'Galeria i historia ogrodu', exact: true }), [await image(page)]); await card.getByRole('button', { name: 'Zamknij okno', exact: true }).click(); const panel = await settings(page); await expect(panel).toContainText('nie zawiera plików zdjęć'); const buffer = await zipDownload(page, panel, 'Eksportuj dane'); const json = JSON.parse(buffer.toString()); expect(json.version).toBe(STORAGE_VERSION); expect(json.data.photos).toHaveLength(1); expect(buffer.toString()).not.toMatch(/base64|data:image/);
});

test('telefon: wybór aparatu, powiększenie i porównanie bez przewijania w poziomie', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await seed(page); await page.getByRole('navigation', { name: 'Nawigacja mobilna' }).getByRole('button', { name: 'Ogrody', exact: true }).click(); await page.getByRole('button', { name: 'Karta ogrodu Ogród przy Lipowej', exact: true }).click(); const card = page.getByRole('dialog', { name: 'Karta ogrodu: Ogród przy Lipowej', exact: true }); await card.getByRole('tab',{name:'Galeria',exact:true}).click(); const gallery = card.getByRole('region', { name: 'Galeria i historia ogrodu', exact: true });
  await upload(gallery, [await image(page, 'przed.png')]); await upload(gallery, [await image(page, 'po.png')], 'after'); await gallery.getByRole('button', { name: 'Dodaj zdjęcia', exact: true }).click(); await expect(gallery.getByLabel('Aparat telefonu', { exact: true })).toHaveAttribute('capture', 'environment'); expect(await card.evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true); await gallery.getByRole('button', { name: 'Anuluj dodawanie' }).click();
  await gallery.getByRole('button', { name: 'Wybierz PRZED', exact: true }).click(); await gallery.getByRole('button', { name: 'Wybierz PO', exact: true }).click(); await gallery.getByRole('button', { name: 'Porównaj PRZED i PO', exact: true }).click(); const compare = page.getByRole('dialog', { name: 'Porównanie PRZED i PO', exact: true }); await expect(compare.locator('img')).toHaveCount(2); expect(await compare.evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('pozostałość po przerwanym zapisie pliku jest sprzątana po ponownym uruchomieniu', async ({ page }) => {
  await seed(page); const card = await garden(page); await upload(card.getByRole('region', { name: 'Galeria i historia ogrodu', exact: true }), [await image(page)]);
  await page.evaluate(() => new Promise<void>((resolve, reject) => { const open = indexedDB.open('garden-manager-photos'); open.onerror = () => reject(open.error); open.onsuccess = () => { const db = open.result, tx = db.transaction('assets', 'readwrite'), store = tx.objectStore('assets'), get = store.getAll(); get.onsuccess = () => store.add({ ...get.result[0], id: 'interrupted', createdAt: 0 }); tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => reject(tx.error); }; }));
  expect(await assets(page)).toHaveLength(2); await page.reload(); await expect.poll(async () => (await assets(page)).length).toBe(1); expect((await snapshot(page)).photos).toHaveLength(1);
});
