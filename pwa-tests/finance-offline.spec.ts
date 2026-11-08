import { test, expect } from "@playwright/test";
import { financeClock, financeData } from "../tests/finance-fixture";
import { resetCanonical, settled } from "../tests/atomic-fixture";
import { snapshot } from "../tests/atomic-report-helpers";
import { STORAGE_KEY, STORAGE_VERSION } from "../src/data/repository";
test("offline finance navigation and an explicit payment preserve approved amounts after restart", async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.clock.setFixedTime(financeClock);
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
    { key: STORAGE_KEY, version: STORAGE_VERSION, data: financeData() },
  );
  await page.reload();
  await page.locator(".app-shell").waitFor();
  await context.setOffline(true);
  await page.goto(
    "/#clients?finance=client-1&owner=client&financeFilter=outstanding",
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  const finance = page.getByRole("dialog", {
      name: "Rozliczenia klienta: Anna Kowalska",
      exact: true,
    }),
    job = page.getByRole("dialog", { name: "Szczegóły zlecenia", exact: true }),
    payment = page.getByRole("dialog", {
      name: "Szczegóły płatności",
      exact: true,
    });
  await expect(finance.getByTestId("finance-outstanding")).toContainText(
    "750,00",
  );
  const before = await snapshot(page);
  await finance.locator("details.finance-job-payments summary").click();
  await finance
    .locator('[data-payment-id="finance-partial"]')
    .getByRole("button")
    .click();
  await expect(payment.getByTestId("payment-detail-amount")).toContainText(
    "250,00",
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(payment).toBeVisible();
  await payment
    .getByRole("button", {
      name: "Rozliczenie zlecenia Wizyta częściowo opłacona",
      exact: true,
    })
    .click();
  await expect(job.getByTestId("payment-job-total")).toContainText("1000,00");
  expect(await snapshot(page)).toEqual(before);
  await job
    .getByRole("button", { name: "Dodaj płatność", exact: true })
    .click();
  await job.getByLabel("Kwota (zł)", { exact: true }).fill("5");
  await job
    .getByRole("button", { name: "Zapisz płatność", exact: true })
    .click();
  await settled(page);
  await expect(job.getByTestId("payment-job-remaining")).toContainText(
    "745,00",
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(job.getByTestId("payment-job-paid")).toContainText("255,00");
  const after = await snapshot(page);
  expect(after.jobs).toEqual(before.jobs);
  expect(after.payments).toHaveLength(before.payments.length + 1);
  expect(after.reportSequence).toBe(before.reportSequence);
  expect(errors).toEqual([]);
});
