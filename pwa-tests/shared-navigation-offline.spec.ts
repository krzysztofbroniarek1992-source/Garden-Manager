import { test, expect } from "@playwright/test";

test("addressed core cards restore offline with native history and no business writes", async ({
  page,
  context,
}) => {
  await page.goto("/#clients");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  const client = page.getByRole("button", {
    name: "Anna Kowalska",
    exact: true,
  });
  await client.click();
  await page
    .getByRole("button", {
      name: "Otwórz ogród Ogród przy Lipowej",
      exact: true,
    })
    .click();
  const garden = page.getByRole("dialog", {
    name: "Karta ogrodu: Ogród przy Lipowej",
    exact: true,
  });
  await garden
    .getByRole("tab", { name: "Zlecenia i historia prac", exact: true })
    .click();
  const before = await page.evaluate(() =>
    localStorage.getItem("garden-manager:v1"),
  );
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    garden.getByRole("tab", { name: "Zlecenia i historia prac", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await garden
    .getByRole("button", {
      name: "Szczegóły zlecenia Pielęgnacja ogrodu",
      exact: true,
    })
    .click();
  const job = page.getByRole("dialog", {
    name: "Szczegóły zlecenia",
    exact: true,
  });
  await job
    .getByRole("button", { name: "Materiały i rozliczenie", exact: true })
    .click();
  await expect(page).toHaveURL(/job=job-1&section=billing/);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(job.locator('[data-visit-section="billing"]')).toBeInViewport();
  await page.goBack();
  await expect(garden).toBeVisible();
  await page.goForward();
  await expect(job).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("garden-manager:v1")),
  ).toBe(before);
});
