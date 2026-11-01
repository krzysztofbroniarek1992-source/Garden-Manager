import { closeOpenDialogs } from './navigation-helpers';
import {
  test as base,
  expect,
  type Page,
  type Locator,
} from '@playwright/test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createDemoData } from '../src/data/demo';
import { STORAGE_VERSION } from '../src/data/repository';
import {
  applyWorkTemplate,
  editChecklistItem,
} from '../src/checklists/commands';
import type { Data } from '../src/domain';
const test = base.extend<{ errors: string[] }>({
  errors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await use(errors);
      expect(errors).toEqual([]);
    },
    { auto: true },
  ],
});
test.use({ timezoneId: 'Europe/Warsaw' });
const clock = new Date('2026-10-31T10:00:00+01:00');
function fixture(completed = true) {
  const d = createDemoData(clock);
  d.clients[0] = {
    ...d.clients[0],
    notes: 'PRIVATE_CLIENT_NOTES',
    phone: 'PRIVATE_PHONE',
    email: 'private@example.com',
  };
  d.gardens[0].notes = 'PRIVATE_GARDEN_NOTES';
  d.gardens[0].zones = [
    {
      id: 'zone',
      name: 'Rabata różana',
      type: 'rabata',
      area: 12,
      length: null,
      plants: 'Róże',
      requirements: 'PRIVATE_REQUIREMENTS',
      treatments: '',
    },
  ];
  d.jobs[0] = {
    ...d.jobs[0],
    title: 'Zakres zaplanowany',
    date: '2026-10-31',
    status: completed ? 'completed' : 'planned',
    seconds: completed ? 13620 : 0,
    notes: 'PRIVATE_JOB_NOTES',
    activities: ['Pielęgnacja róż — Łódź, Żółć, łąka. ĄĆĘŁŃÓŚŹŻ ąćęłńóśźż'],
    materials: [
      {
        id: 'm',
        name: 'Kora ogrodowa',
        quantity: 2.3456789,
        unit: 'l',
        unitPrice: 10,
        purchaseUnitPrice: 9.87,
      },
    ],
    settlement: completed
      ? {
          calculatedLaborCents: 45400,
          suggestedLaborCents: 45000,
          finalLaborCents: 45000,
          materialsCents: 2346,
          approvedAt: clock.getTime(),
          source: 'rounded',
        }
      : null,
  };
  d.payments = completed
    ? [
        {
          id: 'p',
          jobId: 'job-1',
          amountCents: 10000,
          receivedDate: '2026-10-31',
          method: 'transfer',
          note: 'PRIVATE_BANK_NOTE',
        },
      ]
    : [];
  return d;
}
async function seed(page: Page, data = fixture(), version = STORAGE_VERSION) {
  await page.clock.install({ time: clock });
  await page.goto('/');
  await page.evaluate(
    ({ data, version }) =>
      localStorage.setItem(
        'garden-manager:v1',
        JSON.stringify({ version, data }),
      ),
    { data, version },
  );
  await page.reload();
}
async function snapshot(page: Page): Promise<Data> {
  return page.evaluate(
    () => JSON.parse(localStorage.getItem('garden-manager:v1')!).data,
  );
}
async function job(page: Page, completed = true) {
  await closeOpenDialogs(page);
  await page
    .getByRole('navigation', { name: 'Nawigacja główna' })
    .getByRole('button', {
      name: completed ? 'Historia prac' : /^Zlecenia/,
      exact: true,
    })
    .click();
  await page
    .locator('.job-title-button')
    .filter({ hasText: 'Zakres zaplanowany' })
    .click();
  return page.getByRole('dialog', { name: 'Szczegóły zlecenia', exact: true });
}
async function summary(page: Page, detail?: Locator) {
  if (!detail) detail = await job(page);
  await detail
    .getByRole('button', { name: 'Podsumowanie wizyty', exact: true })
    .click();
  return page.getByRole('dialog', { name: 'Podsumowanie wizyty', exact: true });
}
async function builder(page: Page, s?: Locator) {
  if (!s) s = await summary(page);
  await s
    .getByRole('button', { name: 'Generuj raport PDF', exact: true })
    .click();
  return page.getByRole('dialog', {
    name: 'Raport PDF dla klienta',
    exact: true,
  });
}
async function prepare(panel: Locator) {
  await panel
    .getByRole('button', { name: 'Przygotuj podgląd raportu', exact: true })
    .click();
  await expect(
    panel.getByRole('region', { name: 'Podgląd raportu', exact: true }),
  ).toBeVisible();
  return panel.getByRole('article', {
    name: 'Treść raportu dla klienta',
    exact: true,
  });
}
async function download(page: Page, panel: Locator, name: string) {
  const event = page.waitForEvent('download');
  await panel.getByRole('button', { name, exact: true }).click();
  const file = await event,
    stream = await file.createReadStream(),
    chunks: Buffer[] = [];
  for await (const c of stream!) chunks.push(Buffer.from(c));
  return { name: file.suggestedFilename(), bytes: Buffer.concat(chunks) };
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
async function close(dialog: Locator) {
  await dialog
    .getByRole('button', { name: 'Zamknij okno', exact: true })
    .click();
}
async function image(page: Page, name: string) {
  const bytes = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 120;
    c.height = 80;
    c.getContext('2d')!.fillRect(0, 0, 120, 80);
    const b = await new Promise<Blob>((r) =>
      c.toBlob((b) => r(b!), 'image/png'),
    );
    return [...new Uint8Array(await b.arrayBuffer())];
  });
  return { name, mimeType: 'image/png', buffer: Buffer.from(bytes) };
}
async function upload(
  page: Page,
  gallery: Locator,
  name: string,
  category = 'before',
) {
  await gallery
    .getByRole('button', { name: 'Dodaj zdjęcia', exact: true })
    .click();
  await gallery
    .getByLabel('Zdjęcia z urządzenia', { exact: true })
    .setInputFiles(await image(page, name));
  await gallery
    .getByRole('combobox', { name: 'Kategoria zdjęcia', exact: true })
    .selectOption(category);
  await gallery
    .getByLabel('Opis zdjęcia', { exact: true })
    .fill('PRIVATE_PHOTO_DESCRIPTION');
  await gallery
    .getByRole('button', { name: 'Zapisz zdjęcia', exact: true })
    .click();
  await expect(
    gallery.getByText('Zdjęcia zapisane na tym urządzeniu.', { exact: true }),
  ).toBeVisible();
}
async function settings(page: Page) {
  await page
    .getByRole('button', {
      name: 'Ustawienia konta demonstracyjnego',
      exact: true,
    })
    .click();
  return page.getByRole('dialog', { name: 'Ustawienia', exact: true });
}

