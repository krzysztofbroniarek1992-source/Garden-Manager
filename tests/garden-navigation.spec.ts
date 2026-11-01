import {
  test as base,
  expect,
  type Page,
  type Locator,
} from '@playwright/test';
import { createDemoData } from '../src/data/demo';
import { STORAGE_VERSION, validateData } from '../src/data/repository';
import type { Data, Job } from '../src/domain';
import { newNote } from '../src/desk/model';
import { saveNote } from '../src/desk/commands';
import { createBlankChecklist } from '../src/checklists/commands';

const clock = new Date('2026-11-01T10:00:00+01:00');
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
function fixture(): Data {
  const d = createDemoData(clock);
  d.clients = [
    {
      id: 'anna',
      name: 'Anna Ogrodowa',
      phone: '600111222',
      email: 'anna@example.test',
      notes: 'Ważna notatka klienta',
    },
    { id: 'jan', name: 'Jan Inny', phone: '', email: '', notes: '' },
  ];
  d.gardens = [
    {
      id: 'garden-a',
      clientId: 'anna',
      name: 'Ogród przy domu',
      address: 'ul. Lipowa 10',
      area: 500,
      notes: 'Notatka ogrodu',
      zones: [
        {
          id: 'zone',
          name: 'Rabata różana',
          type: 'rabata',
          area: 40,
          length: null,
          plants: 'Róże',
          requirements: 'Podlewanie rano',
          treatments: '2026-10-30: cięcie',
        },
      ],
    },
    {
      id: 'garden-b',
      clientId: 'anna',
      name: 'Ogród za miastem',
      address: 'Leśna 2',
      area: 700,
      notes: '',
      zones: [],
    },
    {
      id: 'garden-c',
      clientId: 'jan',
      name: 'Ogród innego klienta',
      address: 'Polna 7',
      area: 50,
      notes: '',
      zones: [],
    },
  ];
  const job = (
    id: string,
    title: string,
    date: string,
    changes: Partial<Job> = {},
  ): Job => ({
    id,
    title,
    date,
    gardenId: 'garden-a',
    time: '08:00',
    status: 'planned',
    billing: 'hourly',
    rate: 120,
    fixedPrice: 0,
    seconds: 0,
    materials: [],
    notes: '',
    activities: ['Pielęgnacja'],
    settlement: null,
    ...changes,
  });
  const settled = (
    j: Job,
    labor: number,
    materials = 0,
    source: 'manual' | 'fixed' | 'legacy' = 'manual',
  ): Job => ({
    ...j,
    status: 'completed',
    settlement: {
      calculatedLaborCents: 45400,
      suggestedLaborCents: source === 'manual' ? 45000 : null,
      finalLaborCents: labor,
      materialsCents: materials,
      approvedAt: clock.getTime(),
      source,
    },
  });
  d.jobs = [
    settled(
      job('manual', 'Wizyta z wpłatą', '2026-11-01', {
        seconds: 3601,
        materials: [
          {
            id: 'm',
            name: 'Kora',
            quantity: 3,
            unit: 'l',
            unitPrice: 29,
            purchaseUnitPrice: 12,
          },
        ],
      }),
      45000,
      8700,
    ),
    job('planned', 'Plan na listopad', '2026-11-01'),
    job('pending', 'Cena do zatwierdzenia', '2026-11-02', {
      status: 'completed',
      seconds: 59,
    }),
    settled(
      job('fixed', 'Ryczałt październikowy', '2026-10-20', {
        billing: 'fixed',
        fixedPrice: 454,
        seconds: 600,
      }),
      45400,
      0,
      'fixed',
    ),
    settled(
      job('legacy', 'Archiwalne 541 zł', '2025-12-20', { seconds: 120 }),
      54100,
      0,
      'legacy',
    ),
    job('second', 'Zlecenie drugiego ogrodu', '2026-11-01', {
      gardenId: 'garden-b',
    }),
    job('foreign', 'Nie należy do Anny', '2026-11-01', {
      gardenId: 'garden-c',
    }),
  ];
  d.payments = [
    {
      id: 'partial',
      jobId: 'manual',
      amountCents: 20000,
      receivedDate: '2026-11-01',
      method: 'transfer',
      note: 'Zachowana wpłata',
    },
  ];
  d.timer = null;
  d.notes = [];
  d.todos = [];
  d.photos = [];
  d.checklists = [];
  d.taskSchedules = [];
  d.taskOccurrences = [];
  return d;
}
async function seed(page: Page, d = fixture()) {
  validateData(d);
  await page.clock.install({ time: clock });
  await page.goto('/');
  await page.evaluate(
    ({ data, version }) =>
      localStorage.setItem(
        'garden-manager:v1',
        JSON.stringify({ version, data }),
      ),
    { data: d, version: STORAGE_VERSION },
  );
  await page.reload();
}
const snapshot = (page: Page): Promise<Data> =>
  page.evaluate(
    () => JSON.parse(localStorage.getItem('garden-manager:v1')!).data,
  );
