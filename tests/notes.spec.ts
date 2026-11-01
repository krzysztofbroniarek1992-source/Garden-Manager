import { closeOpenDialogs } from './navigation-helpers';
import {
  test as base,
  expect,
  type Page,
  type Locator,
} from '@playwright/test';
import { createDemoData } from '../src/data/demo';
import { STORAGE_VERSION } from '../src/data/repository';
import type { Data } from '../src/domain';
import { newNote, newTodo, type Note, type Todo } from '../src/desk/model';
import type { TaskSchedule } from '../src/planning/model';

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
const day = '2026-10-31',
  clock = new Date('2026-10-31T10:00:00+01:00');
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
  data.payments = [
    {
      id: 'p',
      jobId: 'job-5',
      amountCents: 1000,
      receivedDate: day,
      method: 'cash',
      note: 'Zachować',
    },
  ];
  return data;
}
function note(data: Data, patch: Partial<Note> = {}): Note {
  return {
    ...newNote(data),
    title: 'Obserwacja liści',
    body: 'Sprawdzić róże',
    createdAt: 1000,
    updatedAt: 1000,
    revision: 1,
    ...patch,
  };
}
function todo(data: Data, patch: Partial<Todo> = {}): Todo {
  return {
    ...newTodo(data),
    title: 'Telefon do klienta',
    createdAt: 1000,
    updatedAt: 1000,
    revision: 1,
    ...patch,
  };
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
async function notes(page: Page) {
  await nav(page, 'Notatki');
}
async function openNote(page: Page, title = 'Obserwacja liści') {
  await page
    .locator('.desk-card')
    .getByRole('button', { name: title, exact: true })
    .click();
  return page.getByRole('dialog', { name: 'Szczegóły notatki', exact: true });
}
async function addNote(page: Page, title: string, reminder = false) {
  await page
    .getByRole('button', {
      name: reminder ? 'Dodaj przypomnienie' : 'Dodaj notatkę',
      exact: true,
    })
    .click();
  const form = page.getByRole('dialog', {
    name: reminder ? 'Nowe przypomnienie' : 'Nowa notatka',
    exact: true,
  });
  await form.getByLabel('Tytuł notatki', { exact: true }).fill(title);
  await form
    .getByLabel('Treść notatki', { exact: true })
    .fill('Zapis z terenu');
  await form
    .getByRole('button', { name: 'Zapisz notatkę', exact: true })
    .click();
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
  await card.getByRole('tab',{name:'Galeria',exact:true}).click();
  return card;
}
async function image(page: Page) {
  const bytes = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 30;
    c.height = 20;
    c.getContext('2d')!.fillRect(0, 0, 30, 20);
    const blob = await new Promise<Blob>((resolve) =>
      c.toBlob((b) => resolve(b!), 'image/png'),
    );
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  return {
    name: 'roze.png',
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
async function download(page: Page, panel: Locator, name: string) {
  const event = page.waitForEvent('download');
  await panel
    .getByRole('button', {
      name: name === 'Zlecenia' ? /^Zlecenia/ : name,
      exact: true,
    })
    .click();
  const stream = await (await event).createReadStream(),
    chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
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

test('szybkie przyciski pulpitu zapisują ogólną notatkę i przypomnienie bez zlecenia', async ({
  page,
}) => {
  await seed(page);
  const before = await snapshot(page);
  await addNote(page, 'Pomysł ogólny');
  await addNote(page, 'Termin kontaktu', true);
  await expect(
    page.getByRole('region', { name: 'Przypomnienia i sprawy', exact: true }),
  ).toContainText('Termin kontaktu');
  const saved = await snapshot(page);
  expect(saved.notes).toHaveLength(2);
  expect(saved.notes[1]).toMatchObject({
    clientId: null,
    reminder: { date: day, time: null, status: 'active' },
  });
  expect(saved.jobs).toEqual(before.jobs);
  expect(saved.payments).toEqual(before.payments);
  expect(saved.timer).toBeNull();
  await page.reload();
  await notes(page);
  await expect(page.locator('.desk-card')).toHaveCount(2);
});

test('edycja, archiwum, wyszukiwanie i usuwanie z potwierdzeniem', async ({
  page,
}) => {
  const data = fixture();
  data.notes = [note(data)];
  await seed(page, data);
  await notes(page);
  let detail = await openNote(page);
  await detail
    .getByRole('button', { name: 'Edytuj notatkę', exact: true })
    .click();
  const form = page.getByRole('dialog', {
    name: 'Edytuj notatkę',
    exact: true,
  });
  await form
    .getByLabel('Tytuł notatki', { exact: true })
    .fill('Zalecenie po kontroli');
  await form
    .getByLabel('Treść notatki', { exact: true })
    .fill('Usunąć chore liście');
  await form
    .getByRole('combobox', { name: 'Kategoria notatki', exact: true })
    .selectOption('care');
  await form
    .getByRole('combobox', { name: 'Priorytet', exact: true })
    .selectOption('high');
  await form
    .getByRole('button', { name: 'Zapisz notatkę', exact: true })
    .click();
  detail = page.getByRole('dialog', { name: 'Szczegóły notatki', exact: true });
  await expect(detail).toContainText('Usunąć chore liście');
  await detail
    .getByRole('button', { name: 'Archiwizuj notatkę', exact: true })
    .click();
  await detail
    .getByRole('button', { name: 'Zamknij okno', exact: true })
    .click();
  await expect(page.locator('.desk-card')).toHaveCount(0);
  await page
    .getByRole('combobox', { name: 'Status notatki', exact: true })
    .selectOption('archived');
  await page.getByLabel('Szukaj notatek', { exact: true }).fill('chore');
  await expect(page.locator('.desk-card')).toHaveCount(1);
  detail = await openNote(page, 'Zalecenie po kontroli');
  await detail
    .getByRole('button', { name: 'Przywróć notatkę', exact: true })
    .click();
  await detail
    .getByRole('button', { name: 'Usuń notatkę', exact: true })
    .click();
  await detail
    .getByRole('button', { name: 'Zachowaj wpis', exact: true })
    .click();
  expect((await snapshot(page)).notes).toHaveLength(1);
  await detail
    .getByRole('button', { name: 'Usuń notatkę', exact: true })
    .click();
  await detail
    .getByRole('button', { name: 'Potwierdź usunięcie wpisu', exact: true })
    .click();
  expect((await snapshot(page)).notes).toEqual([]);
  expect((await snapshot(page)).deskTombstones).toHaveLength(1);
});

test('filtry klienta, kategorii, priorytetu i terminu łączą się', async ({
  page,
}) => {
  const data = fixture();
  data.notes = [
    note(data, {
      ...newNote(data, { clientId: 'client-1' }),
      title: 'Pilny kontakt',
      body: 'Telefon',
      createdAt: 1000,
      updatedAt: 1000,
      revision: 1,
      category: 'contact',
      priority: 'urgent',
      reminder: {
        date: day,
        time: '08:00',
        status: 'active',
        completedAt: null,
      },
    }),
    note(data, { title: 'Pomysł ogólny', category: 'idea', priority: 'low' }),
  ];
  await seed(page, data);
  await notes(page);
  await page
    .getByRole('combobox', { name: 'Klient', exact: true })
    .selectOption('client-1');
  await page
    .getByRole('combobox', { name: 'Kategoria', exact: true })
    .selectOption('contact');
  await page
    .getByRole('combobox', { name: 'Priorytet', exact: true })
    .selectOption('urgent');
  await page
    .getByRole('combobox', { name: 'Termin przypomnienia', exact: true })
    .selectOption('overdue');
  await page.getByLabel('Termin od', { exact: true }).fill(day);
  await expect(page.locator('.desk-card')).toHaveCount(1);
  await expect(page.locator('.desk-card')).toContainText('Pilny kontakt');
  await page.getByLabel('Termin do', { exact: true }).fill('2026-10-30');
  await expect(page.getByRole('alert')).toContainText('późniejszy');
  await page
    .getByRole('button', { name: 'Wyczyść filtry', exact: true })
    .click();
  await expect(page.locator('.desk-card')).toHaveCount(2);
});

test('odroczenie i statusy przypomnienia aktualizują pulpit i jeden termin w kalendarzu', async ({
  page,
}) => {
  const data = fixture();
  data.notes = [
    note(data, {
      reminder: {
        date: day,
        time: '08:30',
        status: 'active',
        completedAt: null,
      },
    }),
  ];
  await seed(page, data);
  await expect(page.locator('.desk-overview')).toContainText('Zaległe');
  await notes(page);
  const detail = await openNote(page);
  await detail
    .getByRole('button', { name: 'Odrocz przypomnienie', exact: true })
    .click();
  await detail
    .getByLabel('Nowa data przypomnienia', { exact: true })
    .fill('2026-11-02');
  await detail
    .getByLabel('Nowa godzina przypomnienia', { exact: true })
    .fill('12:15');
  await detail
    .getByRole('button', { name: 'Zapisz odroczenie', exact: true })
    .click();
  await detail
    .getByRole('button', { name: 'Przypomnienie wykonane', exact: true })
    .click();
  await expect(
    detail.getByRole('region', { name: 'Przypomnienie notatki' }),
  ).toContainText('Wykonane');
  await detail
    .getByRole('button', { name: 'Aktywuj ponownie', exact: true })
    .click();
  await detail
    .getByRole('button', { name: 'Anuluj przypomnienie', exact: true })
    .click();
  await detail
    .getByRole('button', { name: 'Aktywuj ponownie', exact: true })
    .click();
  await detail
    .getByRole('button', { name: 'Zamknij okno', exact: true })
    .click();
  await nav(page, 'Kalendarz');
  await expect(page.locator('.calendar-agenda')).not.toContainText(
    'Obserwacja liści',
  );
  await page.getByLabel('Przejdź do dnia', { exact: true }).fill('2026-11-02');
  await expect(
    page
      .locator('.calendar-agenda')
      .getByRole('button', { name: 'Obserwacja liści', exact: true }),
  ).toHaveCount(1);
  await expect(page.locator('.calendar-agenda')).toContainText('12:15');
  await page
    .locator('.calendar-agenda')
    .getByRole('button', { name: 'Obserwacja liści', exact: true })
    .click();
  await expect(
    page.getByRole('dialog', { name: 'Szczegóły notatki', exact: true }),
  ).toBeVisible();
  expect((await snapshot(page)).notes[0].id).toBe(data.notes[0].id);
  expect((await snapshot(page)).jobs).toEqual(data.jobs);
});

test('archiwizacja ukrywa przypomnienie, przywrócenie pokazuje je ponownie', async ({
  page,
}) => {
  const data = fixture();
  data.notes = [
    note(data, {
      reminder: { date: day, time: null, status: 'active', completedAt: null },
    }),
  ];
  await seed(page, data);
  await notes(page);
  const detail = await openNote(page);
  await detail
    .getByRole('button', { name: 'Archiwizuj notatkę', exact: true })
    .click();
  await detail
    .getByRole('button', { name: 'Zamknij okno', exact: true })
    .click();
  await nav(page, 'Kalendarz');
  await expect(page.locator('.calendar-agenda')).not.toContainText(
    'Obserwacja liści',
  );
  await notes(page);
  await page
    .getByRole('combobox', { name: 'Status notatki', exact: true })
    .selectOption('archived');
  await (
    await openNote(page)
  )
    .getByRole('button', { name: 'Przywróć notatkę', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Zamknij okno', exact: true })
    .click();
  await nav(page, 'Panel główny');
  await expect(page.locator('.desk-overview')).toContainText(
    'Obserwacja liści',
  );
});

test('karty klienta, ogrodu, strefy i wizyty tworzą notatki z właściwymi relacjami', async ({
  page,
}) => {
  await seed(page);
  await nav(page, 'Klienci');
  await page
    .locator('.client-name-button')
    .filter({ hasText: 'Anna Kowalska' })
    .click();
  let region = page.getByRole('region', {
    name: 'Notatki klienta',
    exact: true,
  });
  await region
    .getByRole('button', { name: 'Dodaj notatkę', exact: true })
    .click();
  let form = page.getByRole('dialog', { name: 'Nowa notatka', exact: true });
  await expect(
    form.getByRole('combobox', { name: 'Powiązany klient', exact: true }),
  ).toHaveValue('client-1');
  await form
    .getByLabel('Tytuł notatki', { exact: true })
    .fill('Rozmowa z klientką');
  await form
    .getByRole('button', { name: 'Zapisz notatkę', exact: true })
    .click();
  await expect(region).toContainText('Rozmowa z klientką');
  const card = await garden(page);
  await card.getByRole('tab',{name:'Notatki i dokumentacja',exact:true}).click();
  region = card.getByRole('region', { name: 'Notatki ogrodu', exact: true });
  await region
    .getByRole('button', { name: 'Dodaj notatkę', exact: true })
    .click();
  form = page.getByRole('dialog', { name: 'Nowa notatka', exact: true });
  await expect(
    form.getByRole('combobox', { name: 'Powiązany ogród', exact: true }),
  ).toHaveValue('garden-1');
  await form
    .getByLabel('Tytuł notatki', { exact: true })
    .fill('Notatka ogrodu');
  await form
    .getByRole('button', { name: 'Zapisz notatkę', exact: true })
    .click();
  await card.getByRole('tab',{name:'Strefy i rośliny',exact:true}).click();
  await card
    .getByRole('button', { name: 'Notatki strefy Rabata różana', exact: true })
    .click();
  const zone = page.getByRole('dialog', {
    name: 'Notatki strefy: Rabata różana',
    exact: true,
  });
  await zone
    .getByRole('button', { name: 'Dodaj notatkę', exact: true })
    .click();
  form = page.getByRole('dialog', { name: 'Nowa notatka', exact: true });
  await expect(
    form.getByRole('combobox', { name: 'Powiązana strefa', exact: true }),
  ).toHaveValue('zone');
  await form.getByLabel('Tytuł notatki', { exact: true }).fill('Notatka róż');
  await form
    .getByRole('button', { name: 'Zapisz notatkę', exact: true })
    .click();
  await zone.getByRole('button', { name: 'Zamknij okno', exact: true }).click();
  await card.getByRole('button', { name: 'Zamknij okno', exact: true }).click();
  await nav(page, 'Zlecenia');
  await page
    .locator('.job-title-button')
    .filter({ hasText: 'Pielęgnacja ogrodu' })
    .click();
  region = page.getByRole('region', {
    name: 'Notatki zlecenia i wizyty',
    exact: true,
  });
  await region
    .getByRole('button', { name: 'Dodaj notatkę', exact: true })
    .click();
  form = page.getByRole('dialog', { name: 'Nowa notatka', exact: true });
  await expect(
    form.getByRole('combobox', { name: 'Powiązane zlecenie', exact: true }),
  ).toHaveValue('job-1');
  await form.getByLabel('Tytuł notatki', { exact: true }).fill('Po wizycie');
  await form
    .getByRole('button', { name: 'Zapisz notatkę', exact: true })
    .click();
  const saved = await snapshot(page);
  expect(
    saved.notes.map((n) => [n.clientId, n.gardenId, n.zoneId, n.jobId]),
  ).toEqual([
    ['client-1', null, null, null],
    ['client-1', 'garden-1', null, null],
    ['client-1', 'garden-1', 'zone', null],
    ['client-1', 'garden-1', null, 'job-1'],
  ]);
});

test('sprawy na dziś, nadchodzące, zaległe i bez terminu oraz szybkie wykonanie', async ({
  page,
}) => {
  const data = fixture();
  data.todos = [
    todo(data, { title: 'Dziś', dueDate: day }),
    todo(data, { title: 'Jutro', dueDate: '2026-11-01' }),
    todo(data, {
      title: 'Zaległa',
      dueDate: day,
      dueTime: '08:00',
      priority: 'urgent',
    }),
    todo(data, { title: 'Bez daty' }),
  ];
  await seed(page, data);
  await nav(page, 'Do zrobienia');
  const tabs = page.getByRole('group', { name: 'Widok listy spraw' });
  for (const [tab, title] of [
    ['Na dziś', 'Dziś'],
    ['Nadchodzące', 'Jutro'],
    ['Zaległe', 'Zaległa'],
    ['Bez terminu', 'Bez daty'],
  ]) {
    await tabs.getByRole('button', { name: tab, exact: true }).click();
    await expect(page.locator('.desk-todo-row')).toHaveCount(1);
    await expect(page.locator('.desk-todo-row')).toContainText(title);
  }
  await page
    .getByRole('button', { name: 'Wykonaj sprawę Bez daty', exact: true })
    .click();
  await expect(page.locator('.desk-todo-row')).toHaveCount(0);
  await tabs.getByRole('button', { name: 'Wykonane', exact: true }).click();
  await expect(page.locator('.desk-todo-row')).toContainText('Bez daty');
  await page
    .getByRole('button', {
      name: 'Oznacz jako niewykonane Bez daty',
      exact: true,
    })
    .click();
  await expect(page.locator('.desk-todo-row')).toHaveCount(0);
  expect((await snapshot(page)).jobs).toEqual(data.jobs);
});

test('samodzielna sprawa ma edycję, anulowanie i usuwanie bez zakładania zlecenia', async ({
  page,
}) => {
  await seed(page);
  await nav(page, 'Do zrobienia');
  await page.getByRole('button', { name: 'Dodaj sprawę', exact: true }).click();
  let form = page.getByRole('dialog', {
    name: 'Nowa sprawa do załatwienia',
    exact: true,
  });
  await form.getByLabel('Tytuł sprawy', { exact: true }).fill('Telefon');
  await form
    .getByLabel('Opis sprawy', { exact: true })
    .fill('Uzgodnić pielęgnację');
  await form
    .getByRole('combobox', { name: 'Powiązany klient', exact: true })
    .selectOption('client-1');
  await form
    .getByRole('combobox', { name: 'Powiązany ogród', exact: true })
    .selectOption('garden-1');
  await form
    .getByRole('combobox', { name: 'Powiązana strefa', exact: true })
    .selectOption('zone');
  await form
    .getByRole('button', { name: 'Zapisz sprawę', exact: true })
    .click();
  await page
    .locator('.desk-todo-row')
    .getByRole('button', { name: 'Telefon', exact: true })
    .click();
  const detail = page.getByRole('dialog', {
    name: 'Szczegóły sprawy',
    exact: true,
  });
  await detail
    .getByRole('button', { name: 'Edytuj sprawę', exact: true })
    .click();
  form = page.getByRole('dialog', { name: 'Edytuj sprawę', exact: true });
  await form
    .getByLabel('Termin sprawy (opcjonalnie)', { exact: true })
    .fill('2026-11-05');
  await form
    .getByRole('button', { name: 'Zapisz sprawę', exact: true })
    .click();
  await detail
    .getByRole('button', { name: 'Anuluj sprawę', exact: true })
    .click();
  await expect(detail).toContainText('Anulowane');
  await detail
    .getByRole('button', { name: 'Usuń sprawę', exact: true })
    .click();
  await detail
    .getByRole('button', { name: 'Potwierdź usunięcie wpisu', exact: true })
    .click();
  expect((await snapshot(page)).todos).toEqual([]);
});

test('kalendarz rozróżnia cztery rodzaje wydarzeń i tworzy nowe przypomnienie oraz sprawę z wybranego dnia', async ({
  page,
}) => {
  const data = fixture();
  data.notes = [
    note(data, {
      reminder: { date: day, time: null, status: 'active', completedAt: null },
    }),
  ];
  data.todos = [todo(data, { dueDate: day })];
  data.taskSchedules = [
    {
      id: 's',
      title: 'Planowane koszenie',
      notes: '',
      startDate: day,
      endDate: null,
      time: '08:00',
      clientId: null,
      gardenId: null,
      zoneId: null,
      zoneName: null,
      recurrence: {
        frequency: 'once',
        interval: 1,
        months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      },
      endedOn: null,
      revision: 1,
      updatedAt: 1000,
    } as TaskSchedule,
  ];
  await seed(page, data);
  await nav(page, 'Kalendarz');
  const agenda = page.locator('.calendar-agenda');
  for (const kind of [
    'Praca ogrodnicza',
    'Zlecenie',
    'Przypomnienie',
    'Sprawa',
  ])
    await expect(agenda).toContainText(kind);
  await page.getByLabel('Przejdź do dnia', { exact: true }).fill('2026-11-04');
  await page
    .getByRole('button', { name: '+ Przypomnienie na ten dzień', exact: true })
    .click();
  let form = page.getByRole('dialog', {
    name: 'Nowe przypomnienie',
    exact: true,
  });
  await expect(
    form.getByLabel('Data przypomnienia', { exact: true }),
  ).toHaveValue('2026-11-04');
  await form
    .getByLabel('Tytuł notatki', { exact: true })
    .fill('Przypomnienie z dnia');
  await form
    .getByRole('button', { name: 'Zapisz notatkę', exact: true })
    .click();
  await page
    .getByRole('button', { name: '+ Sprawa na ten dzień', exact: true })
    .click();
  form = page.getByRole('dialog', {
    name: 'Nowa sprawa do załatwienia',
    exact: true,
  });
  await expect(
    form.getByLabel('Termin sprawy (opcjonalnie)', { exact: true }),
  ).toHaveValue('2026-11-04');
  await form.getByLabel('Tytuł sprawy', { exact: true }).fill('Sprawa z dnia');
  await form
    .getByRole('button', { name: 'Zapisz sprawę', exact: true })
    .click();
  await expect(
    agenda.getByRole('button', { name: 'Sprawa z dnia', exact: true }),
  ).toHaveCount(1);
  await agenda
    .getByRole('button', { name: 'Sprawa z dnia', exact: true })
    .click();
  await expect(
    page.getByRole('dialog', { name: 'Szczegóły sprawy', exact: true }),
  ).toBeVisible();
  expect((await snapshot(page)).jobs).toEqual(data.jobs);
});

test('notatka z galerii korzysta z istniejącego ID zdjęcia, a usuwanie notatki nie usuwa pliku', async ({
  page,
}) => {
  await seed(page);
  const card = await garden(page),
    gallery = card.getByRole('region', {
      name: 'Galeria i historia ogrodu',
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
  const original = (await snapshot(page)).photos[0];
  await gallery
    .getByRole('button', { name: 'Notatka do zdjęcia roze.png', exact: true })
    .click();
  const form = page.getByRole('dialog', { name: 'Nowa notatka', exact: true });
  await expect(
    form.getByRole('combobox', {
      name: 'Zdjęcie z galerii (opcjonalnie)',
      exact: true,
    }),
  ).toHaveValue(original.id);
  await form.getByLabel('Tytuł notatki', { exact: true }).fill('Problem róż');
  await form
    .getByRole('button', { name: 'Zapisz notatkę', exact: true })
    .click();
  await card.getByRole('tab',{name:'Notatki i dokumentacja',exact:true}).click();
  await card
    .getByRole('region', { name: 'Notatki ogrodu', exact: true })
    .getByRole('button', { name: 'Problem róż', exact: true })
    .click();
  const detail = page.getByRole('dialog', {
    name: 'Szczegóły notatki',
    exact: true,
  });
  await expect(detail.locator('.desk-linked-photo img')).toBeVisible();
  expect(await assetCount(page)).toBe(1);
  await detail
    .getByRole('button', { name: 'Usuń notatkę', exact: true })
    .click();
  await detail
    .getByRole('button', { name: 'Potwierdź usunięcie wpisu', exact: true })
    .click();
  expect(await assetCount(page)).toBe(1);
  expect((await snapshot(page)).photos[0]).toEqual(original);
});

test('pełny ZIP i JSON zawierają notatki, przypomnienia, sprawy i relacje fotograficzne', async ({
  page,
}) => {
  const data = fixture();
  data.notes = [
    note(data, {
      reminder: {
        date: day,
        time: '13:00',
        status: 'active',
        completedAt: null,
      },
    }),
  ];
  data.todos = [todo(data, { dueDate: '2026-11-02' })];
  await seed(page, data);
  const card = await garden(page),
    gallery = card.getByRole('region', {
      name: 'Galeria i historia ogrodu',
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
  await card.getByRole('button', { name: 'Zamknij okno', exact: true }).click();
  await notes(page);
  let detail = await openNote(page);
  await detail
    .getByRole('button', { name: 'Edytuj notatkę', exact: true })
    .click();
  const form = page.getByRole('dialog', {
    name: 'Edytuj notatkę',
    exact: true,
  });
  const photo = (await snapshot(page)).photos[0];
  await form
    .getByRole('combobox', {
      name: 'Zdjęcie z galerii (opcjonalnie)',
      exact: true,
    })
    .selectOption(photo.id);
  await form
    .getByRole('button', { name: 'Zapisz notatkę', exact: true })
    .click();
  await detail
    .getByRole('button', { name: 'Zamknij okno', exact: true })
    .click();
  const original = await snapshot(page);
  let panel = await settings(page);
  const json = JSON.parse(
    (await download(page, panel, 'Eksportuj dane')).toString(),
  );
  expect(json.data.notes).toEqual(original.notes);
  expect(json.data.todos).toEqual(original.todos);
  const zip = await download(page, panel, 'Pobierz pełną kopię ZIP');
  await panel
    .getByRole('button', { name: 'Zamknij okno', exact: true })
    .click();
  detail = await openNote(page);
  await detail
    .getByRole('button', { name: 'Usuń notatkę', exact: true })
    .click();
  await detail
    .getByRole('button', { name: 'Potwierdź usunięcie wpisu', exact: true })
    .click();
  panel = await settings(page);
  await panel
    .getByLabel('Wczytaj pełną kopię ZIP', { exact: true })
    .setInputFiles({
      name: 'garden.zip',
      mimeType: 'application/zip',
      buffer: zip,
    });
  await expect(
    panel.getByRole('checkbox', {
      name: 'Rozumiem, że bieżący zestaw zostanie zastąpiony.',
      exact: true,
    }),
  ).toBeVisible();
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
  expect(restored.notes).toEqual(original.notes);
  expect(restored.todos).toEqual(original.todos);
  expect(restored.jobs).toEqual(original.jobs);
  expect(restored.payments).toEqual(original.payments);
  await page.reload();
  await notes(page);
  detail = await openNote(page);
  await expect(detail.locator('.desk-linked-photo img')).toBeVisible();
});

test('migracja v6 zachowuje dotychczasowe dane i oryginalny zapis', async ({
  page,
}) => {
  const data = fixture(),
    old = JSON.parse(JSON.stringify(data));
  delete old.notes;
  delete old.todos;
  delete old.deskTombstones;
  await seed(page, old, 6);
  const stored = await page.evaluate(() => ({
    main: JSON.parse(localStorage.getItem('garden-manager:v1')!),
    old: JSON.parse(localStorage.getItem('garden-manager:backup:v6')!),
  }));
  expect(stored.main.version).toBe(STORAGE_VERSION);
  expect(stored.main.data).toEqual({
    ...old,
    notes: [],
    todos: [],
    deskTombstones: [],
  });
  expect(stored.old).toEqual({ version: 6, data: old });
  await addNote(page, 'Po migracji');
  expect((await snapshot(page)).jobs).toEqual(data.jobs);
});

test('telefon: notatki i sprawy są dostępne z Więcej, formularze i filtry mieszczą się w ekranie', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page);
  await addNote(page, 'Mobilna notatka', true);
  await page.getByRole('button', { name: 'Więcej', exact: true }).click();
  await page
    .locator('.mobile-more')
    .getByRole('button', { name: 'Notatki', exact: true })
    .click();
  await expect(page.locator('.desk-card')).toContainText('Mobilna notatka');
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  const detail = await openNote(page, 'Mobilna notatka');
  await detail
    .getByRole('button', { name: 'Edytuj notatkę', exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Anuluj', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Zamknij okno', exact: true })
    .click();
  await page.getByRole('button', { name: 'Więcej', exact: true }).click();
  await page
    .locator('.mobile-more')
    .getByRole('button', { name: 'Do zrobienia', exact: true })
    .click();
  await page.getByRole('button', { name: 'Dodaj sprawę', exact: true }).click();
  const form = page.getByRole('dialog', {
    name: 'Nowa sprawa do załatwienia',
    exact: true,
  });
  await form
    .getByLabel('Tytuł sprawy', { exact: true })
    .fill('Mobilny telefon');
  await form
    .getByRole('button', { name: 'Zapisz sprawę', exact: true })
    .click();
  await page
    .getByRole('button', {
      name: 'Wykonaj sprawę Mobilny telefon',
      exact: true,
    })
    .click();
  await expect(page.locator('.desk-todo-row')).toContainText('Wykonane');
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
});
