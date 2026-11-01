import { test, expect } from "@playwright/test";
import {
  planningClock,
  planningNavigationData,
} from "../tests/planning-navigation-fixture";
import { STORAGE_KEY, STORAGE_VERSION } from "../src/data/repository";

test("offline calendar and series preserve moved identity, history and business data", async ({
  page,
  context,
}) => {
  await page.clock.setFixedTime(planningClock);
  await page.goto("/#dashboard");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  await page.evaluate(
    ({ key, version, data }) =>
      localStorage.setItem(key, JSON.stringify({ version, data })),
    {
      key: STORAGE_KEY,
      version: STORAGE_VERSION,
      data: planningNavigationData(),
    },
  );
  await page.reload();
  await context.setOffline(true);
  await page.goto(
    "/#calendar?date=2026-11-03&view=week&gardenFilter=garden-1&kindFilter=work",
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  const before = await page.evaluate(
    (key) => localStorage.getItem(key),
    STORAGE_KEY,
  );
  const task = page.getByRole("dialog", {
    name: "Szczegóły zadania",
    exact: true,
  });
  const series = page.getByRole("dialog", {
    name: "Harmonogram: Nawigacyjna pielęgnacja",
    exact: true,
  });
  const job = page.getByRole("dialog", {
    name: "Szczegóły zlecenia",
    exact: true,
  });
  await page
    .locator(".calendar-agenda")
    .getByRole("button", { name: "Nawigacyjna pielęgnacja", exact: true })
    .click();
  await expect(task).toContainText("Termin pierwotny: 2026-10-31");
  await expect(page).toHaveURL(/original=2026-10-31/);
  await task
    .getByRole("button", { name: "Seria harmonogramu", exact: true })
    .click();
  await expect(series).toBeVisible();
  await series
    .getByRole("button", {
      name: "Zlecenie harmonogramu Powiązana wizyta",
      exact: true,
    })
    .click();
  await expect(job).toBeVisible();
  await job
    .getByRole("button", { name: "Wróć do harmonogramu", exact: true })
    .click();
  await series
    .getByRole("button", { name: "Wróć do czynności", exact: true })
    .click();
  await task
    .getByRole("button", { name: "Wróć do kalendarza", exact: true })
    .click();
  await expect(page.getByLabel("Przejdź do dnia", { exact: true })).toHaveValue(
    "2026-11-03",
  );
  await expect(
    page.getByRole("button", { name: "Tydzień", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.goForward();
  await expect(task).toBeVisible();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(task).toContainText("2026-11-03");
  expect(
    await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY),
  ).toBe(before);
});