async function openGarden(
  page: Page,
  name = 'Ogród przy domu',
): Promise<Locator> {
  await page.goto('/#gardens');
  await page
    .getByRole('button', { name: `Karta ogrodu ${name}`, exact: true })
    .click();
  return page.getByRole('dialog', {
    name: `Karta ogrodu: ${name}`,
    exact: true,
  });
}
async function history(card: Locator) {
  await card
    .getByRole('tab', { name: 'Zlecenia i historia prac', exact: true })
    .click();
  return card.getByRole('tabpanel', {
    name: 'Zlecenia i historia prac',
    exact: true,
  });
}
const detail = (page: Page) =>
  page.getByRole('dialog', { name: 'Szczegóły zlecenia', exact: true });

test('szkic edycji wizyty nie nadpisuje nowszej zmiany z drugiej karty', async ({
  page,
  context,
}) => {
  await seed(page);
  const card = await openGarden(page);
  await history(card);
  await card
    .getByRole('button', {
      name: 'Szczegóły zlecenia Plan na listopad',
      exact: true,
    })
    .click();
  const visit = detail(page);
  await visit
    .getByRole('button', { name: 'Edytuj zlecenie', exact: true })
    .click();
  await visit
    .getByLabel('Nazwa pracy', { exact: true })
    .fill('Nieaktualny szkic');
  const second = await context.newPage();
  await second.clock.install({ time: clock });
  const other = await openGarden(second);
  await history(other);
  await other
    .getByRole('button', {
      name: 'Edytuj zlecenie Plan na listopad',
      exact: true,
    })
    .click();
  const form = second.getByRole('dialog', {
    name: 'Edytuj zlecenie',
    exact: true,
  });
  await form
    .getByLabel('Notatka', { exact: true })
    .fill('Ważna zmiana w drugiej karcie');
  await form
    .getByRole('button', { name: 'Zapisz zlecenie', exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await snapshot(page)).jobs.find((j) => j.id === 'planned')?.notes,
    )
    .toBe('Ważna zmiana w drugiej karcie');
  await visit
    .getByRole('button', { name: 'Zapisz zlecenie', exact: true })
    .click();
  await expect(visit.getByRole('alert')).toContainText('innej karcie');
  expect(
    (await snapshot(page)).jobs.find((j) => j.id === 'planned'),
  ).toMatchObject({
    title: 'Plan na listopad',
    notes: 'Ważna zmiana w drugiej karcie',
  });
  await second.close();
});

