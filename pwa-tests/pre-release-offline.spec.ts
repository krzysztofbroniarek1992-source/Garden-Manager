import { test, expect } from "@playwright/test";
import { fieldData, fieldClock } from "../tests/field-fixture";
import { resetCanonical, settled } from "../tests/atomic-fixture";
import { snapshot } from "../tests/atomic-report-helpers";
test("offline client edits in two PWA tabs preserve the newer record and reject an old form after reopening", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 360, height: 844 });
  await page.clock.setFixedTime(fieldClock);
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  await resetCanonical(page);
  await page.evaluate(
    (data) =>
      localStorage.setItem(
        "garden-manager:v1",
        JSON.stringify({ version: 10, data }),
      ),
    fieldData(),
  );
  await page.reload();
  await page.locator(".app-shell").waitFor();
  const before = await snapshot(page);
  await context.setOffline(true);
  await page.goto("/#clients?client=client-1");
  await page
    .getByRole("button", { name: "Edytuj klienta", exact: true })
    .click();
  const first = page.getByRole("dialog", {
    name: "Edytuj klienta",
    exact: true,
  });
  const other = await context.newPage();
  await other.clock.setFixedTime(fieldClock);
  await other.goto("/#clients?client=client-1");
  await other
    .getByRole("button", { name: "Edytuj klienta", exact: true })
    .click();
  const second = other.getByRole("dialog", {
    name: "Edytuj klienta",
    exact: true,
  });
  await second.getByLabel("Telefon", { exact: true }).fill("600999888");
  await second
    .getByRole("button", { name: "Zapisz zmiany", exact: true })
    .click();
  await expect(second).toBeHidden();
  await settled(other);
  await first
    .getByRole("textbox", { name: "Notatki", exact: true })
    .fill("Szkic zachowany offline");
  await first
    .getByRole("button", { name: "Zapisz zmiany", exact: true })
    .click();
  await expect(first.getByRole("alert")).toContainText("innej karcie");
  await expect(
    first.getByRole("textbox", { name: "Notatki", exact: true }),
  ).toHaveValue("Szkic zachowany offline");
  expect(
    (await snapshot(page)).clients.find((c: any) => c.id === "client-1").phone,
  ).toBe("600999888");
  page.once("dialog", (d) => d.accept());
  await first.getByRole("button", { name: "Anuluj", exact: true }).click();
  await expect(first).toBeHidden();
  await page.reload();
  await page.locator(".app-shell").waitFor();
  const after = await snapshot(page);
  expect(after.clients.find((c: any) => c.id === "client-1").phone).toBe(
    "600999888",
  );
  for (const key of [
    "jobs",
    "gardens",
    "payments",
    "timer",
    "photos",
    "taskSchedules",
    "taskOccurrences",
    "availability",
    "reportSequence",
    "notes",
    "checklists",
  ])
    expect(after[key]).toEqual(before[key]);
  await other.close();
});
