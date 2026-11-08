import { test, expect } from "@playwright/test";
import { zonesData, zonesClock } from "../tests/zones-fixture";
import { STORAGE_KEY, STORAGE_VERSION } from "../src/data/repository";
import { resetCanonical, settled } from "../tests/atomic-fixture";
import { snapshot } from "../tests/atomic-report-helpers";
test("offline scoped zone, calendar and completed work survive restart without generating a new care cycle", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.clock.setFixedTime(zonesClock);
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
    { key: STORAGE_KEY, version: STORAGE_VERSION, data: zonesData() },
  );
  await page.reload();
  await page.locator(".app-shell").waitFor();
  await context.setOffline(true);
  await page.goto(
    "/#gardens?zone=zone-doc&zoneGarden=garden-1&section=overview",
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  const zone = page.getByRole("dialog", {
      name: "Strefa: Rabata różana",
      exact: true,
    }),
    task = page.getByRole("dialog", { name: "Szczegóły zadania", exact: true }),
    job = page.getByRole("dialog", { name: "Szczegóły zlecenia", exact: true });
  await expect(zone).toContainText("Róże 'New Dawn'");
  const before = await snapshot(page);
  await zone.getByRole("tab", { name: /Czynności i harmonogramy/ }).click();
  await zone
    .getByRole("button", {
      name: "Kalendarz harmonogramu Pielęgnacja róż",
      exact: true,
    })
    .click();
  await expect(task).toContainText("Termin pierwotny: 2026-11-15");
  await task
    .getByRole("button", { name: "Strefa: Rabata różana", exact: true })
    .click();
  await zone.getByRole("tab", { name: /Zlecenia i historia/ }).click();
  await zone
    .getByRole("button", {
      name: "Rozliczenie zlecenia Wizyta częściowo opłacona",
      exact: true,
    })
    .click();
  await expect(job.getByTestId("payment-job-total")).toContainText("1000,00");
  await job
    .getByRole("button", { name: "Strefa: Rabata różana", exact: true })
    .click();
  expect(await snapshot(page)).toEqual(before);
  await zone
    .getByRole("button", { name: "Edytuj strefę", exact: true })
    .click();
  const editor = page.getByRole("dialog", {
    name: "Edycja strefy",
    exact: true,
  });
  await editor
    .getByRole("textbox", { name: "Rośliny", exact: true })
    .fill("Opis roślin zapisany offline");
  await editor
    .getByRole("button", { name: "Zapisz strefę", exact: true })
    .click();
  await expect(editor).toBeHidden();
  await settled(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(zone).toContainText("Opis roślin zapisany offline");
  const after = await snapshot(page);
  for (const key of [
    "jobs",
    "payments",
    "taskSchedules",
    "taskOccurrences",
    "photos",
    "notes",
    "checklists",
  ] as const)
    expect(after[key]).toEqual(before[key]);
  expect(after.reportSequence).toBe(before.reportSequence);
  expect(errors).toEqual([]);
});
