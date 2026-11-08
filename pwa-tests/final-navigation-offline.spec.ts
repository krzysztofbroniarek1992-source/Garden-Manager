import { test, expect } from "@playwright/test";
import { finalData, finalClock } from "../tests/final-navigation-fixture";
import { STORAGE_KEY, STORAGE_VERSION } from "../src/data/repository";
import { resetCanonical, settled } from "../tests/atomic-fixture";
import { snapshot } from "../tests/atomic-report-helpers";
test("offline addressed todo, mobile menu, settings and calculator restore context without business writes", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.clock.setFixedTime(finalClock);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  await resetCanonical(page);
  await page.evaluate(
    ({ key, version, data }) =>
      localStorage.setItem(key, JSON.stringify({ version, data })),
    { key: STORAGE_KEY, version: STORAGE_VERSION, data: finalData() },
  );
  await page.reload();
  await page.locator(".app-shell").waitFor();
  const before = await snapshot(page);
  await context.setOffline(true);
  await page.goto("/#todos?todo=todo-final");
  await page.reload({ waitUntil: "domcontentloaded" });
  const todo = page.getByRole("dialog", {
    name: "Szczegóły sprawy",
    exact: true,
  });
  await expect(todo).toContainText("Zamówić korę");
  await todo
    .getByRole("button", { name: "Strefa: Rabata różana", exact: true })
    .click();
  await page.goBack();
  await expect(todo).toBeVisible();
  await todo
    .getByRole("button", { name: "Wróć do listy spraw", exact: true })
    .click();
  await page.getByRole("button", { name: "Więcej", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Więcej opcji", exact: true })
    .getByRole("button", { name: "Kalkulatory", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Ogród do obliczeń", exact: true })
    .selectOption("garden-1");
  await page
    .getByRole("combobox", { name: "Strefa ogrodu", exact: true })
    .selectOption("zone-doc");
  await page.getByLabel("Grubość warstwy (cm)", { exact: true }).fill("5");
  await page
    .getByRole("button", { name: "Otwórz katalog materiałów", exact: true })
    .click();
  await page.goBack();
  await expect(
    page.getByLabel("Grubość warstwy (cm)", { exact: true }),
  ).toHaveValue("5");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    page.getByLabel("Grubość warstwy (cm)", { exact: true }),
  ).toHaveValue("5");
  await page
    .getByRole("button", {
      name: "Ustawienia konta demonstracyjnego",
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(/dialog=settings/);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("dialog", { name: "Ustawienia", exact: true }),
  ).toBeVisible();
  await page.goBack();
  await settled(page);
  expect(await snapshot(page)).toEqual(before);
  expect(errors).toEqual([]);
});