test('karta wizyty łączy zakres, czas, materiały, checklisty i czytelną nawigację', async ({
  page,
}) => {
  let d = fixture();
  d = applyWorkTemplate(
    d,
    'starter-lawn-v1',
    { kind: 'visit', jobId: 'job-1' },
    clock.getTime(),
  ).data;
  await seed(page, d);
  const before = await snapshot(page),
    detail = await job(page);
  await expect(
    detail.getByRole('navigation', {
      name: 'Nawigacja karty wizyty',
      exact: true,
    }),
  ).toBeVisible();
  await expect(detail).toContainText('Zakres zaplanowanych prac');
  const s = await summary(page, detail);
  await expect(s).toContainText('Anna Kowalska');
  await expect(s).toContainText('Ogród przy Lipowej');
  await expect(s).toContainText('03:47:00');
  await expect(s).toContainText('2,3456789');
  await expect(s).toContainText('Koszenie trawnika');
  await expect(s).toContainText('PRIVATE_JOB_NOTES');
  await expect(s).toContainText('Checklista jest niepełna');
  expect((await snapshot(page)).jobs).toEqual(before.jobs);
  await s
    .getByRole('button', { name: 'Otwórz notatki wizyty', exact: true })
    .click();
  await expect(detail.locator('[data-visit-section="notes"]')).toBeFocused();
});

