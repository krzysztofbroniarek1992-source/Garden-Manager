import { test as base, expect, type Page } from '@playwright/test';
import { createDemoData } from '../src/data/demo';
import { STORAGE_VERSION } from '../src/data/repository';
import type { Data, GardenZone } from '../src/domain';

const test = base.extend<{ browserErrors: string[] }>({
  browserErrors: [async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await use(errors);
    expect(errors).toEqual([]);
  }, { auto: true }],
});
const zone: GardenZone = { id: 'zone-1', name: 'Rabata różana', type: 'rabata', area: 12.3456789, length: null, plants: 'Róże', requirements: 'Podlewanie rano', treatments: '2026-10-30: cięcie' };
function fixture(): Data {
  const data = createDemoData();
  data.gardens[0].zones = [zone, { ...zone, id: 'hedge', name: 'Żywopłot zachodni', type: 'żywopłot', area: null, length: 30 }];
  data.materialCatalog = [
    { id: 'bark', name: 'Kora testowa', category: 'Podłoża', unit: 'l', purchaseUnitPrice: 0.5, packageName: 'worek', packageQuantity: 80, notes: 'Sosnowa' },
    { id: 'fertilizer', name: 'Nawóz testowy', category: 'Nawozy', unit: 'kg', purchaseUnitPrice: 10, packageName: 'worek', packageQuantity: 5, notes: '' },
    { id: 'net', name: 'Siatka', category: 'Inne', unit: 'm', purchaseUnitPrice: 2, packageName: '', packageQuantity: null, notes: '' },
  ];
  return data;
}
async function seed(page: Page, data = fixture()) {
  await page.goto('/');
  await page.evaluate(({ data, version }) => { localStorage.setItem('garden-manager:v1', JSON.stringify({ version, data })); }, { data, version: STORAGE_VERSION });
  await page.reload();
}
async function snapshot(page: Page): Promise<{ version: number; data: Data }> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('garden-manager:v1')!));
}
async function navigate(page: Page, name: string) {
  await page.getByRole('navigation', { name: 'Nawigacja główna' }).getByRole('button', { name: new RegExp(`^${name}(?: |$)`) }).click();
}
async function openGarden(page: Page) {
  await navigate(page, 'Obiekty i ogrody');
  await page.getByRole('button', { name: 'Karta ogrodu Ogród przy Lipowej', exact: true }).click();
  return page.getByRole('dialog', { name: 'Karta ogrodu: Ogród przy Lipowej', exact: true });
}

