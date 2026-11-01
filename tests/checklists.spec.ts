import { closeOpenDialogs } from './navigation-helpers';
import {
  test as base,
  expect,
  type Page,
  type Locator,
} from '@playwright/test';
import { createDemoData } from '../src/data/demo';
import { STORAGE_VERSION } from '../src/data/repository';
import { newWorkTemplate } from '../src/checklists/model';
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
function fixture() {
  const data = createDemoData(clock);
  data.gardens[0].zones = [
    {
      id: 'zone',
      name: 'Rabata różana',
      type: 'rabata',
      area: 12,
      length: null,
      plants: 'Róże',
      requirements: '',
      treatments: '',
    },
  ];
  data.workTemplates.push({
    ...newWorkTemplate(),
    id: 'custom',
    name: 'Lista testowa',
    category: 'Dodatkowe',
    description: 'Prace własne',
    revision: 1,
    createdAt: 1000,
    updatedAt: 1000,
    items: [
      { id: 'control', title: 'Kontrola' },
      { id: 'clean', title: 'Sprzątanie' },
    ],
  });
  data.payments = [
    {
      id: 'old-payment',
      jobId: 'job-5',
      amountCents: 1000,
      receivedDate: '2026-10-30',
      method: 'cash',
      note: 'Zachować',
    },
  ];
  return data;
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
async function nav(page: Page, name: string) {
  await closeOpenDialogs(page);
  await page
    .getByRole('navigation', { name: 'Nawigacja główna' })
    .getByRole('button', {
      name: name === 'Zlecenia' ? /^Zlecenia/ : name,
      exact: true,
    })
    .click();
}
async function library(page: Page) {
  await nav(page, 'Szablony prac');
  await expect(
    page.getByRole('heading', { name: 'Szablony prac', exact: true }),
  ).toBeVisible();
}
function templateCard(page: Page, name: string) {
  return page
    .locator('.work-template-card')
    .filter({ has: page.getByRole('heading', { name, exact: true }) });
}
async function job(page: Page) {
  await nav(page, 'Zlecenia');
  await page
    .locator('.job-title-button')
    .filter({ hasText: 'Pielęgnacja ogrodu' })
    .click();
  return page.getByRole('dialog', { name: 'Szczegóły zlecenia', exact: true });
}
async function garden(page: Page) {
  await nav(page, 'Obiekty i ogrody');
  await page
    .getByRole('button', {
      name: 'Karta ogrodu Ogród przy Lipowej',
      exact: true,
    })
    .click();
  const card=page.getByRole('dialog', {
    name: 'Karta ogrodu: Ogród przy Lipowej',
    exact: true,
  });
  await card.getByRole('tab',{name:'Harmonogram i plany czynności',exact:true}).click();
  return card;
}
async function apply(page: Page, panel: Locator, id = 'custom') {
  await panel
    .getByRole('combobox', { name: 'Szablon do zastosowania', exact: true })
    .selectOption(id);
  await panel
    .getByRole('button', { name: 'Zastosuj szablon', exact: true })
    .click();
  return page.getByRole('dialog', { name: /^Checklista:/ });
}
async function close(dialog: Locator) {
  await dialog
    .getByRole('button', { name: 'Zamknij okno', exact: true })
    .click();
}
async function download(page: Page, panel: Locator, name: string) {
  const event = page.waitForEvent('download');
  await panel.getByRole('button', { name, exact: true }).click();
  const stream = await (await event).createReadStream(),
    chunks: Buffer[] = [];
  for await (const c of stream!) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks);
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
async function image(page: Page) {
  const bytes = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 40;
    c.height = 30;
    c.getContext('2d')!.fillRect(0, 0, 40, 30);
    const b = await new Promise<Blob>((r) =>
      c.toBlob((b) => r(b!), 'image/png'),
    );
    return [...new Uint8Array(await b.arrayBuffer())];
  });
  return {
    name: 'checklista.png',
    mimeType: 'image/png',
    buffer: Buffer.from(bytes),
  };
}
async function assetCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const r = indexedDB.open('garden-manager-photos', 1);
        r.onerror = () => reject(r.error);
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction('assets', 'readonly'),
            count = tx.objectStore('assets').count();
          count.onsuccess = () => resolve(count.result);
          tx.oncomplete = () => db.close();
        };
      }),
  );
}

