import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fieldData, fieldClock, fieldDay, fieldURL } from "./field-fixture";
import { snapshot } from "./atomic-report-helpers";
import { changeCanonical, settled, setChecked } from "./atomic-fixture";
import { holdFinanceWrites } from "./finance-fixture";
const id = "field-today",
  at = fieldClock.getTime();
const visit = (p: Page) =>
  p.getByRole("dialog", { name: "Wizyta w terenie", exact: true });
const button = (p: Page, name: string) =>
  visit(p).getByRole("button", { name, exact: true });
async function open(p: Page) {
  await p.goto(fieldURL);
  await expect(visit(p)).toBeVisible();
}
async function start(p: Page) {
  await button(p, "START — Rozpocznij pomiar").click();
  await expect(button(p, "PAUZA")).toBeVisible();
  await settled(p);
}
async function stop(p: Page) {
  p.once("dialog", (d) => d.accept());
  await button(p, "STOP").click();
  await expect(button(p, "START — Rozpocznij pomiar")).toBeVisible();
  await settled(p);
}
async function section(p: Page, name: string) {
  await visit(p)
    .getByRole("navigation", { name: "Sekcje wizyty terenowej" })
    .getByRole("button", { name, exact: true })
    .click();
}
async function addActivity(p: Page, text = "Koszenie i sprzątanie") {
  await button(p, "Dodaj czynność").click();
  await visit(p).getByLabel("Czynność 1", { exact: true }).fill(text);
  await button(p, "Zapisz czynności").click();
  await expect(button(p, "Zapisz czynności")).toBeHidden();
  await settled(p);
}
async function addNote(p: Page) {
  await section(p, "Notatki");
  await button(p, "Dodaj notatkę").click();
  const f = p.getByRole("dialog", { name: "Nowa notatka", exact: true });
  await f
    .getByLabel("Tytuł notatki", { exact: true })
    .fill("Notatka po koszeniu");
  await f
    .getByRole("textbox", { name: "Treść notatki", exact: true })
    .fill("Świerki do przycięcia podczas kolejnej wizyty.");
  await f.getByRole("button", { name: "Zapisz notatkę", exact: true }).click();
  await expect(f).toBeHidden();
  await settled(p);
}
async function addPhoto(p: Page) {
  const chooser = p.waitForEvent("filechooser");
  await button(p, "Zrób zdjęcie").click();
  await (await chooser).setFiles("src/reports/fixtures/garden.jpg");
  await visit(p)
    .getByRole("textbox", { name: "Opis zdjęcia", exact: true })
    .fill("Stan rabaty w trakcie pracy");
  await button(p, "Zapisz zdjęcia").click();
  await expect(
    visit(p).getByText("Zdjęcia zapisane na tym urządzeniu.", { exact: true }),
  ).toBeVisible();
  await settled(p);
}
async function addMaterial(p: Page) {
  await section(p, "Materiały");
  await button(p, "Dodaj materiały").click();
  await visit(p)
    .getByLabel("Nazwa materiału 1", { exact: true })
    .fill("Kora terenowa");
  await visit(p).getByLabel("Ilość materiału 1", { exact: true }).fill("2.5");
  await visit(p)
    .getByLabel("Jednostka materiału 1", { exact: true })
    .selectOption("l");
  await visit(p).getByLabel("Cena materiału 1", { exact: true }).fill("12.50");
  await button(p, "Zapisz materiały").click();
  await expect(button(p, "Zapisz materiały")).toBeHidden();
  await settled(p);
}
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(fieldClock);
  await page.addInitScript((data) => {
    if (!localStorage.getItem("garden-manager:v1"))
      localStorage.setItem(
        "garden-manager:v1",
        JSON.stringify({ version: 10, data }),
      );
  }, fieldData());
});
test("entry, today/upcoming search and opening a visit do not create records or start time", async ({
  page,
}) => {
  await page.goto("/#field");
  const before = await snapshot(page);
  await expect(
    page.getByRole("heading", { name: "Tryb terenowy", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Zlecenia na dzisiaj" }),
  ).toContainText("Terenowe koszenie");
  await expect(
    page.getByRole("region", { name: "Najbliższe zlecenia" }),
  ).toContainText("Jutrzejszy żywopłot");
  await page.getByLabel("Znajdź zlecenie", { exact: true }).fill("Terenowe");
  await page.getByRole("button", { name: /Terenowe koszenie/ }).click();
  await expect(visit(page)).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
});
test("new unplanned work reuses JobForm, assigns the garden and returns to the field visit without starting", async ({
  page,
}) => {
  await page.goto("/#field");
  const before = await snapshot(page);
  await page
    .getByRole("button", { name: "Utwórz zlecenie", exact: true })
    .click();
  const f = page.getByRole("dialog", { name: "Nowe zlecenie", exact: true });
  await f
    .getByLabel("Nazwa pracy", { exact: true })
    .fill("Nieplanowane sprzątanie");
  await f.getByRole("button", { name: "Zapisz zlecenie", exact: true }).click();
  await expect(visit(page)).toContainText("Nieplanowane sprzątanie");
  const after = await snapshot(page);
  expect(after.jobs).toHaveLength(before.jobs.length + 1);
  expect(after.jobs.at(-1)).toMatchObject({
    gardenId: "garden-1",
    status: "planned",
    seconds: 0,
    settlement: null,
  });
  expect(after.timer).toBeNull();
});
test("START pause resume STOP are deliberate, timestamp-based after screen suspension and distinct from completion", async ({
  page,
  context,
}) => {
  await open(page);
  await start(page);
  await page.clock.setFixedTime(new Date(at + 7200000));
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(page.getByTestId("field-time")).toHaveText("02:00:00");
  await page.reload();
  await expect(page.getByTestId("field-time")).toHaveText("02:00:00");
  await button(page, "PAUZA").click();
  await expect(button(page, "WZNÓW")).toBeVisible();
  await settled(page);
  await page.clock.setFixedTime(new Date(at + 9000000));
  await expect(page.getByTestId("field-time")).toHaveText("02:00:00");
  await button(page, "WZNÓW").click();
  await expect(button(page, "PAUZA")).toBeVisible();
  await page.clock.setFixedTime(new Date(at + 9065000));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByTestId("field-time")).toHaveText("02:01:05");
  page.once("dialog", (d) => d.dismiss());
  await button(page, "STOP").click();
  expect((await snapshot(page)).timer).not.toBeNull();
  await stop(page);
  const after = await snapshot(page),
    j = after.jobs.find((j: any) => j.id === id);
  expect(j).toMatchObject({
    seconds: 7265,
    status: "in-progress",
    settlement: null,
  });
  expect(after.timer).toBeNull();
  const reopened = await context.newPage();
  await reopened.clock.setFixedTime(new Date(at + 10000000));
  await reopened.goto(fieldURL);
  await expect(reopened.getByTestId("field-time")).toHaveText("02:01:05");
  await reopened.close();
});
test("rapid repeated START and STOP commit once and do not reset a segment or duplicate its history", async ({
  page,
}) => {
  await open(page);
  await button(page, "START — Rozpocznij pomiar").evaluate(
    (e: HTMLButtonElement) => {
      e.click();
      e.click();
      e.click();
    },
  );
  await expect(button(page, "PAUZA")).toBeVisible();
  await settled(page);
  await page.clock.setFixedTime(new Date(at + 10000));
  let confirmations = 0;
  page.on("dialog", async (d) => {
    confirmations++;
    await d.accept();
  });
  await button(page, "STOP").evaluate((e: HTMLButtonElement) => {
    e.click();
    e.click();
    e.click();
  });
  await expect(button(page, "START — Rozpocznij pomiar")).toBeVisible();
  await settled(page);
  const d = await snapshot(page),
    j = d.jobs.find((j: any) => j.id === id);
  expect(j.seconds).toBe(10);
  expect(confirmations).toBe(1);
  expect(j.timeHistory.filter((e: any) => e.kind === "stopped")).toHaveLength(
    1,
  );
});
test("one active timer remains first, switching visits does not stop it and a second START is disabled", async ({
  page,
}) => {
  await open(page);
  await start(page);
  await page.goto("/#field?field=field-next");
  await expect(button(page, "START — Rozpocznij pomiar")).toBeDisabled();
  await button(page, "Otwórz aktywną wizytę").click();
  await expect(visit(page)).toContainText("Terenowe koszenie");
  await page.goto("/#field");
  await expect(
    page.getByRole("region", { name: "Aktywna wizyta" }),
  ).toContainText("Terenowe koszenie");
  expect((await snapshot(page)).timer.jobId).toBe(id);
});
test("adding and editing several activities during measurement keeps a single running timer and other visit data", async ({
  page,
}) => {
  await open(page);
  await start(page);
  const before = await snapshot(page);
  await addActivity(page);
  await button(page, "Edytuj czynności").click();
  await visit(page).getByLabel("Czynność 1", { exact: true }).fill("Koszenie");
  await button(page, "Dodaj czynność").click();
  await visit(page)
    .getByLabel("Czynność 2", { exact: true })
    .fill("Sprzątanie");
  await button(page, "Zapisz czynności").click();
  await expect(button(page, "Zapisz czynności")).toBeHidden();
  await settled(page);
  const after = await snapshot(page);
  expect(after.timer).toEqual(before.timer);
  expect(after.jobs.find((j: any) => j.id === id).activities).toEqual([
    "Koszenie",
    "Sprzątanie",
  ]);
  expect(after.payments).toEqual(before.payments);
  expect(after.taskOccurrences).toEqual(before.taskOccurrences);
  await page.reload();
  await expect(
    visit(page).getByRole("listitem").filter({ hasText: "Sprzątanie" }),
  ).toBeVisible();
});
test("materials use the shared fields and append during a visit without stopping or altering an approved settlement", async ({
  page,
}) => {
  await open(page);
  await start(page);
  const before = await snapshot(page);
  await addMaterial(page);
  let d = await snapshot(page);
  expect(d.timer).toEqual(before.timer);
  expect(d.jobs.find((j: any) => j.id === id).materials[0]).toMatchObject({
    name: "Kora terenowa",
    quantity: 2.5,
    unit: "l",
    unitPrice: 12.5,
  });
  await page.goto("/#field?field=job-1");
  await addMaterial(page);
  d = await snapshot(page);
  expect(d.jobs.find((j: any) => j.id === "job-1").settlement).toEqual(
    before.jobs.find((j: any) => j.id === "job-1").settlement,
  );
  expect(d.payments).toEqual(before.payments);
});
test("camera is requested only explicitly, during category and real client/garden/job/zone associations persist", async ({
  page,
}) => {
  let requests = 0;
  page.on("filechooser", () => requests++);
  await open(page);
  await expect(visit(page)).toBeVisible();
  expect(requests).toBe(0);
  await start(page);
  const before = await snapshot(page);
  await addPhoto(page);
  expect(requests).toBe(1);
  const d = await snapshot(page),
    p = d.photos.find(
      (p: any) => p.description === "Stan rabaty w trakcie pracy",
    );
  expect(p).toMatchObject({
    jobId: id,
    gardenId: "garden-1",
    clientId: "client-1",
    category: "during",
  });
  expect(d.timer).toEqual(before.timer);
  await page.reload();
  await expect(
    visit(page).getByRole("img", {
      name: "Stan rabaty w trakcie pracy",
      exact: true,
    }),
  ).toBeVisible();
});
test("a cancelled camera chooser does not create an empty photo or change the visit", async ({
  page,
}) => {
  await open(page);
  const before = await snapshot(page),
    chooser = page.waitForEvent("filechooser");
  await button(page, "Zrób zdjęcie").click();
  await (await chooser).setFiles([]);
  expect(await snapshot(page)).toEqual(before);
});
test("notes and checklist edits stay scoped to the visit and survive reload without stopping work", async ({
  page,
}) => {
  await open(page);
  await start(page);
  const before = await snapshot(page);
  await addNote(page);
  await section(page, "Checklisty");
  await visit(page)
    .getByRole("button", { name: "Przygotowanie terenu", exact: true })
    .click();
  await setChecked(
    page.getByRole("checkbox", {
      name: "Wykonano: Sprawdź bramę",
      exact: true,
    }),
    true,
  );
  await settled(page);
  const d = await snapshot(page);
  expect(d.timer).toEqual(before.timer);
  expect(
    d.notes.find((n: any) => n.title === "Notatka po koszeniu"),
  ).toMatchObject({ jobId: id, gardenId: "garden-1", clientId: "client-1" });
  expect(
    d.checklists.find((c: any) => c.id === "field-list").items[0].status,
  ).toBe("done");
  await page.reload();
  await expect(
    page.getByRole("checkbox", {
      name: "Wykonano: Sprawdź bramę",
      exact: true,
    }),
  ).toBeChecked();
});
test("summary contains activities, materials, notes, photos and checklist; completion permits incomplete work without price approval", async ({
  page,
}) => {
  await open(page);
  await addActivity(page);
  await addNote(page);
  await addMaterial(page);
  await addPhoto(page);
  await button(page, "Podsumowanie wizyty").click();
  const summary = page.getByRole("dialog", {
    name: "Podsumowanie wizyty",
    exact: true,
  });
  await expect(summary).toContainText("Koszenie i sprzątanie");
  await expect(summary).toContainText("Kora terenowa");
  await expect(summary).toContainText("Notatka po koszeniu");
  await expect(summary).toContainText("Przygotowanie terenu");
  await expect(
    summary.getByRole("img", {
      name: "Stan rabaty w trakcie pracy",
      exact: true,
    }),
  ).toBeVisible();
  await summary
    .getByRole("button", { name: "Zamknij okno", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Szczegóły zlecenia", exact: true })
    .getByRole("button", { name: "Wróć do wizyty w terenie", exact: true })
    .click();
  await expect(visit(page)).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await button(page, "Zakończ wizytę").click();
  await expect(button(page, "Zakończ wizytę")).toBeHidden();
  expect(
    (await snapshot(page)).jobs.find((j: any) => j.id === id),
  ).toMatchObject({ status: "completed", settlement: null });
});
test("GM-005 source opens its actual occurrence and finishing the visit never confirms the treatment or shifts availability", async ({
  page,
}) => {
  const fixture = fieldData(),
    source = fixture.taskOccurrences.find(
      (o) => o.scheduleId === "field-care",
    )!;
  await page.goto("/#field?field=" + encodeURIComponent(source.jobId!));
  const before = await snapshot(page);
  await button(page, source.title + " · " + source.originalDate).click();
  await expect(
    page.getByRole("dialog", { name: "Szczegóły zadania", exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(visit(page)).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await button(page, "Zakończ wizytę").click();
  await expect(button(page, "Zakończ wizytę")).toBeHidden();
  const after = await snapshot(page);
  expect(after.taskOccurrences).toEqual(before.taskOccurrences);
  expect(after.taskSchedules).toEqual(before.taskSchedules);
  expect(after.availability).toEqual(before.availability);
});
test("native Back/Forward, related cards, filters and reload retain the field visit section without writes", async ({
  page,
}) => {
  await page.goto("/#field");
  await page.getByLabel("Znajdź zlecenie", { exact: true }).fill("Terenowe");
  await page.getByRole("button", { name: /Terenowe koszenie/ }).click();
  await section(page, "Notatki");
  const before = await snapshot(page);
  await button(
    page,
    "Ogród: " + before.gardens.find((g: any) => g.id === "garden-1").name,
  ).click();
  await expect(
    page.getByRole("dialog", { name: /Karta ogrodu/ }),
  ).toBeVisible();
  await page.goBack();
  await expect(visit(page)).toBeVisible();
  await expect(page).toHaveURL(/section=notes/);
  await page.goForward();
  await expect(
    page.getByRole("dialog", { name: /Karta ogrodu/ }),
  ).toBeVisible();
  await page.goBack();
  await page.reload();
  await expect(visit(page)).toBeVisible();
  await expect(page).toHaveURL(/section=notes/);
  expect(await snapshot(page)).toEqual(before);
});
test("unsaved activities and note bodies survive rejected section changes and browser Back", async ({
  page,
}) => {
  await page.goto("/#field");
  await page.getByRole("button", { name: /Terenowe koszenie/ }).click();
  await button(page, "Dodaj czynność").click();
  await visit(page)
    .getByLabel("Czynność 1", { exact: true })
    .fill("Niezapisana czynność");
  page.once("dialog", (d) => d.dismiss());
  await section(page, "Materiały");
  await expect(
    visit(page).getByLabel("Czynność 1", { exact: true }),
  ).toHaveValue("Niezapisana czynność");
  page.once("dialog", (d) => d.dismiss());
  await page.goBack();
  await expect(
    visit(page).getByLabel("Czynność 1", { exact: true }),
  ).toHaveValue("Niezapisana czynność");
  page.once("dialog", (d) => d.accept());
  await section(page, "Notatki");
  await button(page, "Dodaj notatkę").click();
  const f = page.getByRole("dialog", { name: "Nowa notatka", exact: true });
  await f
    .getByRole("textbox", { name: "Treść notatki", exact: true })
    .fill("Zachowaj ten tekst");
  page.once("dialog", (d) => d.dismiss());
  await page.goBack();
  await expect(
    f.getByRole("textbox", { name: "Treść notatki", exact: true }),
  ).toHaveValue("Zachowaj ten tekst");
});
test("an awaited START blocks navigation and only announces local save after the transaction commits", async ({
  page,
}) => {
  await page.goto("/#field");
  await page.getByRole("button", { name: /Terenowe koszenie/ }).click();
  await holdFinanceWrites(page);
  await button(page, "START — Rozpocznij pomiar").click();
  await expect(page.locator("html")).toHaveAttribute("aria-busy", "true");
  await expect(
    visit(page).getByText("Zapisywanie… Poczekaj na zatwierdzenie operacji.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    visit(page).getByText("Pomiar rozpoczęty i zapisany lokalnie.", {
      exact: true,
    }),
  ).toBeHidden();
  await page.goBack();
  await expect(visit(page)).toBeVisible();
  await page.evaluate(() => (window as any).releaseFinanceWrite());
  await expect(button(page, "PAUZA")).toBeVisible();
  await settled(page);
  expect((await snapshot(page)).timer.jobId).toBe(id);
});
test("quota failure preserves a draft and every business field without pretending it was saved", async ({
  page,
}) => {
  await open(page);
  const before = await snapshot(page);
  await button(page, "Dodaj czynność").click();
  await visit(page)
    .getByLabel("Czynność 1", { exact: true })
    .fill("Szkic przy braku miejsca");
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    (window as any).restoreFieldPut = () =>
      (IDBObjectStore.prototype.put = put);
    IDBObjectStore.prototype.put = function (...args: any[]) {
      if (args[1] === "current")
        throw new DOMException("Brak miejsca", "QuotaExceededError");
      return put.apply(this, args as any);
    };
  });
  await button(page, "Zapisz czynności").click();
  await expect(visit(page).getByRole("alert")).toBeVisible();
  await expect(
    visit(page).getByLabel("Czynność 1", { exact: true }),
  ).toHaveValue("Szkic przy braku miejsca");
  expect(await snapshot(page)).toEqual(before);
  await page.evaluate(() => (window as any).restoreFieldPut());
  await button(page, "Zapisz czynności").click();
  await expect(button(page, "Zapisz czynności")).toBeHidden();
});
test("two tabs starting different visits simultaneously keep exactly one timer and reject the stale action", async ({
  page,
  context,
}) => {
  await open(page);
  const other = await context.newPage();
  await other.clock.setFixedTime(fieldClock);
  await other.goto("/#field?field=field-next");
  await expect(visit(other)).toBeVisible();
  await holdFinanceWrites(page);
  await Promise.all([
    button(page, "START — Rozpocznij pomiar").click(),
    button(other, "START — Rozpocznij pomiar").click(),
  ]);
  await page.evaluate(() => (window as any).releaseFinanceWrite());
  await Promise.all([settled(page), settled(other)]);
  const d = await snapshot(page);
  expect([id, "field-next"]).toContain(d.timer.jobId);
  expect(
    d.jobs.filter(
      (j: any) =>
        [id, "field-next"].includes(j.id) && j.status === "in-progress",
    ),
  ).toHaveLength(1);
  await expect
    .poll(async () =>
      [
        ...(await visit(page).getByRole("alert").allTextContents()),
        ...(await visit(other).getByRole("alert").allTextContents()),
      ].join(" "),
    )
    .toContain("innej karcie");
  expect(await snapshot(other)).toEqual(d);
  await other.close();
});
test("a concurrent activity edit is rejected without overwriting material changes or discarding the local draft", async ({
  page,
  context,
}) => {
  await open(page);
  await button(page, "Dodaj czynność").click();
  await visit(page)
    .getByLabel("Czynność 1", { exact: true })
    .fill("Szkic drugiej karty");
  const other = await context.newPage();
  await other.clock.setFixedTime(fieldClock);
  await other.goto(fieldURL);
  await addActivity(other, "Pierwszy zapis");
  await button(page, "Zapisz czynności").click();
  await expect(visit(page).getByRole("alert")).toContainText("innej karcie");
  await expect(
    visit(page).getByLabel("Czynność 1", { exact: true }),
  ).toHaveValue("Szkic drugiej karty");
  expect(
    (await snapshot(page)).jobs.find((j: any) => j.id === id).activities,
  ).toEqual(["Pierwszy zapis"]);
  await other.close();
});
test("missing, deleted and malformed field targets never crash or recreate jobs", async ({
  page,
}) => {
  await open(page);
  const before = await snapshot(page);
  await changeCanonical(page, { removeJob: "field-next" });
  await page.goto("/#field?field=field-next");
  await expect(visit(page)).toContainText("nie jest już dostępna");
  await page.goto("/#field?field=missing");
  await expect(visit(page)).toContainText("nie jest już dostępna");
  await page.goto("/#field?field=x&section=unknown");
  await expect(
    page.getByRole("alert").filter({ hasText: "Nieprawidłowy adres" }),
  ).toBeVisible();
  const after = await snapshot(page);
  expect(after.jobs).toHaveLength(before.jobs.length - 1);
  expect(after.payments).toEqual(before.payments);
});
for (const width of [320, 360, 390, 430, 1280])
  test(`field controls and all sections fit ${width}px with keyboard focus and readable touch targets`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page);
    for (const name of [
      "Czynności",
      "Zdjęcia",
      "Notatki",
      "Checklisty",
      "Materiały",
    ]) {
      await section(page, name);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(
        await visit(page).evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
      ).toBe(true);
    }
    await button(page, "START — Rozpocznij pomiar").focus();
    await expect(button(page, "START — Rozpocznij pomiar")).toBeFocused();
    const box = await button(page, "START — Rozpocznij pomiar").boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(60);
  });
test.describe("touch field controls", () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });
  test("mobile shortcut, taps and the material form use the same visit without horizontal overflow", async ({
    page,
  }) => {
    await page.goto("/");
    await page
      .getByRole("button", { name: "Otwórz tryb terenowy", exact: true })
      .tap();
    await page
      .getByRole("region", { name: "Zlecenia na dzisiaj" })
      .getByRole("button", { name: /Terenowe koszenie/ })
      .tap();
    await button(page, "START — Rozpocznij pomiar").tap();
    await expect(button(page, "PAUZA")).toBeVisible();
    await section(page, "Materiały");
    await button(page, "Dodaj materiały").tap();
    await visit(page)
      .getByLabel("Nazwa materiału 1", { exact: true })
      .fill("Nawóz");
    expect(
      await visit(page).evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
    ).toBe(true);
  });
});
test("field photo errors and quota do not corrupt the visit, keep the timer and preserve other documentation", async ({
  page,
}) => {
  await open(page);
  await start(page);
  const before = await snapshot(page);
  const chooser = page.waitForEvent("filechooser");
  await button(page, "Zrób zdjęcie").click();
  await (
    await chooser
  ).setFiles({
    name: "broken.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from("broken file"),
  });
  await button(page, "Zapisz zdjęcia").click();
  await expect(visit(page).getByRole("alert").first()).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
  await visit(page)
    .getByLabel("Zdjęcia z urządzenia", { exact: true })
    .setInputFiles("src/reports/fixtures/garden.jpg");
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.add;
    (window as any).restorePhotoPut = () =>
      (IDBObjectStore.prototype.add = put);
    IDBObjectStore.prototype.add = function (...args: any[]) {
      if (this.name === "assets")
        throw new DOMException("Brak miejsca", "QuotaExceededError");
      return put.apply(this, args as any);
    };
  });
  await button(page, "Zapisz zdjęcia").click();
  await expect(visit(page).getByRole("alert").first()).toContainText(
    /miejsce|miejsca|pamię/,
  );
  expect(await snapshot(page)).toEqual(before);
  await page.evaluate(() => (window as any).restorePhotoPut());
  await button(page, "Zapisz zdjęcia").click();
  await expect(
    visit(page).getByText("Zdjęcia zapisane na tym urządzeniu.", {
      exact: true,
    }),
  ).toBeVisible();
  expect((await snapshot(page)).timer).toEqual(before.timer);
});
test("field JSON and full ZIP restore work, notes, checklist, GM-005, availability and actual photo files", async ({
  page,
}) => {
  test.setTimeout(60000);
  await open(page);
  await addActivity(page);
  await addMaterial(page);
  await addNote(page);
  await addPhoto(page);
  const before = await snapshot(page);
  await page.goto("/#field?dialog=settings");
  const settings = page.getByRole("dialog", {
    name: "Ustawienia",
    exact: true,
  });
  const download = async (name: string) => {
    const waiting = page.waitForEvent("download");
    await settings.getByRole("button", { name, exact: true }).click();
    return readFile((await (await waiting).path())!);
  };
  const json = JSON.parse((await download("Eksportuj dane")).toString());
  expect(json.version).toBe(11);
  expect(json.data).toEqual(before);
  const zip = await download("Pobierz pełną kopię ZIP");
  await settings
    .getByLabel("Wczytaj pełną kopię ZIP", { exact: true })
    .setInputFiles({
      name: "wizyta-terenowa.zip",
      mimeType: "application/zip",
      buffer: zip,
    });
  await setChecked(
    settings.getByRole("checkbox", {
      name: "Rozumiem, że bieżący zestaw zostanie zastąpiony.",
      exact: true,
    }),
    true,
  );
  await settings.getByLabel("Wpisz ODTWÓRZ", { exact: true }).fill("ODTWÓRZ");
  await settings
    .getByRole("button", { name: "Odtwórz dane i zdjęcia", exact: true })
    .click();
  await expect(settings).toContainText("Dane i zdjęcia zostały odtworzone");
  await settled(page);
  const after = await snapshot(page);
  for (const key of [
    "jobs",
    "notes",
    "checklists",
    "taskSchedules",
    "taskOccurrences",
    "payments",
    "timer",
    "availability",
  ])
    expect(after[key]).toEqual(before[key]);
  expect(after.photos[0].sha256).toBe(before.photos[0].sha256);
  await page.goto(fieldURL + "&section=photos");
  await expect
    .poll(() =>
      visit(page)
        .getByRole("img", { name: "Stan rabaty w trakcie pracy", exact: true })
        .evaluate((i: HTMLImageElement) => i.naturalWidth),
    )
    .toBeGreaterThan(0);
});
test("an old STOP confirmation in one tab cannot stop a restarted interval in another tab at the same timestamp", async ({
  page,
  context,
}) => {
  await open(page);
  await start(page);
  const old = await snapshot(page),
    other = await context.newPage();
  await other.clock.setFixedTime(fieldClock);
  await other.goto(fieldURL);
  await expect(button(other, "PAUZA")).toBeVisible();
  const waiting = page.waitForEvent("dialog"),
    click = button(page, "STOP").click();
  const confirmation = await waiting;
  await stop(other);
  await start(other);
  const restarted = await snapshot(other);
  expect(restarted.timer).toEqual(old.timer);
  expect(
    restarted.jobs.find((j: any) => j.id === id).timeHistory.at(-1).id,
  ).not.toBe(old.jobs.find((j: any) => j.id === id).timeHistory.at(-1).id);
  await confirmation.accept();
  await click;
  await expect(visit(page).getByRole("alert")).toContainText("innej karcie");
  await settled(page);
  expect((await snapshot(page)).timer).toEqual(restarted.timer);
  expect(
    (await snapshot(page)).jobs.find((j: any) => j.id === id).timeHistory,
  ).toEqual(restarted.jobs.find((j: any) => j.id === id).timeHistory);
  await other.close();
});
test("catalog material selection replaces the untouched blank draft and keeps the purchase/client price separate", async ({
  page,
}) => {
  await open(page);
  await section(page, "Materiały");
  await button(page, "Dodaj materiały").click();
  await visit(page)
    .getByRole("combobox", { name: /^Dodaj z katalogu/ })
    .selectOption("material-final");
  await expect(
    visit(page).getByLabel("Nazwa materiału 1", { exact: true }),
  ).toHaveValue("Kora sosnowa");
  await expect(
    visit(page).getByLabel("Nazwa materiału 2", { exact: true }),
  ).toHaveCount(0);
  await visit(page)
    .getByLabel("Cena materiału 1", { exact: true })
    .fill("3.50");
  await button(page, "Zapisz materiały").click();
  await expect(button(page, "Zapisz materiały")).toBeHidden();
  expect(
    (await snapshot(page)).jobs.find((j: any) => j.id === id).materials[0],
  ).toMatchObject({
    catalogId: "material-final",
    purchaseUnitPrice: 2,
    unitPrice: 3.5,
  });
});
test("an empty field list offers manual creation without writing placeholder records", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const raw = JSON.parse(localStorage.getItem("garden-manager:v1")!);
    raw.data.jobs = [];
    raw.data.payments = [];
    raw.data.taskSchedules = [];
    raw.data.taskOccurrences = [];
    raw.data.checklists = [];
    raw.data.notes = [];
    raw.data.todos = [];
    localStorage.setItem("garden-manager:v1", JSON.stringify(raw));
  });
  await page.goto("/#field");
  await expect(
    page.getByRole("heading", { name: "Rozpocznij od zlecenia", exact: true }),
  ).toBeVisible();
  expect((await snapshot(page)).jobs).toEqual([]);
  await page
    .getByRole("button", { name: "Utwórz zlecenie", exact: true })
    .click();
  expect((await snapshot(page)).jobs).toEqual([]);
  const f = page.getByRole("dialog", { name: "Nowe zlecenie", exact: true });
  await f.getByRole("button", { name: "Anuluj", exact: true }).click();
  expect((await snapshot(page)).jobs).toEqual([]);
});
