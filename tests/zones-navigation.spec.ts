import { test as base, expect, type Page } from "@playwright/test";
import { zonesData, zonesClock } from "./zones-fixture";
import { STORAGE_KEY, STORAGE_VERSION } from "../src/data/repository";
import { snapshot } from "./atomic-report-helpers";
import { settled, setChecked } from "./atomic-fixture";
import { holdFinanceWrites as holdWrites } from "./finance-fixture";
import { closeOpenDialogs } from "./navigation-helpers";
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
const zone = (p: Page, name = "Rabata różana") =>
  p.getByRole("dialog", { name: `Strefa: ${name}`, exact: true });
const garden = (p: Page) =>
  p.getByRole("dialog", {
    name: "Karta ogrodu: Ogród przy Lipowej",
    exact: true,
  });
const task = (p: Page) =>
  p.getByRole("dialog", { name: "Szczegóły zadania", exact: true });
const series = (p: Page) =>
  p.getByRole("dialog", { name: "Harmonogram: Pielęgnacja róż", exact: true });
const job = (p: Page) =>
  p.getByRole("dialog", { name: "Szczegóły zlecenia", exact: true });
const photo = (p: Page) =>
  p.getByRole("dialog", { name: "Podgląd zdjęcia", exact: true });
const zoneURL = "/#gardens?zone=zone-doc&zoneGarden=garden-1&section=overview";
const taskURL =
  "/#calendar?task=care-series&original=2026-11-15&date=2026-11-17&view=day";
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(zonesClock);
  await page.addInitScript(
    ({ key, version, data }) => {
      if (!localStorage.getItem(key))
        localStorage.setItem(key, JSON.stringify({ version, data }));
    },
    { key: STORAGE_KEY, version: STORAGE_VERSION, data: zonesData() },
  );
});
async function plans(p: Page) {
  await zone(p)
    .getByRole("tab", { name: /Czynności i harmonogramy/ })
    .click();
}
async function history(p: Page) {
  await zone(p)
    .getByRole("tab", { name: /Zlecenia i historia/ })
    .click();
}

