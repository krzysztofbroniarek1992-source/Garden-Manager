import { test, expect, type Page } from "@playwright/test";
import { documentationClock, documentationData } from "./documentation-fixture";
import { STORAGE_KEY, STORAGE_VERSION } from "../src/data/repository";
import { snapshot } from "./atomic-report-helpers";
import { settled } from "./atomic-fixture";
const note = (p: Page) =>
  p.getByRole("dialog", { name: "Szczegóły notatki", exact: true });
const garden = (p: Page) =>
  p.getByRole("dialog", {
    name: "Karta ogrodu: Ogród przy Lipowej",
    exact: true,
  });
const job = (p: Page) =>
  p.getByRole("dialog", { name: "Szczegóły zlecenia", exact: true });
const photo = (p: Page) =>
  p.getByRole("dialog", { name: "Podgląd zdjęcia", exact: true });
const report = (p: Page) =>
  p.getByRole("dialog", { name: "Raport PDF dla klienta", exact: true });
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(documentationClock);
  await page.addInitScript(
    ({ key, version, data }) => {
      if (!localStorage.getItem(key))
        localStorage.setItem(key, JSON.stringify({ version, data }));
    },
    { key: STORAGE_KEY, version: STORAGE_VERSION, data: documentationData() },
  );
});
async function upload(p: Page) {
  await p.goto("/#jobs?job=job-1&section=photos");
  await job(p)
    .getByRole("button", { name: "Dodaj zdjęcia", exact: true })
    .click();
  // A real PNG goes through the existing resize + thumbnail + IndexedDB pipeline.
  const png = await p.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 120;
    c.height = 80;
    c.getContext("2d")!.fillRect(0, 0, 120, 80);
    return Array.from(
      new Uint8Array(
        await (
          await new Promise<Blob>((r) => c.toBlob((b) => r(b!), "image/png"))
        ).arrayBuffer(),
      ),
    );
  });
  await job(p)
    .getByLabel("Zdjęcia z urządzenia", { exact: true })
    .setInputFiles({
      name: "dokumentacja.png",
      mimeType: "image/png",
      buffer: Buffer.from(png),
    });
  await job(p)
    .getByRole("combobox", { name: "Kategoria zdjęcia", exact: true })
    .selectOption("before");
  await job(p)
    .getByRole("button", { name: "Zapisz zdjęcia", exact: true })
    .click();
  await expect(job(p).locator(".photo-card img")).toBeVisible();
  await settled(p);
  return (await snapshot(p)).photos[0].id as string;
}
test("note → zone → job preserves filters, browser history and data across reload", async ({
  page,
}) => {
  await page.goto("/#notes");
  await page.getByLabel("Szukaj notatek", { exact: true }).fill("Obserwacja");
  await page
    .getByRole("button", { name: "Obserwacja dokumentacji", exact: true })
    .click();
  const before = await snapshot(page);
  await expect(page).toHaveURL(/note=note-doc/);
  await note(page)
    .getByRole("button", { name: "Strefa: Rabata dokumentacji", exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog", { name: "Strefa: Rabata dokumentacji", exact: true })
      .getByRole("tab", { name: "Notatki", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.goBack();
  await expect(note(page)).toBeVisible();
  await note(page)
    .getByRole("button", { name: "Zlecenie: Wizyta dokumentacji", exact: true })
    .click();
  await expect(page).toHaveURL(/job=job-1&section=notes/);
  await job(page)
    .getByRole("button", { name: "Wróć do notatki", exact: true })
    .click();
  await expect(note(page)).toBeVisible();
  await page.reload();
  await expect(note(page)).toBeVisible();
  await page.goBack();
  await expect(page.getByLabel("Szukaj notatek", { exact: true })).toHaveValue(
    "Obserwacja",
  );
  await page.goForward();
  await expect(note(page)).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
});
test("garden gallery → photo → job and Back/Forward retain gallery filters and direct address", async ({
  page,
  context,
}) => {
  const id = await upload(page);
  await page.goto("/#gardens?garden=garden-1&section=gallery");
  await garden(page)
    .getByLabel("Filtr kategorii zdjęć", { exact: true })
    .selectOption("before");
  await garden(page)
    .getByLabel("Kolejność zdjęć", { exact: true })
    .selectOption("oldest");
  await garden(page)
    .getByRole("button", {
      name: "Powiększ zdjęcie dokumentacja.png",
      exact: true,
    })
    .click();
  const before = await snapshot(page),
    address = page.url();
  await expect(page).toHaveURL(new RegExp(`photo=${id}`));
  await photo(page)
    .getByRole("button", { name: "Zlecenie: Wizyta dokumentacji", exact: true })
    .click();
  await expect(page).toHaveURL(/section=photos/);
  await page.goBack();
  await expect(photo(page).locator("img")).toBeVisible();
  await page.goBack();
  await expect(
    garden(page).getByLabel("Filtr kategorii zdjęć", { exact: true }),
  ).toHaveValue("before");
  await expect(
    garden(page).getByLabel("Kolejność zdjęć", { exact: true }),
  ).toHaveValue("oldest");
  await page.goForward();
  await expect(photo(page)).toBeVisible();
  await page.reload();
  await expect(photo(page).locator("img")).toBeVisible();
  const reopened = await context.newPage();
  await reopened.goto(address);
  await expect(photo(reopened).locator("img")).toBeVisible();
  await reopened.close();
  expect(await snapshot(page)).toEqual(before);
});
test("visit checklist opens its source garden plan with real scope links and returns to the visit", async ({
  page,
}) => {
  await page.goto("/#jobs?job=job-1&section=checklists");
  await job(page)
    .getByRole("button", { name: "Plan dokumentacji", exact: true })
    .click();
  const checklist = page.getByRole("dialog", {
    name: "Checklista: Plan dokumentacji",
    exact: true,
  });
  const before = await snapshot(page);
  await expect(page).toHaveURL(/checklist=checklist-doc/);
  await checklist
    .getByRole("button", { name: "Otwórz źródłowy plan", exact: true })
    .click();
  await expect(page).toHaveURL(/checklist=plan-doc/);
  await expect(
    checklist.getByRole("button", {
      name: "Strefa: Rabata dokumentacji",
      exact: true,
    }),
  ).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/checklist=checklist-doc/);
  await checklist
    .getByRole("button", { name: "Zlecenie: Wizyta dokumentacji", exact: true })
    .click();
  await expect(job(page)).toBeVisible();
  await expect(page).toHaveURL(/section=checklists/);
  await page.reload();
  await expect(job(page)).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
});
test("saved report address shows its immutable version and returns to the correct visit summary without allocation", async ({
  page,
}) => {
  await page.goto("/#jobs?job=job-1");
  await job(page)
    .getByRole("button", { name: "Raporty wizyty (1)", exact: true })
    .click();
  await report(page)
    .getByRole("button", { name: "Podgląd wersji 1", exact: true })
    .click();
  const before = await snapshot(page);
  await expect(page).toHaveURL(/report=job-1&reportVersion=report-doc/);
  await expect(
    report(page).getByRole("article", {
      name: "Treść raportu dla klienta",
      exact: true,
    }),
  ).toContainText("BO/2026/000001");
  await report(page)
    .getByRole("button", { name: "Zlecenie: Wizyta dokumentacji", exact: true })
    .click();
  await expect(page).toHaveURL(/job=job-1&section=summary/);
  const summary = page.getByRole("dialog", {
    name: "Podsumowanie wizyty",
    exact: true,
  });
  await expect(summary).toBeVisible();
  await page.reload();
  await expect(summary).toBeVisible();
  await summary
    .getByRole("button", { name: "Generuj raport PDF", exact: true })
    .click();
  await report(page)
    .getByRole("button", { name: "Podgląd wersji 1", exact: true })
    .click();
  await page.reload();
  await expect(report(page)).toContainText(
    "Zapisana historyczna wersja raportu.",
  );
  expect(await snapshot(page)).toEqual(before);
});
test("missing/deleted documentation and a report belonging to another job fail safely without mutations", async ({
  page,
}) => {
  await page.goto("/#notes");
  const before = await snapshot(page);
  for (const hash of [
    "#notes?note=missing",
    "#gardens?photo=missing",
    "#templates?checklist=missing",
    "#jobs?report=missing",
    "#jobs?report=job-2&reportVersion=report-doc",
  ]) {
    await page.goto("/" + hash);
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog")).toContainText(
      /usunięt|niedostępn|dostępn|istnieje/i,
    );
    expect(await snapshot(page)).toEqual(before);
  }
});
test("unsaved note is protected on Back/Close and a pending atomic save keeps the draft until commit", async ({
  page,
}) => {
  await page.goto("/#notes");
  await page
    .getByRole("button", { name: "Obserwacja dokumentacji", exact: true })
    .click();
  await note(page)
    .getByRole("button", { name: "Edytuj notatkę", exact: true })
    .click();
  const form = page.getByRole("dialog", {
    name: "Edytuj notatkę",
    exact: true,
  });
  await form
    .getByLabel("Treść notatki", { exact: true })
    .fill("Chroniona zmiana po wizycie");
  const address = page.url();
  page.once("dialog", (d) => d.dismiss());
  await page.goBack();
  await expect(page).toHaveURL(address);
  page.once("dialog", (d) => d.dismiss());
  await form.getByRole("button", { name: "Zamknij okno", exact: true }).click();
  await expect(form.getByLabel("Treść notatki", { exact: true })).toHaveValue(
    "Chroniona zmiana po wizycie",
  );
  const before = await snapshot(page);
  await page.evaluate(() => {
    const request = indexedDB.open("garden-manager-state", 1);
    request.onsuccess = () => {
      const db = request.result,
        tx = db.transaction("state", "readwrite"),
        store = tx.objectStore("state");
      let released = false;
      (window as any).releaseDocWrite = () => {
        released = true;
      };
      const pump = () => {
        store.get("current").onsuccess = () => {
          if (!released) pump();
        };
      };
      pump();
      tx.oncomplete = () => db.close();
    };
  });
  await page.waitForFunction(() => !!(window as any).releaseDocWrite);
  await form
    .getByRole("button", { name: "Zapisz notatkę", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("aria-busy", "true");
  await expect(form.locator("form")).toHaveAttribute("inert", "");
  await page.goBack();
  await expect(page).toHaveURL(address);
  await expect(form).toBeVisible();
  await page.evaluate(() => (window as any).releaseDocWrite());
  await settled(page);
  await expect(note(page)).toContainText("Chroniona zmiana po wizycie");
  const after = await snapshot(page);
  expect(after.jobs).toEqual(before.jobs);
  expect(after.payments).toEqual(before.payments);
  expect(after.timer).toEqual(before.timer);
  await page.reload();
  await expect(note(page)).toContainText("Chroniona zmiana po wizycie");
  expect(await snapshot(page)).toEqual(after);
});
test("failed note save retains its guarded draft and retry does not touch reports or financial records", async ({
  page,
}) => {
  await page.goto("/#notes?note=note-doc");
  await note(page)
    .getByRole("button", { name: "Edytuj notatkę", exact: true })
    .click();
  const form = page.getByRole("dialog", {
    name: "Edytuj notatkę",
    exact: true,
  });
  await form
    .getByLabel("Treść notatki", { exact: true })
    .fill("Szkic po błędzie");
  const before = await snapshot(page);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    (window as any).restoreDocPut = () => {
      IDBObjectStore.prototype.put = put;
    };
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === "state" && args[1] === "current")
        throw new DOMException("Brak miejsca na notatkę", "QuotaExceededError");
      return put.apply(this, args);
    };
  });
  await form
    .getByRole("button", { name: "Zapisz notatkę", exact: true })
    .click();
  await expect(form.getByRole("alert")).toContainText("Brak miejsca");
  page.once("dialog", (d) => d.dismiss());
  await form.getByRole("button", { name: "Zamknij okno", exact: true }).click();
  await expect(form.getByLabel("Treść notatki", { exact: true })).toHaveValue(
    "Szkic po błędzie",
  );
  expect(await snapshot(page)).toEqual(before);
  await page.evaluate(() => (window as any).restoreDocPut());
  await form
    .getByRole("button", { name: "Zapisz notatkę", exact: true })
    .click();
  await expect(note(page)).toContainText("Szkic po błędzie");
  expect((await snapshot(page)).jobs).toEqual(before.jobs);
});
for (const width of [360, 390, 430])
  test(`documentation navigation on phone ${width}px has no horizontal overflow`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/#notes?note=note-doc");
    for (let i = 0; i < 2; i++) {
      const dialog = i === 0 ? note(page) : garden(page);
      await expect(dialog).toBeVisible();
      expect(
        await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      ).toBe(true);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      if (i === 0)
        await note(page)
          .getByRole("button", {
            name: "Ogród: Ogród przy Lipowej",
            exact: true,
          })
          .click();
    }
    await page.goBack();
    await expect(note(page)).toBeVisible();
    await page.reload();
    await expect(note(page)).toBeVisible();
  });