test('publiczny opis, zalecenia i strefa zapisują się bez zmiany stopera i rozliczenia', async ({
  page,
}) => {
  await seed(page);
  const before = await snapshot(page),
    s = await summary(page);
  await s
    .getByLabel('Opis wykonanych prac dla klienta', { exact: true })
    .fill('Wykonano cięcie róż i uprzątnięto rabatę.');
  await s
    .getByLabel('Uwagi i zalecenia dla klienta', { exact: true })
    .fill('Podlewać po posadzeniu.');
  await s
    .getByRole('combobox', { name: 'Strefa wizyty', exact: true })
    .selectOption('zone');
  await expect(
    s.getByRole('button', { name: 'Generuj raport PDF', exact: true }),
  ).toBeDisabled();
  await s
    .getByRole('button', {
      name: 'Zapisz podsumowanie dla klienta',
      exact: true,
    })
    .click();
  await expect(
    s.getByRole('button', { name: 'Generuj raport PDF', exact: true }),
  ).toBeEnabled();
  const after = await snapshot(page);
  expect(after.jobs[0].visitDetails).toMatchObject({
    zoneId: 'zone',
    zoneName: 'Rabata różana',
    publicWork: 'Wykonano cięcie róż i uprzątnięto rabatę.',
  });
  expect(after.jobs[0].seconds).toBe(before.jobs[0].seconds);
  expect(after.jobs[0].settlement).toEqual(before.jobs[0].settlement);
  expect(after.payments).toEqual(before.payments);
  expect(after.timer).toEqual(before.timer);
  await page.reload();
  await expect(
    (await summary(page)).getByLabel('Uwagi i zalecenia dla klienta', {
      exact: true,
    }),
  ).toHaveValue('Podlewać po posadzeniu.');
});

test('PDF zawiera polskie znaki i publiczny opis, domyślnie bez finansów i prywatnych danych', async ({
  page,
}) => {
  await seed(page);
  const before = await snapshot(page),
    panel = await builder(page);
  await expect(
    panel.getByRole('checkbox', {
      name: 'Pokaż ceny i należności',
      exact: true,
    }),
  ).not.toBeChecked();
  await expect(
    panel.getByRole('checkbox', {
      name: 'Dołącz uwagi i zalecenia dla klienta',
      exact: true,
    }),
  ).not.toBeChecked();
  const paper = await prepare(panel);
  await expect(paper).toContainText('BRONIAREK OGRODY');
  await expect(paper).toContainText('Żółć');
  await expect(paper).not.toContainText('PRIVATE');
  await expect(paper).not.toContainText('Zatwierdzone rozliczenie');
  expect((await snapshot(page)).jobs[0].reports).toBeUndefined();
  const file = await download(page, panel, 'Zapisz raport i pobierz PDF');
  expect(file.name).toMatch(/^BO-2026-\d{6}-v1\.pdf$/);
  const text = await pdfText(file.bytes);
  expect(text).toContain('ĄĆĘŁŃÓŚŹŻ ąćęłńóśźż');
  expect(text).toContain('Pielęgnacja róż — Łódź');
  expect(text).not.toMatch(
    /PRIVATE|9,87|PRIVATE_PHONE|Zatwierdzone rozliczenie/,
  );
  const saved = await snapshot(page);
  expect(saved.jobs[0].reports).toHaveLength(1);
  expect(saved.jobs[0].settlement).toEqual(before.jobs[0].settlement);
  expect(saved.payments).toEqual(before.payments);
  expect(
    await page.evaluate(() => localStorage.getItem('garden-manager:v1')),
  ).not.toMatch(/base64|data:image|JVBER/);
});

