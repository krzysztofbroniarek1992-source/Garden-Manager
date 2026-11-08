import { test, expect } from "@playwright/test";
import {
  documentationClock,
  documentationData,
} from "../tests/documentation-fixture";
import { resetCanonical, settled } from "../tests/atomic-fixture";
import { snapshot } from "../tests/atomic-report-helpers";
import { STORAGE_KEY, STORAGE_VERSION } from "../src/data/repository";
test("documentation links, saved report version and note editing work after an offline restart", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.clock.setFixedTime(documentationClock);
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
    { key: STORAGE_KEY, version: STORAGE_VERSION, data: documentationData() },
  );
  await page.reload();
  await page.locator(".app-shell").waitFor();
  await context.setOffline(true);
  await page.goto("/#notes?note=note-doc");
  await page.reload({ waitUntil: "domcontentloaded" });
  const note = page.getByRole("dialog", {
      name: "Szczegóły notatki",
      exact: true,
    }),
    job = page.getByRole("dialog", { name: "Szczegóły zlecenia", exact: true }),
    report = page.getByRole("dialog", {
      name: "Raport PDF dla klienta",
      exact: true,
    });
  await expect(note).toContainText("Obserwacja dokumentacji");
  const before = await snapshot(page);
  await note
    .getByRole("button", { name: "Zlecenie: Wizyta dokumentacji", exact: true })
    .click();
  await expect(job).toBeVisible();
  await job
    .getByRole("button", { name: "Raporty wizyty (1)", exact: true })
    .click();
  await report
    .getByRole("button", { name: "Podgląd wersji 1", exact: true })
    .click();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    report.getByRole("article", {
      name: "Treść raportu dla klienta",
      exact: true,
    }),
  ).toContainText("BO/2026/000001");
  expect(await snapshot(page)).toEqual(before);
  await page.goBack();
  await page.goBack();
  await page.goBack();
  await expect(note).toBeVisible();
  await note
    .getByRole("button", { name: "Edytuj notatkę", exact: true })
    .click();
  const form = page.getByRole("dialog", {
    name: "Edytuj notatkę",
    exact: true,
  });
  await form
    .getByLabel("Treść notatki", { exact: true })
    .fill("Opis zapisany bez internetu");
  await form
    .getByRole("button", { name: "Zapisz notatkę", exact: true })
    .click();
  await settled(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(note).toContainText("Opis zapisany bez internetu");
  expect((await snapshot(page)).jobs).toEqual(before.jobs);
  expect(errors).toEqual([]);
});
