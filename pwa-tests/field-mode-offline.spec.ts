import { test, expect } from "@playwright/test";
import { fieldData, fieldClock, fieldURL } from "../tests/field-fixture";
import { resetCanonical, settled, setChecked } from "../tests/atomic-fixture";
import { snapshot } from "../tests/atomic-report-helpers";
test("field mode works offline through start, pause, resume, activities, notes, checklist, materials, photo, reload and explicit finish", async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 390, height: 844 });
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
  await context.setOffline(true);
  await page.goto(fieldURL);
  const visit = page.getByRole("dialog", {
      name: "Wizyta w terenie",
      exact: true,
    }),
    button = (name: string) => visit.getByRole("button", { name, exact: true });
  const section = async (name: string) =>
    visit
      .getByRole("navigation", { name: "Sekcje wizyty terenowej" })
      .getByRole("button", { name, exact: true })
      .click();
  const before = await snapshot(page);
  await button("START — Rozpocznij pomiar").click();
  await expect(button("PAUZA")).toBeVisible();
  await page.clock.setFixedTime(new Date(fieldClock.getTime() + 7200000));
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(page.getByTestId("field-time")).toHaveText("02:00:00");
  await button("PAUZA").click();
  await expect(button("WZNÓW")).toBeVisible();
  await page.reload();
  await expect(button("WZNÓW")).toBeVisible();
  await page.clock.setFixedTime(new Date(fieldClock.getTime() + 10800000));
  await expect(page.getByTestId("field-time")).toHaveText("02:00:00");
  await button("WZNÓW").click();
  await expect(button("PAUZA")).toBeVisible();
  await button("Dodaj czynność").click();
  await visit
    .getByLabel("Czynność 1", { exact: true })
    .fill("Koszenie offline");
  await button("Zapisz czynności").click();
  await expect(button("Zapisz czynności")).toBeHidden();
  await section("Materiały");
  await button("Dodaj materiały").click();
  await visit
    .getByLabel("Nazwa materiału 1", { exact: true })
    .fill("Nawóz offline");
  await visit.getByLabel("Ilość materiału 1", { exact: true }).fill("3");
  await button("Zapisz materiały").click();
  await expect(button("Zapisz materiały")).toBeHidden();
  await section("Notatki");
  await button("Dodaj notatkę").click();
  const note = page.getByRole("dialog", { name: "Nowa notatka", exact: true });
  await note
    .getByLabel("Tytuł notatki", { exact: true })
    .fill("Notatka offline");
  await note
    .getByRole("textbox", { name: "Treść notatki", exact: true })
    .fill("Kontrola drzew podczas kolejnej wizyty");
  await note
    .getByRole("button", { name: "Zapisz notatkę", exact: true })
    .click();
  await expect(note).toBeHidden();
  await section("Checklisty");
  await button("Przygotowanie terenu").click();
  await setChecked(
    page.getByRole("checkbox", {
      name: "Wykonano: Sprawdź bramę",
      exact: true,
    }),
    true,
  );
  await settled(page);
  await page.goBack();
  await expect(visit).toBeVisible();
  const chooser = page.waitForEvent("filechooser");
  await button("Zrób zdjęcie").click();
  await (await chooser).setFiles("src/reports/fixtures/garden.jpg");
  await visit
    .getByRole("textbox", { name: "Opis zdjęcia", exact: true })
    .fill("Zdjęcie offline");
  await button("Zapisz zdjęcia").click();
  await expect(
    visit.getByText("Zdjęcia zapisane na tym urządzeniu.", { exact: true }),
  ).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await button("STOP").click();
  await expect(button("START — Rozpocznij pomiar")).toBeVisible();
  await settled(page);
  page.once("dialog", (d) => d.accept());
  await button("Zakończ wizytę").click();
  await expect(button("Zakończ wizytę")).toBeHidden();
  await settled(page);
  const after = await snapshot(page);
  expect(after.jobs.find((j: any) => j.id === "field-today")).toMatchObject({
    status: "completed",
    seconds: 7200,
    activities: ["Koszenie offline"],
    settlement: null,
  });
  expect(after.timer).toBeNull();
  for (const key of [
    "taskSchedules",
    "taskOccurrences",
    "payments",
    "availability",
    "reportSequence",
  ])
    expect(after[key]).toEqual(before[key]);
  const reopened = await context.newPage();
  await reopened.clock.setFixedTime(fieldClock);
  await reopened.goto(fieldURL + "&section=photos");
  await expect(
    reopened.getByRole("img", { name: "Zdjęcie offline", exact: true }),
  ).toBeVisible();
  await expect(reopened.getByTestId("field-time")).toHaveText("02:00:00");
  expect(await snapshot(reopened)).toEqual(after);
  await reopened.close();
});