test("client → garden → zone shows real plant/care text and returns without business writes", async ({
  page,
}) => {
  await page.goto("/#clients?client=client-1");
  const before = await snapshot(page);
  await page
    .getByRole("button", {
      name: "Otwórz ogród Ogród przy Lipowej",
      exact: true,
    })
    .click();
  await garden(page)
    .getByRole("tab", { name: "Strefy i rośliny", exact: true })
    .click();
  await garden(page)
    .getByRole("button", { name: "Otwórz strefę Rabata różana", exact: true })
    .click();
  await expect(zone(page)).toContainText("Róże 'New Dawn'");
  await expect(zone(page)).toContainText("Podlewanie rano");
  await expect(zone(page)).toContainText("2026-10-20: Przycięto róże");
  await expect(zone(page)).toContainText("12,346 m²");
  await expect(page).toHaveURL(/zone=zone-doc&zoneGarden=garden-1/);
  await zone(page)
    .getByRole("button", { name: "Ogród: Ogród przy Lipowej", exact: true })
    .click();
  await expect(
    garden(page).getByRole("tab", { name: "Strefy i rośliny", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await garden(page)
    .getByRole("button", { name: /Wróć do klienta Anna Kowalska/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "Anna Kowalska", exact: true }),
  ).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
});
test("zone → series → shifted calendar occurrence keeps the original identity and context", async ({
  page,
}) => {
  await page.goto(zoneURL);
  await plans(page);
  const before = await snapshot(page);
  await expect(
    zone(page).getByRole("button", {
      name: "Otwórz harmonogram Pielęgnacja róż",
      exact: true,
    }),
  ).toHaveCount(1);
  await expect(zone(page)).not.toContainText("Pielęgnacja trawnika");
  await zone(page)
    .getByRole("button", {
      name: "Otwórz harmonogram Pielęgnacja róż",
      exact: true,
    })
    .click();
  await series(page)
    .getByLabel("Terminy od", { exact: true })
    .fill("2026-11-15");
  await series(page)
    .getByRole("button", { name: "Kalendarz terminu 2026-11-15", exact: true })
    .click();
  await expect(task(page)).toContainText("Termin pierwotny: 2026-11-15");
  await expect(task(page)).toContainText("2026-11-17");
  await expect(page).toHaveURL(/original=2026-11-15/);
  await page.goBack();
  await expect(page.getByLabel("Przejdź do dnia", { exact: true })).toHaveValue(
    "2026-11-17",
  );
  await page
    .getByRole("button", { name: "Wróć do harmonogramu", exact: true })
    .click();
  await expect(
    series(page).getByLabel("Terminy od", { exact: true }),
  ).toHaveValue("2026-11-15");
  await series(page)
    .getByRole("button", { name: "Wróć do strefy", exact: true })
    .click();
  await expect(
    zone(page).getByRole("tab", { name: /Czynności i harmonogramy/ }),
  ).toHaveAttribute("aria-selected", "true");
  expect(await snapshot(page)).toEqual(before);
});
test("zone calendar shortcut returns directly to its zone, and skipped occurrences stay skipped", async ({
  page,
}) => {
  await page.goto(zoneURL);
  await plans(page);
  const before = await snapshot(page);
  await zone(page)
    .getByRole("button", {
      name: "Kalendarz harmonogramu Pielęgnacja róż",
      exact: true,
    })
    .click();
  await expect(task(page)).toContainText("Termin pierwotny: 2026-11-15");
  await task(page)
    .getByRole("button", { name: "Zamknij okno", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Wróć do strefy", exact: true })
    .click();
  await expect(zone(page)).toBeVisible();
  await zone(page)
    .getByRole("button", {
      name: "Otwórz harmonogram Pielęgnacja róż",
      exact: true,
    })
    .click();
  await series(page)
    .getByLabel("Terminy od", { exact: true })
    .fill("2026-11-29");
  await series(page)
    .getByRole("button", { name: "Szczegóły terminu 2026-11-29", exact: true })
    .click();
  await expect(task(page)).toContainText("Odwołane");
  expect(await snapshot(page)).toEqual(before);
});
test("calendar → care task → zone → completed work → source task uses only stored relationships", async ({
  page,
}) => {
  await page.goto(taskURL);
  const before = await snapshot(page);
  await task(page)
    .getByRole("button", { name: "Strefa: Rabata różana", exact: true })
    .click();
  await history(page);
  await expect(
    zone(page).getByRole("button", {
      name: "Szczegóły zlecenia Wizyta częściowo opłacona",
      exact: true,
    }),
  ).toBeVisible();
  await expect(zone(page)).not.toContainText(
    "Róże w opisie bez przypisania strefy",
  );
  await expect(zone(page)).not.toContainText("Opłacona działka");
  await zone(page)
    .getByRole("button", {
      name: "Szczegóły zlecenia Wizyta częściowo opłacona",
      exact: true,
    })
    .click();
  await job(page)
    .getByRole("button", { name: "Źródłowy termin: 2026-11-01", exact: true })
    .click();
  await expect(task(page).locator(".badge.status-completed")).toHaveText(
    "Wykonane",
  );
  await task(page)
    .getByRole("button", { name: "Otwórz rzeczywiste zlecenie", exact: true })
    .click();
  await expect(job(page)).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
});
test("work → garden → zone and direct work-zone links preserve actual scope", async ({
  page,
}) => {
  await page.goto("/#jobs?job=job-1");
  const before = await snapshot(page);
  await expect(
    job(page).getByRole("button", {
      name: "Strefa: Rabata różana",
      exact: true,
    }),
  ).toBeVisible();
  await job(page)
    .getByRole("button", { name: "Ogród: Ogród przy Lipowej", exact: true })
    .click();
  await garden(page)
    .getByRole("tab", { name: "Strefy i rośliny", exact: true })
    .click();
  await garden(page)
    .getByRole("button", { name: "Otwórz strefę Rabata różana", exact: true })
    .click();
  await expect(zone(page)).toBeVisible();
  await page.goBack();
  await page.goBack();
  await expect(job(page)).toBeVisible();
  await job(page)
    .getByRole("button", { name: "Strefa: Rabata różana", exact: true })
    .click();
  await expect(zone(page)).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
});
test("a zone without schedule or work references never creates them from descriptions", async ({
  page,
}) => {
  await page.goto("/#gardens?zone=zone-lawn&zoneGarden=garden-1");
  const before = await snapshot(page);
  await expect(zone(page, "Trawnik")).not.toContainText("Pielęgnacja róż");
  await zone(page, "Trawnik")
    .getByRole("tab", { name: /Zlecenia i historia/ })
    .click();
  await expect(zone(page, "Trawnik")).toContainText("Wizyta bez zatwierdzenia");
  await expect(zone(page, "Trawnik")).not.toContainText(
    "Wizyta częściowo opłacona",
  );
  expect(await snapshot(page)).toEqual(before);
});
test("the same zone ID in two gardens has distinct URLs and cards after restart", async ({
  page,
  context,
}) => {
  await page.goto(zoneURL);
  const before = await snapshot(page);
  await page.goto(
    "/#gardens?zone=zone-doc&zoneGarden=garden-6&section=history",
  );
  await expect(zone(page, "Rabata weekendowa")).toContainText(
    "Opłacona działka",
  );
  await expect(zone(page, "Rabata weekendowa")).not.toContainText(
    "Wizyta częściowo opłacona",
  );
  await page.reload();
  await expect(zone(page, "Rabata weekendowa")).toBeVisible();
  const other = await context.newPage();
  await other.goto(page.url());
  await expect(zone(other, "Rabata weekendowa")).toBeVisible();
  await other.close();
  expect(await snapshot(page)).toEqual(before);
});
test("old garden-zone addresses keep their highlight while new zone sections restore with Back/Forward", async ({
  page,
}) => {
  await page.goto("/#gardens?garden=garden-1&section=zones&zone=zone-doc");
  await expect(garden(page).locator('[data-zone-id="zone-doc"]')).toBeFocused();
  await garden(page)
    .getByRole("button", { name: "Otwórz strefę Rabata różana", exact: true })
    .click();
  await history(page);
  await zone(page)
    .getByLabel("Status zleceń strefy", { exact: true })
    .selectOption("completed");
  await zone(page)
    .getByRole("button", {
      name: "Szczegóły zlecenia Wizyta częściowo opłacona",
      exact: true,
    })
    .click();
  await page.goBack();
  await expect(
    zone(page).getByLabel("Status zleceń strefy", { exact: true }),
  ).toHaveValue("completed");
  await page.reload();
  await expect(
    zone(page).getByRole("tab", { name: /Zlecenia i historia/ }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    zone(page).getByLabel("Status zleceń strefy", { exact: true }),
  ).toHaveValue("completed");
  await page.goForward();
  await expect(job(page)).toBeVisible();
});
test("missing garden/zone and forged scoped links show a safe message without writes", async ({
  page,
}) => {
  await page.goto(zoneURL);
  const before = await snapshot(page);
  for (const hash of [
    "#gardens?zone=missing&zoneGarden=garden-1",
    "#gardens?zone=zone-doc&zoneGarden=missing",
  ]) {
    await page.goto("/" + hash);
    await expect(
      page.getByRole("dialog", { name: "Szczegóły strefy", exact: true }),
    ).toContainText("nie są już dostępne");
  }
  await page.goto("/#gardens?zone=zone-doc&zoneGarden=");
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(zone(page)).toHaveCount(0);
  expect(await snapshot(page)).toEqual(before);
});
test("zone editing reuses the guarded form and waits for an atomic commit before closing", async ({
  page,
}) => {
  await page.goto("/#gardens?garden=garden-1&section=zones");
  await garden(page)
    .getByRole("button", { name: "Otwórz strefę Rabata różana", exact: true })
    .click();
  await zone(page)
    .getByRole("button", { name: "Edytuj strefę", exact: true })
    .click();
  const edit = page.getByRole("dialog", { name: "Edycja strefy", exact: true });
  await edit
    .getByRole("textbox", { name: "Rośliny", exact: true })
    .fill("Róże i lawenda — szkic");
  const address = page.url(),
    before = await snapshot(page);
  page.once("dialog", (d) => d.dismiss());
  await page.goBack();
  await expect(page).toHaveURL(address);
  page.once("dialog", (d) => d.dismiss());
  await edit.getByRole("button", { name: "Zamknij okno", exact: true }).click();
  await expect(
    edit.getByRole("textbox", { name: "Rośliny", exact: true }),
  ).toHaveValue("Róże i lawenda — szkic");
  await holdWrites(page);
  await edit
    .getByRole("button", { name: "Zapisz strefę", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("aria-busy", "true");
  await page.goBack();
  await expect(page).toHaveURL(address);
  await page.evaluate(() => (window as any).releaseFinanceWrite());
  await settled(page);
  await expect(edit).toBeHidden();
  await expect(zone(page)).toContainText("Róże i lawenda — szkic");
  const after = await snapshot(page);
  expect(after.jobs).toEqual(before.jobs);
  expect(after.payments).toEqual(before.payments);
  expect(after.taskSchedules).toEqual(before.taskSchedules);
  expect(after.taskOccurrences).toEqual(before.taskOccurrences);
  expect(after.reportSequence).toBe(before.reportSequence);
  await page.reload();
  await expect(zone(page)).toContainText("Róże i lawenda — szkic");
});
test("failed zone save keeps its draft and can be retried without touching history", async ({
  page,
}) => {
  await page.goto(zoneURL);
  await zone(page)
    .getByRole("button", { name: "Edytuj strefę", exact: true })
    .click();
  const edit = page.getByRole("dialog", { name: "Edycja strefy", exact: true });
  await edit
    .getByRole("textbox", { name: "Szczególne wymagania", exact: true })
    .fill("Wymagania po błędzie");
  const before = await snapshot(page);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    (window as any).restoreZonePut = () => {
      IDBObjectStore.prototype.put = put;
    };
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === "state" && args[1] === "current")
        throw new DOMException("Brak miejsca na strefę", "QuotaExceededError");
      return put.apply(this, args);
    };
  });
  await edit
    .getByRole("button", { name: "Zapisz strefę", exact: true })
    .click();
  await expect(edit.getByRole("alert")).toContainText("Brak miejsca");
  expect(await snapshot(page)).toEqual(before);
  page.once("dialog", (d) => d.dismiss());
  await edit.getByRole("button", { name: "Zamknij okno", exact: true }).click();
  await expect(
    edit.getByRole("textbox", { name: "Szczególne wymagania", exact: true }),
  ).toHaveValue("Wymagania po błędzie");
  await page.evaluate(() => (window as any).restoreZonePut());
  await edit
    .getByRole("button", { name: "Zapisz strefę", exact: true })
    .click();
  await expect(edit).toBeHidden();
  expect((await snapshot(page)).jobs).toEqual(before.jobs);
});
test("deleted zone remains unavailable and historical care does not acquire a different zone", async ({
  page,
}) => {
  await page.goto(zoneURL);
  const before = await snapshot(page);
  await zone(page)
    .getByRole("button", { name: "Ogród: Ogród przy Lipowej", exact: true })
    .click();
  await garden(page)
    .getByRole("button", { name: "Usuń strefę Rabata różana", exact: true })
    .click();
  await garden(page)
    .getByRole("button", { name: "Potwierdź usunięcie strefy", exact: true })
    .click();
  await expect(
    garden(page).getByRole("button", {
      name: "Otwórz strefę Rabata różana",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.goBack();
  await expect(
    page.getByRole("dialog", { name: "Szczegóły strefy", exact: true }),
  ).toContainText("nie są już dostępne");
  await page.goto(taskURL);
  await expect(
    task(page).getByRole("button", {
      name: "Strefa: Rabata różana",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(task(page)).toContainText("Historyczna strefa: Rabata różana");
  const after = await snapshot(page);
  expect(after.payments).toEqual(before.payments);
  expect(after.jobs.map((j: any) => j.settlement)).toEqual(
    before.jobs.map((j: any) => j.settlement),
  );
  expect(after.reportSequence).toBe(before.reportSequence);
  expect(after.gardens[5].zones).toEqual(before.gardens[5].zones);
});
test("deleting a zone in another tab preserves the visible draft and disables a stale save", async ({
  page,
  context,
}) => {
  await page.goto(zoneURL);
  await zone(page)
    .getByRole("button", { name: "Edytuj strefę", exact: true })
    .click();
  const edit = page.getByRole("dialog", { name: "Edycja strefy", exact: true });
  await edit
    .getByRole("textbox", { name: "Rośliny", exact: true })
    .fill("Szkic przed usunięciem");
  const other = await context.newPage();
  await other.goto("/#gardens?garden=garden-1&section=zones");
  await garden(other)
    .getByRole("button", { name: "Usuń strefę Rabata różana", exact: true })
    .click();
  await garden(other)
    .getByRole("button", { name: "Potwierdź usunięcie strefy", exact: true })
    .click();
  await expect(
    garden(other).getByRole("button", {
      name: "Otwórz strefę Rabata różana",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(edit.getByRole("alert")).toContainText(
    "Szkic pozostaje widoczny",
  );
  await expect(
    edit.getByRole("textbox", { name: "Rośliny", exact: true }),
  ).toHaveValue("Szkic przed usunięciem");
  await expect(
    edit.getByRole("button", { name: "Zapisz strefę", exact: true }),
  ).toBeDisabled();
  page.once("dialog", (d) => d.dismiss());
  await edit.getByRole("button", { name: "Zamknij okno", exact: true }).click();
  await expect(edit).toBeVisible();
  await other.close();
});
for (const width of [360, 390, 430])
  test(`zone → schedule → calendar and Back work at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(zoneURL);
    await expect(zone(page)).toContainText("Róże 'New Dawn'");
    await plans(page);
    expect(
      await zone(page).evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
    await zone(page)
      .getByRole("button", {
        name: "Kalendarz harmonogramu Pielęgnacja róż",
        exact: true,
      })
      .click();
    await expect(task(page)).toContainText("2026-11-17");
    await page.goBack();
    await page
      .getByRole("button", { name: "Wróć do strefy", exact: true })
      .click();
    await expect(zone(page)).toBeVisible();
    await page.reload();
    await expect(
      zone(page).getByRole("tab", { name: /Czynności i harmonogramy/ }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  });

test("zone work opens preserved settlement and saved report without creating financial operations", async ({
  page,
}) => {
  await page.goto(zoneURL);
  await history(page);
  const before = await snapshot(page);
  await zone(page)
    .getByRole("button", {
      name: "Rozliczenie zlecenia Wizyta częściowo opłacona",
      exact: true,
    })
    .click();
  await expect(job(page).getByTestId("payment-job-total")).toContainText(
    "1000,00",
  );
  await expect(job(page).getByTestId("payment-job-paid")).toContainText(
    "250,00",
  );
  await expect(job(page).getByTestId("payment-job-remaining")).toContainText(
    "750,00",
  );
  await job(page)
    .getByRole("button", { name: "Raporty wizyty (1)", exact: true })
    .click();
  const report = page.getByRole("dialog", {
    name: "Raport PDF dla klienta",
    exact: true,
  });
  await report
    .getByRole("button", { name: "Podgląd wersji 1", exact: true })
    .click();
  await expect(report).toContainText("Zapisana historyczna wersja raportu.");
  await report
    .getByRole("button", { name: "Rozliczenie zlecenia", exact: true })
    .click();
  await job(page)
    .getByRole("button", { name: "Strefa: Rabata różana", exact: true })
    .click();
  await expect(zone(page)).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
});

test("zone documentation, text, care schedules and finance survive JSON export and a full ZIP restore", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto(zoneURL);
  await zone(page).getByRole("tab", { name: "Galeria", exact: true }).click();
  await zone(page)
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
          await new Promise<Blob>((r) => c.toBlob((b) => r(b!), "image/png"))
        ).arrayBuffer(),
      ),
    );
  });
  await zone(page)
    .getByLabel("Zdjęcia z urządzenia", { exact: true })
    .setInputFiles({
      name: "roze.png",
      mimeType: "image/png",
      buffer: Buffer.from(bytes),
    });
  await zone(page)
    .getByRole("combobox", { name: "Kategoria zdjęcia", exact: true })
    .selectOption("before");
  await zone(page)
    .getByRole("button", { name: "Zapisz zdjęcia", exact: true })
    .click();
  await expect(zone(page).locator(".photo-card img")).toBeVisible();
  await zone(page)
    .getByLabel("Filtr kategorii zdjęć", { exact: true })
    .selectOption("before");
  const before = await snapshot(page);
  await zone(page)
    .getByRole("button", { name: "Powiększ zdjęcie roze.png", exact: true })
    .click();
  await photo(page)
    .getByRole("button", { name: "Strefa: Rabata różana", exact: true })
    .click();
  await expect(
    zone(page).getByLabel("Filtr kategorii zdjęć", { exact: true }),
  ).toHaveValue("before");
  expect((await snapshot(page)).photos).toHaveLength(1);
  await closeOpenDialogs(page);
  await page
    .getByRole("button", {
      name: "Ustawienia konta demonstracyjnego",
      exact: true,
    })
    .click();
  const settings = page.getByRole("dialog", {
    name: "Ustawienia",
    exact: true,
  });
  const download = async (name: string) => {
    const event = page.waitForEvent("download");
    await settings.getByRole("button", { name, exact: true }).click();
    const stream = await (await event).createReadStream();
    const chunks: Buffer[] = [];
    for await (const c of stream!) chunks.push(Buffer.from(c));
    return Buffer.concat(chunks);
  };
  const json = JSON.parse((await download("Eksportuj dane")).toString());
  expect(json.version).toBe(9);
  expect(json.data.gardens).toEqual(before.gardens);
  expect(json.data.taskSchedules).toEqual(before.taskSchedules);
  const zip = await download("Pobierz pełną kopię ZIP");
  await settings
    .getByLabel("Wczytaj pełną kopię ZIP", { exact: true })
    .setInputFiles({
      name: "strefy.zip",
      mimeType: "application/zip",
      buffer: zip,
    });
  await setChecked(
    settings.getByRole("checkbox", {
      name: "Rozumiem, że bieżący zestaw zostanie zastąpiony.",
      exact: true,
    }),
    true,
  );
  await settings.getByLabel("Wpisz ODTWÓRZ", { exact: true }).fill("ODTWÓRZ");
  await settings
    .getByRole("button", { name: "Odtwórz dane i zdjęcia", exact: true })
    .click();
  await expect(
    settings.getByText(/Dane i zdjęcia zostały odtworzone/).last(),
  ).toBeVisible();
  await settled(page);
  await page.reload();
  const after = await snapshot(page);
  for (const key of [
    "gardens",
    "jobs",
    "payments",
    "taskSchedules",
    "taskOccurrences",
    "notes",
    "checklists",
  ] as const)
    expect(after[key]).toEqual(before[key]);
  expect(after.reportSequence).toBe(before.reportSequence);
  expect(after.photos[0].id).toBe(before.photos[0].id);
  await page.goto(zoneURL);
  await zone(page).getByRole("tab", { name: "Galeria", exact: true }).click();
  await expect(zone(page).locator(".photo-card img")).toBeVisible();
  await expect
    .poll(() =>
      zone(page)
        .locator(".photo-card img")
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBeGreaterThan(0);
});
