import { createHash } from "node:crypto";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  availabilityData,
  availabilityClock,
  availabilityDate as day,
  availabilityURL,
} from "./availability-fixture";
import { STORAGE_KEY, STORAGE_VERSION } from "../src/data/repository";
import { snapshot } from "./atomic-report-helpers";
import { settled, setChecked } from "./atomic-fixture";
import { holdFinanceWrites } from "./finance-fixture";
const form = (p: Page) =>
  p.getByRole("dialog", { name: "Dostępność dnia", exact: true });
const batch = (p: Page) =>
  p.getByRole("dialog", { name: "Dostępność wielu dni", exact: true });
const daily = (p: Page) =>
  p.getByRole("region", { name: "Dostępność wybranego dnia", exact: true });
const dateButton = (p: Page, date: string) =>
  p.getByRole("button", { name: `Wybierz dzień ${date}`, exact: true });
async function openDay(p: Page, date = day) {
  await p.goto("/#calendar?availability=" + date);
  await expect(form(p)).toBeVisible();
}
async function save(p: Page, kind = "unavailable", from?: string, to?: string) {
  await form(p)
    .getByRole("combobox", { name: "Rodzaj dostępności", exact: true })
    .selectOption(kind);
  if (from) await form(p).getByLabel("Godzina od", { exact: true }).fill(from);
  if (to) await form(p).getByLabel("Godzina do", { exact: true }).fill(to);
  await form(p)
    .getByRole("button", { name: "Zapisz dostępność", exact: true })
    .click();
  await expect(form(p)).toBeHidden();
  await settled(p);
}
async function choose(p: Page, dates = [day, "2027-04-03", "2027-04-05"]) {
  await p.goto(availabilityURL);
  await p
    .getByRole("button", { name: "Zaznacz wiele dni", exact: true })
    .click();
  for (const date of dates) await dateButton(p, date).click();
  await p
    .getByRole("button", {
      name: `Zaznaczono ${dates.length} dni`,
      exact: true,
    })
    .click();
  await expect(batch(p)).toBeVisible();
}
function unchanged(after: any, before: any) {
  const { availability: _a, ...rest } = after,
    { availability: _b, ...original } = before;
  expect(rest).toEqual(original);
}
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(availabilityClock);
  await page.addInitScript(
    ({ key, data }) => {
      if (!localStorage.getItem(key))
        localStorage.setItem(key, JSON.stringify({ version: 10, data }));
    },
    { key: STORAGE_KEY, data: availabilityData() },
  );
});

test("a whole-day block persists its reason and note across all calendar views, reload and reopening without business writes", async ({
  page,
  context,
}) => {
  await page.goto(availabilityURL);
  const before = await snapshot(page);
  await daily(page)
    .getByRole("button", { name: "Ustaw dostępność", exact: true })
    .click();
  await form(page)
    .getByRole("combobox", { name: "Rodzaj dostępności", exact: true })
    .selectOption("unavailable");
  await form(page)
    .getByRole("combobox", { name: "Powód (opcjonalnie)", exact: true })
    .selectOption("pawnshop");
  await form(page)
    .getByRole("textbox", { name: "Notatka dostępności", exact: true })
    .fill("Zmiana 8:15–20:45");
  await form(page)
    .getByRole("button", { name: "Zapisz dostępność", exact: true })
    .click();
  await expect(form(page)).toBeHidden();
  await expect(daily(page)).toContainText("Niedostępny");
  await expect(daily(page)).toContainText("Lombard");
  await expect(daily(page)).toContainText("Zmiana 8:15–20:45");
  for (const name of ["Tydzień", "Dzień", "Miesiąc"]) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(daily(page)).toContainText("Niedostępny");
  }
  await page.reload();
  await expect(daily(page)).toContainText("Lombard");
  const other = await context.newPage();
  await other.goto("/#calendar?date=" + day + "&view=day");
  await expect(daily(other)).toContainText("Lombard");
  await other.close();
  const after = await snapshot(page);
  expect(after.availability).toHaveLength(1);
  unchanged(after, before);
});
for (const c of [
  { kind: "until", to: "14:00", label: "Dostępny do 14:00" },
  { kind: "from", from: "14:00", label: "Dostępny od 14:00" },
  { kind: "range", from: "08:15", to: "20:45", label: "Dostępny 08:15–20:45" },
])
  test(`partial availability ${c.kind} uses only its necessary fields and saves exact hours`, async ({
    page,
  }) => {
    await openDay(page);
    await form(page)
      .getByRole("combobox", { name: "Rodzaj dostępności", exact: true })
      .selectOption(c.kind);
    await expect(
      form(page).getByLabel("Godzina od", { exact: true }),
    ).toHaveCount(c.from ? 1 : 0);
    await expect(
      form(page).getByLabel("Godzina do", { exact: true }),
    ).toHaveCount(c.to ? 1 : 0);
    await save(page, c.kind, c.from, c.to);
    await expect(daily(page)).toContainText(c.label);
  });
