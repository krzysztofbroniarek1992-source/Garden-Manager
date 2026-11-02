import { test, expect } from "@playwright/test";
import { data, snapshot, preview } from "../tests/atomic-report-helpers";
import { resetCanonical } from "../tests/atomic-fixture";
test("offline queued PDF saves remain unique after reopening the application", async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  await page.clock.setFixedTime(new Date("2026-10-31T10:00:00+01:00"));
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
        JSON.stringify({ version: 9, data }),
      ),
    data(),
  );
  await page.reload();
  await context.setOffline(true);
  const first = await preview(page, "Raport atomowy 1"),
    other = await context.newPage();
  await other.clock.setFixedTime(new Date("2026-10-31T10:00:00+01:00"));
  const second = await preview(other, "Raport atomowy 2");
  const downloads: string[] = [];
  page.on("download", (d) => downloads.push(d.suggestedFilename()));
  other.on("download", (d) => downloads.push(d.suggestedFilename()));
  await page.evaluate(() => {
    void navigator.locks.request(
      "garden-manager-photos",
      () =>
        new Promise<void>((r) => {
          (window as any).releaseReports = r;
        }),
    );
  });
  await page.waitForFunction(() => !!(window as any).releaseReports);
  await Promise.all([
    first
      .getByRole("button", { name: "Zapisz raport i pobierz PDF", exact: true })
      .click(),
    second
      .getByRole("button", { name: "Zapisz raport i pobierz PDF", exact: true })
      .click(),
  ]);
  await page.waitForFunction(
    async () =>
      ((await navigator.locks.query()).pending ?? []).filter(
        (l) => l.name === "garden-manager-photos",
      ).length >= 2,
  );
  await page.evaluate(() => (window as any).releaseReports());
  await expect.poll(() => downloads.length).toBe(1);
  const one = await snapshot(page),
    loser = one.jobs[0].reports?.length ? second : first;
  await expect(loser.getByRole("alert")).toContainText("zmieniły");
  await loser
    .getByRole("button", { name: "Przygotuj podgląd raportu", exact: true })
    .click();
  await loser
    .getByRole("button", { name: "Zapisz raport i pobierz PDF", exact: true })
    .click();
  await expect.poll(() => downloads.length).toBe(2);
  expect(new Set(downloads).size).toBe(2);
  const saved = await snapshot(page);
  expect(saved.reportSequence).toBe(2);
  expect(saved.jobs.flatMap((j: any) => j.reports ?? [])).toHaveLength(2);
  await page.close();
  await other.close();
  const reopened = await context.newPage();
  await reopened.goto("/#history");
  expect(await snapshot(reopened)).toEqual(saved);
});