test('jawne opcje finansów, checklist i zaleceń oraz wyłączenie czasu i materiałów działają w PDF', async ({
  page,
}) => {
  let d = fixture();
  d = applyWorkTemplate(
    d,
    'starter-lawn-v1',
    { kind: 'visit', jobId: 'job-1' },
    clock.getTime(),
  ).data;
  const c = d.checklists[0];
  d = editChecklistItem(
    d,
    c.id,
    c.revision,
    c.items[0].id,
    { status: 'done', note: 'PRIVATE_CHECKLIST_NOTE' },
    clock.getTime(),
  );
  d.jobs[0].visitDetails = {
    publicWork: 'Prace wykonane',
    clientRemarks: 'Zalecenie: podlewać róże.',
    zoneId: 'zone',
    zoneName: 'Rabata różana',
    updatedAt: clock.getTime(),
    revision: 1,
  };
  await seed(page, d);
  const panel = await builder(page);
  await panel
    .getByRole('checkbox', { name: 'Pokaż ceny i należności', exact: true })
    .check();
  await panel
    .getByRole('checkbox', { name: 'Pokaż checklisty i statusy', exact: true })
    .check();
  await panel
    .getByRole('checkbox', {
      name: 'Dołącz uwagi i zalecenia dla klienta',
      exact: true,
    })
    .check();
  await panel
    .getByRole('checkbox', { name: 'Pokaż czas pracy', exact: true })
    .uncheck();
  await panel
    .getByRole('checkbox', { name: 'Pokaż materiały i ilości', exact: true })
    .uncheck();
  const paper = await prepare(panel);
  await expect(paper).toContainText('Zatwierdzone rozliczenie');
  await expect(paper).toContainText('Zalecenie: podlewać róże.');
  const text = await pdfText(
    (await download(page, panel, 'Zapisz raport i pobierz PDF')).bytes,
  );
  expect(text).toContain('450,00');
  expect(text).toContain('373,46');
  expect(text).toContain('Wykonane: Kontrola terenu i przeszkód');
  expect(text).not.toMatch(
    /PRIVATE|Czas pracy|Wykorzystane materiały|Kora ogrodowa/,
  );
  expect((await snapshot(page)).jobs[0].settlement).toEqual(
    d.jobs[0].settlement,
  );
});

test('raport ze zdjęciami PRZED/PO oraz logo korzysta z istniejących identyfikatorów', async ({
  page,
}) => {
  await seed(page);
  const detail = await job(page),
    gallery = detail.getByRole('region', {
      name: 'Galeria zlecenia i wizyty',
      exact: true,
    });
  await upload(page, gallery, 'przed.png', 'before');
  await upload(page, gallery, 'po.png', 'after');
  const panel = await builder(page, await summary(page, detail));
  await panel
    .getByRole('checkbox', {
      name: 'Dołącz wybrane zdjęcia PRZED/PO',
      exact: true,
    })
    .check();
  await panel
    .getByRole('checkbox', { name: 'Dołącz zdjęcie przed.png', exact: true })
    .check();
  await panel
    .getByRole('checkbox', { name: 'Dołącz zdjęcie po.png', exact: true })
    .check();
  await panel.getByText('Opcjonalne logo firmy', { exact: true }).click();
  await panel
    .getByLabel('Dodaj logo do galerii wizyty', { exact: true })
    .setInputFiles(await image(page, 'logo.png'));
  await expect(
    panel
      .getByRole('combobox', {
        name: 'Logo z galerii wizyty lub ogrodu',
        exact: true,
      })
      .getByRole('option', { name: 'logo.png', exact: true }),
  ).toHaveCount(1);
  const logo = (await snapshot(page)).photos.find(
    (p) => p.filename === 'logo.png',
  )!;
  await panel
    .getByRole('combobox', {
      name: 'Logo z galerii wizyty lub ogrodu',
      exact: true,
    })
    .selectOption(logo.id);
  const before = await snapshot(page),
    paper = await prepare(panel);
  await expect(paper.locator('.report-photo-grid img')).toHaveCount(2);
  await expect(paper.locator('.report-logo img')).toHaveCount(1);
  expect(
    await paper
      .locator('img')
      .evaluateAll((images) =>
        images.every(
          (image) => !(image as HTMLImageElement).alt.includes('PRIVATE'),
        ),
      ),
  ).toBe(true);
  const file = await download(page, panel, 'Zapisz raport i pobierz PDF'),
    text = await pdfText(file.bytes);
  expect(text).toContain('PRZED PRACĄ');
  expect(text).toContain('PO PRACY');
  expect(text).not.toContain('PRIVATE_PHOTO_DESCRIPTION');
  const saved = await snapshot(page);
  expect(saved.photos).toEqual(before.photos);
  expect(
    saved.jobs[0].reports?.[0].snapshot.photos.map((p) => p.photoId),
  ).toEqual(
    before.photos.filter((p) => p.category !== 'other').map((p) => p.id),
  );
  expect(saved.jobs[0].reports?.[0].snapshot.logo?.photoId).toBe(logo.id);
  await close(panel);
  await close(
    page.getByRole('dialog', { name: 'Podsumowanie wizyty', exact: true }),
  );
  await gallery
    .getByRole('button', { name: 'Usuń zdjęcie przed.png', exact: true })
    .click();
  const removal = page.getByRole('dialog', {
    name: 'Usunąć zdjęcie?',
    exact: true,
  });
  await expect(removal).toContainText('używane w zapisanej wersji raportu');
  await removal.getByRole('button', { name: 'Anuluj', exact: true }).click();
});