test("invalid or inverted hours are rejected without writing any data", async ({
  page,
}) => {
  await openDay(page);
  const before = await snapshot(page);
  await form(page)
    .getByRole("combobox", { name: "Rodzaj dostępności", exact: true })
    .selectOption("range");
  await form(page).getByLabel("Godzina od", { exact: true }).fill("16:00");
  await form(page).getByLabel("Godzina do", { exact: true }).fill("08:00");
  await form(page)
    .getByRole("button", { name: "Zapisz dostępność", exact: true })
    .click();
  await expect(form(page).getByRole("alert")).toContainText(
    "Godzina od musi poprzedzać",
  );
  expect(await snapshot(page)).toEqual(before);
});
test("multi-select toggles one date once, saves a batch atomically and removes it with explicit confirmation", async ({
  page,
}) => {
  await page.goto(availabilityURL);
  const before = await snapshot(page);
  await page
    .getByRole("button", { name: "Zaznacz wiele dni", exact: true })
    .click();
  for (const date of [day, "2027-04-03", "2027-04-05"])
    await dateButton(page, date).click();
  await dateButton(page, "2027-04-03").click();
  await expect(
    page.getByRole("button", { name: "Zaznaczono 2 dni", exact: true }),
  ).toBeEnabled();
  await dateButton(page, "2027-04-03").click();
  await page
    .getByRole("button", { name: "Zaznaczono 3 dni", exact: true })
    .click();
  await batch(page)
    .getByRole("combobox", { name: "Powód (opcjonalnie)", exact: true })
    .selectOption("pawnshop");
  await batch(page)
    .getByRole("button", { name: "Zapisz dostępność", exact: true })
    .click();
  await expect(batch(page)).toBeHidden();
  await settled(page);
  expect((await snapshot(page)).availability).toHaveLength(3);
  unchanged(await snapshot(page), before);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Zaznaczono 3 dni", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Zaznaczono 3 dni", exact: true })
    .click();
  await batch(page)
    .getByRole("button", {
      name: "Usuń ograniczenia zaznaczonych dni",
      exact: true,
    })
    .click();
  expect((await snapshot(page)).availability).toHaveLength(3);
  await batch(page)
    .getByRole("button", {
      name: "Potwierdź usunięcie ograniczeń",
      exact: true,
    })
    .click();
  await expect(batch(page)).toBeHidden();
  expect((await snapshot(page)).availability).toEqual([]);
  await page
    .getByRole("button", { name: "Zakończ zaznaczanie dni", exact: true })
    .click();
  await page
    .locator(".calendar-agenda")
    .getByRole("button", { name: "Nawożenie GM-005", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Szczegóły zadania", exact: true }),
  ).toBeVisible();
});
test("mass overwrite previews existing settings and cancellation preserves the individual rule", async ({
  page,
}) => {
  await openDay(page);
  await save(page, "until", undefined, "14:00");
  const before = await snapshot(page);
  await choose(page);
  await batch(page)
    .getByRole("button", { name: "Zapisz dostępność", exact: true })
    .click();
  await expect(
    batch(page).getByRole("group", {
      name: "Potwierdzenie nadpisania dostępności",
      exact: true,
    }),
  ).toContainText("1 dnia");
  expect(await snapshot(page)).toEqual(before);
  await batch(page)
    .getByRole("button", { name: "Anuluj potwierdzenie", exact: true })
    .click();
  await expect(batch(page)).toBeVisible();
  await batch(page)
    .getByRole("button", { name: "Zapisz dostępność", exact: true })
    .click();
  await batch(page)
    .getByRole("button", { name: "Potwierdź nadpisanie dni", exact: true })
    .click();
  await expect(batch(page)).toBeHidden();
  expect(
    (await snapshot(page)).availability.every(
      (d: any) => d.kind === "unavailable",
    ),
  ).toBe(true);
});
test("existing planned jobs and GM-005 remain in place and conflicts open their real cards", async ({
  page,
}) => {
  await openDay(page);
  const before = await snapshot(page);
  await save(page);
  await expect(daily(page)).toContainText("Kolizje dostępności: 2");
  await daily(page)
    .getByRole("button", { name: "09:00 · Zaplanowane koszenie", exact: true })
    .click();
  const job = page.getByRole("dialog", {
    name: "Szczegóły zlecenia",
    exact: true,
  });
  await expect(job).toContainText("Termin koliduje");
  await page.goBack();
  await daily(page)
    .getByRole("button", { name: "09:00 · Nawożenie GM-005", exact: true })
    .click();
  const task = page.getByRole("dialog", {
    name: "Szczegóły zadania",
    exact: true,
  });
  await expect(task).toContainText("Termin koliduje");
  const current = await snapshot(page);
  expect(current.taskSchedules).toEqual(before.taskSchedules);
  expect(current.taskOccurrences).toEqual(before.taskOccurrences);
  expect(current.jobs).toEqual(before.jobs);
  expect(current.timer).toEqual(before.timer);
  await task
    .getByRole("button", { name: "Potwierdź wykonanie zabiegu", exact: true })
    .click();
  await task
    .getByLabel("Faktyczna data wykonania", { exact: true })
    .fill("2027-04-08");
  await task
    .getByRole("button", { name: "Zapisz wykonanie zabiegu", exact: true })
    .click();
  await expect(
    task.getByRole("region", { name: "Historia zabiegów" }),
  ).toContainText("2027-05-08");
});
test("new job warns, allows changing the date and accepts an explicit exception without starting time", async ({
  page,
}) => {
  await openDay(page);
  await save(page);
  const before = await snapshot(page);
  await page
    .getByRole("button", { name: "+ Nowe zlecenie na ten dzień", exact: true })
    .click();
  const job = page.getByRole("dialog", { name: "Nowe zlecenie", exact: true });
  await job
    .getByLabel("Nazwa pracy", { exact: true })
    .fill("Wyjątek w grafiku");
  await job
    .getByRole("button", { name: "Zapisz zlecenie", exact: true })
    .click();
  await expect(
    job.getByRole("group", {
      name: "Potwierdzenie kolizji dostępności",
      exact: true,
    }),
  ).toBeVisible();
  expect((await snapshot(page)).jobs).toEqual(before.jobs);
  await job.getByRole("button", { name: "Zmień termin", exact: true }).click();
  await expect(job.getByLabel("Data", { exact: true })).toBeFocused();
  await job
    .getByRole("button", { name: "Zapisz zlecenie", exact: true })
    .click();
  await job
    .getByRole("button", { name: "Zaplanuj mimo wszystko", exact: true })
    .click();
  await expect(job).toBeHidden();
  await settled(page);
  const after = await snapshot(page);
  expect(after.jobs).toHaveLength(before.jobs.length + 1);
  expect(after.jobs.at(-1)).toMatchObject({
    title: "Wyjątek w grafiku",
    date: day,
    status: "planned",
    seconds: 0,
  });
  expect(after.timer).toEqual(before.timer);
  expect(after.payments).toEqual(before.payments);
});
test("partial availability accepts a start before the limit without estimating a duration", async ({
  page,
}) => {
  await openDay(page);
  await save(page, "until", undefined, "14:00");
  await page
    .getByRole("button", { name: "+ Nowe zlecenie na ten dzień", exact: true })
    .click();
  const job = page.getByRole("dialog", { name: "Nowe zlecenie", exact: true });
  await job
    .getByLabel("Nazwa pracy", { exact: true })
    .fill("Praca przed granicą");
  await job.getByLabel("Godzina", { exact: true }).fill("13:59");
  await job
    .getByRole("button", { name: "Zapisz zlecenie", exact: true })
    .click();
  await expect(job).toBeHidden();
  expect((await snapshot(page)).jobs.at(-1).time).toBe("13:59");
});
test("nearest available days exclude whole blocks, include partial windows and disclose existing work", async ({
  page,
}) => {
  await openDay(page, "2027-06-20");
  await save(page);
  await openDay(page, "2027-06-21");
  await save(page, "from", "14:00");
  await page.goto("/#calendar?date=2027-06-20&view=month");
  const nearest = page.getByRole("region", {
    name: "Najbliższe dostępne terminy",
    exact: true,
  });
  await expect(nearest.getByRole("button")).toHaveCount(7);
  await expect(nearest.getByRole("button", { name: /2027-06-20/ })).toHaveCount(
    0,
  );
  await nearest
    .getByRole("button", { name: /2027-06-21.*Dostępny od 14:00/ })
    .click();
  await expect(page).toHaveURL(/date=2027-06-21&view=day/);
  await expect(daily(page)).toContainText("Dostępny od 14:00");
});
test("availability form protects dirty changes, native Back/Forward and refresh retain calendar filters and selection", async ({
  page,
}) => {
  await page.goto(availabilityURL);
  await daily(page)
    .getByRole("button", { name: "Ustaw dostępność", exact: true })
    .click();
  await form(page)
    .getByRole("textbox", { name: "Notatka dostępności", exact: true })
    .fill("Niezapisany szkic");
  page.once("dialog", (d) => d.dismiss());
  await page.goBack();
  await expect(
    form(page).getByRole("textbox", {
      name: "Notatka dostępności",
      exact: true,
    }),
  ).toHaveValue("Niezapisany szkic");
  await form(page)
    .getByRole("button", { name: "Zapisz dostępność", exact: true })
    .click();
  await expect(form(page)).toBeHidden();
  await expect(page).toHaveURL(
    /view=month.*gardenFilter=garden-1.*kindFilter=work/,
  );
  await page.goForward();
  await expect(
    form(page).getByRole("textbox", {
      name: "Notatka dostępności",
      exact: true,
    }),
  ).toHaveValue("Niezapisany szkic");
  await page.reload();
  await expect(form(page)).toBeVisible();
  await form(page)
    .getByRole("button", { name: "Wróć do kalendarza", exact: true })
    .click();
  await expect(dateButton(page, day)).toHaveAttribute("aria-pressed", "true");
});
test("quota failure preserves the full batch, current records and draft for retry", async ({
  page,
}) => {
  await choose(page);
  const before = await snapshot(page);
  await batch(page)
    .getByRole("textbox", { name: "Notatka dostępności", exact: true })
    .fill("Szkic po błędzie");
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    let once = true;
    IDBObjectStore.prototype.put = function (
      ...args: Parameters<IDBObjectStore["put"]>
    ) {
      if (once && this.name === "state") {
        once = false;
        throw new DOMException("Disk full", "QuotaExceededError");
      }
      return put.apply(this, args);
    };
  });
  await batch(page)
    .getByRole("button", { name: "Zapisz dostępność", exact: true })
    .click();
  await expect(batch(page).getByRole("alert")).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
  await expect(
    batch(page).getByRole("textbox", {
      name: "Notatka dostępności",
      exact: true,
    }),
  ).toHaveValue("Szkic po błędzie");
  await batch(page)
    .getByRole("button", { name: "Zapisz dostępność", exact: true })
    .click();
  await expect(batch(page)).toBeHidden();
  expect((await snapshot(page)).availability).toHaveLength(3);
});
test("a pending bulk save blocks Back and commits once after the authoritative lock is released", async ({
  page,
}) => {
  await choose(page);
  await holdFinanceWrites(page);
  await batch(page)
    .getByRole("button", { name: "Zapisz dostępność", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("aria-busy", "true");
  await page.goBack();
  await expect(batch(page)).toBeVisible();
  await page.evaluate(() => (window as any).releaseFinanceWrite());
  await settled(page);
  await expect(batch(page)).toBeHidden();
  expect((await snapshot(page)).availability).toHaveLength(3);
});
for (const same of [false, true])
  test(`two tabs edit ${same ? "the same date with conflict protection" : "different dates without lost updates"}`, async ({
    page,
    context,
  }) => {
    await openDay(page);
    const other = await context.newPage();
    await other.clock.setFixedTime(availabilityClock);
    await other.goto("/#calendar?availability=" + (same ? day : "2027-04-02"));
    await expect(form(other)).toBeVisible();
    for (const [p, note] of [
      [page, "Pierwsza karta"],
      [other, "Druga karta"],
    ] as const) {
      await form(p)
        .getByRole("combobox", { name: "Rodzaj dostępności", exact: true })
        .selectOption("unavailable");
      await form(p)
        .getByRole("textbox", { name: "Notatka dostępności", exact: true })
        .fill(note);
    }
    await holdFinanceWrites(page);
    await Promise.all([
      form(page)
        .getByRole("button", { name: "Zapisz dostępność", exact: true })
        .click(),
      form(other)
        .getByRole("button", { name: "Zapisz dostępność", exact: true })
        .click(),
    ]);
    await expect(page.locator("html")).toHaveAttribute("aria-busy", "true");
    await expect(other.locator("html")).toHaveAttribute("aria-busy", "true");
    await page.evaluate(() => (window as any).releaseFinanceWrite());
    await Promise.all([settled(page), settled(other)]);
    if (same) {
      await expect
        .poll(
          async () => (await form(page).count()) + (await form(other).count()),
        )
        .toBe(1);
      const loser = (await form(page).count()) ? page : other;
      await expect(form(loser).getByRole("alert")).toContainText(
        "innej karcie",
      );
      expect((await snapshot(page)).availability).toHaveLength(1);
    } else {
      await expect(form(page)).toBeHidden();
      await expect(form(other)).toBeHidden();
      expect((await snapshot(page)).availability).toHaveLength(2);
    }
    await other.close();
  });
test("malformed availability addresses are safe and do not create data", async ({
  page,
}) => {
  await page.goto("/#calendar?availability=2027-02-30");
  await page.locator(".app-shell").waitFor();
  await expect(form(page)).toHaveCount(0);
  expect((await snapshot(page)).availability).toBeUndefined();
});
for (const width of [320, 360, 390, 430, 1280])
  test(`availability, touch selection and seasonal calendar remain usable at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(availabilityURL);
    await page
      .getByRole("button", { name: "Zaznacz wiele dni", exact: true })
      .click();
    await dateButton(page, day).click();
    await dateButton(page, "2027-04-03").click();
    await expect(
      page.getByRole("button", { name: "Zaznaczono 2 dni", exact: true }),
    ).toBeEnabled();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page
      .getByRole("button", { name: "Zaznaczono 2 dni", exact: true })
      .click();
    await batch(page)
      .getByRole("combobox", { name: "Rodzaj dostępności", exact: true })
      .selectOption("range");
    await batch(page).getByLabel("Godzina od", { exact: true }).fill("08:15");
    await batch(page).getByLabel("Godzina do", { exact: true }).fill("20:45");
    expect(
      await batch(page).evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
    ).toBe(true);
    await batch(page)
      .getByRole("button", { name: "Zapisz dostępność", exact: true })
      .click();
    await expect(batch(page)).toBeHidden();
    expect((await snapshot(page)).availability).toHaveLength(2);
  });

test("native v10 without availability stays byte-equivalent on bootstrap and persists the optional extension in IndexedDB", async ({
  page,
}) => {
  await page.route("**/__availability_probe", (r) =>
    r.fulfill({ contentType: "text/html", body: "<!doctype html>" }),
  );
  await page.goto("/__availability_probe");
  const data = availabilityData();
  await page.evaluate(async (data) => {
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.open("garden-manager-state", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("state");
      r.onerror = () => reject(r.error);
      r.onsuccess = () => {
        const db = r.result,
          tx = db.transaction("state", "readwrite");
        tx.objectStore("state").put(
          { formatVersion: 10, revision: 47, data },
          "current",
        );
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
      };
    });
    localStorage.setItem("garden-manager:v1", "corrupt mirror");
  }, data);
  await page.goto("/#calendar?date=" + day + "&view=day");
  await page.locator(".app-shell").waitFor();
  expect(await snapshot(page)).toEqual(data);
  const meta = await page.evaluate(
    () =>
      new Promise<any>((resolve) => {
        const r = indexedDB.open("garden-manager-state", 1);
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction("state", "readonly"),
            store = tx.objectStore("state"),
            current = store.get("current"),
            keys = store.getAllKeys();
          tx.oncomplete = () => {
            db.close();
            resolve({ current: current.result, keys: keys.result });
          };
        };
      }),
  );
  expect(meta.current).toEqual({ formatVersion: 10, revision: 47, data });
  expect(meta.keys).toEqual(["current"]);
  await daily(page)
    .getByRole("button", { name: "Ustaw dostępność", exact: true })
    .click();
  await save(page);
  const after = await snapshot(page);
  unchanged(after, data);
  await page.reload();
  expect(await snapshot(page)).toEqual(after);
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("garden-manager:v1")!).version,
    ),
  ).toBe(10);
});
test("full ZIP and JSON preserve availability, care history and a real photo; restoring an older v10 backup uses default availability", async ({
  page,
}) => {
  await openDay(page);
  await save(page, "range", "08:15", "20:45");
  await page.goto("/#jobs?job=job-1&section=photos");
  const gallery = page.getByRole("region", {
    name: "Galeria zlecenia i wizyty",
    exact: true,
  });
  await gallery
    .getByRole("button", { name: "Dodaj zdjęcia", exact: true })
    .click();
  const bytes = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 30;
    c.height = 20;
    c.getContext("2d")!.fillRect(0, 0, 30, 20);
    return Array.from(
      new Uint8Array(
        await (
          await new Promise<Blob>((r) => c.toBlob((b) => r(b!), "image/png"))
        ).arrayBuffer(),
      ),
    );
  });
  await gallery
    .getByLabel("Zdjęcia z urządzenia", { exact: true })
    .setInputFiles({
      name: "grafik-ogrodu.png",
      mimeType: "image/png",
      buffer: Buffer.from(bytes),
    });
  await gallery
    .getByRole("button", { name: "Zapisz zdjęcia", exact: true })
    .click();
  await expect(gallery.locator(".photo-card")).toHaveCount(1);
  await settled(page);
  const before = await snapshot(page);
  await page.goto("/#dashboard?dialog=settings");
  const settings = page.getByRole("dialog", {
    name: "Ustawienia",
    exact: true,
  });
  const get = async (label: string) => {
    const waiting = page.waitForEvent("download");
    await settings.getByRole("button", { name: label, exact: true }).click();
    return readFile((await (await waiting).path())!);
  };
  const json = JSON.parse((await get("Eksportuj dane")).toString());
  expect(json.version).toBe(STORAGE_VERSION);
  expect(json.data.availability).toEqual(before.availability);
  const zip = await get("Pobierz pełną kopię ZIP");
  await settings
    .getByLabel("Wczytaj pełną kopię ZIP", { exact: true })
    .setInputFiles({
      name: "dostepnosc.zip",
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
  const after = await snapshot(page);
  for (const key of [
    "availability",
    "jobs",
    "taskSchedules",
    "taskOccurrences",
    "payments",
    "timer",
  ])
    expect(after[key]).toEqual(before[key]);
  await page.goto("/#jobs?job=job-1&section=photos");
  await expect
    .poll(() =>
      gallery
        .locator("img")
        .first()
        .evaluate((i: HTMLImageElement) => i.naturalWidth),
    )
    .toBeGreaterThan(0);
  await page.goto("/#dashboard?dialog=settings");
  await settings
    .getByRole("button", { name: "Usuń punkt odzyskiwania", exact: true })
    .click();
  await settings
    .getByRole("button", { name: "Potwierdź usunięcie punktu", exact: true })
    .click();
  await expect(
    settings.getByRole("button", {
      name: "Pobierz punkt odzyskiwania ZIP",
      exact: true,
    }),
  ).toHaveCount(0);
  const files = unzipSync(zip),
    envelope = JSON.parse(strFromU8(files["data.json"]));
  delete envelope.data.availability;
  files["data.json"] = strToU8(JSON.stringify(envelope));
  const manifest = JSON.parse(strFromU8(files["manifest.json"]));
  manifest.dataSha256 = createHash("sha256")
    .update(files["data.json"])
    .digest("hex");
  files["manifest.json"] = strToU8(JSON.stringify(manifest));
  await settings
    .getByLabel("Wczytaj pełną kopię ZIP", { exact: true })
    .setInputFiles({
      name: "starszy-v10.zip",
      mimeType: "application/zip",
      buffer: Buffer.from(zipSync(files)),
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
  const legacy = await snapshot(page);
  expect(legacy.availability).toBeUndefined();
  for (const key of [
    "jobs",
    "taskSchedules",
    "taskOccurrences",
    "payments",
    "timer",
  ])
    expect(legacy[key]).toEqual(before[key]);
  expect(legacy.photos[0].sha256).toBe(before.photos[0].sha256);
});

test.describe("touch availability controls", () => {
  test.use({ hasTouch: true });
  test("phone taps select several dates and save one batch", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 844 });
    await page.goto(availabilityURL);
    await page
      .getByRole("button", { name: "Zaznacz wiele dni", exact: true })
      .tap();
    await dateButton(page, day).tap();
    await dateButton(page, "2027-04-03").tap();
    await page
      .getByRole("button", { name: "Zaznaczono 2 dni", exact: true })
      .tap();
    await batch(page)
      .getByRole("button", { name: "Zapisz dostępność", exact: true })
      .tap();
    await expect(batch(page)).toBeHidden();
    expect((await snapshot(page)).availability).toHaveLength(2);
  });
});

test("a restriction committed by another tab while a job waits is checked before any job is created", async ({
  page,
  context,
}) => {
  await page.goto("/#calendar?date=" + day + "&view=day");
  const before = await snapshot(page);
  await page
    .getByRole("button", { name: "+ Nowe zlecenie na ten dzień", exact: true })
    .click();
  const job = page.getByRole("dialog", { name: "Nowe zlecenie", exact: true });
  await job
    .getByLabel("Nazwa pracy", { exact: true })
    .fill("Nowy termin po zmianie grafiku");
  const other = await context.newPage();
  await other.clock.setFixedTime(availabilityClock);
  await other.goto("/#calendar?availability=" + day);
  await form(other)
    .getByRole("combobox", { name: "Rodzaj dostępności", exact: true })
    .selectOption("unavailable");
  await holdFinanceWrites(page);
  await form(other)
    .getByRole("button", { name: "Zapisz dostępność", exact: true })
    .click();
  await expect(other.locator("html")).toHaveAttribute("aria-busy", "true");
  await job
    .getByRole("button", { name: "Zapisz zlecenie", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("aria-busy", "true");
  await page.evaluate(() => (window as any).releaseFinanceWrite());
  await Promise.all([settled(page), settled(other)]);
  await expect(
    job.getByRole("alert").filter({ hasText: "aktualną dostępnością" }),
  ).toBeVisible();
  expect((await snapshot(page)).jobs).toEqual(before.jobs);
  await expect(job.getByLabel("Nazwa pracy", { exact: true })).toHaveValue(
    "Nowy termin po zmianie grafiku",
  );
  await job
    .getByRole("button", { name: "Zapisz zlecenie", exact: true })
    .click();
  await job
    .getByRole("button", { name: "Zaplanuj mimo wszystko", exact: true })
    .click();
  await expect(job).toBeHidden();
  expect((await snapshot(page)).jobs).toHaveLength(before.jobs.length + 1);
  await other.close();
});