test('biblioteka zawiera edytowalne przykłady i umożliwia tworzenie oraz kolejność czynności', async ({
  page,
}) => {
  await seed(page);
  await library(page);
  await expect(page.locator('.work-template-card')).toHaveCount(5);
  await templateCard(page, 'Koszenie trawnika')
    .getByText('Pokaż czynności (6)', { exact: true })
    .click();
  await expect(
    templateCard(page, 'Koszenie trawnika').locator('ol>li'),
  ).toHaveText([
    'Kontrola terenu i przeszkód',
    'Przygotowanie kosiarki',
    'Koszenie',
    'Podkaszanie krawędzi',
    'Oczyszczenie nawierzchni',
    'Spakowanie sprzętu',
  ]);
  await page
    .getByRole('button', { name: 'Dodaj szablon', exact: true })
    .click();
  const form = page.getByRole('dialog', {
    name: 'Nowy szablon prac',
    exact: true,
  });
  await form.getByLabel('Nazwa szablonu', { exact: true }).fill('Mój standard');
  await form
    .getByLabel('Opis szablonu', { exact: true })
    .fill('Prace jesienne');
  await form.getByLabel('Kategoria usługi', { exact: true }).fill('Jesień');
  await form.getByLabel('Czynność 1', { exact: true }).fill('Ocena terenu');
  await form
    .getByRole('button', { name: 'Dodaj czynność szablonu', exact: true })
    .click();
  await form.getByLabel('Czynność 2', { exact: true }).fill('Kontrola bramy');
  await form
    .getByRole('button', { name: 'Przesuń czynność 2 w górę', exact: true })
    .click();
  await form
    .getByRole('button', { name: 'Zapisz szablon', exact: true })
    .click();
  expect(
    (await snapshot(page)).workTemplates.at(-1)?.items.map((i) => i.title),
  ).toEqual(['Kontrola bramy', 'Ocena terenu']);
  await page.reload();
  await expect(templateCard(page, 'Mój standard')).toBeVisible();
});

