import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createDemoData } from "../src/data/demo";
import { snapshot } from "./atomic-report-helpers";
import { mockAndroid, androidBack } from "./android-bridge-fixture";
const csv =
  "Data;Kwota;Kontrahent;Opis;ID\n10.11.2026;-12,30;ORLEN;Paliwo;\n10.11.2026;-12,30;ORLEN;Paliwo;\n11.11.2026;-50,00;Własny;Przelew własny;own\n11.11.2026;200,00;Klient;Wpłata;credit\n31.02.2026;-10,00;Błąd;Zła data;bad";
const modal = (p: Page) =>
  p.getByRole("dialog", { name: "Import wyciągu CSV", exact: true });
async function seed(page: Page) {
  await page.addInitScript(
    (d) => {
      if (!localStorage.getItem("garden-manager:v1"))
        localStorage.setItem(
          "garden-manager:v1",
          JSON.stringify({ version: 11, data: d }),
        );
    },
    createDemoData(new Date("2026-11-10T10:00:00Z")),
  );
}
async function upload(page: Page, text = csv, existing = false) {
  await page.getByRole("button", { name: "Importuj CSV", exact: true }).click();
  const m = modal(page);
  if (existing)
    await m
      .getByRole("combobox", { name: "Profil rachunku", exact: true })
      .selectOption({ label: "Konto firmowe PLN" });
  else
    await m
      .getByLabel("Nazwa profilu rachunku", { exact: true })
      .fill("Konto firmowe PLN");
  await m
    .getByLabel("Plik CSV", { exact: true })
    .setInputFiles({
      name: "listopad.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(text),
    });
  if (!existing) {
    for (const [label, index] of [
      ["Data", 0],
      ["Kwota ze znakiem", 1],
      ["Kontrahent", 2],
      ["Opis", 3],
      ["ID operacji bankowej", 4],
    ] as const)
      await m
        .getByRole("combobox", { name: label, exact: true })
        .selectOption(String(index));
  }
  await m
    .getByRole("button", {
      name: "Zapisz profil i sprawdź operacje",
      exact: true,
    })
    .click();
  await expect(m.getByText(/Nowe:.*Koszty:/)).toBeVisible();
  return m;
}
async function commit(page: Page) {
  page.once("dialog", (d) => d.accept());
  await modal(page)
    .getByRole("button", { name: /^Zapisz import/ })
    .click();
  await expect(modal(page)).toHaveCount(0);
}
for (const width of [1280, 360, 390, 430])
  test(`manual expenses, filters, summary, unsaved protection and reload at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await seed(page);
    await page.goto("/#expenses");
    await expect(
      page.getByRole("heading", { name: "Rejestr wydatków jest pusty" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Dodaj wydatek", exact: true })
      .click();
    const form = page.getByRole("dialog", {
      name: "Nowy wydatek",
      exact: true,
    });
    await form.getByLabel("Kontrahent", { exact: true }).fill("Warsztat Łódź");
    await form.getByLabel("Kwota (zł)", { exact: true }).fill("123,45");
    await form.getByLabel("Data wydatku", { exact: true }).fill("2026-11-10");
    page.once("dialog", (d) => d.dismiss());
    await form.getByRole("button", { name: "Anuluj", exact: true }).click();
    await expect(form).toBeVisible();
    await form
      .getByRole("button", { name: "Zapisz wydatek", exact: true })
      .click();
    await expect(form).toHaveCount(0);
    await page
      .getByRole("button", { name: "Finanse firmy", exact: true })
      .click();
    await page.getByLabel("Miesiąc / rok", { exact: true }).fill("2026-11");
    await expect(
      page.locator(".expense-metrics").getByText("123,45 zł", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Rejestr wydatków", exact: true })
      .click();
    await page.getByLabel("Szukaj wydatków", { exact: true }).fill("Łódź");
    await page
      .getByRole("button", {
        name: "Edytuj wydatek Warsztat Łódź",
        exact: true,
      })
      .click();
    const edit = page.getByRole("dialog", {
      name: "Edytuj wydatek",
      exact: true,
    });
    await edit
      .getByRole("combobox", { name: "Status wydatku", exact: true })
      .selectOption("excluded");
    await edit
      .getByLabel("Notatka / powód decyzji", { exact: true })
      .fill("Zakup prywatny");
    await edit
      .getByRole("button", { name: "Zapisz wydatek", exact: true })
      .click();
    await expect(edit).toHaveCount(0);
    await page.reload();
    await expect(page.locator(".expense-ledger")).toContainText(
      "Zakup prywatny",
    );
    expect((await snapshot(page)).expenses[0]).toMatchObject({
      amountCents: 12345,
      status: "excluded",
      history: expect.any(Array),
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
test("CSV preview approvals, excluded credits, genuine identical transactions and semantic reimport", async ({
  page,
}) => {
  await seed(page);
  await page.goto("/#expenses");
  const before = await snapshot(page);
  const m = await upload(page);
  await expect(m).toContainText(
    "Nowe: 4 · Koszty: 0 · Wyłączone: 4 · Duplikaty: 0 · Pominięte: 0 · Błędy: 1",
  );
  await m
    .getByRole("button", {
      name: "Zatwierdź nowe obciążenia bez ostrzeżeń",
      exact: true,
    })
    .click();
  await expect(m).toContainText("Koszty: 2 · Wyłączone: 2");
  await commit(page);
  const saved = await snapshot(page);
  expect(saved.expenses).toHaveLength(4);
  expect(
    saved.expenses.filter((e: any) => e.status === "approved"),
  ).toHaveLength(2);
  expect(saved.payments).toEqual(before.payments);
  expect(saved.jobs).toEqual(before.jobs);
  expect(saved.timer).toEqual(before.timer);
  const again = await upload(page, csv, true);
  await expect(again).toContainText("Duplikaty: 4");
  await commit(page);
  expect((await snapshot(page)).expenses).toEqual(saved.expenses);
  await page
    .getByRole("button", { name: "Historia importów", exact: true })
    .click();
  await expect(page.locator(".expense-audit")).toHaveCount(2);
  await page.reload();
  await expect(page.locator(".expense-audit")).toHaveCount(2);
});
test("two tab imports serialize without losing expenses, and stale edits fail closed", async ({
  page,
  context,
}) => {
  await seed(page);
  await page.goto("/#expenses");
  const file =
    "Data;Kwota;Kontrahent;Opis;ID\n10.11.2026;-12,30;ORLEN;Paliwo;id-1";
  await upload(page, file);
  const other = await context.newPage();
  await other.goto("/#expenses");
  await upload(other, file, true);
  await Promise.all([commit(page), commit(other)]);
  const saved = await snapshot(page);
  expect(saved.expenses).toHaveLength(1);
  expect(saved.expenseImports).toHaveLength(2);
  for (const p of [page, other])
    await p
      .getByRole("button", { name: "Edytuj wydatek ORLEN", exact: true })
      .click();
  const a = page.getByRole("dialog", { name: "Edytuj wydatek", exact: true }),
    b = other.getByRole("dialog", { name: "Edytuj wydatek", exact: true });
  await a
    .getByLabel("Notatka / powód decyzji", { exact: true })
    .fill("Nowsza decyzja");
  await a.getByRole("button", { name: "Zapisz wydatek", exact: true }).click();
  await expect(a).toHaveCount(0);
  await b
    .getByLabel("Notatka / powód decyzji", { exact: true })
    .fill("Stara decyzja");
  await b.getByRole("button", { name: "Zapisz wydatek", exact: true }).click();
  await expect(b.getByRole("alert")).toContainText("innej karcie");
  expect((await snapshot(page)).expenses[0].note).toBe("Nowsza decyzja");
});
test("custom category and editable rule are reused in CSV proposals", async ({
  page,
}) => {
  await seed(page);
  await page.goto("/#expenses");
  await page
    .getByRole("button", { name: "Kategorie i reguły", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Dodaj kategorię", exact: true })
    .click();
  let form = page.getByRole("dialog", {
    name: "Kategoria kosztów",
    exact: true,
  });
  await form.getByLabel("Nazwa", { exact: true }).fill("Transport firmowy");
  await form
    .getByRole("button", { name: "Zapisz ustawienie", exact: true })
    .click();
  await page.getByRole("button", { name: "Dodaj regułę", exact: true }).click();
  form = page.getByRole("dialog", { name: "Reguła podpowiedzi", exact: true });
  await form.getByLabel("Nazwa", { exact: true }).fill("Przewóz");
  await form.getByLabel("Szukany fragment", { exact: true }).fill("TAXI");
  await form
    .getByRole("combobox", { name: "Kategoria", exact: true })
    .selectOption({ label: "Transport firmowy" });
  await form
    .getByRole("button", { name: "Zapisz ustawienie", exact: true })
    .click();
  const m = await upload(
    page,
    "Data;Kwota;Kontrahent;Opis;ID\n10.11.2026;-30,00;Taxi;Przewóz;taxi-1",
  );
  await expect(
    m.getByRole("combobox", { name: "Kategoria wiersza 2", exact: true }),
  ).toHaveValue((await snapshot(page)).expenseCategories.at(-1).id);
  await commit(page);
});
test("v11 JSON and full ZIP restore expense audit and a real photo without touching payments", async ({
  page,
}) => {
  await seed(page);
  await page.goto("/#expenses");
  await upload(page);
  await commit(page);
  await page.goto("/#jobs?job=job-1&section=photos");
  const gallery = page.getByRole("region", {
    name: "Galeria zlecenia i wizyty",
    exact: true,
  });
  await gallery
    .getByRole("button", { name: "Dodaj zdjęcia", exact: true })
    .click();
  await gallery
    .getByLabel("Zdjęcia z urządzenia", { exact: true })
    .setInputFiles("src/reports/fixtures/garden.jpg");
  await gallery
    .getByRole("button", { name: "Zapisz zdjęcia", exact: true })
    .click();
  await expect(gallery.locator(".photo-card")).toHaveCount(1);
  const before = await snapshot(page);
  await page.goto("/#dashboard?dialog=settings");
  const s = page.getByRole("dialog", { name: "Ustawienia", exact: true });
  const get = async (name: string) => {
    const w = page.waitForEvent("download");
    await s.getByRole("button", { name, exact: true }).click();
    return readFile((await (await w).path())!);
  };
  const json = JSON.parse((await get("Eksportuj dane")).toString());
  expect(json.version).toBe(11);
  expect(json.data.expenses).toEqual(before.expenses);
  const zip = await get("Pobierz pełną kopię ZIP");
  await s
    .getByLabel("Wczytaj pełną kopię ZIP", { exact: true })
    .setInputFiles({
      name: "firma.zip",
      mimeType: "application/zip",
      buffer: zip,
    });
  await s
    .getByRole("checkbox", {
      name: "Rozumiem, że bieżący zestaw zostanie zastąpiony.",
      exact: true,
    })
    .check();
  await s.getByLabel("Wpisz ODTWÓRZ", { exact: true }).fill("ODTWÓRZ");
  await s
    .getByRole("button", { name: "Odtwórz dane i zdjęcia", exact: true })
    .click();
  await expect(s).toContainText("Dane i zdjęcia zostały odtworzone");
  const after = await snapshot(page);
  for (const key of [
    "expenses",
    "expenseCategories",
    "expenseProfiles",
    "expenseRules",
    "expenseImports",
    "jobs",
    "payments",
    "taskSchedules",
    "timer",
  ])
    expect(after[key]).toEqual(before[key]);
  await page.goto("/#jobs?job=job-1&section=photos");
  await expect
    .poll(() =>
      gallery
        .locator("img")
        .first()
        .evaluate((i: HTMLImageElement) => i.naturalWidth),
    )
    .toBeGreaterThan(0);
});
test("Android Back protects expense drafts and native CSV picker passes the CSV kind", async ({
  page,
}) => {
  await mockAndroid(page);
  await page.goto("/#expenses");
  await page
    .getByRole("button", { name: "Dodaj wydatek", exact: true })
    .click();
  const form = page.getByRole("dialog", { name: "Nowy wydatek", exact: true });
  await form.getByLabel("Kontrahent", { exact: true }).fill("Szkic Android");
  page.once("dialog", (d) => d.dismiss());
  await androidBack(page);
  await expect(form).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await androidBack(page);
  await expect(form).toHaveCount(0);
  await page.getByRole("button", { name: "Importuj CSV", exact: true }).click();
  await modal(page)
    .getByRole("button", { name: "Wybierz CSV z urządzenia", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).gmNative.calls
            .filter((c: any) => c.method === "pickBackup")
            .at(-1)?.args.kind,
      ),
    )
    .toBe("csv");
  expect((await snapshot(page)).expenses).toHaveLength(0);
});
test("pending expense transaction blocks navigation and commits before the form closes", async ({
  page,
}) => {
  await seed(page);
  await page.goto("/#expenses");
  await page
    .getByRole("button", { name: "Dodaj wydatek", exact: true })
    .click();
  const form = page.getByRole("dialog", { name: "Nowy wydatek", exact: true });
  await form.getByLabel("Kontrahent", { exact: true }).fill("Opóźniony zapis");
  await form.getByLabel("Kwota (zł)", { exact: true }).fill("12,34");
  await page.evaluate(() => {
    const open = indexedDB.open("garden-manager-state", 1);
    open.onsuccess = () => {
      const db = open.result,
        tx = db.transaction("state", "readwrite"),
        store = tx.objectStore("state");
      let release = false;
      (window as any).releaseExpense = () => {
        release = true;
      };
      const pump = () => {
        store.get("current").onsuccess = () => {
          if (!release) pump();
        };
      };
      pump();
      tx.oncomplete = () => db.close();
    };
  });
  await page.waitForFunction(() => !!(window as any).releaseExpense);
  await form
    .getByRole("button", { name: "Zapisz wydatek", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("aria-busy", "true");
  await page
    .getByRole("navigation", { name: "Nawigacja główna", exact: true })
    .getByRole("button", { name: "Panel główny", exact: true })
    .click();
  await expect(form).toBeVisible();
  expect(new URL(page.url()).hash).toBe("#expenses");
  await page.evaluate(() => (window as any).releaseExpense());
  await expect(form).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".expense-ledger")).toContainText(
    "Opóźniony zapis",
  );
  expect((await snapshot(page)).expenses[0].amountCents).toBe(1234);
});