test('brak zdjęcia w IndexedDB pokazuje błąd i nie zapisuje uszkodzonego raportu', async ({
  page,
}) => {
  await seed(page);
  const detail = await job(page),
    gallery = detail.getByRole('region', {
      name: 'Galeria zlecenia i wizyty',
      exact: true,
    });
  await upload(page, gallery, 'brak.png');
  const photo = (await snapshot(page)).photos[0];
  await page.evaluate(
    (id) =>
      new Promise<void>((resolve, reject) => {
        const r = indexedDB.open('garden-manager-photos', 1);
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction('assets', 'readwrite');
          tx.objectStore('assets').delete(id);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    photo.assetId,
  );
  const panel = await builder(page, await summary(page, detail));
  await panel
    .getByRole('checkbox', {
      name: 'Dołącz wybrane zdjęcia PRZED/PO',
      exact: true,
    })
    .check();
  await panel
    .getByRole('checkbox', { name: 'Dołącz zdjęcie brak.png', exact: true })
    .check();
  await panel
    .getByRole('button', { name: 'Przygotuj podgląd raportu', exact: true })
    .click();
  await expect(panel.getByRole('alert')).toContainText('Brak lub uszkodzenie');
  expect((await snapshot(page)).jobs[0].reports).toBeUndefined();
  await expect(
    panel.getByRole('button', {
      name: 'Zapisz raport i pobierz PDF',
      exact: true,
    }),
  ).toHaveCount(0);
});

test('brak czcionki daje czytelny komunikat bez utraty danych', async ({
  page,
}) => {
  await seed(page);
  await page.route('**/fonts/*.ttf', (route) => route.abort());
  const before = await snapshot(page),
    panel = await builder(page);
  await panel
    .getByRole('button', { name: 'Przygotuj podgląd raportu', exact: true })
    .click();
  await expect(panel.getByRole('alert')).toContainText('czcionki');
  expect(await snapshot(page)).toEqual(before);
});

test('ponowne pobranie nie duplikuje historii, zmiana opisu tworzy wersję i zachowuje poprzednią', async ({
  page,
}) => {
  await seed(page);
  const s = await summary(page);
  let panel = await builder(page, s);
  await prepare(panel);
  const original = await download(page, panel, 'Zapisz raport i pobierz PDF'),
    record = (await snapshot(page)).jobs[0].reports![0];
  await prepare(panel);
  await download(page, panel, 'Zapisz raport i pobierz PDF');
  expect((await snapshot(page)).jobs[0].reports).toHaveLength(1);
  await close(panel);
  await s
    .getByLabel('Opis wykonanych prac dla klienta', { exact: true })
    .fill('NOWY ZAKRES wykonanych prac.');
  await s
    .getByRole('button', {
      name: 'Zapisz podsumowanie dla klienta',
      exact: true,
    })
    .click();
  panel = await builder(page, s);
  await prepare(panel);
  await download(page, panel, 'Zapisz raport i pobierz PDF');
  const history = (await snapshot(page)).jobs[0].reports!;
  expect(history).toHaveLength(2);
  expect(history[0]).toEqual(record);
  expect(history[1].number).toBe(record.number);
  expect(history[1].version).toBe(2);
  const old = await download(page, panel, 'Pobierz ponownie wersję 1');
  expect(await pdfText(old.bytes)).toBe(await pdfText(original.bytes));
  expect(await pdfText(old.bytes)).not.toContain('NOWY ZAKRES');
  await panel
    .getByRole('button', { name: 'Podgląd wersji 1', exact: true })
    .click();
  await expect(
    panel.getByRole('article', {
      name: 'Treść raportu dla klienta',
      exact: true,
    }),
  ).not.toContainText('NOWY ZAKRES');
});

test('zmiana płatności po podglądzie blokuje zapis starego rozliczenia i zachowuje wpłatę', async ({
  page,
}) => {
  await seed(page);
  const panel = await builder(page);
  await panel
    .getByRole('checkbox', { name: 'Pokaż ceny i należności', exact: true })
    .check();
  await prepare(panel);
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('garden-manager:v1')!);
    raw.data.payments[0].amountCents = 11000;
    localStorage.setItem('garden-manager:v1', JSON.stringify(raw));
  });
  await panel
    .getByRole('button', { name: 'Zapisz raport i pobierz PDF', exact: true })
    .click();
  await expect(panel.getByRole('alert')).toContainText('zmieniły');
  expect((await snapshot(page)).payments[0].amountCents).toBe(11000);
  expect((await snapshot(page)).jobs[0].reports).toBeUndefined();
});

