import { test as base, expect, type Page } from "@playwright/test";
import {
  planningClock,
  planningNavigationData,
} from "./planning-navigation-fixture";
import { snapshot } from "./atomic-report-helpers";
import { settled } from "./atomic-fixture";
const test = base.extend<{ browserErrors: string[] }>({
  browserErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await use(errors);
      expect(errors).toEqual([]);
    },
    { auto: true },
  ],
});
const calendarURL =
  "/#calendar?date=2026-11-03&view=week&gardenFilter=garden-1&kindFilter=work";
const task = (page: Page) =>
  page.getByRole("dialog", { name: "Szczegóły zadania", exact: true });
const job = (page: Page) =>
  page.getByRole("dialog", { name: "Szczegóły zlecenia", exact: true });
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(planningClock);
  await page.addInitScript((data) => {
    if (!localStorage.getItem("garden-manager:v1"))
      localStorage.setItem(
        "garden-manager:v1",
        JSON.stringify({ version: 9, data }),
      );
  }, planningNavigationData());
});
async function openTask(page: Page) {
  await page.goto(calendarURL);
  await page
    .locator(".calendar-agenda")
    .getByRole("button", { name: "Nawigacyjna pielęgnacja", exact: true })
    .click();
  await expect(task(page)).toBeVisible();
}
/** A barrier made of actual requests: no timing assumption about IndexedDB. */
async function holdWrites(page: Page) {
  await page.evaluate(() => {
    const request = indexedDB.open("garden-manager-state", 1);
    request.onsuccess = () => {
      const db = request.result,
        tx = db.transaction("state", "readwrite"),
        store = tx.objectStore("state");
      let released = false;
      (window as any).releaseNavigationWrite = () => {
        released = true;
      };
      const pump = () => {
        const get = store.get("current");
        get.onsuccess = () => {
          if (!released) pump();
        };
      };
      pump();
      tx.oncomplete = () => db.close();
    };
  });
  await page.waitForFunction(() => !!(window as any).releaseNavigationWrite);
}
async function releaseWrites(page: Page) {
  await page.evaluate(() => (window as any).releaseNavigationWrite());
  await settled(page);
}
async function pending(page: Page) {
  await expect(page.locator("html")).toHaveAttribute("aria-busy", "true");
}
async function calendarContext(page: Page) {
  await expect(page.getByLabel("Przejdź do dnia", { exact: true })).toHaveValue(
    "2026-11-03",
  );
  await expect(
    page.getByRole("button", { name: "Tydzień", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("combobox", { name: "Ogród w kalendarzu", exact: true }),
  ).toHaveValue("garden-1");
}

test("a pending occurrence move blocks Back and Close, then returns to its calendar with one saved exception", async ({
  page,
}) => {
  await openTask(page);
  const before = await snapshot(page),
    address = page.url();
  await task(page)
    .getByRole("button", { name: "Przesuń ten termin", exact: true })
    .click();
  const date = task(page).getByLabel("Nowa data terminu", { exact: true });
  await date.fill("2026-11-04");
  await holdWrites(page);
  await task(page)
    .getByRole("button", { name: "Zapisz przesunięcie", exact: true })
    .click();
  await pending(page);
  await expect(task(page).locator(".task-details")).toHaveAttribute(
    "inert",
    "",
  );
  await task(page)
    .getByRole("button", { name: "Zamknij okno", exact: true })
    .click();
  await expect(task(page)).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(address);
  await expect(date).toHaveValue("2026-11-04");
  await releaseWrites(page);
  await expect(task(page)).toHaveCount(0);
  await calendarContext(page);
  const after = await snapshot(page);
  expect(
    after.taskOccurrences.filter(
      (o: any) =>
        o.scheduleId === "series-navigation" && o.originalDate === "2026-10-31",
    ),
  ).toHaveLength(1);
  expect(
    after.taskOccurrences.find((o: any) => o.originalDate === "2026-10-31")
      .date,
  ).toBe("2026-11-04");
  expect(after.jobs).toEqual(before.jobs);
  expect(after.timer).toEqual(before.timer);
  expect(after.payments).toEqual(before.payments);
  expect(after.reportSequence).toBe(before.reportSequence);
  await page.goForward();
  await expect(task(page)).toContainText("2026-11-04");
  await page.reload();
  await expect(task(page)).toContainText("Termin pierwotny: 2026-10-31");
  expect(await snapshot(page)).toEqual(after);
});

test("a failed atomic move retains its guarded draft and retry commits exactly once", async ({
  page,
}) => {
  await openTask(page);
  const before = await snapshot(page);
  await task(page)
    .getByRole("button", { name: "Przesuń ten termin", exact: true })
    .click();
  const date = task(page).getByLabel("Nowa data terminu", { exact: true });
  await date.fill("2026-11-04");
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (window as any).restoreNavigationPut = () => {
      IDBObjectStore.prototype.put = original;
    };
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === "state" && args[1] === "current")
        throw new DOMException("Brak miejsca w teście", "QuotaExceededError");
      return original.apply(this, args);
    };
  });
  await task(page)
    .getByRole("button", { name: "Zapisz przesunięcie", exact: true })
    .click();
  await expect(task(page).getByRole("alert")).toContainText("Brak miejsca");
  await expect(date).toHaveValue("2026-11-04");
  expect(await snapshot(page)).toEqual(before);
  page.once("dialog", (d) => d.dismiss());
  await task(page)
    .getByRole("button", { name: "Ogród: Ogród przy Lipowej", exact: true })
    .click();
  await expect(date).toHaveValue("2026-11-04");
  await page.evaluate(() => (window as any).restoreNavigationPut());
  await task(page)
    .getByRole("button", { name: "Zapisz przesunięcie", exact: true })
    .click();
  await expect(task(page)).toHaveCount(0);
  const after = await snapshot(page);
  expect(after.taskOccurrences).toHaveLength(before.taskOccurrences.length);
  expect(
    after.taskOccurrences.find((o: any) => o.originalDate === "2026-10-31")
      .date,
  ).toBe("2026-11-04");
});