test('katalog: dodawanie, edycja, wyszukiwanie i użycie podczas tworzenia zlecenia', async ({ page }) => {
  await seed(page);
  await navigate(page, 'Materiały');
  await page.getByRole('button', { name: 'Dodaj materiał', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Nowy materiał' });
  await form.getByLabel('Nazwa materiału', { exact: true }).fill('Ziemia uniwersalna');
  await form.getByLabel('Kategoria', { exact: true }).fill('Podłoża');
  await form.getByLabel('Jednostka miary').selectOption('l');
  await form.getByLabel('Domyślna cena zakupu').fill('0.6');
  await form.getByLabel('Opakowanie (opcjonalnie)').fill('worek');
  await form.getByLabel('Ilość w opakowaniu').fill('50');
  await form.getByLabel('Notatki').fill('Bez torfu');
  await form.getByRole('button', { name: 'Zapisz materiał' }).click();
  await page.getByLabel('Szukaj materiałów', { exact: true }).fill('ziemia');
  await expect(page.locator('.entity-grid article')).toHaveCount(1);
  await page.getByRole('button', { name: 'Edytuj materiał Ziemia uniwersalna' }).click();
  await page.getByRole('dialog').getByLabel('Domyślna cena zakupu').fill('0.7');
  await page.getByRole('button', { name: 'Zapisz materiał' }).click();
  await page.reload();
  const item = (await snapshot(page)).data.materialCatalog.find(m => m.name === 'Ziemia uniwersalna')!;
  expect(item).toMatchObject({ purchaseUnitPrice: 0.7, packageQuantity: 50, notes: 'Bez torfu' });
  await navigate(page, 'Zlecenia');
  await page.getByRole('button', { name: 'Nowe zlecenie', exact: true }).click();
  const job = page.getByRole('dialog', { name: 'Nowe zlecenie' });
  await job.getByLabel('Nazwa pracy').fill('Ziemia z katalogu');
  await job.getByLabel('Szukaj materiału w katalogu').fill('ziemia');
  await job.getByRole('combobox', { name: 'Dodaj z katalogu', exact: true }).selectOption(item.id);
  await expect(job.getByLabel('Cena zakupu materiału 1', { exact: true })).toHaveValue('0.7');
  await expect(job.getByLabel('Cena materiału 1', { exact: true })).toHaveValue('0.7');
  await job.getByLabel('Ilość materiału 1', { exact: true }).fill('0.123456789');
  await job.getByLabel('Cena materiału 1', { exact: true }).fill('0.9');
  await job.getByRole('button', { name: 'Zapisz zlecenie' }).click();
  const saved = (await snapshot(page)).data.jobs.find(j => j.title === 'Ziemia z katalogu')!;
  expect(saved.materials[0]).toMatchObject({ quantity: 0.123456789, unit: 'l', purchaseUnitPrice: 0.7, unitPrice: 0.9, catalogId: item.id });
});

test('strefy: zapis wymiarów, edycja, anulowanie i potwierdzenie usunięcia bez utraty historii', async ({ page }) => {
  await seed(page);
  const before = (await snapshot(page)).data;
  let card = await openGarden(page);
  await card.getByRole('button', { name: 'Dodaj strefę', exact: true }).click();
  await card.getByLabel('Nazwa strefy', { exact: true }).fill('Trawnik testowy');
  await card.getByLabel('Powierzchnia strefy').fill('125.123456789');
  await card.getByLabel('Rośliny', { exact: true }).fill('Trawa');
  await card.getByLabel('Szczególne wymagania').fill('Podlewać rano');
  await card.getByLabel('Wykonane zabiegi').fill('2026-10-31: koszenie');
  await card.getByRole('button', { name: 'Zapisz strefę' }).click();
  await card.getByRole('button', { name: 'Edytuj strefę Trawnik testowy', exact: true }).click();
  await card.getByLabel('Długość strefy').fill('50');
  await card.getByRole('button', { name: 'Zapisz strefę' }).click();
  await card.getByRole('button', { name: 'Edytuj dane ogrodu' }).click();
  await page.getByRole('dialog', { name: 'Edytuj ogród', exact: true }).getByLabel('Adres *').fill('Nowa ulica 5');
  await page.getByRole('button', { name: 'Zapisz zmiany', exact: true }).click();
  await expect(card).toContainText('Nowa ulica 5');
  expect((await snapshot(page)).data.gardens[0].zones.at(-1)).toMatchObject({ area: 125.123456789, length: 50, treatments: '2026-10-31: koszenie' });
  await card.getByRole('button', { name: 'Usuń strefę Trawnik testowy', exact: true }).click();
  await card.getByRole('button', { name: 'Anuluj usunięcie' }).click();
  await expect(card.locator('.zone-card').filter({ hasText: 'Trawnik testowy' })).toBeVisible();
  await card.getByRole('button', { name: 'Usuń strefę Trawnik testowy', exact: true }).click();
  await card.getByRole('button', { name: 'Potwierdź usunięcie strefy' }).click();
  await expect(card.locator('.zone-card')).toHaveCount(2);
  const after = (await snapshot(page)).data;
  expect(after.jobs).toEqual(before.jobs);
  expect(after.payments).toEqual(before.payments);
  await card.getByRole('button', { name: /Pielęgnacja ogrodu/ }).click();
  await expect(page.getByRole('dialog', { name: 'Szczegóły zlecenia', exact: true })).toBeVisible();
});

test('powierzchnie i objętości: wszystkie kształty, przejście do warstwy i litry', async ({ page }) => {
  await seed(page);
  await navigate(page, 'Kalkulatory');
  const result = page.getByTestId('calculator-result');
  await page.getByRole('combobox', { name: 'Kształt', exact: true }).selectOption('rectangle');
  await page.getByLabel('Długość (m)', { exact: true }).fill('2.3');
  await page.getByLabel('Szerokość (m)', { exact: true }).fill('4.7');
  await expect(result.locator('strong')).toHaveText('10,81 m²');
  await page.getByRole('combobox', { name: 'Kształt', exact: true }).selectOption('circle');
  await page.getByLabel('Promień (m)').fill('3');
  await expect(result.locator('strong')).toHaveText('28,274 m²');
  await page.getByRole('combobox', { name: 'Kształt', exact: true }).selectOption('triangle');
  await page.getByLabel('Podstawa (m)').fill('5');
  await page.getByLabel('Wysokość trójkąta (m)').fill('7');
  await expect(result.locator('strong')).toHaveText('17,5 m²');
  await page.getByRole('combobox', { name: 'Kształt', exact: true }).selectOption('manual');
  await page.getByLabel('Powierzchnia do obliczeń').fill('12.3456789');
  await page.getByRole('button', { name: 'Użyj powierzchni do obliczenia warstwy' }).click();
  await expect(page.getByLabel('Powierzchnia do obliczeń')).toHaveValue('12.3456789');
  await page.getByLabel('Grubość warstwy').fill('1');
  await expect(result.locator('strong')).toHaveText('0,123 m³');
  await expect(result).toContainText('123,457 l');
  await page.getByLabel('Grubość warstwy').fill('-1');
  await expect(result).toContainText('nieujemne');
});

test('nawożenie i środki: pusta dawka, etykieta, g/kg, ml/l, dawka na 100 m² i niezgodne jednostki', async ({ page }) => {
  await seed(page);
  await navigate(page, 'Kalkulatory');
  await page.getByRole('combobox', { name: 'Kalkulator', exact: true }).selectOption('dose');
  await expect(page.getByText(/dawkę przepisz z aktualnej etykiety/)).toBeVisible();
  await expect(page.getByLabel('Dawka z etykiety', { exact: true })).toHaveValue('');
  await page.getByLabel('Powierzchnia do obliczeń').fill('250');
  await page.getByLabel('Dawka z etykiety', { exact: true }).fill('30');
  await page.getByRole('combobox', { name: 'Materiał z katalogu', exact: true }).selectOption('fertilizer');
  await expect(page.getByTestId('calculator-result')).toContainText('Ilość materiału: 7,5 kg');
  await expect(page.getByTestId('calculator-result')).toContainText(/75,00\s*zł/);
  await page.getByRole('combobox', { name: 'Dawka na', exact: true }).selectOption('100');
  await page.getByLabel('Dawka z etykiety', { exact: true }).fill('150');
  await page.getByLabel('Jednostka dawki').selectOption('ml');
  await expect(page.getByTestId('calculator-result')).toContainText('Jednostka wyniku nie pasuje');
  await expect(page.getByRole('button', { name: 'Dodaj materiał do zlecenia' })).toBeDisabled();
  await page.getByRole('combobox', { name: 'Materiał z katalogu', exact: true }).selectOption('bark');
  await expect(page.getByTestId('calculator-result')).toContainText('375 ml');
  await expect(page.getByTestId('calculator-result')).toContainText('0,375 l');
});

test('żywopłot pobiera długość strefy i rozlicza bryłę lub metry', async ({ page }) => {
  await seed(page);
  const garden = await openGarden(page);
  await garden.getByRole('button', { name: 'Oblicz dla strefy Żywopłot zachodni', exact: true }).click();
  await expect(page.getByLabel('Długość żywopłotu')).toHaveValue('30');
  await page.getByLabel('Wysokość żywopłotu').fill('2');
  await page.getByLabel('Szerokość żywopłotu').fill('0.5');
  await expect(page.getByTestId('calculator-result').locator('strong')).toHaveText('30 m³');
  await page.getByLabel('Ilość do kosztorysu').selectOption('length');
  await page.getByRole('combobox', { name: 'Materiał z katalogu', exact: true }).selectOption('net');
  await expect(page.getByTestId('calculator-result')).toContainText('Ilość materiału: 30 m');
  await expect(page.getByTestId('calculator-result')).toContainText(/60,00\s*zł/);
  await page.getByRole('combobox', { name: 'Kalkulator', exact: true }).selectOption('dose');
  await expect(page.getByLabel('Powierzchnia do obliczeń')).toHaveValue('');
});

test('strefa → kalkulator → materiał: dokładność i oddzielne ceny, zamrożona należność oraz jawna korekta', async ({ page }) => {
  const data = fixture();
  data.jobs[0] = { ...data.jobs[0], seconds: 13620, status: 'completed', settlement: { calculatedLaborCents: 45400, suggestedLaborCents: 45000, finalLaborCents: 45000, materialsCents: 0, approvedAt: 1000, source: 'rounded' } };
  data.payments = [{ id: 'p', jobId: 'job-1', amountCents: 10000, receivedDate: '2026-10-30', method: 'cash', note: 'Historia' }];
  await seed(page, data);
  const garden = await openGarden(page);
  await garden.getByRole('button', { name: 'Oblicz dla strefy Rabata różana', exact: true }).click();
  await expect(page.getByLabel('Powierzchnia do obliczeń')).toHaveValue('12.3456789');
  await page.getByLabel('Grubość warstwy').fill('1');
  await page.getByRole('combobox', { name: 'Materiał z katalogu', exact: true }).selectOption('bark');
  await expect(page.getByLabel('Cena dla klienta')).toHaveValue('0.5');
  await page.getByLabel('Cena dla klienta').fill('0.7');
  await expect(page.getByTestId('calculator-result')).toContainText('Do zakupu: 2 opak.');
  await page.getByLabel('Zlecenie docelowe').selectOption('job-1');
  await page.getByRole('button', { name: 'Dodaj materiał do zlecenia' }).click();
  await expect(page.getByRole('status')).toContainText('Zatwierdzona należność pozostała bez zmian');
  let saved = (await snapshot(page)).data;
  expect(saved.jobs[0].materials[0].quantity).toBeCloseTo(123.456789, 9);
  expect(saved.jobs[0].materials[0]).toMatchObject({ purchaseUnitPrice: 0.5, unitPrice: 0.7, unit: 'l', catalogId: 'bark', zoneId: zone.id, zoneName: zone.name });
  expect(saved.jobs[0].settlement).toEqual(data.jobs[0].settlement);
  expect(saved.jobs[0].seconds).toBe(13620);
  expect(saved.payments).toEqual(data.payments);
  await page.getByRole('button', { name: 'Wróć do karty ogrodu' }).click();
  await garden.getByRole('button', { name: /Pielęgnacja ogrodu/ }).click();
  const detail = page.getByRole('dialog', { name: 'Szczegóły zlecenia', exact: true });
  await expect(detail.getByTestId('payment-job-total')).toHaveText(/450,00\s*zł/);
  await expect(detail.locator('.payment-material-list')).toContainText(/zakup: 0,50\s*zł\/l/);
  await detail.getByRole('button', { name: 'Skoryguj cenę', exact: true }).click();
  await detail.getByRole('button', { name: 'Sprawdź korektę ceny' }).click();
  await detail.getByRole('button', { name: 'Potwierdź korektę ceny' }).click();
  await expect(detail.getByTestId('payment-job-total')).toHaveText(/536,42\s*zł/);
  saved = (await snapshot(page)).data;
  expect(saved.jobs[0].settlement!.finalLaborCents).toBe(45000);
  expect(saved.jobs[0].settlement!.materialsCents).toBe(8642);
  expect(saved.payments).toEqual(data.payments);
});

test('karta zlecenia otwiera kalkulator, który dopisuje materiał tylko do tego zlecenia', async ({ page }) => {
  await seed(page);
  const before = (await snapshot(page)).data;
  const garden = await openGarden(page);
  await garden.getByRole('button', { name: /Pielęgnacja ogrodu/ }).click();
  const detail = page.getByRole('dialog', { name: 'Szczegóły zlecenia', exact: true });
  await detail.getByRole('button', { name: 'Oblicz materiały', exact: true }).click();
  await detail.getByRole('combobox', { name: 'Kalkulator', exact: true }).selectOption('materials');
  await detail.getByRole('combobox', { name: 'Materiał z katalogu', exact: true }).selectOption('bark');
  await detail.getByLabel('Ilość materiału', { exact: true }).fill('160');
  await expect(detail.getByLabel('Ogród do obliczeń')).toBeDisabled();
  await expect(detail.getByLabel('Zlecenie docelowe')).toHaveValue('job-1');
  await detail.getByRole('button', { name: 'Dodaj materiał do zlecenia' }).click();
  await expect(detail.getByTestId('job-materials-total')).toHaveText(/80,00\s*zł/);
  const after = (await snapshot(page)).data;
  expect(after.jobs[0].materials[0]).toMatchObject({ quantity: 160, unitPrice: 0.5, purchaseUnitPrice: 0.5 });
  expect(after.jobs.slice(1)).toEqual(before.jobs.slice(1));
});

test('migracja v3 zachowuje wizytę i należności, a eksport v4 odtwarza strefy i katalog', async ({ page }) => {
  const full = fixture();
  full.timer = { jobId: 'job-1', startedAt: 1000, paused: true, remainderMs: 321 };
  full.jobs[0].status = 'in-progress';
  full.payments = [{ id: 'p', jobId: 'job-5', amountCents: 100, receivedDate: '2026-10-30', method: 'cash', note: '' }];
  const { materialCatalog: _catalog, ...old } = full;
  const legacy = { ...old, gardens: old.gardens.map(({ zones: _z, ...g }) => g) };
  const original = JSON.stringify({ version: 3, data: legacy });
  await page.goto('/');
  await page.evaluate(raw => localStorage.setItem('garden-manager:v1', raw), original);
  await page.reload();
  const migrated = await snapshot(page);
  expect(migrated.version).toBe(STORAGE_VERSION);
  expect(migrated.data.jobs).toEqual(full.jobs);
  expect(migrated.data.timer).toEqual(full.timer);
  expect(migrated.data.payments).toEqual(full.payments);
  expect(await page.evaluate(() => localStorage.getItem('garden-manager:backup:v3'))).toBe(original);
  // Exercise the normal v4 reader with all new fields before exporting.
  full.jobs[0].materials = [{ id: 'new-material', name: 'Kora testowa', quantity: 0.123456789, unit: 'l', purchaseUnitPrice: 0.5, unitPrice: 0.7, catalogId: 'bark', zoneId: zone.id, zoneName: zone.name }];
  await seed(page, full);
  await page.getByRole('button', { name: 'Ustawienia konta demonstracyjnego' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Eksportuj dane' }).click();
  const stream = await (await downloadPromise).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const exported = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  expect(exported).toEqual({ version: STORAGE_VERSION, data: full });
  await page.evaluate(raw => localStorage.setItem('garden-manager:v1', raw), JSON.stringify(exported));
  await page.reload();
  expect((await snapshot(page)).data).toEqual(full);
});

test('telefon: menu Więcej, katalog, strefy i kalkulator bez przewijania w poziomie', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page);
  const mobile = page.getByRole('navigation', { name: 'Nawigacja mobilna' });
  await mobile.getByRole('button', { name: 'Więcej', exact: true }).click();
  await page.locator('.mobile-more').getByRole('button', { name: 'Materiały', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Katalog materiałów' })).toBeVisible();
  await page.getByRole('button', { name: 'Edytuj materiał Kora testowa', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.getByRole('dialog').evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
  await page.getByRole('button', { name: 'Anuluj', exact: true }).click();
  await mobile.getByRole('button', { name: 'Ogrody', exact: true }).click();
  await page.getByRole('button', { name: 'Karta ogrodu Ogród przy Lipowej', exact: true }).click();
  await page.getByRole('button', { name: 'Oblicz dla strefy Rabata różana', exact: true }).click();
  await page.getByLabel('Grubość warstwy').fill('5');
  await page.getByRole('combobox', { name: 'Materiał z katalogu', exact: true }).selectOption('bark');
  await page.getByLabel('Zlecenie docelowe').selectOption('job-1');
  await page.getByRole('button', { name: 'Dodaj materiał do zlecenia' }).click();
  await expect(page.getByRole('status')).toContainText('Dodano materiał');
  expect(await page.getByRole('dialog').evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