test('zmiana zlecenia w drugiej karcie unieważnia otwarte potwierdzenie usunięcia', async ({
  page,
  context,
}) => {
  await seed(page);
  const card = await openGarden(page);
  await history(card);
  await card
    .getByRole('button', {
      name: 'Usuń zlecenie Plan na listopad',
      exact: true,
    })
    .click();
  const confirm = page.getByRole('dialog', {
    name: 'Usunąć zlecenie?',
    exact: true,
  });
  await confirm.getByRole('checkbox').check();
  const second = await context.newPage();
  await second.clock.install({ time: clock });
  const other = await openGarden(second);
  await history(other);
  await other
    .getByRole('button', {
      name: 'Edytuj zlecenie Plan na listopad',
      exact: true,
    })
    .click();
  const form = second.getByRole('dialog', {
    name: 'Edytuj zlecenie',
    exact: true,
  });
  await form
    .getByLabel('Nazwa pracy', { exact: true })
    .fill('Wizyta po korekcie');
  await form
    .getByRole('button', { name: 'Zapisz zlecenie', exact: true })
    .click();
  await expect(confirm.getByRole('alert')).toContainText('zmieniły');
  await expect(
    confirm.getByRole('button', { name: 'Usuń zlecenie', exact: true }),
  ).toBeDisabled();
  expect(
    (await snapshot(page)).jobs.find((j) => j.id === 'planned')?.title,
  ).toBe('Wizyta po korekcie');
  await second.close();
});

