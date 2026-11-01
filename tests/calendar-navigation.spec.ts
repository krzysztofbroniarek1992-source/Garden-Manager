import { createBlankChecklist } from "../src/checklists/commands";
import { test as base, expect, type Page } from "@playwright/test";
import { STORAGE_KEY, STORAGE_VERSION } from "../src/data/repository";
import {
  planningClock,
  planningNavigationData,
} from "./planning-navigation-fixture";
const test = base.extend<{ errors: string[] }>({
  errors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await use(errors);
      expect(errors).toEqual([]);
    },
    { auto: true },
  ],
});
test.setTimeout(60_000);
const garden = (p: Page) =>
  p.getByRole("dialog", {
    name: "Karta ogrodu: Ogród przy Lipowej",
    exact: true,
  });
const task = (p: Page) =>
  p.getByRole("dialog", { name: "Szczegóły zadania", exact: true });
const series = (p: Page) =>
  p.getByRole("dialog", {
    name: "Harmonogram: Nawigacyjna pielęgnacja",
    exact: true,
  });
const job = (p: Page) =>
  p.getByRole("dialog", { name: "Szczegóły zlecenia", exact: true });
const snapshot = (p: Page) =>
  p.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
const taskURL =
  "/#calendar?task=series-navigation&original=2026-10-31&date=2026-11-03&view=week&gardenFilter=garden-1&kindFilter=work";
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(planningClock);
  await page.addInitScript(
    ({ key, version, data }) => {
      if (!localStorage.getItem(key))
        localStorage.setItem(key, JSON.stringify({ version, data }));
    },
    {
      key: STORAGE_KEY,
      version: STORAGE_VERSION,
      data: planningNavigationData(),
    },
  );
});

test("garden → series → linked job and source term preserve the garden context", async ({
  page,
}) => {
  await page.goto("/#gardens?garden=garden-1&section=plans");
  const before = await snapshot(page);
  await garden(page)
    .getByRole("button", {
      name: "Otwórz harmonogram Nawigacyjna pielęgnacja",
      exact: true,
    })
    .click();
  await expect(series(page)).toBeVisible();
  await series(page)
    .getByLabel("Terminy od", { exact: true })
    .fill("2026-11-01");
  await series(page)
    .getByRole("button", {
      name: "Zlecenie harmonogramu Powiązana wizyta",
      exact: true,
    })
    .click();
  await expect(job(page)).toContainText("Powiązana wizyta");
  await job(page)
    .getByRole("button", { name: "Wróć do harmonogramu", exact: true })
    .click();
  await expect(
    series(page).getByLabel("Terminy od", { exact: true }),
  ).toHaveValue("2026-11-01");
  await series(page)
    .getByRole("button", { name: "Szczegóły terminu 2026-10-31", exact: true })
    .click();
  await expect(task(page)).toContainText("2026-11-03");
  await expect(task(page)).toContainText("Termin pierwotny: 2026-10-31");
  await task(page)
    .getByRole("button", { name: "Wróć do harmonogramu", exact: true })
    .click();
  await series(page)
    .getByRole("button", {
      name: "Wróć do ogrodu Ogród przy Lipowej",
      exact: true,
    })
    .click();
  await expect(
    garden(page).getByRole("tab", {
      name: "Harmonogram i plany czynności",
      exact: true,
    }),
  ).toHaveAttribute("aria-selected", "true");
  expect(await snapshot(page)).toBe(before);
});