test('historia przerw i korekt korzysta z jednego stopera, bez przypadkowej zmiany czasu przy podsumowaniu', async ({
  page,
}) => {
  await seed(page, fixture(false));
  await page.clock.setFixedTime(clock);
  const detail = await job(page, false);
  await detail
    .getByRole('button', { name: 'START — Rozpocznij wizytę', exact: true })
    .click();
  await page.clock.setFixedTime(new Date(clock.getTime() + 15750));
  await detail
    .getByRole('button', {
      name: 'PAUZA — Przerwa bez naliczania',
      exact: true,
    })
    .click();
  await page.clock.setFixedTime(new Date(clock.getTime() + 46000));
  const before = await snapshot(page),
    s = await summary(page, detail);
  expect((await snapshot(page)).timer).toEqual(before.timer);
  await expect(
    s.getByRole('button', { name: 'Generuj raport PDF', exact: true }),
  ).toBeDisabled();
  await close(s);
  await detail
    .getByRole('button', { name: 'WZNÓW — Kontynuuj wizytę', exact: true })
    .click();
  await page.clock.setFixedTime(new Date(clock.getTime() + 56250));
  await detail
    .getByRole('button', { name: 'STOP — Zakończ pomiar', exact: true })
    .click();
  expect((await snapshot(page)).jobs[0].seconds).toBe(26);
  await detail
    .getByText('Historia przerw i korekt · 4 zdarzeń', { exact: true })
    .click();
  await expect(detail.locator('.visit-time-history')).toContainText(
    'przerwa 00:00:30,250',
  );
  await detail
    .getByRole('button', { name: 'Popraw czas pracy', exact: true })
    .click();
  const correction = detail.getByRole('region', {
    name: 'Ręczna korekta czasu pracy',
    exact: true,
  });
  await correction.getByLabel('Minuty', { exact: true }).fill('1');
  await correction.getByLabel('Sekundy', { exact: true }).fill('5');
  await correction
    .getByRole('button', { name: 'Zapisz korektę czasu', exact: true })
    .click();
  await correction
    .getByRole('button', { name: 'Potwierdź korektę czasu', exact: true })
    .click();
  expect((await snapshot(page)).jobs[0].timeHistory?.at(-1)).toMatchObject({
    kind: 'corrected',
    beforeSeconds: 26,
    afterSeconds: 65,
  });
  await detail.getByRole('button', { name: 'Zakończ', exact: true }).click();
  await detail
    .getByRole('button', { name: 'Anuluj wycenę', exact: true })
    .click();
  const finished = await summary(page, detail);
  await expect(
    finished.getByRole('button', { name: 'Generuj raport PDF', exact: true }),
  ).toBeEnabled();
  expect((await snapshot(page)).jobs[0].settlement).toBeNull();
});

