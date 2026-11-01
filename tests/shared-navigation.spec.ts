import { test as base, expect, type Page } from "@playwright/test";
import { createDemoData } from "../src/data/demo";
import { STORAGE_KEY, STORAGE_VERSION } from "../src/data/repository";

const test = base.extend<{ errors: string[] }>({
  errors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await use(errors);
      expect(errors).toEqual([]);
    },
    { auto: true },
  ],
});

const now = new Date("2026-11-01T10:00:00+01:00");
const data = createDemoData(now);
data.gardens[0].zones = [
  {
    id: "zone-1",
    name: "Rabata",
    type: "rabata",
    area: 20,
    length: null,
    plants: "Róże",
    requirements: "",
    treatments: "",
  },
];
data.jobs.find((j) => j.id === "job-6")!.gardenId = "garden-1";
data.jobs.find((j) => j.id === "job-6")!.date = "2026-11-01";
const garden = (page: Page) =>
  page.getByRole("dialog", {
    name: "Karta ogrodu: Ogród przy Lipowej",
    exact: true,
  });
const job = (page: Page) =>
  page.getByRole("dialog", { name: "Szczegóły zlecenia", exact: true });
const main = (page: Page) =>
  page.getByRole("navigation", { name: "Nawigacja główna", exact: true });

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: now });
  await page.addInitScript(
    ({ key, version, data }) => {
      if (!localStorage.getItem(key))
        localStorage.setItem(key, JSON.stringify({ version, data }));
    },
    { key: STORAGE_KEY, version: STORAGE_VERSION, data },
  );
});

