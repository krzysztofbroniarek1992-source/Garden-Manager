import { test, expect } from "@playwright/test";
import { snapshot } from "../tests/atomic-report-helpers";
test("expenses and CSV import work offline, survive reopening, and do not post bank credits as payments", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#expenses");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  const before = await snapshot(page);
  await context.setOffline(true);
  await page
    .getByRole("button", { name: "Dodaj wydatek", exact: true })
    .click();
  let form = page.getByRole("dialog", { name: "Nowy wydatek", exact: true });
  await form.getByLabel("Kontrahent", { exact: true }).fill("Offline serwis");
  await form.getByLabel("Kwota (zł)", { exact: true }).fill("15,20");
  await form
    .getByRole("button", { name: "Zapisz wydatek", exact: true })
    .click();
  await expect(form).toHaveCount(0);
  await page.getByRole("button", { name: "Importuj CSV", exact: true }).click();
  form = page.getByRole("dialog", { name: "Import wyciągu CSV", exact: true });
  await form
    .getByLabel("Nazwa profilu rachunku", { exact: true })
    .fill("Konto offline");
  await form
    .getByLabel("Plik CSV", { exact: true })
    .setInputFiles({
      name: "offline.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "Data;Kwota;Opis\n10.11.2026;-20,00;Paliwo\n10.11.2026;100,00;Wpłata",
      ),
    });
  for (const [name, value] of [
    ["Data", "0"],
    ["Kwota ze znakiem", "1"],
    ["Opis", "2"],
  ])
    await form.getByRole("combobox", { name, exact: true }).selectOption(value);
  await form
    .getByRole("button", {
      name: "Zapisz profil i sprawdź operacje",
      exact: true,
    })
    .click();
  await expect(form).toContainText("Nowe: 2");
  await form
    .getByRole("button", {
      name: "Zatwierdź nowe obciążenia bez ostrzeżeń",
      exact: true,
    })
    .click();
  page.once("dialog", (d) => d.accept());
  await form.getByRole("button", { name: /^Zapisz import/ }).click();
  await expect(form).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".expense-ledger .tool-card")).toHaveCount(3);
  await page
    .getByRole("button", { name: "Finanse firmy", exact: true })
    .click();
  await expect(page.locator(".expense-metrics")).toBeVisible();
  const saved = await snapshot(page);
  expect(saved.payments).toEqual(before.payments);
  expect(saved.jobs).toEqual(before.jobs);
  expect(saved.expenseImports).toHaveLength(1);
  const other = await context.newPage();
  await other.goto("/#expenses");
  await expect(other.locator(".expense-ledger .tool-card")).toHaveCount(3);
});
