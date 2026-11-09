import { test, expect, type Page } from "@playwright/test";
import { fieldData, fieldClock } from "./field-fixture";
import { snapshot } from "./atomic-report-helpers";
import { settled } from "./atomic-fixture";
import { holdFinanceWrites } from "./finance-fixture";
function auditData() {
  const d = fieldData();
  d.gardens.push({
    id: "garden-free",
    clientId: "client-1",
    name: "Pusty ogród testowy",
    address: "Adres testowy 1",
    area: 0,
    notes: "",
    zones: [],
  });
  return d;
}
const dialog = (p: Page, name: string) =>
  p.getByRole("dialog", { name, exact: true });
async function client(p: Page) {
  await p.goto("/#clients?client=client-1");
  await p.getByRole("button", { name: "Edytuj klienta", exact: true }).click();
  await expect(dialog(p, "Edytuj klienta")).toBeVisible();
}
async function garden(p: Page) {
  await p.goto("/#gardens?garden=garden-1");
  await p
    .getByRole("button", { name: "Edytuj dane ogrodu", exact: true })
    .click();
  await expect(dialog(p, "Edytuj ogród")).toBeVisible();
}
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(fieldClock);
  await page.addInitScript((data) => {
    if (!localStorage.getItem("garden-manager:v1"))
      localStorage.setItem(
        "garden-manager:v1",
        JSON.stringify({ version: 10, data }),
      );
  }, auditData());
});
test("a stale client form cannot overwrite a phone saved in another tab", async ({
  page,
  context,
}) => {
  await client(page);
  const other = await context.newPage();
  await other.clock.setFixedTime(fieldClock);
  await client(other);
  await dialog(other, "Edytuj klienta")
    .getByLabel("Telefon", { exact: true })
    .fill("600111222");
  await dialog(other, "Edytuj klienta")
    .getByRole("button", { name: "Zapisz zmiany", exact: true })
    .click();
  await expect(dialog(other, "Edytuj klienta")).toBeHidden();
  await settled(other);
  await dialog(page, "Edytuj klienta")
    .getByRole("textbox", { name: "Notatki", exact: true })
    .fill("Lokalny szkic do zachowania");
  await dialog(page, "Edytuj klienta")
    .getByRole("button", { name: "Zapisz zmiany", exact: true })
    .click();
  await settled(page);
  expect(
    (await snapshot(page)).clients.find((c: any) => c.id === "client-1").phone,
  ).toBe("600111222");
  await expect(dialog(page, "Edytuj klienta")).toBeVisible();
  await expect(dialog(page, "Edytuj klienta").getByRole("alert")).toContainText(
    "innej karcie",
  );
  await expect(
    dialog(page, "Edytuj klienta").getByRole("textbox", {
      name: "Notatki",
      exact: true,
    }),
  ).toHaveValue("Lokalny szkic do zachowania");
  expect(
    (await snapshot(page)).clients.find((c: any) => c.id === "client-1").phone,
  ).toBe("600111222");
  await other.close();
});
test("a stale garden form cannot overwrite a more recent address or zone", async ({
  page,
  context,
}) => {
  await garden(page);
  const before = await snapshot(page),
    other = await context.newPage();
  await other.clock.setFixedTime(fieldClock);
  await garden(other);
  await dialog(other, "Edytuj ogród")
    .getByRole("textbox", { name: "Adres *", exact: true })
    .fill("Nowy adres 12, Warszawa");
  await dialog(other, "Edytuj ogród")
    .getByRole("button", { name: "Zapisz zmiany", exact: true })
    .click();
  await expect(dialog(other, "Edytuj ogród")).toBeHidden();
  await settled(other);
  await dialog(page, "Edytuj ogród")
    .getByRole("textbox", { name: "Notatki", exact: true })
    .fill("Szkic ogrodu");
  await dialog(page, "Edytuj ogród")
    .getByRole("button", { name: "Zapisz zmiany", exact: true })
    .click();
  await settled(page);
  expect(
    (await snapshot(page)).gardens.find((g: any) => g.id === "garden-1")
      .address,
  ).toBe("Nowy adres 12, Warszawa");
  await expect(dialog(page, "Edytuj ogród")).toBeVisible();
  await expect(dialog(page, "Edytuj ogród").getByRole("alert")).toContainText(
    "innej karcie",
  );
  const after = await snapshot(page);
  expect(after.gardens.find((g: any) => g.id === "garden-1").address).toBe(
    "Nowy adres 12, Warszawa",
  );
  expect(after.gardens.find((g: any) => g.id === "garden-1").zones).toEqual(
    before.gardens.find((g: any) => g.id === "garden-1").zones,
  );
  await other.close();
});
async function zone(p: Page) {
  await p.goto("/#gardens?zone=zone-doc&zoneGarden=garden-1");
  await p.getByRole("button", { name: "Edytuj strefę", exact: true }).click();
  await expect(dialog(p, "Edycja strefy")).toBeVisible();
}
async function material(p: Page) {
  await p.goto("/#materials");
  await p
    .getByRole("button", { name: "Edytuj materiał Kora sosnowa", exact: true })
    .click();
  await expect(dialog(p, "Edytuj materiał")).toBeVisible();
}
test("a stale zone edit retains its draft and never erases plants recorded in another tab", async ({
  page,
  context,
}) => {
  await zone(page);
  const other = await context.newPage();
  await other.clock.setFixedTime(fieldClock);
  await zone(other);
  await dialog(other, "Edycja strefy")
    .getByRole("textbox", { name: "Rośliny", exact: true })
    .fill("Nowe róże zapisane w drugiej karcie");
  await dialog(other, "Edycja strefy")
    .getByRole("button", { name: "Zapisz strefę", exact: true })
    .click();
  await expect(dialog(other, "Edycja strefy")).toBeHidden();
  await settled(other);
  await dialog(page, "Edycja strefy")
    .getByRole("textbox", { name: "Szczególne wymagania", exact: true })
    .fill("Nie utracisz tego szkicu");
  await dialog(page, "Edycja strefy")
    .getByRole("button", { name: "Zapisz strefę", exact: true })
    .click();
  await expect(dialog(page, "Edycja strefy").getByRole("alert")).toContainText(
    "innej karcie",
  );
  await expect(
    dialog(page, "Edycja strefy").getByRole("textbox", {
      name: "Szczególne wymagania",
      exact: true,
    }),
  ).toHaveValue("Nie utracisz tego szkicu");
  expect(
    (await snapshot(page)).gardens
      .find((g: any) => g.id === "garden-1")
      .zones.find((z: any) => z.id === "zone-doc").plants,
  ).toBe("Nowe róże zapisane w drugiej karcie");
  await other.close();
});
test("a stale catalog edit preserves a newer purchase price and all visit settlements", async ({
  page,
  context,
}) => {
  await material(page);
  const before = await snapshot(page),
    other = await context.newPage();
  await other.clock.setFixedTime(fieldClock);
  await material(other);
  await dialog(other, "Edytuj materiał")
    .getByRole("spinbutton", { name: /Domyślna cena zakupu/ })
    .fill("17.50");
  await dialog(other, "Edytuj materiał")
    .getByRole("button", { name: "Zapisz materiał", exact: true })
    .click();
  await expect(dialog(other, "Edytuj materiał")).toBeHidden();
  await settled(other);
  await dialog(page, "Edytuj materiał")
    .getByRole("textbox", { name: "Notatki", exact: true })
    .fill("Lokalny szkic katalogu");
  await dialog(page, "Edytuj materiał")
    .getByRole("button", { name: "Zapisz materiał", exact: true })
    .click();
  await expect(
    dialog(page, "Edytuj materiał").getByRole("alert"),
  ).toContainText("innej karcie");
  await expect(
    dialog(page, "Edytuj materiał").getByRole("textbox", {
      name: "Notatki",
      exact: true,
    }),
  ).toHaveValue("Lokalny szkic katalogu");
  const after = await snapshot(page);
  expect(
    after.materialCatalog.find((m: any) => m.id === "material-final")
      .purchaseUnitPrice,
  ).toBe(17.5);
  expect(after.jobs).toEqual(before.jobs);
  expect(after.payments).toEqual(before.payments);
  await other.close();
});
test("editing garden metadata merges a newer zone instead of replacing it or blocking an independent edit", async ({
  page,
  context,
}) => {
  await garden(page);
  const other = await context.newPage();
  await other.clock.setFixedTime(fieldClock);
  await zone(other);
  await dialog(other, "Edycja strefy")
    .getByRole("textbox", { name: "Rośliny", exact: true })
    .fill("Opis niezależnej strefy");
  await dialog(other, "Edycja strefy")
    .getByRole("button", { name: "Zapisz strefę", exact: true })
    .click();
  await expect(dialog(other, "Edycja strefy")).toBeHidden();
  await settled(other);
  await dialog(page, "Edytuj ogród")
    .getByRole("textbox", { name: "Adres *", exact: true })
    .fill("Adres z pierwszej karty");
  await dialog(page, "Edytuj ogród")
    .getByRole("button", { name: "Zapisz zmiany", exact: true })
    .click();
  await expect(dialog(page, "Edytuj ogród")).toBeHidden();
  await settled(page);
  const g = (await snapshot(page)).gardens.find(
    (g: any) => g.id === "garden-1",
  );
  expect(g.address).toBe("Adres z pierwszej karty");
  expect(g.zones.find((z: any) => z.id === "zone-doc").plants).toBe(
    "Opis niezależnej strefy",
  );
  await other.close();
});
test("a garden form opened from the client cannot turn into a create operation after another tab deletes that garden", async ({
  page,
  context,
}) => {
  await page.goto("/#clients?client=client-1");
  await page
    .locator(".client-garden")
    .filter({ hasText: "Pusty ogród testowy" })
    .getByRole("button", { name: "Edytuj ogród", exact: true })
    .click();
  const f = dialog(page, "Edytuj ogród");
  await expect(f).toBeVisible();
  const other = await context.newPage();
  await other.clock.setFixedTime(fieldClock);
  await other.goto("/#gardens");
  await other
    .getByRole("button", {
      name: "Usuń ogród Pusty ogród testowy",
      exact: true,
    })
    .click();
  await dialog(other, "Usunąć ogród?")
    .getByRole("button", { name: "Usuń ogród", exact: true })
    .click();
  await expect(dialog(other, "Usunąć ogród?")).toBeHidden();
  await settled(other);
  expect(
    (await snapshot(page)).gardens.some((g: any) => g.id === "garden-free"),
  ).toBe(false);
  await f
    .getByRole("textbox", { name: "Notatki", exact: true })
    .fill("Szkic po usunięciu");
  await f.getByRole("button", { name: "Zapisz zmiany", exact: true }).click();
  await expect(f.getByRole("alert")).toContainText("innej karcie");
  await expect(
    f.getByRole("textbox", { name: "Notatki", exact: true }),
  ).toHaveValue("Szkic po usunięciu");
  expect(
    (await snapshot(page)).gardens.some((g: any) => g.id === "garden-free"),
  ).toBe(false);
  await other.close();
});
test("a guarded client edit waits for its commit, protects Back and keeps its draft after a quota failure", async ({
  page,
}) => {
  await page.goto("/#dashboard");
  await page
    .getByRole("navigation", { name: "Nawigacja główna", exact: true })
    .getByRole("button", { name: "Klienci", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Edytuj klienta Anna Kowalska", exact: true })
    .click();
  const f = dialog(page, "Edytuj klienta");
  await f.getByLabel("Telefon", { exact: true }).fill("600222333");
  await holdFinanceWrites(page);
  await f.getByRole("button", { name: "Zapisz zmiany", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("aria-busy", "true");
  await page.goBack();
  await expect(f).toBeVisible();
  await page.evaluate(() => (window as any).releaseFinanceWrite());
  await expect(f).toBeHidden();
  await settled(page);
  await page
    .getByRole("button", { name: "Edytuj klienta Anna Kowalska", exact: true })
    .click();
  await f.getByLabel("Telefon", { exact: true }).fill("600444555");
  const before = await snapshot(page);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    (window as any).restoreAuditPut = () =>
      (IDBObjectStore.prototype.put = put);
    IDBObjectStore.prototype.put = function (...args: any[]) {
      if (args[1] === "current")
        throw new DOMException("Brak miejsca", "QuotaExceededError");
      return put.apply(this, args as any);
    };
  });
  await f.getByRole("button", { name: "Zapisz zmiany", exact: true }).click();
  await expect(f.getByRole("alert")).toContainText("Brak miejsca");
  await expect(f.getByLabel("Telefon", { exact: true })).toHaveValue(
    "600444555",
  );
  expect(await snapshot(page)).toEqual(before);
  await page.evaluate(() => (window as any).restoreAuditPut());
  await f.getByRole("button", { name: "Zapisz zmiany", exact: true }).click();
  await expect(f).toBeHidden();
  await settled(page);
  expect(
    (await snapshot(page)).clients.find((c: any) => c.id === "client-1").phone,
  ).toBe("600444555");
});
