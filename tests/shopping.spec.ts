import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createDemoData } from "../src/data/demo";
import { snapshot } from "./atomic-report-helpers";
import { mockAndroid, androidBack } from "./android-bridge-fixture";
import { quickShopping, buyShopping, shoppingExpense, shoppingRow } from "./shopping-helpers";
const editor = (p: Page) => p.getByRole("dialog", { name: "Edytuj zakup", exact: true });

for (const width of [1280, 360, 390, 430]) test("shopping complete lifecycle, exact prices and job return at " + width + "px", async ({ page }) => {
  await page.setViewportSize({ width, height: 900 }); await page.goto("/#shopping");
  const before = await snapshot(page); await quickShopping(page);
  await shoppingRow(page, "Kora firmowa").getByRole("button", { name: "Edytuj zakup", exact: true }).click();
  const f = editor(page);
  await f.getByLabel("Ilość", { exact: true }).fill("2,5");
  await f.getByLabel("Planowana cena (zł)", { exact: true }).fill("12,34");
  await f.getByLabel("Faktyczna cena zakupu (zł)", { exact: true }).fill("30,00");
  await f.getByRole("combobox", { name: "Sposób podania faktycznej ceny", exact: true }).selectOption("total");
  await f.getByRole("combobox", { name: "Priorytet", exact: true }).selectOption("urgent");
  await f.getByLabel("Kategoria zakupów", { exact: true }).fill("Materiały ogrodnicze");
  await f.getByLabel("Sklep lub sprzedawca", { exact: true }).fill("Sklep Łódź");
  await f.getByLabel("Link do produktu", { exact: true }).fill("https://example.com/kora");
  await f.getByRole("combobox", { name: "Powiązane zlecenie", exact: true }).selectOption("job-1");
  await f.getByLabel("Notatki", { exact: true }).fill("Firmowa rabata");
  await f.getByRole("button", { name: "Zapisz zakup", exact: true }).click(); await expect(f).toHaveCount(0);
  await expect(page.locator(".shopping-summary")).toContainText("30,85");
  await expect(shoppingRow(page, "Kora firmowa")).toContainText("30,00");
  await shoppingRow(page, "Kora firmowa").getByRole("button", { name: "Oznacz jako zamówione", exact: true }).click();
  await expect(shoppingRow(page, "Kora firmowa")).toContainText("Zamówione");
  await page.getByRole("combobox", { name: "Status zakupów", exact: true }).selectOption("ordered");
  await page.getByRole("combobox", { name: "Priorytet zakupów", exact: true }).selectOption("urgent");
  await shoppingRow(page, "Kora firmowa").getByRole("button", { name: /^Otwórz zlecenie:/ }).click();
  await expect(page.getByRole("dialog", { name: "Szczegóły zlecenia", exact: true })).toBeVisible();
  await page.goBack(); await expect(shoppingRow(page, "Kora firmowa")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Status zakupów", exact: true })).toHaveValue("ordered");
  await page.reload(); await expect(shoppingRow(page, "Kora firmowa")).toBeVisible();
  await shoppingRow(page, "Kora firmowa").getByRole("button", { name: "Odebrano — kupione", exact: true }).click();
  await page.getByRole("combobox", { name: "Status zakupów", exact: true }).selectOption("");
  expect((await snapshot(page)).expenses).toEqual(before.expenses);
  await shoppingExpense(page, "Kora firmowa", "30,00");
  const saved = await snapshot(page);
  expect(saved.expenses).toHaveLength(before.expenses.length + 1); expect(saved.expenses.at(-1).amountCents).toBe(3000);
  expect(saved.jobs).toEqual(before.jobs); expect(saved.payments).toEqual(before.payments); expect(saved.timer).toEqual(before.timer);
  await shoppingRow(page, "Kora firmowa").getByRole("button", { name: "Archiwizuj zakup", exact: true }).click();
  await expect(shoppingRow(page, "Kora firmowa")).toHaveCount(0);
  await page.getByRole("button", { name: "Archiwum kupionych", exact: true }).click();
  await expect(shoppingRow(page, "Kora firmowa")).toBeVisible();
  await shoppingRow(page, "Kora firmowa").getByRole("button", { name: "Ponów zakup", exact: true }).click();
  await page.getByRole("button", { name: "Bieżąca lista", exact: true }).click();
  await page.getByRole("combobox", { name: "Priorytet zakupów", exact: true }).selectOption("");
  await expect(shoppingRow(page, "Kora firmowa")).toContainText("Do kupienia");
  const after = await snapshot(page); expect(after.shoppingItems).toHaveLength(2); expect(after.expenses).toEqual(saved.expenses);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("bulk creation, search, sort, guarded cancel and soft deletion preserve the expense", async ({ page }) => {
  await page.goto("/#shopping"); await page.getByRole("button", { name: "Dodaj wiele produktów", exact: true }).click();
  const f = page.getByRole("dialog", { name: "Dodaj wiele produktów", exact: true });
  await f.getByLabel("Nazwy produktów", { exact: true }).fill("Ziemia\nRękawice\nSekator");
  page.once("dialog", d => d.dismiss()); await f.getByRole("button", { name: "Anuluj", exact: true }).click();
  await expect(f).toBeVisible();
  await f.getByRole("button", { name: "Dodaj produkty", exact: true }).click();
  await expect(page.locator(".shopping-item")).toHaveCount(3);
  await page.getByRole("combobox", { name: "Sortowanie zakupów", exact: true }).selectOption("name");
  await expect(page.locator(".shopping-item h2").first()).toHaveText("Rękawice");
  await page.getByLabel("Szukaj produktu", { exact: true }).fill("sek"); await expect(page.locator(".shopping-item")).toHaveCount(1);
  await page.getByLabel("Szukaj produktu", { exact: true }).fill("");
  await buyShopping(page, "Sekator"); await shoppingExpense(page, "Sekator");
  const saved = await snapshot(page);
  page.once("dialog", d => { expect(d.message()).toContain("wydatek pozostanie"); return d.accept(); });
  await shoppingRow(page, "Sekator").getByRole("button", { name: "Usuń zakup", exact: true }).click();
  await expect(shoppingRow(page, "Sekator")).toHaveCount(0);
  const after = await snapshot(page); expect(after.expenses).toEqual(saved.expenses);
  expect(after.shoppingItems.find((p: any) => p.name === "Sekator").deletedAt).not.toBeNull();
});

test("two tabs commit one cost and retain a conflicting editor draft", async ({ page, context }) => {
  await page.goto("/#shopping"); await quickShopping(page); await buyShopping(page);
  const other = await context.newPage(); await other.goto("/#shopping");
  for (const p of [page, other]) {
    await shoppingRow(p, "Kora firmowa").getByRole("button", { name: "Dodaj do wydatków firmowych", exact: true }).click();
    await p.getByRole("dialog").getByLabel("Kwota (zł)", { exact: true }).fill("11,22");
  }
  await Promise.all([page, other].map(p => p.getByRole("dialog").getByRole("button", { name: "Zapisz wydatek", exact: true }).click()));
  await expect.poll(async () => (await snapshot(page)).expenses.length).toBe(1);
  const pending = (await page.getByRole("dialog").count()) ? page : other;
  await expect(pending.getByRole("dialog").getByRole("alert")).toBeVisible();
  await expect(pending.getByRole("dialog").getByLabel("Kwota (zł)", { exact: true })).toHaveValue("11,22");
  pending.once("dialog", d => d.accept()); await pending.getByRole("dialog").getByRole("button", { name: "Anuluj", exact: true }).click();
  for (const p of [page, other]) {
    await p.reload(); await shoppingRow(p, "Kora firmowa").getByRole("button", { name: "Edytuj zakup", exact: true }).click();
  }
  await editor(page).getByLabel("Notatki", { exact: true }).fill("Nowsza treść");
  await editor(page).getByRole("button", { name: "Zapisz zakup", exact: true }).click();
  await editor(other).getByLabel("Notatki", { exact: true }).fill("Stary szkic");
  await editor(other).getByRole("button", { name: "Zapisz zakup", exact: true }).click();
  await expect(editor(other).getByRole("alert")).toBeVisible();
  expect((await snapshot(page)).shoppingItems[0].notes).toBe("Nowsza treść");
  await expect(editor(other).getByLabel("Notatki", { exact: true })).toHaveValue("Stary szkic");
});

test("a CSV receipt links to a purchase without creating another expense", async ({ page }) => {
  await page.goto("/#expenses"); await page.getByRole("button", { name: "Importuj CSV", exact: true }).click();
  const f = page.getByRole("dialog", { name: "Import wyciągu CSV", exact: true });
  await f.getByLabel("Nazwa profilu rachunku", { exact: true }).fill("Zakupy firmy");
  await f.getByLabel("Plik CSV", { exact: true }).setInputFiles({ name: "zakup.csv", mimeType: "text/csv", buffer: Buffer.from("Data;Kwota;Opis\n10.11.2026;-49,99;Kora zamówienie") });
  for (const [name, value] of [["Data", "0"], ["Kwota ze znakiem", "1"], ["Opis", "2"]]) await f.getByRole("combobox", { name, exact: true }).selectOption(value);
  await f.getByRole("button", { name: "Zapisz profil i sprawdź operacje", exact: true }).click();
  await f.getByRole("button", { name: "Zatwierdź nowe obciążenia bez ostrzeżeń", exact: true }).click();
  page.once("dialog", d => d.accept()); await f.getByRole("button", { name: /^Zapisz import/ }).click(); await expect(f).toHaveCount(0);
  const before = await snapshot(page); await page.goto("/#shopping"); await quickShopping(page); await buyShopping(page);
  await shoppingRow(page, "Kora firmowa").getByRole("button", { name: "Powiąż istniejący wydatek", exact: true }).click();
  const link = page.getByRole("dialog", { name: "Powiąż istniejący wydatek", exact: true });
  await link.getByRole("combobox", { name: "Istniejący wydatek", exact: true }).selectOption(before.expenses[0].id);
  await link.getByRole("button", { name: "Potwierdź powiązanie", exact: true }).click(); await expect(link).toHaveCount(0);
  await expect(shoppingRow(page, "Kora firmowa")).toContainText("CSV");
  expect((await snapshot(page)).expenses).toEqual(before.expenses); expect((await snapshot(page)).expenseImports).toEqual(before.expenseImports);
});

test("Android More and shared system Back protect an unsaved purchase and preserve it after reload", async ({ page }) => {
  await mockAndroid(page, createDemoData()); await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/#dashboard");
  await page.getByRole("button", { name: "Więcej", exact: true }).click();
  await page.getByRole("navigation", { name: "Pozostałe moduły" }).getByRole("button", { name: "Lista zakupów", exact: true }).click();
  await quickShopping(page); await shoppingRow(page, "Kora firmowa").getByRole("button", { name: "Edytuj zakup", exact: true }).click();
  await editor(page).getByLabel("Notatki", { exact: true }).fill("Nie zgub szkicu");
  page.once("dialog", d => d.dismiss()); await androidBack(page);
  await expect(editor(page).getByLabel("Notatki", { exact: true })).toHaveValue("Nie zgub szkicu");
  await editor(page).getByRole("button", { name: "Zapisz zakup", exact: true }).click();
  await page.reload(); expect((await snapshot(page)).shoppingItems[0].notes).toBe("Nie zgub szkicu");
});

test("v11 canonical migration stores an exact source copy despite a corrupt compatibility mirror", async ({ page }) => {
  await page.route("**/__shopping_seed", r => r.fulfill({ contentType: "text/html", body: "<!doctype html>" }));
  await page.goto("/__shopping_seed"); const data = createDemoData(); delete (data as Partial<typeof data>).shoppingItems;
  await page.evaluate(async data => {
    const db = await new Promise<IDBDatabase>(ok => { const r = indexedDB.open("garden-manager-state", 1); r.onupgradeneeded = () => r.result.createObjectStore("state"); r.onsuccess = () => ok(r.result); });
    await new Promise<void>(ok => { const t = db.transaction("state", "readwrite"); t.objectStore("state").put({ formatVersion: 11, revision: 8, data }, "current"); t.oncomplete = () => ok(); }); db.close();
    localStorage.setItem("garden-manager:v1", "stale and broken");
  }, data);
  await page.goto("/#shopping"); await expect(page.getByRole("heading", { name: "Lista zakupów", exact: true })).toBeVisible();
  expect(await snapshot(page)).toEqual({ ...data, shoppingItems: [] });
  const backup = await page.evaluate(() => new Promise<any>(ok => { const r = indexedDB.open("garden-manager-state", 1); r.onsuccess = () => { const db = r.result, t = db.transaction("state"), q = t.objectStore("state").get("format-v11-source"); q.onsuccess = () => ok(q.result); t.oncomplete = () => db.close(); }; }));
  expect(backup).toEqual({ formatVersion: 11, revision: 8, data });
  await quickShopping(page); await page.reload(); await expect(shoppingRow(page, "Kora firmowa")).toBeVisible();
});

test("full ZIP restores shopping, expense and real photo bytes; JSON exports all shopping metadata", async ({ page }) => {
  await page.goto("/#shopping"); await quickShopping(page); await buyShopping(page); await shoppingExpense(page);
  await page.goto("/#jobs?job=job-1&section=photos");
  const gallery = page.getByRole("region", { name: "Galeria zlecenia i wizyty", exact: true });
  await gallery.getByRole("button", { name: "Dodaj zdjęcia", exact: true }).click();
  await gallery.getByLabel("Zdjęcia z urządzenia", { exact: true }).setInputFiles({ name: "garden.jpg", mimeType: "image/jpeg", buffer: await readFile("src/reports/fixtures/garden.jpg") });
  await gallery.getByRole("button", { name: "Zapisz zdjęcia", exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).photos.length).toBe(1);
  await page.goto("/#dashboard?dialog=settings");
  let settings = page.getByRole("dialog", { name: "Ustawienia", exact: true });
  const waiting = page.waitForEvent("download"); await settings.getByRole("button", { name: "Pobierz pełną kopię ZIP", exact: true }).click();
  const file = await (await waiting).path(); expect(file).toBeTruthy();
  const saved = await snapshot(page); await page.goto("/#shopping"); await quickShopping(page, "Poza kopią");
  await page.goto("/#dashboard?dialog=settings"); settings = page.getByRole("dialog", { name: "Ustawienia", exact: true });
  await settings.getByLabel("Wczytaj pełną kopię ZIP", { exact: true }).setInputFiles(file!);
  await settings.getByRole("checkbox", { name: /Rozumiem/ }).check(); await settings.getByLabel("Wpisz ODTWÓRZ", { exact: true }).fill("ODTWÓRZ");
  await settings.getByRole("button", { name: "Odtwórz dane i zdjęcia", exact: true }).click();
  await expect(settings).toContainText("Dane i zdjęcia zostały odtworzone");
  const restored = await snapshot(page); expect(restored.shoppingItems).toEqual(saved.shoppingItems); expect(restored.expenses).toEqual(saved.expenses);
  expect(restored.photos[0].sha256).toBe(saved.photos[0].sha256);
  const download = page.waitForEvent("download"); await settings.getByRole("button", { name: "Eksportuj dane", exact: true }).click();
  const json = JSON.parse(await readFile((await (await download).path())!, "utf8"));
  expect(json.version).toBe(12); expect(json.data.shoppingItems).toEqual(saved.shoppingItems);
});

test("older JSON import requires explicit restore confirmation and retains the replaced dataset in recovery", async ({ page }) => {
  await page.goto("/#shopping"); await quickShopping(page);
  const before = await snapshot(page), old = structuredClone(before);
  delete old.shoppingItems; old.clients[0].name = "Klient starego JSON";
  await page.goto("/#dashboard?dialog=settings"); const settings = page.getByRole("dialog", { name: "Ustawienia", exact: true });
  await settings.getByLabel("Wczytaj kopię JSON", { exact: true }).setInputFiles({ name: "v11.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ version: 11, data: old })) });
  await expect(settings).toContainText("Sprawdzona kopia JSON");
  expect((await snapshot(page)).shoppingItems).toEqual(before.shoppingItems);
  await settings.getByRole("checkbox", { name: /Rozumiem/ }).check(); await settings.getByLabel("Wpisz ODTWÓRZ", { exact: true }).fill("ODTWÓRZ");
  await settings.getByRole("button", { name: "Odtwórz dane i zdjęcia", exact: true }).click();
  await expect(settings).toContainText("Dane i zdjęcia zostały odtworzone");
  expect((await snapshot(page)).shoppingItems).toEqual([]);
  expect((await snapshot(page)).clients[0].name).toBe("Klient starego JSON");
  await settings.getByRole("button", { name: "Przywróć poprzedni zestaw", exact: true }).click();
  await settings.getByRole("checkbox", { name: /Rozumiem/ }).check(); await settings.getByLabel("Wpisz ODTWÓRZ", { exact: true }).fill("ODTWÓRZ");
  await settings.getByRole("button", { name: "Odtwórz dane i zdjęcia", exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).shoppingItems.length).toBe(1);
});
