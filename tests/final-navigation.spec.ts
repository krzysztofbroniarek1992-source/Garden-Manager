import { test as base, expect, type Page } from "@playwright/test";
import { finalData, finalClock } from "./final-navigation-fixture";
import { STORAGE_KEY, STORAGE_VERSION } from "../src/data/repository";
import { snapshot } from "./atomic-report-helpers";
import { settled, setChecked } from "./atomic-fixture";
import { holdFinanceWrites as holdWrites } from "./finance-fixture";
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
const todo = (p: Page) =>
  p.getByRole("dialog", { name: "Szczegóły sprawy", exact: true });
const menu = (p: Page) =>
  p.getByRole("dialog", { name: "Więcej opcji", exact: true });
const settings = (p: Page) =>
  p.getByRole("dialog", { name: "Ustawienia", exact: true });
const newJob = (p: Page) =>
  p.getByRole("dialog", { name: "Nowe zlecenie", exact: true });
const todoURL = "/#todos?todo=todo-final";
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(finalClock);
  await page.addInitScript(
    ({ key, version, data }) => {
      if (
        location.origin === "http://127.0.0.1:5173" &&
        !localStorage.getItem(key)
      )
        localStorage.setItem(key, JSON.stringify({ version, data }));
    },
    { key: STORAGE_KEY, version: STORAGE_VERSION, data: finalData() },
  );
});
async function release(p: Page) {
  await p.evaluate(() => (window as any).releaseFinanceWrite());
  await settled(p);
}
async function noOverflow(p: Page) {
  expect(
    await p.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  for (const d of await p.getByRole("dialog").all())
    expect(await d.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(
      true,
    );
}
async function failNextWrite(p: Page) {
  await p.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    let once = true;
    IDBObjectStore.prototype.put = function (
      ...args: Parameters<IDBObjectStore["put"]>
    ) {
      if (once && this.name === "state") {
        once = false;
        throw new DOMException("Brak miejsca — test", "QuotaExceededError");
      }
      return put.apply(this, args);
    };
  });
}

test("todo → garden → zone → series and back preserves scoped filters and refresh context without writes", async ({
  page,
  context,
}) => {
  await page.goto("/#todos");
  const before = await snapshot(page);
  await page.getByLabel("Szukaj spraw", { exact: true }).fill("korę");
  await page
    .getByRole("combobox", { name: "Klient", exact: true })
    .selectOption("client-1");
  await page
    .getByRole("combobox", { name: "Priorytet", exact: true })
    .selectOption("high");
  await page
    .getByRole("button", { name: "Zamówić korę do rabaty", exact: true })
    .click();
  await expect(page).toHaveURL(/todo=todo-final/);
  await todo(page)
    .getByRole("button", { name: "Ogród: Ogród przy Lipowej", exact: true })
    .click();
  const garden = page.getByRole("dialog", {
    name: "Karta ogrodu: Ogród przy Lipowej",
    exact: true,
  });
  await garden
    .getByRole("tab", { name: "Strefy i rośliny", exact: true })
    .click();
  await garden
    .getByRole("button", { name: "Otwórz strefę Rabata różana", exact: true })
    .click();
  const zone = page.getByRole("dialog", {
    name: "Strefa: Rabata różana",
    exact: true,
  });
  await zone.getByRole("tab", { name: /Czynności i harmonogramy/ }).click();
  await zone
    .getByRole("button", {
      name: "Otwórz harmonogram Pielęgnacja róż",
      exact: true,
    })
    .click();
  await page.reload();
  await expect(
    page.getByRole("dialog", {
      name: "Harmonogram: Pielęgnacja róż",
      exact: true,
    }),
  ).toBeVisible();
  await page.goBack();
  await expect(zone).toBeVisible();
  await page.goBack();
  await expect(garden).toBeVisible();
  await page.goBack();
  await expect(todo(page)).toBeVisible();
  await todo(page)
    .getByRole("button", { name: "Wróć do listy spraw", exact: true })
    .click();
  await expect(page.getByLabel("Szukaj spraw", { exact: true })).toHaveValue(
    "korę",
  );
  await page.reload();
  await expect(
    page.getByRole("combobox", { name: "Priorytet", exact: true }),
  ).toHaveValue("high");
  await expect(
    page.getByRole("combobox", { name: "Klient", exact: true }),
  ).toHaveValue("client-1");
  const other = await context.newPage();
  await other.goto("http://127.0.0.1:5173" + todoURL);
  await expect(todo(other)).toContainText("Zamówić korę");
  await other.close();
  expect(await snapshot(page)).toEqual(before);
});

