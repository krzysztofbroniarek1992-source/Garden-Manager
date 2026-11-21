import { test, expect } from "@playwright/test";
import { quickShopping, buyShopping, shoppingExpense, shoppingRow } from "../tests/shopping-helpers";
import { snapshot } from "../tests/atomic-report-helpers";
test("shopping and deliberate expense creation remain available after an offline restart", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/#shopping");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true); const before = await snapshot(page);
  await quickShopping(page); await buyShopping(page);
  expect((await snapshot(page)).expenses).toEqual(before.expenses);
  await shoppingExpense(page);
  await shoppingRow(page, "Kora firmowa").getByRole("button", { name: "Archiwizuj zakup", exact: true }).click();
  const other = await context.newPage(); await other.goto("/#shopping");
  await other.getByRole("button", { name: "Archiwum kupionych", exact: true }).click();
  await expect(shoppingRow(other, "Kora firmowa")).toContainText("Powiązany wydatek");
  expect((await snapshot(other)).jobs).toEqual(before.jobs); expect((await snapshot(other)).payments).toEqual(before.payments); expect((await snapshot(other)).timer).toEqual(before.timer);
});