test('niepełna checklista pozwala zakończyć i raportować wizytę bez wymuszania zatwierdzenia ceny', async ({
  page,
}) => {
  let d = fixture(false);
  d = applyWorkTemplate(
    d,
    'starter-lawn-v1',
    { kind: 'visit', jobId: 'job-1' },
    clock.getTime(),
  ).data;
  await seed(page, d);
  const detail = await job(page, false);
  await detail.getByRole('button', { name: 'Zakończ', exact: true }).click();
  await detail
    .getByRole('button', { name: 'Anuluj wycenę', exact: true })
    .click();
  const s = await summary(page, detail);
  await expect(s).toContainText('Checklista jest niepełna');
  const panel = await builder(page, s);
  await prepare(panel);
  await download(page, panel, 'Zapisz raport i pobierz PDF');
  expect((await snapshot(page)).jobs[0].reports).toHaveLength(1);
  expect((await snapshot(page)).jobs[0].settlement).toBeNull();
});

test('migracja v8 i eksport JSON zachowują stare dane oraz metadane raportu', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const old = fixture();
  delete (old as Partial<Data>).reportSequence;
  await seed(page, old, 8);
  const migrated = await page.evaluate(() => ({
    old: JSON.parse(localStorage.getItem('garden-manager:backup:v8')!),
    current: JSON.parse(localStorage.getItem('garden-manager:v1')!),
  }));
  expect(migrated.old).toEqual({ version: 8, data: old });
  expect(migrated.current.data).toEqual({ ...old, reportSequence: 0 });
  const panel = await builder(page);
  await prepare(panel);
  await download(page, panel, 'Zapisz raport i pobierz PDF');
  await close(panel);
  await close(
    page.getByRole('dialog', { name: 'Podsumowanie wizyty', exact: true }),
  );
  await close(
    page.getByRole('dialog', { name: 'Szczegóły zlecenia', exact: true }),
  );
  const set = await settings(page),
    json = JSON.parse(
      (await download(page, set, 'Eksportuj dane')).bytes.toString(),
    );
  expect(json.version).toBe(STORAGE_VERSION);
  expect(json.data.jobs[0].reports).toEqual(
    (await snapshot(page)).jobs[0].reports,
  );
  expect(json.data.reportSequence).toBe(1);
  expect(json.data).not.toHaveProperty('pdf');
});

test('pełna kopia ZIP odtwarza podsumowanie, raporty i zdjęcia oraz ponowną generację PDF', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await seed(page);
  const detail = await job(page),
    gallery = detail.getByRole('region', {
      name: 'Galeria zlecenia i wizyty',
      exact: true,
    });
  await upload(page, gallery, 'zip-przed.png');
  const s = await summary(page, detail);
  let panel = await builder(page, s);
  await panel
    .getByRole('checkbox', {
      name: 'Dołącz wybrane zdjęcia PRZED/PO',
      exact: true,
    })
    .check();
  await panel
    .getByRole('checkbox', {
      name: 'Dołącz zdjęcie zip-przed.png',
      exact: true,
    })
    .check();
  await prepare(panel);
  const originalPdf = await download(
    page,
    panel,
    'Zapisz raport i pobierz PDF',
  );
  await close(panel);
  await close(s);
  await close(detail);
  const original = await snapshot(page);
  let set = await settings(page);
  const zip = await download(page, set, 'Pobierz pełną kopię ZIP');
  await close(set);
  const changed = await summary(page);
  await changed
    .getByLabel('Opis wykonanych prac dla klienta', { exact: true })
    .fill('ZMIANA DO COFNIĘCIA');
  await changed
    .getByRole('button', {
      name: 'Zapisz podsumowanie dla klienta',
      exact: true,
    })
    .click();
  await close(changed);
  await close(
    page.getByRole('dialog', { name: 'Szczegóły zlecenia', exact: true }),
  );
  set = await settings(page);
  await set
    .getByLabel('Wczytaj pełną kopię ZIP', { exact: true })
    .setInputFiles({
      name: 'reports.zip',
      mimeType: 'application/zip',
      buffer: zip.bytes,
    });
  await set
    .getByRole('checkbox', {
      name: 'Rozumiem, że bieżący zestaw zostanie zastąpiony.',
      exact: true,
    })
    .check();
  await set.getByLabel('Wpisz ODTWÓRZ', { exact: true }).fill('ODTWÓRZ');
  await set
    .getByRole('button', { name: 'Odtwórz dane i zdjęcia', exact: true })
    .click();
  await expect(
    set.getByText(/Dane i zdjęcia zostały odtworzone/).last(),
  ).toBeVisible();
  await page.reload();
  expect((await snapshot(page)).jobs).toEqual(original.jobs);
  expect((await snapshot(page)).payments).toEqual(original.payments);
  panel = await builder(page);
  const restored = await download(page, panel, 'Pobierz ponownie wersję 1');
  expect(await pdfText(restored.bytes)).toBe(await pdfText(originalPdf.bytes));
});