test("calendar todo details use URL, Back/Forward and retain date, week and filters", async ({
  page,
}) => {
  const url =
    "/#calendar?date=2026-11-17&view=week&gardenFilter=garden-1&kindFilter=todo";
  await page.goto(url);
  const before = await snapshot(page);
  await page
    .getByRole("button", { name: /Zamówić korę do rabaty/ })
    .first()
    .click();
  await expect(todo(page)).toBeVisible();
  await expect(page).toHaveURL(/todo=todo-final/);
  await page.reload();
  await expect(todo(page)).toBeVisible();
  await todo(page)
    .getByRole("button", {
      name: "Zlecenie: Wizyta częściowo opłacona",
      exact: true,
    })
    .click();
  await page.goBack();
  await expect(todo(page)).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/view=week/);
  await expect(page).toHaveURL(/kindFilter=todo/);
  await page.goForward();
  await expect(todo(page)).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
});

test("dashboard opens real todo and timer details without selecting work or starting time", async ({
  page,
}) => {
  await page.goto("/#dashboard");
  const before = await snapshot(page);
  await page
    .getByRole("button", { name: /Zamówić korę do rabaty/ })
    .first()
    .click();
  await expect(todo(page)).toBeVisible();
  await todo(page)
    .getByRole("button", { name: "Wróć do pulpitu", exact: true })
    .click();
  const selection = await page.locator("#timer-job").inputValue();
  await page
    .getByRole("button", { name: "Otwórz wybrane zlecenie", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Szczegóły zlecenia", exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(page.locator("#timer-job")).toHaveValue(selection);
  expect(await snapshot(page)).toEqual(before);
});

test("dashboard adds a draft with one click; native Back guards unsaved work and a pending commit", async ({
  page,
}) => {
  await page.goto("/#dashboard");
  const before = await snapshot(page);
  await page
    .getByRole("button", { name: "Dodaj zlecenie", exact: true })
    .click();
  await expect(newJob(page)).toBeVisible();
  await expect(page).toHaveURL(/#jobs\?dialog=new-job/);
  expect(await snapshot(page)).toEqual(before);
  await newJob(page)
    .getByLabel("Nazwa pracy", { exact: true })
    .fill("Nowa wizyta z pulpitu");
  page.once("dialog", (d) => d.dismiss());
  await page.goBack();
  await expect(newJob(page)).toBeVisible();
  await expect(page).toHaveURL(/dialog=new-job/);
  await holdWrites(page);
  await newJob(page)
    .getByRole("button", { name: "Zapisz zlecenie", exact: true })
    .click();
  await expect(page.locator(".pending-write-status")).toContainText(
    "Zapisywanie zmian",
  );
  await page.goBack();
  await expect(newJob(page)).toBeVisible();
  await release(page);
  await expect(newJob(page)).toBeHidden();
  await expect(page).toHaveURL(/#dashboard$/);
  const after = await snapshot(page);
  expect(after.jobs).toHaveLength(before.jobs.length + 1);
  expect(
    after.jobs.find((j: any) => j.title === "Nowa wizyta z pulpitu"),
  ).toMatchObject({ status: "planned", seconds: 0, settlement: null });
  expect(after.payments).toEqual(before.payments);
  expect(after.timer).toBe(before.timer);
  expect(after.reportSequence).toBe(before.reportSequence);
});

test("new-job and settings direct addresses refresh safely and malformed dialogs show errors", async ({
  page,
}) => {
  await page.goto("/#jobs?dialog=new-job");
  const before = await snapshot(page);
  await expect(newJob(page)).toBeVisible();
  await page.reload();
  await expect(newJob(page)).toBeVisible();
  await newJob(page)
    .getByRole("button", { name: "Anuluj", exact: true })
    .click();
  await expect(page).toHaveURL(/#jobs$/);
  await page.goto("/#materials?dialog=settings");
  await expect(settings(page)).toBeVisible();
  await page.reload();
  await expect(settings(page)).toBeVisible();
  await settings(page)
    .getByRole("button", { name: "Zamknij okno", exact: true })
    .click();
  await expect(page).toHaveURL(/#materials$/);
  await page.goto("/#jobs?dialog=not-a-dialog");
  await expect(page.getByRole("alert")).toContainText("Nieprawidłowy adres");
  await page.getByRole("button", { name: "Pokaż listę", exact: true }).click();
  await expect(page.getByRole("alert")).toBeHidden();
  expect(await snapshot(page)).toEqual(before);
});

test("settings preserve a failed draft, expose an error and await an atomic retry", async ({
  page,
}) => {
  await page.goto("/#dashboard");
  const before = await snapshot(page);
  await page.getByRole("button", { name: "Ustawienia", exact: true }).click();
  const rate = settings(page).getByLabel(/Domyślna stawka/);
  await rate.fill("175");
  await failNextWrite(page);
  await settings(page)
    .getByRole("button", { name: "Zapisz ustawienia", exact: true })
    .click();
  await expect(settings(page).getByRole("alert")).toBeVisible();
  await expect(rate).toHaveValue("175");
  page.once("dialog", (d) => d.dismiss());
  await page.goBack();
  await expect(settings(page)).toBeVisible();
  await holdWrites(page);
  await settings(page)
    .getByRole("button", { name: "Zapisz ustawienia", exact: true })
    .click();
  await expect(page.locator(".pending-write-status")).toContainText(
    "Zapisywanie zmian",
  );
  await settings(page)
    .getByRole("button", { name: "Zamknij okno", exact: true })
    .click();
  await expect(settings(page)).toBeVisible();
  await release(page);
  await expect(settings(page).getByRole("status")).toContainText("Zapisano");
  await settings(page)
    .getByRole("button", { name: "Zamknij okno", exact: true })
    .click();
  expect((await snapshot(page)).jobs).toEqual(before.jobs);
  expect((await snapshot(page)).settings.hourlyRate).toBe(175);
});

async function prepareCalculator(page: Page) {
  await page.goto("/#dashboard");
  await page
    .getByRole("navigation", { name: "Nawigacja główna", exact: true })
    .getByRole("button", { name: "Kalkulatory", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Ogród do obliczeń", exact: true })
    .selectOption("garden-1");
  await page
    .getByRole("combobox", { name: "Strefa ogrodu", exact: true })
    .selectOption("zone-doc");
  await page.getByLabel("Grubość warstwy (cm)", { exact: true }).fill("10");
  await page
    .getByRole("combobox", { name: "Materiał z katalogu", exact: true })
    .selectOption("material-final");
  await page
    .getByRole("combobox", { name: "Zlecenie docelowe", exact: true })
    .selectOption("job-1");
}

test("calculator → catalog → material editor and related work keep their context after Back and refresh", async ({
  page,
}) => {
  await prepareCalculator(page);
  const before = await snapshot(page);
  await page
    .getByRole("button", { name: "Otwórz katalog materiałów", exact: true })
    .click();
  await page.getByLabel("Szukaj materiałów", { exact: true }).fill("kora");
  await page
    .getByRole("button", { name: "Edytuj materiał Kora sosnowa", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Edytuj materiał", exact: true })
    .getByRole("button", { name: "Anuluj", exact: true })
    .click();
  await page.goBack();
  await expect(
    page.getByLabel("Grubość warstwy (cm)", { exact: true }),
  ).toHaveValue("10");
  await page.reload();
  await expect(
    page.getByRole("combobox", { name: "Materiał z katalogu", exact: true }),
  ).toHaveValue("material-final");
  await page
    .getByRole("button", {
      name: "Zlecenie: Wizyta częściowo opłacona",
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(/section=billing/);
  await page.goBack();
  await expect(
    page.getByRole("combobox", { name: "Zlecenie docelowe", exact: true }),
  ).toHaveValue("job-1");
  await page.goForward();
  await page.goBack();
  await page
    .getByRole("button", { name: "Otwórz katalog materiałów", exact: true })
    .click();
  await expect(
    page.getByLabel("Szukaj materiałów", { exact: true }),
  ).toHaveValue("kora");
  expect(await snapshot(page)).toEqual(before);
});

test("calculator commit locks its inputs, retains an error and adds one material without changing approved finance", async ({
  page,
}) => {
  await prepareCalculator(page);
  const before = await snapshot(page);
  await failNextWrite(page);
  await page
    .getByRole("button", { name: "Dodaj materiał do zlecenia", exact: true })
    .click();
  await expect(page.getByRole("alert").last()).toBeVisible();
  await expect(
    page.getByLabel("Grubość warstwy (cm)", { exact: true }),
  ).toHaveValue("10");
  await holdWrites(page);
  await page
    .getByRole("button", { name: "Dodaj materiał do zlecenia", exact: true })
    .click();
  await expect(page.locator(".calculator-panel")).toHaveAttribute("inert", "");
  await page.goBack();
  await expect(page).toHaveURL(/#calculators/);
  await release(page);
  await expect(page.locator(".calculator-notice")).toContainText(
    "Dodano materiał",
  );
  const after = await snapshot(page);
  const old = before.jobs.find((j: any) => j.id === "job-1"),
    saved = after.jobs.find((j: any) => j.id === "job-1");
  expect(saved.materials).toHaveLength(old.materials.length + 1);
  expect(saved.settlement).toEqual(old.settlement);
  expect(after.payments).toEqual(before.payments);
  expect(after.timer).toEqual(before.timer);
  expect(after.reportSequence).toBe(before.reportSequence);
});

test("missing and deleted todos are safe, retain history, and never infer IDs from historical names", async ({
  page,
}) => {
  await page.goto("/#todos?todo=missing");
  const before = await snapshot(page);
  await expect(
    page.getByRole("dialog", { name: "Szczegóły wpisu", exact: true }),
  ).toContainText("usunięty");
  await page.goto(todoURL);
  await todo(page)
    .getByRole("button", { name: "Usuń sprawę", exact: true })
    .click();
  await todo(page)
    .getByRole("button", { name: "Potwierdź usunięcie wpisu", exact: true })
    .click();
  await expect(todo(page)).toBeHidden();
  await settled(page);
  await page.goto(todoURL);
  await expect(
    page.getByRole("dialog", { name: "Szczegóły wpisu", exact: true }),
  ).toContainText("usunięty");
  const after = await snapshot(page);
  expect(after.jobs).toEqual(before.jobs);
  expect(after.payments).toEqual(before.payments);
  expect(after.taskOccurrences).toEqual(before.taskOccurrences);
});

for (const width of [320, 360, 390, 430, 768, 1280])
  test(`aggregate views, dialogs, long forms and keyboard controls fit ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(75000);
    await page.setViewportSize({ width, height: 850 });
    await page.goto("/#dashboard");
    const before = await snapshot(page);
    for (const route of [
      "clients",
      "gardens",
      "jobs",
      "history",
      "calendar",
      "materials",
      "calculators",
      "notes",
      "todos",
      "templates",
    ]) {
      await page.goto("/#" + route);
      await page.locator(".app-shell").waitFor();
      await noOverflow(page);
    }
    if (width < 701) {
      const more = page.getByRole("button", { name: "Więcej", exact: true });
      await more.click();
      await expect(menu(page)).toBeVisible();
      await page.keyboard.press("Shift+Tab");
      await expect(
        menu(page).getByRole("button", { name: "Ustawienia", exact: true }),
      ).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(
        menu(page).getByRole("button", { name: "Zamknij okno", exact: true }),
      ).toBeFocused();
      await page.goBack();
      await expect(menu(page)).toBeHidden();
      await expect(more).toBeFocused();
      await page.goForward();
      await expect(menu(page)).toBeVisible();
      await page.reload();
      await expect(menu(page)).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(menu(page)).toBeHidden();
    }
    await page.goto("/#jobs?dialog=new-job");
    await expect(newJob(page)).toBeVisible();
    await noOverflow(page);
    if (width < 701) {
      await expect(
        newJob(page).getByLabel("Nazwa pracy", { exact: true }),
      ).toHaveCSS("font-size", "16px");
      const b = await newJob(page)
        .getByRole("button", { name: "Zamknij okno", exact: true })
        .boundingBox();
      expect(b!.width).toBeGreaterThanOrEqual(44);
      expect(b!.height).toBeGreaterThanOrEqual(44);
    }
    await newJob(page)
      .getByRole("button", { name: "Dodaj", exact: true })
      .click();
    await noOverflow(page);
    await page.setViewportSize({ width, height: 360 });
    await newJob(page)
      .getByRole("button", { name: "Zapisz zlecenie", exact: true })
      .scrollIntoViewIfNeeded();
    await expect(
      newJob(page).getByRole("button", {
        name: "Zapisz zlecenie",
        exact: true,
      }),
    ).toBeInViewport();
    await noOverflow(page);
    page.once("dialog", (d) => d.accept());
    await newJob(page)
      .getByRole("button", { name: "Anuluj", exact: true })
      .click();
    await page.setViewportSize({ width, height: 850 });
    for (const route of [
      "clients?client=client-1",
      "gardens?garden=garden-1&section=billing",
      "gardens?zone=zone-doc&zoneGarden=garden-1&section=plans",
      "todos?todo=todo-final",
      "clients?finance=client-1&owner=client",
      "clients?payment=finance-partial",
      "jobs?job=job-1&section=photos",
    ]) {
      await page.goto("/#" + route);
      if (route.startsWith("clients?client="))
        await expect(
          page.getByRole("heading", { name: "Anna Kowalska", exact: true }),
        ).toBeVisible();
      else await page.getByRole("dialog").last().waitFor();
      await noOverflow(page);
    }
    expect(await snapshot(page)).toEqual(before);
  });

test("pending calculator write raises the real browser warning before reload and retains its state", async ({
  page,
}) => {
  await prepareCalculator(page);
  await holdWrites(page);
  await page
    .getByRole("button", { name: "Dodaj materiał do zlecenia", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("aria-busy", "true");
  let prompts = 0;
  page.once("dialog", async (d) => {
    expect(d.type()).toBe("beforeunload");
    prompts++;
    await d.dismiss();
  });
  await page.evaluate(() => {
    setTimeout(() => location.reload(), 0);
  });
  await expect.poll(() => prompts).toBe(1);
  await expect(
    page.getByLabel("Grubość warstwy (cm)", { exact: true }),
  ).toHaveValue("10");
  await release(page);
  await expect(page.locator(".calculator-notice")).toContainText(
    "Dodano materiał",
  );
});

test("keyboard skip control reaches main content and keeps a visible focus indicator", async ({
  page,
}) => {
  await page.goto("/#dashboard");
  const before = await snapshot(page);
  const skip = page.getByRole("button", {
    name: "Przejdź do treści",
    exact: true,
  });
  await skip.focus();
  await expect(skip).toBeInViewport();
  await expect(skip).toHaveCSS("outline-style", "solid");
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
  expect(await snapshot(page)).toEqual(before);
});

test("full ZIP restores a photo and addressed todo with its original client, garden, zone and work IDs", async ({
  page,
}) => {
  await page.goto("/#jobs?job=job-1&section=photos");
  const gallery = page.getByRole("dialog", {
    name: "Szczegóły zlecenia",
    exact: true,
  });
  await gallery
    .getByRole("button", { name: "Dodaj zdjęcia", exact: true })
    .click();
  const bytes = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 40;
    c.height = 40;
    c.getContext("2d")!.fillRect(0, 0, 40, 40);
    return Array.from(
      new Uint8Array(
        await (
          await new Promise<Blob>((resolve) =>
            c.toBlob((b) => resolve(b!), "image/png"),
          )
        ).arrayBuffer(),
      ),
    );
  });
  await gallery
    .getByLabel("Zdjęcia z urządzenia", { exact: true })
    .setInputFiles({
      name: "raport-ogrodu.png",
      mimeType: "image/png",
      buffer: Buffer.from(bytes),
    });
  await gallery
    .getByRole("button", { name: "Zapisz zdjęcia", exact: true })
    .click();
  await expect(gallery.locator(".photo-card")).toHaveCount(1);
  const before = await snapshot(page);
  await page.goto("/#jobs?job=job-1&section=photos&dialog=settings");
  await expect(settings(page)).toBeVisible();
  const jsonDownload = page.waitForEvent("download");
  await settings(page)
    .getByRole("button", { name: "Eksportuj dane", exact: true })
    .click();
  const json = await jsonDownload;
  const { readFile } = await import("node:fs/promises");
  const exported = JSON.parse(await readFile((await json.path())!, "utf8"));
  expect(exported.version).toBe(STORAGE_VERSION);
  expect(exported.data.todos).toEqual(before.todos);
  const download = page.waitForEvent("download");
  await settings(page)
    .getByRole("button", { name: "Pobierz pełną kopię ZIP", exact: true })
    .click();
  const backup = await download;
  await settings(page)
    .getByLabel("Wczytaj pełną kopię ZIP", { exact: true })
    .setInputFiles((await backup.path())!);
  await setChecked(
    settings(page).getByRole("checkbox", {
      name: "Rozumiem, że bieżący zestaw zostanie zastąpiony.",
      exact: true,
    }),
    true,
  );
  await settings(page)
    .getByLabel("Wpisz ODTWÓRZ", { exact: true })
    .fill("ODTWÓRZ");
  await settings(page)
    .getByRole("button", { name: "Odtwórz dane i zdjęcia", exact: true })
    .click();
  await expect(settings(page)).toContainText(
    "Dane i zdjęcia zostały odtworzone",
  );
  const after = await snapshot(page);
  for (const key of [
    "todos",
    "jobs",
    "payments",
    "taskSchedules",
    "taskOccurrences",
    "notes",
    "checklists",
  ] as const)
    expect(after[key]).toEqual(before[key]);
  expect(
    after.photos.map(({ assetId: _assetId, ...photo }: any) => photo),
  ).toEqual(before.photos.map(({ assetId: _assetId, ...photo }: any) => photo));
  expect(after.photos[0].assetId).not.toBe(before.photos[0].assetId);
  expect(after.reportSequence).toBe(before.reportSequence);
  await settings(page)
    .getByRole("button", { name: "Zamknij okno", exact: true })
    .click();
  await page.reload();
  await expect(gallery.locator(".photo-card")).toHaveCount(1);
  await expect
    .poll(() =>
      gallery
        .locator(".photo-card img")
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBeGreaterThan(0);
  await page.goto(todoURL);
  await expect(
    todo(page).getByRole("button", {
      name: "Strefa: Rabata różana",
      exact: true,
    }),
  ).toBeVisible();
  await todo(page)
    .getByRole("button", {
      name: "Zlecenie: Wizyta częściowo opłacona",
      exact: true,
    })
    .click();
  await page.goBack();
  await expect(todo(page)).toBeVisible();
});

test("touch navigation uses the same menu, todo and garden return stack on a phone", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.clock.setFixedTime(finalClock);
  await page.addInitScript((data) => {
    if (!localStorage.getItem("garden-manager:v1"))
      localStorage.setItem(
        "garden-manager:v1",
        JSON.stringify({ version: 9, data }),
      );
  }, finalData());
  await page.goto("http://127.0.0.1:5173/#dashboard");
  const before = await snapshot(page);
  await page.getByRole("button", { name: "Więcej", exact: true }).tap();
  await menu(page)
    .getByRole("button", { name: "Do zrobienia", exact: true })
    .tap();
  await page
    .getByRole("button", { name: "Zamówić korę do rabaty", exact: true })
    .tap();
  await todo(page)
    .getByRole("button", { name: "Ogród: Ogród przy Lipowej", exact: true })
    .tap();
  await page
    .getByRole("dialog", {
      name: "Karta ogrodu: Ogród przy Lipowej",
      exact: true,
    })
    .getByRole("button", { name: "Zamknij okno", exact: true })
    .tap();
  await expect(todo(page)).toBeVisible();
  await noOverflow(page);
  expect(await snapshot(page)).toEqual(before);
  expect(errors).toEqual([]);
  await context.close();
});

test("an empty v9 dataset can close or leave the addressed new-job view without creating a record", async ({
  page,
}) => {
  const data = finalData();
  for (const key of [
    "clients",
    "gardens",
    "jobs",
    "payments",
    "notes",
    "todos",
    "photos",
    "checklists",
    "taskSchedules",
    "taskOccurrences",
  ] as const)
    data[key] = [];
  await page.addInitScript(
    (data) =>
      localStorage.setItem(
        "garden-manager:v1",
        JSON.stringify({ version: 9, data }),
      ),
    data,
  );
  await page.goto("/#jobs?dialog=new-job");
  await expect(newJob(page).getByRole("alert")).toContainText(
    "Najpierw dodaj klienta i ogród",
  );
  const before = await snapshot(page);
  await newJob(page)
    .getByRole("button", { name: "Wróć do zleceń", exact: true })
    .click();
  await expect(newJob(page)).toBeHidden();
  await expect(page).toHaveURL(/#jobs$/);
  await page.goto("/#jobs?dialog=new-job");
  await newJob(page)
    .getByRole("button", { name: "Otwórz klientów", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: /^Klienci 0$/ }),
  ).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
});
