import { expect, type Page } from "@playwright/test";
export const shoppingRow = (page: Page, name: string) => page.getByRole("article", { name: "Zakup: " + name, exact: true });
export async function quickShopping(page: Page, name = "Kora firmowa") {
  await page.getByLabel("Szybko dodaj produkt", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Dodaj produkt", exact: true }).click();
  await expect(shoppingRow(page, name)).toBeVisible();
}
export async function buyShopping(page: Page, name = "Kora firmowa") {
  await shoppingRow(page, name).getByRole("button", { name: "Oznacz jako kupione", exact: true }).click();
  await expect(shoppingRow(page, name).getByRole("button", { name: "Dodaj do wydatków firmowych", exact: true })).toBeVisible();
}
export async function shoppingExpense(page: Page, name = "Kora firmowa", amount = "24,68") {
  await shoppingRow(page, name).getByRole("button", { name: "Dodaj do wydatków firmowych", exact: true }).click();
  const form = page.getByRole("dialog", { name: "Dodaj zakup do wydatków firmowych", exact: true });
  await form.getByLabel("Kwota (zł)", { exact: true }).fill(amount);
  await form.getByLabel("Data wydatku", { exact: true }).fill("2026-11-10");
  await form.getByRole("combobox", { name: "Kategoria", exact: true }).selectOption("expense-category-1");
  await form.getByRole("button", { name: "Zapisz wydatek", exact: true }).click();
  await expect(form).toHaveCount(0);
  await expect(shoppingRow(page, name)).toContainText("Powiązany wydatek");
}