test("legacy link, client → garden → job, native Back/Forward and in-app return share history", async ({
  page,
}) => {
  await page.goto("/?client=client-1#clients");
  await expect(
    page.getByRole("heading", { name: "Anna Kowalska", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/#clients\?client=client-1$/);
  await page
    .getByRole("button", {
      name: "Otwórz ogród Ogród przy Lipowej",
      exact: true,
    })
    .click();
  await garden(page)
    .getByRole("tab", { name: "Zlecenia i historia prac", exact: true })
    .click();
  await garden(page)
    .getByRole("button", {
      name: "Szczegóły zlecenia Pielęgnacja ogrodu",
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(/job=job-1/);
  await page.goBack();
  await expect(garden(page)).toBeVisible();
  await expect(
    garden(page).getByRole("tab", {
      name: "Zlecenia i historia prac",
      exact: true,
    }),
  ).toHaveAttribute("aria-selected", "true");
  await page.goForward();
  await expect(job(page)).toBeVisible();
  await job(page)
    .getByRole("button", {
      name: "Wróć do ogrodu Ogród przy Lipowej",
      exact: true,
    })
    .click();
  await expect(garden(page)).toBeVisible();
  await garden(page)
    .getByRole("button", { name: "Klient: Anna Kowalska", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Anna Kowalska", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("reload and a new browser page restore garden/job sections from the URL", async ({
  page,
  context,
}) => {
  await page.goto("/#gardens?garden=garden-1&section=zones");
  await expect(
    garden(page).getByRole("tab", { name: "Strefy i rośliny", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.reload();
  await expect(garden(page)).toContainText("Rabata");
  const other = await context.newPage();
  await other.goto(page.url());
  await expect(garden(other)).toContainText("Róże");
  await other.close();
  await page.goto("/#history?job=job-6&section=billing");
  await expect(
    job(page).locator('[data-visit-section="billing"]'),
  ).toBeInViewport();
  await page.reload();
  await expect(
    job(page).locator('[data-visit-section="billing"]'),
  ).toBeInViewport();
  await expect(
    job(page).getByRole("region", { name: "Korekta ceny robocizny" }),
  ).toHaveCount(0);
});

test("an already opened job can be targeted at billing through its garden", async ({
  page,
}) => {
  await page.goto("/#history?job=job-6&section=notes");
  await job(page)
    .getByRole("button", { name: "Ogród: Ogród przy Lipowej", exact: true })
    .click();
  await garden(page)
    .getByRole("tab", { name: "Rozliczenia", exact: true })
    .click();
  await garden(page)
    .getByRole("button", {
      name: "Rozliczenie zlecenia Koszenie trawnika",
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(/job=job-6&section=billing/);
  await expect(
    job(page).locator('[data-visit-section="billing"]'),
  ).toBeInViewport();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(job(page).locator(".billing-editor")).toHaveCount(0);
});

test("main tabs always open their aggregate lists, with filters kept on browser return", async ({
  page,
}) => {
  await page.goto("/#clients");
  await page.getByLabel("Szukaj klientów", { exact: true }).fill("Anna");
  await page
    .getByRole("button", { name: "Anna Kowalska", exact: true })
    .click();
  await main(page)
    .getByRole("button", { name: "Obiekty i ogrody", exact: true })
    .click();
  await main(page)
    .getByRole("button", { name: "Klienci", exact: true })
    .click();
  await expect(page).toHaveURL(/#clients$/);
  await expect(page.getByLabel("Szukaj klientów", { exact: true })).toHaveValue(
    "Anna",
  );
  await expect(
    page.getByRole("button", { name: "Edytuj klienta", exact: true }),
  ).toHaveCount(0);
  await page.goBack();
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Anna Kowalska", exact: true }),
  ).toBeVisible();
});

test("invalid routes and deleted objects have a safe return", async ({
  page,
}) => {
  await page.goto("/#bad-view");
  await expect(page.getByRole("alert")).toContainText("Nieprawidłowy adres");
  await page.getByRole("button", { name: "Pokaż listę", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  for (const hash of [
    "#clients?client=missing",
    "#gardens?garden=missing",
    "#jobs?job=missing",
  ]) {
    await page.goto(`/${hash}`);
    await expect(page.locator("body")).toContainText(
      /Nie znaleziono klienta|nie jest już dostępne|nie jest już dostępny/,
    );
    if (await page.getByRole("dialog").count())
      await page
        .getByRole("button", { name: "Zamknij okno", exact: true })
        .click();
    else
      await page
        .getByRole("button", { name: "Wróć do klientów", exact: true })
        .click();
    await expect(page).not.toHaveURL(/missing/);
  }
});

test("dirty client form survives cancellation of native Back, then can be discarded once", async ({
  page,
}) => {
  await page.goto("/#clients");
  await page
    .getByRole("button", { name: "Anna Kowalska", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Edytuj klienta", exact: true })
    .click();
  const form = page.getByRole("dialog", {
    name: "Edytuj klienta",
    exact: true,
  });
  await form
    .getByLabel("Imię i nazwisko / nazwa firmy *", { exact: true })
    .fill("Niezapisany klient");
  let prompts = 0;
  const reject = async (d: import("@playwright/test").Dialog) => {
    prompts++;
    await d.dismiss();
  };
  page.on("dialog", reject);
  await page.goBack();
  await expect.poll(() => prompts).toBe(1);
  await expect(page).toHaveURL(/client=client-1/);
  await expect(form).toBeVisible();
  await expect(
    form.getByLabel("Imię i nazwisko / nazwa firmy *", { exact: true }),
  ).toHaveValue("Niezapisany klient");
  page.off("dialog", reject);
  page.once("dialog", async (d) => {
    prompts++;
    await d.accept();
  });
  await page.goBack();
  await expect(
    page.getByLabel("Szukaj klientów", { exact: true }),
  ).toBeVisible();
  expect(prompts).toBe(2);
  const stored = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!).data,
    STORAGE_KEY,
  );
  expect(stored.clients[0].name).toBe("Anna Kowalska");
});

test("dirty job and zone forms guard Escape, cancellation and application navigation; save does not prompt", async ({
  page,
}) => {
  await page.goto("/#jobs?job=job-1");
  await job(page)
    .getByRole("button", { name: "Edytuj zlecenie", exact: true })
    .click();
  await job(page)
    .getByLabel("Nazwa pracy", { exact: true })
    .fill("Szkic wizyty");
  page.once("dialog", (d) => d.dismiss());
  await page.keyboard.press("Escape");
  await expect(job(page)).toBeVisible();
  page.once("dialog", (d) => d.dismiss());
  await job(page)
    .getByRole("button", { name: "Ogród: Ogród przy Lipowej", exact: true })
    .click();
  await expect(page).toHaveURL(/job=job-1/);
  await job(page)
    .getByRole("button", { name: "Zapisz zlecenie", exact: true })
    .click();
  await expect(
    job(page).getByRole("heading", { name: "Szkic wizyty", exact: true }),
  ).toBeVisible();
  await job(page)
    .getByRole("button", { name: "Ogród: Ogród przy Lipowej", exact: true })
    .click();
  await garden(page)
    .getByRole("tab", { name: "Strefy i rośliny", exact: true })
    .click();
  await garden(page)
    .getByRole("button", { name: "Edytuj strefę Rabata", exact: true })
    .click();
  const zone = garden(page);
  await zone
    .getByRole("textbox", { name: "Rośliny", exact: true })
    .fill("Szkic roślin");
  page.once("dialog", (d) => d.dismiss());
  await zone
    .getByRole("button", { name: "Anuluj edycję strefy", exact: true })
    .click();
  await expect(
    zone.getByRole("textbox", { name: "Rośliny", exact: true }),
  ).toHaveValue("Szkic roślin");
});

test("a failed save keeps the job draft guarded and preserves the stored record", async ({
  page,
}) => {
  await page.goto("/#jobs?job=job-1");
  await job(page)
    .getByRole("button", { name: "Edytuj zlecenie", exact: true })
    .click();
  await job(page)
    .getByLabel("Nazwa pracy", { exact: true })
    .fill("Nieudany zapis");
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "garden-manager:v1")
        throw new DOMException("Brak miejsca", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  await job(page)
    .getByRole("button", { name: "Zapisz zlecenie", exact: true })
    .click();
  await expect(job(page).getByRole("alert")).toBeVisible();
  let prompts = 0;
  page.once("dialog", async (d) => {
    prompts++;
    await d.dismiss();
  });
  await page.keyboard.press("Escape");
  expect(prompts).toBe(1);
  await expect(
    job(page).getByLabel("Nazwa pracy", { exact: true }),
  ).toHaveValue("Nieudany zapis");
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("garden-manager:v1")!).data.jobs[0]
          .title,
    ),
  ).toBe("Pielęgnacja ogrodu");
});

test("Forward also protects a dirty garden form and resumes after explicit discard", async ({
  page,
}) => {
  await page.goto("/#gardens");
  await page
    .getByRole("button", {
      name: "Karta ogrodu Ogród przy Lipowej",
      exact: true,
    })
    .click();
  await garden(page)
    .getByRole("tab", { name: "Zlecenia i historia prac", exact: true })
    .click();
  await garden(page)
    .getByRole("button", {
      name: "Szczegóły zlecenia Pielęgnacja ogrodu",
      exact: true,
    })
    .click();
  await page.goBack();
  await garden(page)
    .getByRole("button", { name: "Edytuj dane ogrodu", exact: true })
    .click();
  const form = page.getByRole("dialog", { name: "Edytuj ogród", exact: true });
  await form
    .getByLabel("Nazwa ogrodu *", { exact: true })
    .fill("Niezapisany ogród");
  let prompts = 0;
  page.once("dialog", async (d) => {
    prompts++;
    await d.dismiss();
  });
  await page.goForward();
  await expect.poll(() => prompts).toBe(1);
  await expect(page).toHaveURL(/garden=garden-1/);
  await expect(form).toBeVisible();
  page.once("dialog", async (d) => {
    prompts++;
    await d.accept();
  });
  await page.goForward();
  await expect(job(page)).toBeVisible();
  expect(prompts).toBe(2);
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("garden-manager:v1")!).data.gardens[0]
          .name,
    ),
  ).toBe("Ogród przy Lipowej");
});

test("the selected history month and filters survive reload and browser return", async ({
  page,
}) => {
  await page.goto("/#clients?client=client-1");
  await page
    .getByLabel("Filtr statusu wykonania", { exact: true })
    .selectOption("completed");
  await page
    .getByLabel("Kolejność historii", { exact: true })
    .selectOption("asc");
  await page
    .getByRole("button", {
      name: "Otwórz ogród Ogród przy Lipowej",
      exact: true,
    })
    .click();
  await garden(page)
    .getByRole("tab", { name: "Zlecenia i historia prac", exact: true })
    .click();
  await garden(page)
    .getByLabel("Filtr statusu zleceń ogrodu", { exact: true })
    .selectOption("completed");
  await page.reload();
  await expect(
    garden(page).getByLabel("Filtr statusu zleceń ogrodu", { exact: true }),
  ).toHaveValue("completed");
  await page.goBack();
  await expect(
    page.getByLabel("Filtr statusu wykonania", { exact: true }),
  ).toHaveValue("completed");
  await expect(
    page.getByLabel("Kolejność historii", { exact: true }),
  ).toHaveValue("asc");
});

for (const width of [360, 390, 430])
  test(`phone ${width}px: addressed cards, native history and data stay intact`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/#clients?client=client-1");
    const before = await page.evaluate(
      (key) => localStorage.getItem(key),
      STORAGE_KEY,
    );
    await page
      .getByRole("button", {
        name: "Otwórz ogród Ogród przy Lipowej",
        exact: true,
      })
      .click();
    await garden(page)
      .getByRole("tab", { name: "Strefy i rośliny", exact: true })
      .click();
    await page.reload();
    await expect(garden(page)).toContainText("Rabata");
    await page.goBack();
    await expect(
      page.getByRole("heading", { name: "Anna Kowalska", exact: true }),
    ).toBeVisible();
    await page.goForward();
    await expect(garden(page)).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY),
    ).toBe(before);
  });

test("reload warns before discarding a changed client form", async ({
  page,
}) => {
  await page.goto("/#clients?client=client-1");
  await page
    .getByRole("button", { name: "Edytuj klienta", exact: true })
    .click();
  const form = page.getByRole("dialog", {
    name: "Edytuj klienta",
    exact: true,
  });
  await form
    .getByLabel("Imię i nazwisko / nazwa firmy *", { exact: true })
    .fill("Szkic przed odświeżeniem");
  let prompts = 0;
  page.once("dialog", async (d) => {
    expect(d.type()).toBe("beforeunload");
    prompts++;
    await d.dismiss();
  });
  // A cancelled reload does not emit a new load event; request it without
  // Playwright's navigation waiter, then verify the actual browser warning.
  await page.evaluate(() => { setTimeout(() => location.reload(), 0); });
  await expect.poll(() => prompts).toBe(1);
  await expect(
    form.getByLabel("Imię i nazwisko / nazwa firmy *", { exact: true }),
  ).toHaveValue("Szkic przed odświeżeniem");
  page.once("dialog", (d) => d.accept());
  await Promise.all([
    page.waitForEvent('load'),
    page.evaluate(() => { setTimeout(() => location.reload(), 0); }),
  ]);
  await expect(form).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Anna Kowalska", exact: true }),
  ).toBeVisible();
});

test("a job removed in another tab becomes unavailable without crashing", async ({
  page,
  context,
}) => {
  await page.goto("/#jobs?job=job-1");
  await expect(job(page)).toBeVisible();
  const other = await context.newPage();
  await other.goto("/#dashboard");
  await other.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("garden-manager:v1")!);
    raw.data.jobs = raw.data.jobs.filter(
      (j: { id: string }) => j.id !== "job-1",
    );
    localStorage.setItem("garden-manager:v1", JSON.stringify(raw));
  });
  await expect(job(page)).toContainText("To zlecenie nie jest już dostępne");
  await job(page)
    .getByRole("button", { name: "Zamknij okno", exact: true })
    .click();
  await expect(page).toHaveURL(/#jobs$/);
  await other.close();
});
