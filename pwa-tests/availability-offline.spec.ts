import { test, expect } from "@playwright/test";
import {
  availabilityData,
  availabilityClock,
  availabilityDate as day,
  availabilityURL,
} from "../tests/availability-fixture";
import { resetCanonical, settled } from "../tests/atomic-fixture";
import { snapshot } from "../tests/atomic-report-helpers";
test("offline availability supports mass selection, hour edits, removal and reopening without touching care, visits, photos or money", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 360, height: 844 });
  await page.clock.setFixedTime(availabilityClock);
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
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
    availabilityData(),
  );
  await page.reload();
  await page.locator(".app-shell").waitFor();
  const before = await snapshot(page);
  await context.setOffline(true);
  await page.goto(availabilityURL);
  await page
    .getByRole("button", { name: "Zaznacz wiele dni", exact: true })
    .click();
  for (const date of [day, "2027-04-03"])
    await page
      .getByRole("button", { name: `Wybierz dzień ${date}`, exact: true })
      .click();
  await page
    .getByRole("button", { name: "Zaznaczono 2 dni", exact: true })
    .click();
  const batch = page.getByRole("dialog", {
    name: "Dostępność wielu dni",
    exact: true,
  });
  await batch
    .getByRole("combobox", { name: "Powód (opcjonalnie)", exact: true })
    .selectOption("pawnshop");
  await batch
    .getByRole("button", { name: "Zapisz dostępność", exact: true })
    .click();
  await expect(batch).toBeHidden();
  await settled(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  expect((await snapshot(page)).availability).toHaveLength(2);
  await page.goto("/#calendar?availability=" + day);
  const form = page.getByRole("dialog", {
    name: "Dostępność dnia",
    exact: true,
  });
  await form
    .getByRole("combobox", { name: "Rodzaj dostępności", exact: true })
    .selectOption("until");
  await form.getByLabel("Godzina do", { exact: true }).fill("14:00");
  await form
    .getByRole("button", { name: "Zapisz dostępność", exact: true })
    .click();
  await expect(form).toBeHidden();
  await page.goto("/#calendar?availability=2027-04-03");
  await form
    .getByRole("button", { name: "Usuń ograniczenie dostępności", exact: true })
    .click();
  await form
    .getByRole("button", {
      name: "Potwierdź usunięcie ograniczeń",
      exact: true,
    })
    .click();
  await expect(form).toBeHidden();
  await settled(page);
  const reopened = await context.newPage();
  await reopened.clock.setFixedTime(availabilityClock);
  await reopened.goto("/#calendar?date=" + day + "&view=day");
  await expect(
    reopened.getByRole("region", {
      name: "Dostępność wybranego dnia",
      exact: true,
    }),
  ).toContainText("Dostępny do 14:00");
  const after = await snapshot(reopened);
  expect(after.availability).toHaveLength(1);
  for (const key of [
    "jobs",
    "taskSchedules",
    "taskOccurrences",
    "payments",
    "timer",
    "photos",
    "notes",
    "checklists",
  ])
    expect(after[key]).toEqual(before[key]);
  await reopened.close();
});