test("garden → moved term in calendar → calendar → original garden, with Back/Forward", async ({
  page,
}) => {
  await page.goto("/#gardens?garden=garden-1&section=plans");
  const before = await snapshot(page);
  await garden(page)
    .getByRole("button", {
      name: "Kalendarz harmonogramu Nawigacyjna pielęgnacja",
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(/task=series-navigation&original=2026-10-31/);
  await expect(task(page)).toContainText("2026-11-03");
  await task(page)
    .getByRole("button", { name: "Zamknij okno", exact: true })
    .click();
  await expect(page.getByLabel("Przejdź do dnia", { exact: true })).toHaveValue(
    "2026-11-03",
  );
  await expect(
    page.getByRole("button", { name: "Dzień", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("combobox", { name: "Ogród w kalendarzu", exact: true }),
  ).toHaveValue("garden-1");
  await page
    .getByRole("button", { name: "Wróć do ogrodu", exact: true })
    .click();
  await expect(garden(page)).toBeVisible();
  await page.goForward();
  await expect(
    page.getByRole("heading", { name: "Kalendarz prac", exact: true }),
  ).toBeVisible();
  await page.goForward();
  await expect(task(page)).toBeVisible();
  expect(await snapshot(page)).toBe(before);
});

test("task links open client, garden and the correct zone, then return to the same event", async ({
  page,
}) => {
  await page.goto(taskURL);
  const before = await snapshot(page);
  await task(page)
    .getByRole("button", { name: "Klient: Anna Kowalska", exact: true })
    .click();
  const client = page.getByRole("dialog", {
    name: "Karta klienta: Anna Kowalska",
    exact: true,
  });
  await expect(client).toBeVisible();
  await client
    .getByRole("button", { name: "Wróć do czynności", exact: true })
    .click();
  await task(page)
    .getByRole("button", { name: "Ogród: Ogród przy Lipowej", exact: true })
    .click();
  await expect(garden(page)).toBeVisible();
  await garden(page)
    .getByRole("button", { name: "Wróć do czynności", exact: false })
    .click();
  await task(page)
    .getByRole("button", { name: "Strefa: Rabata nawigacyjna", exact: true })
    .click();
  const zone = garden(page).locator('[data-zone-id="zone-navigation"]');
  await expect(zone).toBeInViewport();
  await expect(zone).toBeFocused();
  await expect(page).toHaveURL(/section=zones&zone=zone-navigation/);
  await page.goBack();
  await expect(task(page)).toBeVisible();
  await page.reload();
  await expect(task(page)).toContainText("Termin pierwotny: 2026-10-31");
  await task(page)
    .getByRole("button", { name: "Zamknij okno", exact: true })
    .click();
  await expect(page.getByLabel("Przejdź do dnia", { exact: true })).toHaveValue(
    "2026-11-03",
  );
  await expect(
    page.getByRole("button", { name: "Tydzień", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("combobox", { name: "Rodzaj wydarzeń", exact: true }),
  ).toHaveValue("work");
  expect(await snapshot(page)).toBe(before);
});

test("skipped occurrences and calendar filters survive reload and a new page without duplicates", async ({
  page,
  context,
}) => {
  await page.goto(
    "/#calendar?date=2026-11-14&view=week&gardenFilter=garden-1&statusFilter=cancelled&kindFilter=work",
  );
  const before = await snapshot(page);
  const event = page
    .locator(".calendar-agenda")
    .getByRole("button", { name: "Nawigacyjna pielęgnacja", exact: true });
  await expect(event).toHaveCount(1);
  await event.click();
  await expect(task(page)).toContainText("Odwołane");
  await expect(
    task(page).getByRole("button", { name: "Rozpocznij pracę", exact: true }),
  ).toHaveCount(0);
  const other = await context.newPage();
  await other.goto(page.url());
  await expect(task(other)).toContainText("2026-11-14");
  await other.close();
  await page.reload();
  await expect(task(page)).toBeVisible();
  await task(page)
    .getByRole("button", { name: "Zamknij okno", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Status wydarzeń", exact: true }),
  ).toHaveValue("cancelled");
  await expect(
    page
      .locator(".calendar-event")
      .filter({ hasText: "Nawigacyjna pielęgnacja" }),
  ).toHaveCount(1);
  expect(await snapshot(page)).toBe(before);
});

test("linked job → original occurrence → existing job → series never creates another visit", async ({
  page,
}) => {
  await page.goto("/#jobs?job=linked-work");
  const before = await snapshot(page);
  await job(page)
    .getByRole("button", { name: "Źródłowy termin: 2026-11-28", exact: true })
    .click();
  await expect(task(page)).toContainText("2026-12-01");
  await task(page)
    .getByRole("button", { name: "Otwórz rzeczywiste zlecenie", exact: true })
    .click();
  await expect(job(page)).toBeVisible();
  await job(page)
    .getByRole("button", { name: "Seria harmonogramu", exact: true })
    .click();
  await expect(series(page)).toBeVisible();
  await page.goBack();
  await expect(job(page)).toBeVisible();
  await page.goForward();
  await expect(series(page)).toBeVisible();
  await page.reload();
  await expect(series(page)).toContainText("Powiązana wizyta");
  expect(await snapshot(page)).toBe(before);
});

test("explicit start creates one job; closing it returns to task and reopening stays read-only", async ({
  page,
}) => {
  await page.goto(taskURL);
  const before = JSON.parse((await snapshot(page))!).data;
  await task(page)
    .getByRole("button", { name: "Rozpocznij pracę", exact: true })
    .click();
  await expect(job(page)).toBeVisible();
  await job(page)
    .getByRole("button", {
      name: "PAUZA — Przerwa bez naliczania",
      exact: true,
    })
    .click();
  const saved = await snapshot(page);
  for (let i = 0; i < 3; i++) {
    await job(page)
      .getByRole("button", { name: "Wróć do czynności", exact: true })
      .click();
    await expect(task(page)).toBeVisible();
    await task(page)
      .getByRole("button", { name: "Otwórz rzeczywiste zlecenie", exact: true })
      .click();
    await expect(job(page)).toBeVisible();
  }
  expect(await snapshot(page)).toBe(saved);
  const after = JSON.parse(saved!).data;
  expect(after.jobs).toHaveLength(before.jobs.length + 1);
  expect(
    after.taskOccurrences.filter(
      (o: { originalDate: string }) => o.originalDate === "2026-10-31",
    ),
  ).toHaveLength(1);
  expect(after.payments).toEqual(before.payments);
  await job(page)
    .getByRole("button", { name: "Wróć do czynności", exact: true })
    .click();
  await page.reload();
  await expect(
    task(page).getByRole("button", {
      name: "Otwórz rzeczywiste zlecenie",
      exact: true,
    }),
  ).toBeVisible();
  expect(await snapshot(page)).toBe(saved);
});

test("dashboard separates details and timer selection and opens planned reminders", async ({
  page,
}) => {
  await page.goto("/#dashboard");
  const before = await snapshot(page);
  const selected = await page.locator("#timer-job").inputValue();
  await page
    .getByRole("button", {
      name: "Otwórz szczegóły zlecenia Koszenie i porządkowanie",
      exact: true,
    })
    .click();
  await expect(job(page)).toContainText("Koszenie i porządkowanie");
  await job(page)
    .getByRole("button", { name: "Zamknij okno", exact: true })
    .click();
  await expect(page.locator("#timer-job")).toHaveValue(selected);
  await page
    .getByRole("button", {
      name: "Wybierz do stopera Koszenie i porządkowanie",
      exact: true,
    })
    .click();
  await expect(page.locator("#timer-job")).toHaveValue("job-2");
  await page
    .locator(".planning-reminder-row")
    .filter({ hasText: "Nawigacyjna pielęgnacja" })
    .filter({ hasText: "2026-11-03" })
    .click();
  await expect(task(page)).toBeVisible();
  await task(page)
    .getByRole("button", { name: "Zamknij okno", exact: true })
    .click();
  await expect(page.locator("#timer-job")).toHaveValue("job-2");
  expect(await snapshot(page)).toBe(before);
});

test("a changed exception draft is protected by the existing navigation guard", async ({
  page,
}) => {
  await page.goto(taskURL);
  const before = await snapshot(page);
  await task(page)
    .getByRole("button", { name: "Przesuń ten termin", exact: true })
    .click();
  await task(page)
    .getByLabel("Nowa data terminu", { exact: true })
    .fill("2026-11-04");
  page.once("dialog", (d) => d.dismiss());
  await task(page)
    .getByRole("button", { name: "Ogród: Ogród przy Lipowej", exact: true })
    .click();
  await expect(
    task(page).getByLabel("Nowa data terminu", { exact: true }),
  ).toHaveValue("2026-11-04");
  expect(await snapshot(page)).toBe(before);
  page.once("dialog", (d) => d.accept());
  await task(page)
    .getByRole("button", { name: "Anuluj przesunięcie", exact: true })
    .click();
  await expect(
    task(page).getByLabel("Nowa data terminu", { exact: true }),
  ).toHaveCount(0);
});

for (const width of [360, 390, 430])
  test(`phone ${width}px: calendar → task → zone and browser return`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(taskURL);
    const before = await snapshot(page);
    await task(page)
      .getByRole("button", { name: "Strefa: Rabata nawigacyjna", exact: true })
      .click();
    await expect(
      garden(page).locator('[data-zone-id="zone-navigation"]'),
    ).toBeInViewport();
    await page.goBack();
    await expect(task(page)).toBeVisible();
    await page.goForward();
    await expect(garden(page)).toBeVisible();
    await page.reload();
    await expect(garden(page)).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(await snapshot(page)).toBe(before);
  });

test("missing series, occurrences and invalid calendar addresses remain safe", async ({
  page,
}) => {
  for (const url of [
    "/#calendar?schedule=missing",
    "/#calendar?task=series-navigation&original=2026-11-02",
    "/#calendar?date=bad&view=week",
    "/#calendar?date=2000-01-01&anchor=2099-01-01&view=month",
  ]) {
    await page.goto(url);
    await expect(page.locator("body")).toContainText(
      /nie jest już dostępny|Ten termin zmienił się|Nieprawidłowy adres/,
    );
  }
});

test("changing calendar controls addresses the view and preserves event focus after return", async ({
  page,
}) => {
  await page.goto("/#calendar");
  const before = await snapshot(page);
  await page.getByLabel("Przejdź do dnia", { exact: true }).fill("2026-11-03");
  await page.getByRole("button", { name: "Tydzień", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Ogród w kalendarzu", exact: true })
    .selectOption("garden-1");
  await page
    .getByRole("combobox", { name: "Rodzaj wydarzeń", exact: true })
    .selectOption("work");
  await page
    .getByRole("combobox", { name: "Status wydarzeń", exact: true })
    .selectOption("planned");
  await expect(page).toHaveURL(
    /date=2026-11-03&view=week&gardenFilter=garden-1&kindFilter=work&statusFilter=planned/,
  );
  const event = page
    .locator(".calendar-agenda")
    .getByRole("button", { name: "Nawigacyjna pielęgnacja", exact: true });
  await event.click();
  await expect(task(page)).toBeVisible();
  await page.goBack();
  await expect(event).toBeFocused();
  await page.reload();
  await expect(
    page.getByRole("combobox", { name: "Status wydarzeń", exact: true }),
  ).toHaveValue("planned");
  await expect(
    page.getByRole("button", { name: "Tydzień", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(await snapshot(page)).toBe(before);
});

test("zone navigation does not steal focus from existing autosave editors", async ({
  page,
}) => {
  const created = createBlankChecklist(
    planningNavigationData(),
    { kind: "plan", gardenId: "garden-1", zoneId: "zone-navigation" },
    "Plan bez utraty fokusu",
    planningClock.getTime(),
  );
  await page.goto(taskURL);
  await page.evaluate(
    ({ key, version, data }) =>
      localStorage.setItem(key, JSON.stringify({ version, data })),
    { key: STORAGE_KEY, version: STORAGE_VERSION, data: created.data },
  );
  await page.reload();
  await task(page)
    .getByRole("button", { name: "Strefa: Rabata nawigacyjna", exact: true })
    .click();
  await garden(page)
    .getByRole("button", {
      name: "Checklisty strefy Rabata nawigacyjna",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Plan bez utraty fokusu", exact: true })
    .click();
  await page.getByText("Nazwa i opis checklisty", { exact: true }).click();
  const input = page.getByRole("textbox", {
    name: "Nazwa checklisty",
    exact: true,
  });
  await input.fill("Zmieniony plan");
  await expect
    .poll(
      async () => JSON.parse((await snapshot(page))!).data.checklists[0].name,
    )
    .toBe("Zmieniony plan");
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(input).toBeFocused();
  const saved = JSON.parse((await snapshot(page))!).data;
  expect(saved.jobs).toEqual(created.data.jobs);
  expect(saved.timer).toEqual(created.data.timer);
  expect(saved.payments).toEqual(created.data.payments);
});