test("report waiting for the photo/restore lock blocks navigation until its history commit", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto("/#jobs?job=job-1");
  await job(page)
    .getByRole("button", { name: "Raporty wizyty (1)", exact: true })
    .click();
  await report(page)
    .getByRole("checkbox", { name: "Pokaż czas pracy", exact: true })
    .uncheck();
  await report(page)
    .getByRole("button", { name: "Przygotuj podgląd raportu", exact: true })
    .click();
  await expect(
    report(page).getByRole("region", { name: "Podgląd raportu", exact: true }),
  ).toBeVisible();
  const address = page.url(),
    before = await snapshot(page);
  await page.evaluate(() => {
    void navigator.locks.request(
      "garden-manager-photos",
      () =>
        new Promise<void>((resolve) => {
          (window as any).releaseDocReport = resolve;
        }),
    );
  });
  await page.waitForFunction(() => !!(window as any).releaseDocReport);
  const download = page.waitForEvent("download");
  await report(page)
    .getByRole("button", { name: "Zapisz raport i pobierz PDF", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("aria-busy", "true");
  await report(page)
    .getByRole("button", { name: "Zlecenie: Wizyta dokumentacji", exact: true })
    .click();
  await expect(page).toHaveURL(address);
  await page.goBack();
  await expect(page).toHaveURL(address);
  await expect(report(page)).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
  await page.evaluate(() => (window as any).releaseDocReport());
  await download;
  await settled(page);
  const after = await snapshot(page);
  expect(after.jobs[0].reports).toHaveLength(2);
  expect(after.reportSequence).toBe(before.reportSequence);
  expect(after.timer).toEqual(before.timer);
  expect(after.payments).toEqual(before.payments);
  await page.reload();
  await expect(
    report(page).getByRole("button", { name: "Podgląd wersji 2", exact: true }),
  ).toBeVisible();
  expect(await snapshot(page)).toEqual(after);
});

test("a photo and its note navigate by the existing photo ID without copying assets", async ({
  page,
}) => {
  const id = await upload(page);
  await job(page)
    .getByRole("button", {
      name: "Notatka do zdjęcia dokumentacja.png",
      exact: true,
    })
    .click();
  const form = page.getByRole("dialog", { name: "Nowa notatka", exact: true });
  await form
    .getByLabel("Tytuł notatki", { exact: true })
    .fill("Notatka do fotografii");
  await form
    .getByRole("button", { name: "Zapisz notatkę", exact: true })
    .click();
  await job(page)
    .getByRole("button", {
      name: "Powiększ zdjęcie dokumentacja.png",
      exact: true,
    })
    .click();
  await photo(page)
    .getByRole("button", {
      name: "Notatka: Notatka do fotografii",
      exact: true,
    })
    .click();
  const before = await snapshot(page);
  await expect(note(page)).toBeVisible();
  await note(page)
    .getByRole("button", {
      name: "Otwórz zdjęcie dokumentacja.png",
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(new RegExp(`photo=${id}`));
  await expect(photo(page).locator("img")).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
  expect(before.photos).toHaveLength(1);
});