test("starting a task waits for the committed job ID and returns through task to calendar", async ({
  page,
}) => {
  await openTask(page);
  const before = await snapshot(page),
    address = page.url();
  await holdWrites(page);
  await task(page)
    .getByRole("button", { name: "Rozpocznij pracę", exact: true })
    .click();
  await pending(page);
  await expect(
    task(page).getByRole("button", { name: "Rozpocznij pracę", exact: true }),
  ).toBeDisabled();
  await expect(job(page)).toHaveCount(0);
  await expect(page).toHaveURL(address);
  await page.goBack();
  await expect(page).toHaveURL(address);
  await expect(task(page)).toBeVisible();
  await releaseWrites(page);
  await expect(job(page)).toBeVisible();
  await expect(page).not.toHaveURL(/Promise/);
  const after = await snapshot(page);
  expect(after.jobs).toHaveLength(before.jobs.length + 1);
  expect(after.taskOccurrences).toHaveLength(before.taskOccurrences.length);
  expect(after.payments).toEqual(before.payments);
  expect(after.reportSequence).toBe(before.reportSequence);
  expect(
    after.jobs.find((j: any) => j.id === after.timer.jobId).taskOccurrenceId,
  ).toBe("task:series-navigation:2026-10-31");
  await job(page)
    .getByRole("button", { name: "Wróć do czynności", exact: true })
    .click();
  await expect(task(page)).toBeVisible();
  await task(page)
    .getByRole("button", { name: "Otwórz rzeczywiste zlecenie", exact: true })
    .click();
  await expect(job(page)).toBeVisible();
  expect(await snapshot(page)).toEqual(after);
  await job(page)
    .getByRole("button", { name: "Wróć do czynności", exact: true })
    .click();
  await task(page)
    .getByRole("button", { name: "Wróć do kalendarza", exact: true })
    .click();
  await calendarContext(page);
});

test("a new calendar job remains in its form while pending and opens only after commit", async ({
  page,
}) => {
  await page.goto("/#dashboard");
  await page
    .getByRole("navigation", { name: "Nawigacja główna" })
    .getByRole("button", { name: "Kalendarz", exact: true })
    .click();
  await page.getByLabel("Przejdź do dnia", { exact: true }).fill("2026-11-03");
  await page.getByRole("button", { name: "Tydzień", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Ogród w kalendarzu", exact: true })
    .selectOption("garden-1");
  const before = await snapshot(page),
    address = page.url();
  await page
    .getByRole("button", { name: "+ Nowe zlecenie na ten dzień", exact: true })
    .click();
  const form = page.getByRole("dialog", { name: "Nowe zlecenie", exact: true });
  await form
    .getByLabel("Nazwa pracy", { exact: true })
    .fill("Zlecenie po potwierdzeniu");
  await holdWrites(page);
  await form
    .getByRole("button", { name: "Zapisz zlecenie", exact: true })
    .click();
  await pending(page);
  await expect(form.locator("form")).toHaveAttribute("inert", "");
  await page.goBack();
  await expect(page).toHaveURL(address);
  await expect(form.getByLabel("Nazwa pracy", { exact: true })).toHaveValue(
    "Zlecenie po potwierdzeniu",
  );
  await expect(job(page)).toHaveCount(0);
  await releaseWrites(page);
  await expect(form).toHaveCount(0);
  await expect(job(page)).toContainText("Zlecenie po potwierdzeniu");
  const after = await snapshot(page);
  expect(after.jobs).toHaveLength(before.jobs.length + 1);
  expect(after.timer).toEqual(before.timer);
  expect(after.payments).toEqual(before.payments);
  expect(after.taskOccurrences).toEqual(before.taskOccurrences);
  await job(page)
    .getByRole("button", { name: "Wróć do kalendarza", exact: true })
    .click();
  await calendarContext(page);
  await page.reload();
  await calendarContext(page);
  expect(await snapshot(page)).toEqual(after);
});

test("series termination waits for commit without closing the source series card", async ({
  page,
}) => {
  await page.goto(
    "/#calendar?schedule=series-navigation&date=2026-11-03&view=week",
  );
  const series = page.getByRole("dialog", {
    name: "Harmonogram: Nawigacyjna pielęgnacja",
    exact: true,
  });
  await series
    .getByRole("button", {
      name: "Zakończ serię Nawigacyjna pielęgnacja",
      exact: true,
    })
    .click();
  const form = page.getByRole("dialog", {
    name: "Zakończyć serię?",
    exact: true,
  });
  await form
    .getByLabel("Ostatni dzień serii", { exact: true })
    .fill("2026-11-30");
  const before = await snapshot(page);
  await holdWrites(page);
  await form
    .getByRole("button", { name: "Potwierdź zakończenie serii", exact: true })
    .click();
  await pending(page);
  await expect(form).toBeVisible();
  await expect(form.locator("form")).toHaveAttribute("inert", "");
  await form.getByRole("button", { name: "Zamknij okno", exact: true }).click();
  await expect(form).toBeVisible();
  await releaseWrites(page);
  await expect(form).toHaveCount(0);
  await expect(series).toContainText("Seria zakończona");
  const after = await snapshot(page);
  expect(after.taskSchedules[0].endedOn).toBe("2026-11-30");
  expect(after.jobs).toEqual(before.jobs);
  expect(after.payments).toEqual(before.payments);
  await page.reload();
  await expect(series).toBeVisible();
  expect(await snapshot(page)).toEqual(after);
});