test('kopiowanie, edycja, filtry, archiwum i usuwanie szablonu z potwierdzeniem', async ({
  page,
}) => {
  await seed(page);
  await library(page);
  await templateCard(page, 'Lista testowa')
    .getByRole('button', { name: 'Kopiuj', exact: true })
    .click();
  let card = templateCard(page, 'Lista testowa — kopia');
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Edytuj', exact: true }).click();
  const form = page.getByRole('dialog', {
    name: 'Edytuj szablon prac',
    exact: true,
  });
  await form
    .getByLabel('Nazwa szablonu', { exact: true })
    .fill('Jesienna kopia');
  await form
    .getByRole('button', { name: 'Zapisz szablon', exact: true })
    .click();
  await page.getByLabel('Szukaj szablonów', { exact: true }).fill('Jesienna');
  await page
    .getByRole('combobox', { name: 'Filtr kategorii usługi', exact: true })
    .selectOption('Dodatkowe');
  await expect(page.locator('.work-template-card')).toHaveCount(1);
  card = templateCard(page, 'Jesienna kopia');
  await card.getByRole('button', { name: 'Archiwizuj', exact: true }).click();
  await expect(page.locator('.work-template-card')).toHaveCount(0);
  await page
    .getByRole('combobox', { name: 'Status szablonu', exact: true })
    .selectOption('archived');
  await card.getByRole('button', { name: 'Przywróć', exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Status szablonu', exact: true })
    .selectOption('active');
  await card.getByRole('button', { name: 'Usuń szablon', exact: true }).click();
  const confirm = page.getByRole('dialog', {
    name: 'Usunąć szablon prac?',
    exact: true,
  });
  await confirm
    .getByRole('button', { name: 'Zachowaj szablon', exact: true })
    .click();
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Usuń szablon', exact: true }).click();
  await confirm
    .getByRole('button', { name: 'Potwierdź usunięcie szablonu', exact: true })
    .click();
  expect(
    (await snapshot(page)).workTemplates.some(
      (t) => t.name === 'Jesienna kopia',
    ),
  ).toBe(false);
  expect((await snapshot(page)).checklistTombstones).toHaveLength(1);
});

test('biblioteka przypisuje niezależną checklistę do istniejącej wizyty', async ({
  page,
}) => {
  await seed(page);
  const before = await snapshot(page);
  await library(page);
  await templateCard(page, 'Lista testowa')
    .getByRole('button', { name: 'Zastosuj', exact: true })
    .click();
  const form = page.getByRole('dialog', {
    name: 'Zastosuj szablon prac',
    exact: true,
  });
  await form
    .getByRole('combobox', { name: 'Rodzaj checklisty', exact: true })
    .selectOption('visit');
  await form
    .getByRole('combobox', { name: 'Ogród checklisty', exact: true })
    .selectOption('garden-1');
  await form
    .getByRole('combobox', { name: 'Zlecenie lub wizyta', exact: true })
    .selectOption('job-1');
  await form
    .getByRole('button', {
      name: 'Przypisz niezależną checklistę',
      exact: true,
    })
    .click();
  await expect(
    page.getByRole('dialog', {
      name: 'Checklista: Lista testowa',
      exact: true,
    }),
  ).toContainText('0 / 2');
  const saved = await snapshot(page);
  expect(saved.jobs).toEqual(before.jobs);
  expect(saved.timer).toBeNull();
  expect(saved.payments).toEqual(before.payments);
  expect(saved.checklists[0]).toMatchObject({
    kind: 'visit',
    jobId: 'job-1',
    templateId: 'custom',
  });
});

test('checklista wizyty zapisuje odhaczanie, Nie dotyczy, datę i uwagi po odświeżeniu', async ({
  page,
}) => {
  await seed(page);
  const detail = await job(page),
    panel = detail.getByRole('region', {
      name: 'Checklisty wizyty',
      exact: true,
    });
  const checklist = await apply(page, panel);
  await checklist
    .getByRole('checkbox', { name: 'Wykonano: Kontrola', exact: true })
    .check();
  await expect(checklist.locator('.checklist-progress strong')).toHaveText(
    '50%',
  );
  await expect(checklist.locator('.checklist-completed-at')).toContainText(
    '31.10.2026',
  );
  await checklist
    .getByLabel('Uwagi: Kontrola', { exact: true })
    .fill('Teren sprawdzony.');
  await checklist
    .getByRole('combobox', { name: 'Status: Sprzątanie', exact: true })
    .selectOption('not-applicable');
  await expect(checklist.locator('.checklist-progress strong')).toHaveText(
    '100%',
  );
  await expect(checklist.locator('.checklist-progress')).toContainText(
    '1 nie dotyczy',
  );
  const saved = await snapshot(page);
  expect(saved.checklists[0].items[0].note).toBe('Teren sprawdzony.');
  await page.reload();
  const reopened = await job(page);
  await reopened
    .getByRole('region', { name: 'Checklisty wizyty', exact: true })
    .getByRole('button', { name: 'Lista testowa', exact: true })
    .click();
  const current = page.getByRole('dialog', {
    name: 'Checklista: Lista testowa',
    exact: true,
  });
  await expect(
    current.getByRole('checkbox', { name: 'Wykonano: Kontrola', exact: true }),
  ).toBeChecked();
  await expect(
    current.getByLabel('Uwagi: Kontrola', { exact: true }),
  ).toHaveValue('Teren sprawdzony.');
  expect((await snapshot(page)).checklists[0].items[0].completedAt).toBe(
    saved.checklists[0].items[0].completedAt,
  );
});

test('checklista od zera: dodawanie, zmiana kolejności, edycja i usuwanie czynności', async ({
  page,
}) => {
  await seed(page);
  const detail = await job(page),
    panel = detail.getByRole('region', {
      name: 'Checklisty wizyty',
      exact: true,
    });
  await panel
    .getByRole('button', { name: 'Checklista od zera', exact: true })
    .click();
  const blank = page.getByRole('dialog', {
    name: 'Nowa checklista wizyty',
    exact: true,
  });
  await blank
    .getByLabel('Nazwa nowej checklisty', { exact: true })
    .fill('Prace dodatkowe');
  await blank
    .getByRole('button', { name: 'Utwórz checklistę', exact: true })
    .click();
  const checklist = page.getByRole('dialog', {
    name: 'Checklista: Prace dodatkowe',
    exact: true,
  });
  for (const title of ['Pierwsza', 'Druga']) {
    await checklist.getByLabel('Nowa czynność', { exact: true }).fill(title);
    await checklist
      .getByRole('button', {
        name: 'Dodaj czynność do checklisty',
        exact: true,
      })
      .click();
  }
  const second = checklist
    .locator('.checklist-item')
    .filter({ hasText: 'Druga' });
  await second
    .getByText('Edytuj czynność, kolejność i zdjęcie', { exact: true })
    .click();
  await second
    .getByRole('button', { name: 'Przesuń Druga w górę', exact: true })
    .click();
  expect(
    (await snapshot(page)).checklists[0].items.map((i) => i.title),
  ).toEqual(['Druga', 'Pierwsza']);
  await second
    .getByLabel('Nazwa czynności 1', { exact: true })
    .fill('Kontrola furtki');
  await checklist.getByLabel('Nowa czynność', { exact: true }).focus();
  const first = checklist
    .locator('.checklist-item')
    .filter({ hasText: 'Kontrola furtki' });
  await first
    .getByRole('button', { name: 'Usuń czynność', exact: true })
    .click();
  await first
    .getByRole('button', { name: 'Zachowaj czynność', exact: true })
    .click();
  expect((await snapshot(page)).checklists[0].items).toHaveLength(2);
  await first
    .getByRole('button', { name: 'Usuń czynność', exact: true })
    .click();
  await first
    .getByRole('button', { name: 'Potwierdź usunięcie czynności', exact: true })
    .click();
  expect(
    (await snapshot(page)).checklists[0].items.map((i) => i.title),
  ).toEqual(['Pierwsza']);
});

test('edycja, archiwizacja i usunięcie szablonu pozostawiają historię wykonanej czynności', async ({
  page,
}) => {
  await seed(page);
  const detail = await job(page),
    panel = detail.getByRole('region', {
      name: 'Checklisty wizyty',
      exact: true,
    });
  let checklist = await apply(page, panel);
  await checklist
    .getByRole('checkbox', { name: 'Wykonano: Kontrola', exact: true })
    .check();
  await close(checklist);
  await close(detail);
  const original = (await snapshot(page)).checklists[0];
  await library(page);
  await templateCard(page, 'Lista testowa')
    .getByRole('button', { name: 'Edytuj', exact: true })
    .click();
  const form = page.getByRole('dialog', {
    name: 'Edytuj szablon prac',
    exact: true,
  });
  await form.getByLabel('Czynność 1', { exact: true }).fill('Inna kontrola');
  await form
    .getByRole('button', { name: 'Zapisz szablon', exact: true })
    .click();
  await templateCard(page, 'Lista testowa')
    .getByRole('button', { name: 'Archiwizuj', exact: true })
    .click();
  await page
    .getByRole('combobox', { name: 'Status szablonu', exact: true })
    .selectOption('archived');
  await templateCard(page, 'Lista testowa')
    .getByRole('button', { name: 'Usuń szablon', exact: true })
    .click();
  await page
    .getByRole('dialog', { name: 'Usunąć szablon prac?', exact: true })
    .getByRole('button', { name: 'Potwierdź usunięcie szablonu', exact: true })
    .click();
  expect((await snapshot(page)).checklists[0]).toEqual(original);
  await page
    .getByRole('button', { name: 'Checklisty i plany', exact: true })
    .click();
  await page
    .locator('.checklist-summary')
    .getByRole('button', { name: 'Lista testowa', exact: true })
    .click();
  checklist = page.getByRole('dialog', {
    name: 'Checklista: Lista testowa',
    exact: true,
  });
  await expect(
    checklist.getByRole('checkbox', {
      name: 'Wykonano: Kontrola',
      exact: true,
    }),
  ).toBeChecked();
});

test('ponowne zastosowanie i otwieranie tej samej wizyty nie duplikuje checklisty', async ({
  page,
}) => {
  await seed(page);
  let detail = await job(page),
    panel = detail.getByRole('region', {
      name: 'Checklisty wizyty',
      exact: true,
    });
  await close(await apply(page, panel));
  await close(await apply(page, panel));
  await close(await apply(page, panel, 'starter-lawn-v1'));
  const before = (await snapshot(page)).checklists;
  expect(before).toHaveLength(2);
  await close(detail);
  detail = await job(page);
  panel = detail.getByRole('region', {
    name: 'Checklisty wizyty',
    exact: true,
  });
  await expect(panel.locator('.checklist-summary')).toHaveCount(2);
  expect((await snapshot(page)).checklists).toEqual(before);
});

test('plan ogrodu i strefy nie tworzy wizyty, a kopia planu ma niezależny postęp', async ({
  page,
}) => {
  await seed(page);
  const before = await snapshot(page),
    card = await garden(page);
  let panel = card.getByRole('region', {
    name: 'Plany czynności ogrodu',
    exact: true,
  });
  await close(await apply(page, panel));
  await card.getByRole('tab',{name:'Strefy i rośliny',exact:true}).click();
  await card
    .getByRole('button', {
      name: 'Checklisty strefy Rabata różana',
      exact: true,
    })
    .click();
  const zone = page.getByRole('dialog', {
    name: 'Plany strefy: Rabata różana',
    exact: true,
  });
  panel = zone.getByRole('region', {
    name: 'Plany czynności strefy',
    exact: true,
  });
  const checklist = await apply(page, panel);
  await checklist
    .getByRole('checkbox', { name: 'Wykonano: Kontrola', exact: true })
    .check();
  await checklist
    .getByLabel('Uwagi: Kontrola', { exact: true })
    .fill('Zalecenie dla wizyty');
  await close(checklist);
  await close(zone);
  await close(card);
  expect((await snapshot(page)).jobs).toEqual(before.jobs);
  expect((await snapshot(page)).timer).toBeNull();
  const detail = await job(page);
  panel = detail.getByRole('region', {
    name: 'Checklisty wizyty',
    exact: true,
  });
  const plan = (await snapshot(page)).checklists.find(
    (c) => c.zoneId === 'zone',
  )!;
  await panel
    .getByRole('combobox', { name: 'Plan ogrodu do zastosowania', exact: true })
    .selectOption(plan.id);
  await panel
    .getByRole('button', { name: 'Skopiuj plan do wizyty', exact: true })
    .click();
  const copy = page.getByRole('dialog', {
    name: 'Checklista: Lista testowa',
    exact: true,
  });
  await expect(
    copy.getByRole('checkbox', { name: 'Wykonano: Kontrola', exact: true }),
  ).not.toBeChecked();
  await expect(copy.getByLabel('Uwagi: Kontrola', { exact: true })).toHaveValue(
    'Zalecenie dla wizyty',
  );
  expect((await snapshot(page)).checklists).toHaveLength(3);
});

test('harmonogram wskazuje szablon, a lista powstaje dopiero przy rozpoczęciu rzeczywistej pracy', async ({
  page,
}) => {
  await seed(page);
  await nav(page, 'Kalendarz');
  await page
    .getByRole('button', { name: '+ Nowe zadanie na ten dzień', exact: true })
    .click();
  const form = page.getByRole('dialog', { name: 'Nowe zadanie', exact: true });
  await form
    .getByLabel('Nazwa zadania', { exact: true })
    .fill('Praca z checklistą');
  await form
    .getByRole('combobox', { name: 'Ogród (opcjonalnie)', exact: true })
    .selectOption('garden-1');
  await form
    .getByRole('combobox', { name: 'Strefa (opcjonalnie)', exact: true })
    .selectOption('zone');
  await form
    .getByRole('combobox', { name: 'Powtarzanie', exact: true })
    .selectOption('weeks');
  await form
    .getByRole('combobox', {
      name: 'Szablon checklisty (opcjonalnie)',
      exact: true,
    })
    .selectOption('custom');
  await form
    .getByRole('button', { name: 'Zapisz harmonogram', exact: true })
    .click();
  expect((await snapshot(page)).checklists).toEqual([]);
  expect((await snapshot(page)).taskOccurrences).toEqual([]);
  await page
    .locator('.calendar-agenda')
    .getByRole('button', { name: 'Praca z checklistą', exact: true })
    .click();
  const task = page.getByRole('dialog', {
    name: 'Szczegóły zadania',
    exact: true,
  });
  await expect(
    task.getByRole('checkbox', {
      name: 'Zastosuj checklistę przy rozpoczęciu: Lista testowa',
      exact: true,
    }),
  ).toBeChecked();
  await task
    .getByRole('button', { name: 'Rozpocznij pracę', exact: true })
    .click();
  const detail = page.getByRole('dialog', {
    name: 'Szczegóły zlecenia',
    exact: true,
  });
  await expect(
    detail
      .getByRole('region', { name: 'Checklisty wizyty', exact: true })
      .locator('.checklist-summary'),
  ).toHaveCount(1);
  const saved = await snapshot(page);
  expect(saved.checklists[0]).toMatchObject({
    kind: 'visit',
    zoneId: 'zone',
    jobId: saved.timer?.jobId,
  });
  await close(detail);
  await page
    .locator('.calendar-agenda')
    .getByRole('button', { name: 'Praca z checklistą', exact: true })
    .click();
  await expect(
    page.getByRole('dialog', { name: 'Szczegóły zlecenia', exact: true }),
  ).toBeVisible();
  expect((await snapshot(page)).checklists).toEqual(saved.checklists);
});

test('checklista nie zmienia stopera i pozwala zakończyć niepełną wizytę z ostrzeżeniem', async ({
  page,
}) => {
  await seed(page);
  const detail = await job(page);
  await detail
    .getByRole('button', { name: 'START — Rozpocznij wizytę', exact: true })
    .click();
  const before = await snapshot(page),
    panel = detail.getByRole('region', {
      name: 'Checklisty wizyty',
      exact: true,
    });
  const checklist = await apply(page, panel);
  await checklist
    .getByRole('checkbox', { name: 'Wykonano: Kontrola', exact: true })
    .check();
  await close(checklist);
  const after = await snapshot(page);
  expect(after.timer).toEqual(before.timer);
  expect(after.jobs).toEqual(before.jobs);
  expect(after.payments).toEqual(before.payments);
  await expect(detail.locator('.checklist-finish-warning')).toContainText(
    'Możesz zakończyć wizytę',
  );
  await detail.getByRole('button', { name: 'Zakończ', exact: true }).click();
  await expect(detail.locator('.checklist-finish-warning')).toContainText(
    'Wizyta zakończona',
  );
  expect((await snapshot(page)).timer).toBeNull();
  expect(
    (await snapshot(page)).jobs.find((j) => j.id === 'job-1')?.settlement,
  ).toBeNull();
  await expect(
    detail.getByRole('button', {
      name: 'Zatwierdź cenę robocizny',
      exact: true,
    }),
  ).toBeVisible();
});

test('uwaga i zdjęcie czynności używają istniejącej galerii bez kopiowania plików', async ({
  page,
}) => {
  await seed(page);
  const detail = await job(page),
    gallery = detail.getByRole('region', {
      name: 'Galeria zlecenia i wizyty',
      exact: true,
    });
  await gallery
    .getByRole('button', { name: 'Dodaj zdjęcia', exact: true })
    .click();
  await gallery
    .getByLabel('Zdjęcia z urządzenia', { exact: true })
    .setInputFiles(await image(page));
  await gallery
    .getByRole('button', { name: 'Zapisz zdjęcia', exact: true })
    .click();
  await expect(gallery.locator('.photo-card img')).toBeVisible();
  const photo = (await snapshot(page)).photos[0],
    panel = detail.getByRole('region', {
      name: 'Checklisty wizyty',
      exact: true,
    }),
    checklist = await apply(page, panel);
  const item = checklist.locator('.checklist-item').first();
  await item
    .getByText('Edytuj czynność, kolejność i zdjęcie', { exact: true })
    .click();
  await item
    .getByRole('combobox', { name: 'Zdjęcie: Kontrola', exact: true })
    .selectOption(photo.id);
  await expect(item.locator('.checklist-photo img')).toBeVisible();
  expect(await assetCount(page)).toBe(1);
  await close(checklist);
  await panel
    .getByRole('button', { name: 'Przejdź do galerii zlecenia', exact: true })
    .click();
  await expect(
    detail.locator('.checklist-gallery-target').filter({
      has: page.getByRole('region', {
        name: 'Galeria zlecenia i wizyty',
        exact: true,
      }),
    }),
  ).toBeFocused();
  await gallery
    .getByRole('button', { name: 'Usuń zdjęcie checklista.png', exact: true })
    .click();
  await page
    .getByRole('dialog', { name: 'Usunąć zdjęcie?', exact: true })
    .getByRole('button', { name: 'Potwierdź usunięcie zdjęcia', exact: true })
    .click();
  await expect(gallery.locator('.photo-card')).toHaveCount(0);
  expect((await snapshot(page)).checklists[0].items[0]).toMatchObject({
    photoId: null,
    photoName: 'checklista.png',
  });
  await expect.poll(() => assetCount(page)).toBe(0);
});

test('JSON i pełny ZIP odtwarzają szablony, checklisty, wykonanie, uwagi i zdjęcia', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await seed(page);
  const detail = await job(page),
    gallery = detail.getByRole('region', {
      name: 'Galeria zlecenia i wizyty',
      exact: true,
    });
  await gallery
    .getByRole('button', { name: 'Dodaj zdjęcia', exact: true })
    .click();
  await gallery
    .getByLabel('Zdjęcia z urządzenia', { exact: true })
    .setInputFiles(await image(page));
  await gallery
    .getByRole('button', { name: 'Zapisz zdjęcia', exact: true })
    .click();
  await expect(gallery.locator('.photo-card')).toHaveCount(1);
  const photo = (await snapshot(page)).photos[0];
  let checklist = await apply(
    page,
    detail.getByRole('region', { name: 'Checklisty wizyty', exact: true }),
  );
  await checklist
    .getByRole('checkbox', { name: 'Wykonano: Kontrola', exact: true })
    .check();
  await checklist
    .getByLabel('Uwagi: Kontrola', { exact: true })
    .fill('Uwagi do odtworzenia');
  await checklist
    .getByRole('combobox', { name: 'Status: Sprzątanie', exact: true })
    .selectOption('not-applicable');
  await checklist
    .locator('.checklist-item')
    .first()
    .getByText('Edytuj czynność, kolejność i zdjęcie', { exact: true })
    .click();
  await checklist
    .getByRole('combobox', { name: 'Zdjęcie: Kontrola', exact: true })
    .selectOption(photo.id);
  await close(checklist);
  await close(detail);
  const original = await snapshot(page);
  let panel = await settings(page);
  const json = JSON.parse(
    (await download(page, panel, 'Eksportuj dane')).toString(),
  );
  expect(json.data.checklists).toEqual(original.checklists);
  expect(json.data.workTemplates).toEqual(original.workTemplates);
  const zip = await download(page, panel, 'Pobierz pełną kopię ZIP');
  await close(panel);
  await library(page);
  await page
    .getByRole('button', { name: 'Checklisty i plany', exact: true })
    .click();
  await page
    .locator('.checklist-summary')
    .getByRole('button', { name: 'Lista testowa', exact: true })
    .click();
  checklist = page.getByRole('dialog', {
    name: 'Checklista: Lista testowa',
    exact: true,
  });
  await checklist
    .getByRole('button', { name: 'Usuń checklistę', exact: true })
    .click();
  await checklist
    .getByRole('button', {
      name: 'Potwierdź usunięcie checklisty',
      exact: true,
    })
    .click();
  expect((await snapshot(page)).checklists).toEqual([]);
  panel = await settings(page);
  await panel
    .getByLabel('Wczytaj pełną kopię ZIP', { exact: true })
    .setInputFiles({
      name: 'checklists.zip',
      mimeType: 'application/zip',
      buffer: zip,
    });
  await expect(
    panel.getByRole('group', {
      name: 'Potwierdzenie odtworzenia pełnej kopii',
      exact: true,
    }),
  ).toContainText('Szablony / checklisty');
  await panel
    .getByRole('checkbox', {
      name: 'Rozumiem, że bieżący zestaw zostanie zastąpiony.',
      exact: true,
    })
    .check();
  await panel.getByLabel('Wpisz ODTWÓRZ', { exact: true }).fill('ODTWÓRZ');
  await panel
    .getByRole('button', { name: 'Odtwórz dane i zdjęcia', exact: true })
    .click();
  await expect(
    panel.getByText(/Dane i zdjęcia zostały odtworzone/).last(),
  ).toBeVisible();
  const restored = await snapshot(page);
  expect(restored.checklists).toEqual(original.checklists);
  expect(restored.workTemplates).toEqual(original.workTemplates);
  expect(restored.jobs).toEqual(original.jobs);
  expect(restored.payments).toEqual(original.payments);
  await page.reload();
  const reopened = await job(page);
  await reopened
    .getByRole('region', { name: 'Checklisty wizyty', exact: true })
    .getByRole('button', { name: 'Lista testowa', exact: true })
    .click();
  checklist = page.getByRole('dialog', {
    name: 'Checklista: Lista testowa',
    exact: true,
  });
  await checklist
    .locator('.checklist-item')
    .first()
    .getByText('Edytuj czynność, kolejność i zdjęcie', { exact: true })
    .click();
  await expect(checklist.locator('.checklist-photo img')).toBeVisible();
});

test('migracja v7 zachowuje oryginał i nowe przykłady nie wracają po usunięciu', async ({
  page,
}) => {
  const data = fixture(),
    old = JSON.parse(JSON.stringify(data));
  delete old.workTemplates;
  delete old.checklists;
  delete old.checklistTombstones;
  await seed(page, old, 7);
  const result = await page.evaluate(() => ({
    old: JSON.parse(localStorage.getItem('garden-manager:backup:v7')!),
    current: JSON.parse(localStorage.getItem('garden-manager:v1')!),
  }));
  expect(result.old).toEqual({ version: 7, data: old });
  expect(result.current.version).toBe(STORAGE_VERSION);
  expect(result.current.data).toMatchObject(old);
  expect(result.current.data.workTemplates).toHaveLength(4);
  await library(page);
  await templateCard(page, 'Koszenie trawnika')
    .getByRole('button', { name: 'Usuń szablon', exact: true })
    .click();
  await page
    .getByRole('dialog', { name: 'Usunąć szablon prac?', exact: true })
    .getByRole('button', { name: 'Potwierdź usunięcie szablonu', exact: true })
    .click();
  await page.reload();
  await expect(page.locator('.work-template-card')).toHaveCount(3);
});

test('telefon: biblioteka, duże pola odhaczania i edycja listy bez przewijania w poziomie', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page);
  await page.getByRole('button', { name: 'Więcej', exact: true }).click();
  await page
    .locator('.mobile-more')
    .getByRole('button', { name: 'Szablony prac', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Szablony prac', exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page
    .getByRole('navigation', { name: 'Nawigacja mobilna', exact: true })
    .getByRole('button', { name: 'Zlecenia', exact: true })
    .click();
  await page
    .locator('.job-title-button')
    .filter({ hasText: 'Pielęgnacja ogrodu' })
    .click();
  const detail = page.getByRole('dialog', {
      name: 'Szczegóły zlecenia',
      exact: true,
    }),
    checklist = await apply(
      page,
      detail.getByRole('region', { name: 'Checklisty wizyty', exact: true }),
    );
  const checkbox = checklist.getByRole('checkbox', {
    name: 'Wykonano: Kontrola',
    exact: true,
  });
  await checkbox.check();
  expect((await checkbox.boundingBox())!.width).toBeGreaterThanOrEqual(28);
  await expect(checklist.locator('.checklist-progress strong')).toHaveText(
    '50%',
  );
  await checklist
    .getByLabel('Uwagi: Kontrola', { exact: true })
    .fill('Zapis w terenie');
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
});

test('błąd automatycznego zapisu zachowuje szkic uwagi i pozwala ponowić zapis', async ({
  page,
}) => {
  await seed(page);
  const detail = await job(page),
    checklist = await apply(
      page,
      detail.getByRole('region', { name: 'Checklisty wizyty', exact: true }),
    );
  const before = (await snapshot(page)).checklists[0];
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    (window as typeof window & { restoreStorage?: () => void }).restoreStorage =
      () => {
        Storage.prototype.setItem = original;
      };
    Storage.prototype.setItem = function (key, value) {
      if (key === 'garden-manager:v1')
        throw new DOMException('Disk full', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await checklist
    .getByLabel('Uwagi: Kontrola', { exact: true })
    .fill('Szkic do ponowienia');
  await expect(checklist.locator('.checklist-unsaved')).toContainText(
    'Zmiana niezapisana',
  );
  expect((await snapshot(page)).checklists[0]).toEqual(before);
  await expect(
    checklist.getByLabel('Uwagi: Kontrola', { exact: true }),
  ).toHaveValue('Szkic do ponowienia');
  await page.evaluate(() =>
    (
      window as typeof window & { restoreStorage?: () => void }
    ).restoreStorage?.(),
  );
  await checklist
    .getByRole('button', { name: 'Ponów zapis', exact: true })
    .click();
  await expect(checklist.locator('.checklist-unsaved')).toHaveCount(0);
  expect((await snapshot(page)).checklists[0].items[0].note).toBe(
    'Szkic do ponowienia',
  );
});
