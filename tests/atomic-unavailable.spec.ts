import { test, expect } from "@playwright/test";
test("a blocked localStorage getter leaves the application readable and prevents unsafe saves", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("Storage denied", "SecurityError");
      },
    });
  });
  await page.goto("/");
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "blokuje odczyt danych lokalnych" }),
  ).toBeVisible();
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
  await settings
    .getByLabel("Domyślna stawka godzinowa (zł/h)", { exact: true })
    .fill("999");
  await settings
    .getByRole("button", { name: "Zapisz ustawienia", exact: true })
    .click();
  await expect(
    settings
      .getByRole("alert")
      .filter({ hasText: "blokuje odczyt danych lokalnych" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
