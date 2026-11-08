import { test, expect } from "@playwright/test";
import { careData, careClock, careURL } from "../tests/care-fixture";
import { STORAGE_KEY, STORAGE_VERSION } from "../src/data/repository";
import { resetCanonical, settled } from "../tests/atomic-fixture";
import { snapshot } from "../tests/atomic-report-helpers";
test("GM-005 performs, moves and reviews a care series offline across reload and a new app tab", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.setFixedTime(careClock);
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
    { key: STORAGE_KEY, version: STORAGE_VERSION, data: careData() },
  );
  await page.reload();
  await page.locator(".app-shell").waitFor();
  const before = await snapshot(page);
  await context.setOffline(true);
  await page.goto(careURL);
  await page.reload({ waitUntil: "domcontentloaded" });
  const details = page.getByRole("dialog", {
    name: "Szczegóły zadania",
    exact: true,
  });
  await expect(details).toContainText("Nawożenie GM-005");
  await details
    .getByRole("button", { name: "Potwierdź wykonanie zabiegu", exact: true })
    .click();
  await details
    .getByLabel("Faktyczna data wykonania", { exact: true })
    .fill("2027-04-08");
  await details
    .getByRole("button", { name: "Zapisz wykonanie zabiegu", exact: true })
    .click();
  await expect(
    details.getByRole("region", { name: "Historia zabiegów" }),
  ).toContainText("Najbliższy niewykonany zabieg: 2027-05-08");
  await settled(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(details).toContainText("Faktycznie wykonano: 2027-04-08");
  await details
    .getByRole("button", { name: "Otwórz zabieg 2027-05-08", exact: true })
    .click();
  await expect(page).toHaveURL(/cycle=2/);
  await details
    .getByRole("button", { name: "Przesuń ten termin", exact: true })
    .click();
  await details
    .getByLabel("Nowa data terminu", { exact: true })
    .fill("2027-05-10");
  await details
    .getByRole("button", { name: "Zapisz przesunięcie", exact: true })
    .click();
  await settled(page);
  await expect(page).toHaveURL(/cycle=1/);
  await page.goForward();
  await expect(page).toHaveURL(/cycle=2/);
  await expect(details).toContainText("2027-05-10");
  const fresh = await context.newPage();
  await fresh.clock.setFixedTime(careClock);
  await fresh.goto("http://127.0.0.1:4173" + careURL);
  await expect(
    fresh.getByRole("dialog", { name: "Szczegóły zadania", exact: true }),
  ).toContainText("Faktycznie wykonano: 2027-04-08");
  const after = await snapshot(fresh);
  expect(
    after.taskOccurrences.filter((o: any) => o.scheduleId === "care-e2e"),
  ).toHaveLength(2);
  for (const key of ["jobs", "payments", "photos", "timer"])
    expect(after[key]).toEqual(before[key]);
  await fresh.close();
  expect(errors).toEqual([]);
});