test('telefon: podsumowanie, opcje, podgląd i pobranie PDF mieszczą się w ekranie', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page);
  await page.getByRole('button', { name: 'Więcej', exact: true }).click();
  await page
    .locator('.mobile-more')
    .getByRole('button', { name: 'Historia prac', exact: true })
    .click();
  await page
    .locator('.job-title-button')
    .filter({ hasText: 'Zakres zaplanowany' })
    .click();
  const detail = page.getByRole('dialog', {
      name: 'Szczegóły zlecenia',
      exact: true,
    }),
    s = await summary(page, detail);
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  const panel = await builder(page, s);
  await prepare(panel);
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  const file = await download(page, panel, 'Zapisz raport i pobierz PDF');
  expect(file.bytes.slice(0, 5).toString()).toBe('%PDF-');
});

test('dwie karty zapisują raporty z unikalnymi numerami i odrzucają drugi nieaktualny podgląd', async ({
  page,
  context,
}) => {
  test.setTimeout(60_000);
  const d = fixture();
  d.jobs[1] = {
    ...d.jobs[1],
    title: 'Druga wizyta',
    status: 'completed',
    seconds: 3600,
    settlement: null,
  };
  await seed(page, d);
  const first = await builder(page);
  await prepare(first);
  const secondPage = await context.newPage(),
    errors: string[] = [];
  secondPage.on('pageerror', (e) => errors.push(e.message));
  await secondPage.clock.install({ time: clock });
  await secondPage.goto('/#history');
  await secondPage
    .locator('.job-title-button')
    .filter({ hasText: 'Druga wizyta' })
    .click();
  const secondSummary = await summary(
      secondPage,
      secondPage.getByRole('dialog', {
        name: 'Szczegóły zlecenia',
        exact: true,
      }),
    ),
    second = await builder(secondPage, secondSummary);
  await prepare(second);
  let downloads = 0;
  page.on('download', () => downloads++);
  secondPage.on('download', () => downloads++);
  await Promise.all([
    first
      .getByRole('button', { name: 'Zapisz raport i pobierz PDF', exact: true })
      .click(),
    second
      .getByRole('button', { name: 'Zapisz raport i pobierz PDF', exact: true })
      .click(),
  ]);
  await expect.poll(async () => (await snapshot(page)).reportSequence).toBe(1);
  await expect.poll(() => downloads).toBe(1);
  const current = await snapshot(page),
    loser = current.jobs[0].reports?.length ? second : first,
    loserPage = current.jobs[0].reports?.length ? secondPage : page;
  await expect(loser.getByRole('alert')).toContainText('zmieniły');
  await prepare(loser);
  await download(loserPage, loser, 'Zapisz raport i pobierz PDF');
  const saved = await snapshot(page);
  expect(saved.reportSequence).toBe(2);
  expect(saved.jobs[0].reports?.[0].number).not.toBe(
    saved.jobs[1].reports?.[0].number,
  );
  expect(saved.payments).toEqual(d.payments);
  expect(errors).toEqual([]);
  await secondPage.close();
});