test('z klienta można otworzyć każdy ogród nazwą i przyciskiem, wracając do właściwego klienta', async ({
  page,
}) => {
  await seed(page);
  await page.goto('/#clients');
  await page
    .getByRole('button', { name: 'Anna Ogrodowa', exact: true })
    .click();
  await page
    .getByLabel('Filtr statusu wykonania', { exact: true })
    .selectOption('completed');
  for (const [index, name] of [
    'Ogród przy domu',
    'Ogród za miastem',
  ].entries()) {
    const item = page.locator('.client-garden').filter({
      has: page.getByRole('button', {
        name: `Otwórz ogród ${name}`,
        exact: true,
      }),
    });
    await item
      .getByRole('button', {
        name: index === 0 ? `Otwórz ogród ${name}` : 'Otwórz ogród',
        exact: true,
      })
      .click();
    const card = page.getByRole('dialog', {
      name: `Karta ogrodu: ${name}`,
      exact: true,
    });
    await expect(card).toBeVisible();
    await expect(
      card.getByRole('tab', { name: 'Przegląd', exact: true }),
    ).toHaveAttribute('aria-selected', 'true');
    await card
      .getByRole('button', { name: 'Klient: Anna Ogrodowa', exact: true })
      .click();
    await expect(card).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: 'Anna Ogrodowa', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByLabel('Filtr statusu wykonania', { exact: true }),
    ).toHaveValue('completed');
  }
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe(
    'hidden',
  );
});
test('lista ogrodów otwiera tę samą pełną kartę i zachowuje wyszukiwanie po powrocie', async ({
  page,
}) => {
  await seed(page);
  await page.goto('/#gardens');
  await page.getByLabel('Szukaj ogrodów', { exact: true }).fill('przy domu');
  await page
    .getByRole('button', { name: 'Karta ogrodu Ogród przy domu', exact: true })
    .click();
  const card = page.getByRole('dialog', {
    name: 'Karta ogrodu: Ogród przy domu',
    exact: true,
  });
  await card
    .getByRole('button', { name: 'Edytuj dane ogrodu', exact: true })
    .click();
  const form = page.getByRole('dialog', { name: 'Edytuj ogród', exact: true });
  await form.getByLabel('Adres *', { exact: true }).fill('ul. Lipowa 12');
  await form
    .getByRole('button', { name: 'Zapisz zmiany', exact: true })
    .click();
  await expect(card).toContainText('ul. Lipowa 12');
  await card
    .getByRole('button', { name: 'Wróć do listy ogrodów', exact: false })
    .click();
  await expect(page.getByLabel('Szukaj ogrodów', { exact: true })).toHaveValue(
    'przy domu',
  );
  expect((await snapshot(page)).gardens[0].address).toBe('ul. Lipowa 12');
});
test('klient → ogród → zlecenie → ogród zachowuje sekcję, filtr i rozwinięty miesiąc', async ({
  page,
}) => {
  await seed(page);
  await page.goto('/#clients');
  await page
    .getByRole('button', { name: 'Anna Ogrodowa', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Otwórz ogród Ogród przy domu', exact: true })
    .click();
  const card = page.getByRole('dialog', {
    name: 'Karta ogrodu: Ogród przy domu',
    exact: true,
  });
  const list = await history(card);
  await card
    .getByLabel('Filtr statusu zleceń ogrodu', { exact: true })
    .selectOption('completed');
  const october = list.locator('[data-month="2026-10"]');
  await october.locator('summary').click();
  await october
    .getByRole('button', {
      name: 'Szczegóły zlecenia Ryczałt październikowy',
      exact: true,
    })
    .click();
  await detail(page)
    .getByRole('button', { name: 'Ogród: Ogród przy domu', exact: true })
    .click();
  await expect(
    card.getByRole('tab', { name: 'Zlecenia i historia prac', exact: true }),
  ).toHaveAttribute('aria-selected', 'true');
  await expect(
    card.getByLabel('Filtr statusu zleceń ogrodu', { exact: true }),
  ).toHaveValue('completed');
  await expect(october).toHaveAttribute('open', '');
  await expect(
    october.getByRole('button', {
      name: 'Szczegóły zlecenia Ryczałt październikowy',
      exact: true,
    }),
  ).toBeVisible();
  await card
    .getByRole('button', { name: 'Klient: Anna Ogrodowa', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Anna Ogrodowa', exact: true }),
  ).toBeVisible();
});
test('zlecenie z głównej listy prowadzi do ogrodu i klienta, a powrót odtwarza szczegóły wizyty', async ({
  page,
}) => {
  await seed(page);
  await page.goto('/#jobs');
  await page
    .locator('.job-title-button')
    .filter({ hasText: 'Plan na listopad' })
    .click();
  await detail(page)
    .getByRole('button', { name: 'Ogród: Ogród przy domu', exact: true })
    .click();
  const garden = page.getByRole('dialog', {
    name: 'Karta ogrodu: Ogród przy domu',
    exact: true,
  });
  await garden
    .getByRole('button', { name: 'Klient: Anna Ogrodowa', exact: true })
    .click();
  const client = page.getByRole('dialog', {
    name: 'Karta klienta: Anna Ogrodowa',
    exact: true,
  });
  await expect(
    client.getByRole('heading', { name: 'Anna Ogrodowa', exact: true }),
  ).toBeVisible();
  await client
    .getByRole('button', {
      name: 'Wróć do ogrodu Ogród przy domu',
      exact: false,
    })
    .click();
  await expect(garden).toBeVisible();
  await garden
    .getByRole('button', { name: 'Wróć do zlecenia', exact: false })
    .click();
  await expect(
    detail(page).getByRole('heading', {
      name: 'Plan na listopad',
      exact: true,
    }),
  ).toBeVisible();
});
test('nowe zlecenie korzysta z dotychczasowego formularza z przypisanym klientem i ogrodem oraz przetrwa odświeżenie', async ({
  page,
}) => {
  await seed(page);
  const before = await snapshot(page),
    card = await openGarden(page);
  await card
    .getByRole('button', { name: 'Dodaj zlecenie', exact: true })
    .click();
  const form = page.getByRole('dialog', { name: 'Nowe zlecenie', exact: true });
  await expect(
    form.getByRole('combobox', { name: 'Klient', exact: true }),
  ).toHaveValue('anna');
  await expect(
    form.getByRole('combobox', { name: 'Ogród i klient', exact: true }),
  ).toHaveValue('garden-a');
  await form
    .getByLabel('Nazwa pracy', { exact: true })
    .fill('Nowa praca z ogrodu');
  await form
    .getByRole('button', { name: 'Zapisz zlecenie', exact: true })
    .click();
  await expect(
    detail(page).getByRole('heading', {
      name: 'Nowa praca z ogrodu',
      exact: true,
    }),
  ).toBeVisible();
  const d = await snapshot(page);
  expect(d.jobs.at(-1)).toMatchObject({
    gardenId: 'garden-a',
    title: 'Nowa praca z ogrodu',
    status: 'planned',
    seconds: 0,
  });
  expect(d.timer).toBeNull();
  expect(d.payments).toEqual(before.payments);
  await page.reload();
  const reopened = await openGarden(page);
  await history(reopened);
  await expect(
    reopened.getByRole('button', {
      name: 'Szczegóły zlecenia Nowa praca z ogrodu',
      exact: true,
    }),
  ).toBeVisible();
  expect((await snapshot(page)).jobs.at(-1)?.id).toBe(d.jobs.at(-1)?.id);
});
test('edycja z ogrodu otwiera istniejący formularz, zachowuje zatwierdzoną kwotę i częściowe płatności', async ({
  page,
}) => {
  await seed(page);
  const before = await snapshot(page),
    card = await openGarden(page);
  await history(card);
  await card
    .getByRole('button', {
      name: 'Edytuj zlecenie Wizyta z wpłatą',
      exact: true,
    })
    .click();
  const form = page.getByRole('dialog', {
    name: 'Edytuj zlecenie',
    exact: true,
  });
  await form
    .getByLabel('Nazwa pracy', { exact: true })
    .fill('Uzupełniony opis wizyty');
  await form.getByLabel('Stawka (zł/h)', { exact: true }).fill('9999');
  await form
    .getByRole('button', { name: 'Zapisz zlecenie', exact: true })
    .click();
  const d = await snapshot(page);
  expect(d.jobs[0].settlement).toEqual(before.jobs[0].settlement);
  expect(d.jobs[0].seconds).toBe(before.jobs[0].seconds);
  expect(d.payments).toEqual(before.payments);
  await expect(detail(page)).toContainText('537,00');
});
test('zlecenia rozliczone są chronione z informacją o przyczynie', async ({
  page,
}) => {
  await seed(page);
  const before = await snapshot(page),
    card = await openGarden(page);
  await history(card);
  await card
    .getByRole('button', { name: 'Usuń zlecenie Wizyta z wpłatą', exact: true })
    .click();
  const confirm = page.getByRole('dialog', {
    name: 'Usunąć zlecenie?',
    exact: true,
  });
  await expect(confirm).toContainText('ma płatności');
  await expect(confirm).toContainText('zatwierdzone rozliczenie');
  await expect(
    confirm.getByRole('button', { name: 'Usuń zlecenie', exact: true }),
  ).toBeDisabled();
  await confirm.getByRole('button', { name: 'Anuluj', exact: true }).click();
  await card.locator('[data-month="2026-10"] summary').click();
  await card
    .getByRole('button', {
      name: 'Usuń zlecenie Ryczałt październikowy',
      exact: true,
    })
    .click();
  await expect(confirm).toContainText('zatwierdzone rozliczenie');
  await expect(
    confirm.getByRole('button', { name: 'Usuń zlecenie', exact: true }),
  ).toBeDisabled();
  expect(await snapshot(page)).toEqual(before);
});
test('świadome usunięcie niezatwierdzonego zlecenia zachowuje zdjęcia, notatki i checklisty przy ogrodzie', async ({
  page,
}) => {
  let d = fixture();
  d = saveNote(
    d,
    {
      ...newNote(d, { jobId: 'planned' }),
      title: 'Dokumentacja wizyty',
      body: 'Zachować',
    },
    clock.getTime(),
  );
  d = createBlankChecklist(
    d,
    { kind: 'visit', jobId: 'planned' },
    'Lista wizyty',
    clock.getTime(),
  ).data;
  await seed(page, d);
  const card = await openGarden(page);
  await card.getByRole('tab', { name: 'Galeria', exact: true }).click();
  const gallery = card.getByRole('region', {
    name: 'Galeria i historia ogrodu',
    exact: true,
  });
  await gallery
    .getByRole('button', { name: 'Dodaj zdjęcia', exact: true })
    .click();
  const bytes = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 60;
    c.height = 40;
    c.getContext('2d')!.fillRect(0, 0, 60, 40);
    const b = await new Promise<Blob>((r) =>
      c.toBlob((b) => r(b!), 'image/png'),
    );
    return [...new Uint8Array(await b.arrayBuffer())];
  });
  await gallery
    .getByLabel('Zdjęcia z urządzenia', { exact: true })
    .setInputFiles({
      name: 'historia.png',
      mimeType: 'image/png',
      buffer: Buffer.from(bytes),
    });
  await gallery
    .getByRole('combobox', { name: 'Zlecenie zdjęcia', exact: true })
    .selectOption('planned');
  await gallery
    .getByRole('button', { name: 'Zapisz zdjęcia', exact: true })
    .click();
  await expect(gallery.locator('.photo-card')).toHaveCount(1);
  await history(card);
  await card
    .getByRole('button', {
      name: 'Usuń zlecenie Plan na listopad',
      exact: true,
    })
    .click();
  const confirm = page.getByRole('dialog', {
    name: 'Usunąć zlecenie?',
    exact: true,
  });
  await expect(confirm).toContainText(
    'Zdjęcia: 1 · notatki: 1 · checklisty: 1',
  );
  await expect(
    confirm.getByRole('button', { name: 'Usuń zlecenie', exact: true }),
  ).toBeDisabled();
  await confirm.getByRole('checkbox').check();
  await confirm
    .getByRole('button', { name: 'Usuń zlecenie', exact: true })
    .click();
  const after = await snapshot(page);
  expect(after.jobs.some((j) => j.id === 'planned')).toBe(false);
  expect(after.photos[0]).toMatchObject({
    jobId: null,
    gardenId: 'garden-a',
    jobTitle: 'Plan na listopad',
  });
  expect(after.notes[0]).toMatchObject({
    jobId: null,
    gardenId: 'garden-a',
    jobTitle: 'Plan na listopad',
  });
  expect(after.checklists[0]).toMatchObject({
    jobId: null,
    gardenId: 'garden-a',
    jobTitle: 'Plan na listopad',
  });
  expect(after.payments).toEqual(d.payments);
  await card.getByRole('tab', { name: 'Galeria', exact: true }).click();
  await expect(gallery.locator('.photo-card img')).toBeVisible();
});
test('historia grupuje lata i miesiące, stosuje filtr statusu i dokładne podsumowania', async ({
  page,
}) => {
  await seed(page);
  const before = await snapshot(page),
    card = await openGarden(page),
    list = await history(card);
  await expect(list.locator('.history-year>h3')).toHaveText(['2026', '2025']);
  const november = list.locator('[data-month="2026-11"]'),
    october = list.locator('[data-month="2026-10"]');
  await expect(november).toHaveAttribute('open', '');
  await expect(october).not.toHaveAttribute('open', '');
  await expect(november.locator('summary')).toContainText(
    'Zlecenia: 3 · Czas: 01:01:00 · Wartość: 537,00',
  );
  await card
    .getByLabel('Filtr statusu zleceń ogrodu', { exact: true })
    .selectOption('planned');
  await expect(november.locator('summary')).toContainText(
    'Zlecenia: 1 · Czas: 00:00:00 · Wartość: 0,00',
  );
  await card
    .getByLabel('Filtr statusu zleceń ogrodu', { exact: true })
    .selectOption('');
  await list
    .getByLabel('Kolejność historii', { exact: true })
    .selectOption('asc');
  await expect(list.locator('.history-year>h3')).toHaveText(['2025', '2026']);
  await card.getByRole('tab', { name: 'Rozliczenia', exact: true }).click();
  const finance = card.getByRole('tabpanel', {
    name: 'Rozliczenia',
    exact: true,
  });
  await expect(finance.locator('.garden-balances strong')).toHaveText([
    /1\s?532,00\s*zł/,
    /200,00\s*zł/,
    /1\s?332,00\s*zł/,
  ]);
  expect(await snapshot(page)).toEqual(before);
});
test('setki zleceń: starsze miesiące nie montują wierszy, a bieżący pokazuje 50 kolejnych pozycji', async ({
  page,
}) => {
  const d = fixture();
  d.jobs = Array.from({ length: 320 }, (_, index) => ({
    ...d.jobs[1],
    id: `many-${index}`,
    title: `Wizyta ${index}`,
    date: index < 250 ? '2026-11-01' : '2026-10-01',
  }));
  d.payments = [];
  await seed(page, d);
  const card = await openGarden(page),
    list = await history(card);
  await expect(list.locator('tbody tr')).toHaveCount(50);
  await expect(list.locator('[data-month="2026-11"] summary')).toContainText(
    'Zlecenia: 250',
  );
  await list
    .getByRole('button', {
      name: 'Pokaż kolejne 50 zleceń (200 pozostało)',
      exact: true,
    })
    .click();
  await expect(list.locator('tbody tr')).toHaveCount(100);
  await list.locator('[data-month="2026-11"] summary').click();
  await expect(list.locator('tbody tr')).toHaveCount(0);
  await list.locator('[data-month="2026-10"] summary').click();
  await expect(list.locator('tbody tr')).toHaveCount(50);
  expect((await snapshot(page)).jobs).toHaveLength(320);
});
test('sama nawigacja, zakładki i podsumowania nie zmieniają stopera, danych ani formatu', async ({
  page,
}) => {
  const d = fixture();
  d.jobs[1].status = 'in-progress';
  d.timer = {
    jobId: 'planned',
    startedAt: clock.getTime() - 61500,
    paused: true,
    remainderMs: 500,
  };
  await seed(page, d);
  const before = await snapshot(page),
    card = await openGarden(page);
  for (const name of [
    'Strefy i rośliny',
    'Harmonogram i plany czynności',
    'Rozliczenia',
    'Galeria',
    'Notatki i dokumentacja',
    'Zlecenia i historia prac',
  ])
    await card.getByRole('tab', { name, exact: true }).click();
  await card
    .getByRole('button', {
      name: 'Szczegóły zlecenia Plan na listopad',
      exact: true,
    })
    .click();
  await detail(page)
    .getByRole('button', { name: 'Zamknij okno', exact: true })
    .click();
  expect(await snapshot(page)).toEqual(before);
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('garden-manager:v1')!).version,
    ),
  ).toBe(9);
});
for (const width of [360, 390, 430])
  test(`telefon ${width}px: pełna karta, czytelne sekcje i zlecenia bez przewijania strony w poziomie`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await seed(page);
    const card = await openGarden(page);
    const box = await card.boundingBox();
    expect(Math.round(box!.width)).toBe(width);
    expect(Math.round(box!.height)).toBe(844);
    const list = await history(card);
    await expect(
      list.getByRole('button', {
        name: 'Szczegóły zlecenia Plan na listopad',
        exact: true,
      }),
    ).toBeVisible();
    expect(await card.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(
      true,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await card.screenshot({
      path: test.info().outputPath(`garden-${width}.png`),
    });
    await list
      .getByRole('button', {
        name: 'Szczegóły zlecenia Plan na listopad',
        exact: true,
      })
      .click();
    await detail(page)
      .getByRole('button', { name: 'Ogród: Ogród przy domu', exact: true })
      .click();
    await expect(
      card.getByRole('tab', { name: 'Zlecenia i historia prac', exact: true }),
    ).toHaveAttribute('aria-selected', 'true');
  });
