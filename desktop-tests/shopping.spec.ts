import { test, expect } from "@playwright/test";
import { launch, route, snapshot } from "./helpers";
import { quickShopping, buyShopping, shoppingExpense, shoppingRow } from "../tests/shopping-helpers";
test("real Electron shopping, deliberate expense, guarded close and restart with the same profile", async () => {
  const a = await launch(); let closed = false;
  try {
    const before = await snapshot(a.page);
    await a.instance.context().setOffline(true);
    await route(a.page, "#shopping");
    await quickShopping(a.page, "Windows — sekator");
    await shoppingRow(a.page, "Windows — sekator").getByRole("button", { name: "Edytuj zakup", exact: true }).click();
    const form = a.page.getByRole("dialog", { name: "Edytuj zakup", exact: true });
    await form.getByLabel("Notatki", { exact: true }).fill("Pozostaje po zamknięciu i odświeżeniu");
    a.page.once("dialog", d => d.dismiss());
    await a.instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await expect(form).toBeVisible();
    await expect(form.getByLabel("Notatki", { exact: true })).toHaveValue("Pozostaje po zamknięciu i odświeżeniu");
    await form.getByRole("button", { name: "Zapisz zakup", exact: true }).click();
    await expect(form).toHaveCount(0);
    await buyShopping(a.page, "Windows — sekator");
    expect((await snapshot(a.page)).expenses).toEqual(before.expenses);
    await shoppingExpense(a.page, "Windows — sekator");
    await shoppingRow(a.page, "Windows — sekator").getByRole("button", { name: "Archiwizuj zakup", exact: true }).click();
    const saved = await snapshot(a.page);
    expect(saved.jobs).toEqual(before.jobs);
    expect(saved.payments).toEqual(before.payments);
    expect(saved.timer).toEqual(before.timer);
    expect(saved.shoppingItems[0].expenseId).toBe(saved.expenses.at(-1).id);
    const exited = new Promise<void>(resolve => a.instance.process().once("exit", () => resolve()));
    await a.instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await exited; closed = true;
    const b = await launch(a.profile);
    try {
      expect(await snapshot(b.page)).toEqual(saved);
      await route(b.page, "#shopping");
      await b.page.getByRole("button", { name: "Archiwum kupionych", exact: true }).click();
      await expect(shoppingRow(b.page, "Windows — sekator")).toContainText("Pozostaje po zamknięciu");
    } finally { await b.instance.close(); }
  } finally { if (!closed) await a.instance.close(); }
});
