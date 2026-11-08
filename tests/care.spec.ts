import { test, expect, type Page } from "@playwright/test";
import { careData, careClock, careURL } from "./care-fixture";
import { STORAGE_KEY, STORAGE_VERSION } from "../src/data/repository";
import { snapshot } from "./atomic-report-helpers";
import { settled } from "./atomic-fixture";
import { holdFinanceWrites } from "./finance-fixture";
import { readFile } from "node:fs/promises";
const details = (p: Page) =>
  p.getByRole("dialog", { name: "Szczegóły zadania", exact: true });
const history = (p: Page) =>
  details(p).getByRole("region", { name: "Historia zabiegów", exact: true });
async function completion(p: Page, date = "2027-04-08", job?: string) {
  await details(p)
    .getByRole("button", { name: "Potwierdź wykonanie zabiegu", exact: true })
    .click();
  await details(p)
    .getByLabel("Faktyczna data wykonania", { exact: true })
    .fill(date);
  if (job)
    await details(p)
      .getByRole("combobox", {
        name: "Istniejące zlecenie lub wizyta (opcjonalnie)",
        exact: true,
      })
      .selectOption(job);
}
const rows = (d: any) =>
  d.taskOccurrences.filter((o: any) => o.scheduleId === "care-e2e");
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(careClock);
  await page.addInitScript(
    ({ key, version, data }) => {
      if (!localStorage.getItem(key))
        localStorage.setItem(key, JSON.stringify({ version, data }));
    },
    { key: STORAGE_KEY, version: STORAGE_VERSION, data: careData() },
  );
});
test("create an opt-in care series in the existing form and preserve legacy schedules", async ({
  page,
}) => {
  await page.goto("/#calendar?date=2027-04-01&view=day");
  const before = await snapshot(page);
  await page
    .getByRole("button", { name: "+ Nowe zadanie na ten dzień", exact: true })
    .click();
  const form = page.getByRole("dialog", { name: "Nowe zadanie", exact: true });
  await form
    .getByLabel("Sposób planowania", { exact: true })
    .selectOption("care");
  await form
    .getByLabel("Nazwa zadania", { exact: true })
    .fill("Sezonowe koszenie");
  await form
    .getByRole("combobox", { name: "Ogród (wymagany)", exact: true })
    .selectOption("garden-1");
  await form
    .getByRole("combobox", { name: "Strefa (opcjonalnie)", exact: true })
    .selectOption("zone-doc");
  await form
    .getByRole("combobox", { name: "Powtarzanie", exact: true })
    .selectOption("weeks");
  await form.getByLabel("Powtarzaj co").fill("2");
  await form.getByLabel("Ogranicz do sezonu", { exact: true }).check();
  await form
    .getByLabel("Preparat lub materiał (opcjonalnie)", { exact: true })
    .fill("Według własnej dokumentacji");
  await form
    .getByLabel("Dodatkowe uwagi", { exact: true })
    .fill("Sprawdzić warunki");
  await form
    .getByRole("button", { name: "Zapisz harmonogram", exact: true })
    .click();
  await expect(form).toBeHidden();
  await settled(page);
  const after = await snapshot(page);
  expect(after.taskSchedules.filter((s: any) => !s.care)).toEqual(
    before.taskSchedules.filter((s: any) => !s.care),
  );
  const s = after.taskSchedules.find(
    (s: any) => s.title === "Sezonowe koszenie",
  );
  expect(s).toMatchObject({
    clientId: "client-1",
    gardenId: "garden-1",
    zoneId: "zone-doc",
    care: {
      season: { from: "04-01", to: "09-30" },
      notes: "Sprawdzić warunki",
    },
    recurrence: { frequency: "weeks", interval: 2 },
  });
  expect(
    after.taskOccurrences.filter((o: any) => o.scheduleId === s.id),
  ).toHaveLength(1);
  expect(after.jobs).toEqual(before.jobs);
  expect(after.timer).toEqual(before.timer);
});
test("moving does not advance a cycle; actual date and existing visit determine immutable history", async ({
  page,
}) => {
  await page.goto(careURL);
  const before = await snapshot(page);
  await details(page)
    .getByRole("button", { name: "Przesuń ten termin", exact: true })
    .click();
  await details(page)
    .getByLabel("Nowa data terminu", { exact: true })
    .fill("2027-04-05");
  await details(page)
    .getByRole("button", { name: "Zapisz przesunięcie", exact: true })
    .click();
  await expect(details(page)).toBeHidden();
  expect(rows(await snapshot(page))).toHaveLength(1);
  await page.goto(careURL);
  await completion(page, "2027-04-08", "job-1");
  await expect(details(page)).toContainText(
    "Następny termin od faktycznego wykonania: 2027-05-08",
  );
  await details(page)
    .getByRole("button", { name: "Zapisz wykonanie zabiegu", exact: true })
    .click();
  await expect(history(page)).toContainText("Faktycznie wykonano: 2027-04-08");
  await settled(page);
  const after = await snapshot(page);
  expect(rows(after)).toHaveLength(2);
  expect(rows(after)[0]).toMatchObject({
    originalDate: "2027-04-01",
    date: "2027-04-05",
    completion: {
      performedOn: "2027-04-08",
      jobId: "job-1",
      recordedAt: careClock.getTime(),
    },
  });
  expect(rows(after)[1]).toMatchObject({
    date: "2027-05-08",
    status: "planned",
    careCycle: 2,
  });
  for (const key of ["jobs", "payments", "timer", "photos"])
    expect(after[key]).toEqual(before[key]);
  await page.reload();
  await expect(history(page)).toContainText("Faktycznie wykonano: 2027-04-08");
  await details(page)
    .getByRole("button", { name: "Otwórz rzeczywiste zlecenie", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Szczegóły zlecenia", exact: true }),
  ).toContainText("Zabieg: Nawożenie GM-005 · wykonano 2027-04-08");
  await page.goBack();
  await expect(history(page)).toBeVisible();
  await page.goForward();
  await expect(
    page.getByRole("dialog", { name: "Szczegóły zlecenia", exact: true }),
  ).toBeVisible();
});
test("calendar Back/Forward and refresh keep the selected date, view, filters and cycle identity without writes", async ({
  page,
  context,
}) => {
  await page.goto(
    "/#calendar?date=2027-04-01&view=week&gardenFilter=garden-1&kindFilter=work",
  );
  const before = await snapshot(page);
  await page
    .locator(".calendar-agenda")
    .getByRole("button", { name: "Nawożenie GM-005", exact: true })
    .click();
  await expect(page).toHaveURL(/cycle=1/);
  await page.reload();
  await expect(details(page)).toBeVisible();
  await details(page)
    .getByRole("button", { name: "Ogród: Ogród przy Lipowej", exact: true })
    .click();
  await page.goBack();
  await expect(details(page)).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/view=week/);
  await expect(page).toHaveURL(/kindFilter=work/);
  await page.goForward();
  await expect(details(page)).toBeVisible();
  const fresh = await context.newPage();
  await fresh.goto("http://127.0.0.1:5173" + careURL);
  await expect(details(fresh)).toContainText("Nawożenie GM-005");
  await fresh.close();
  expect(await snapshot(page)).toEqual(before);
});
test("skip previews its explicit rule; editing the interval preserves history; ending closes the sole pending item", async ({
  page,
}) => {
  await page.goto(careURL);
  await details(page)
    .getByRole("button", { name: "Pomiń ten termin", exact: true })
    .click();
  await expect(
    details(page).getByRole("group", {
      name: "Potwierdzenie pominięcia terminu",
    }),
  ).toContainText("Następny termin: 2027-05-01");
  await details(page)
    .getByRole("button", { name: "Potwierdź pominięcie", exact: true })
    .click();
  await expect(details(page)).toBeHidden();
  const skipped = rows(await snapshot(page))[0];
  expect(skipped).toMatchObject({
    status: "cancelled",
    closedReason: "skipped",
    completion: null,
  });
  await page.goto(
    careURL.replace(
      "original=2027-04-01&cycle=1",
      "original=2027-05-01&cycle=2",
    ),
  );
  await details(page)
    .getByRole("button", { name: "Edytuj całą serię", exact: true })
    .click();
  const edit = page.getByRole("dialog", {
    name: "Edytuj harmonogram",
    exact: true,
  });
  await edit.getByLabel("Powtarzaj co").fill("7");
  await edit
    .getByRole("button", { name: "Zapisz harmonogram", exact: true })
    .click();
  await expect(edit).toBeHidden();
  expect(rows(await snapshot(page))[0]).toEqual(skipped);
  await page.goto(
    careURL.replace(
      "original=2027-04-01&cycle=1",
      "original=2027-05-01&cycle=2",
    ),
  );
  await completion(page, "2027-05-03");
  await details(page)
    .getByRole("button", { name: "Zapisz wykonanie zabiegu", exact: true })
    .click();
  await expect(history(page)).toContainText(
    "Najbliższy niewykonany zabieg: 2027-05-10",
  );
  await details(page)
    .getByRole("button", { name: "Zakończ serię", exact: true })
    .click();
  await details(page)
    .getByRole("button", { name: "Potwierdź zakończenie serii", exact: true })
    .click();
  await expect(details(page)).toBeHidden();
  const after = rows(await snapshot(page));
  expect(after.filter((o: any) => o.status === "planned")).toHaveLength(0);
  expect(after[1].completion.performedOn).toBe("2027-05-03");
  expect(after[2].closedReason).toBe("ended");
});
test("one overdue item persists across reloads and elapsed intervals; completing a visit does not complete care", async ({
  page,
}) => {
  await page.goto(careURL);
  await details(page)
    .getByRole("button", { name: "Rozpocznij pracę", exact: true })
    .click();
  const visit = page.getByRole("dialog", {
    name: "Szczegóły zlecenia",
    exact: true,
  });
  await expect(visit).toBeVisible();
  await visit.getByRole("button", { name: "Zakończ", exact: true }).click();
  await settled(page);
  await page.goBack();
  await expect(
    details(page).getByRole("button", {
      name: "Potwierdź wykonanie zabiegu",
      exact: true,
    }),
  ).toBeVisible();
  await page.reload();
  const after = await snapshot(page);
  expect(rows(after)).toHaveLength(1);
  expect(rows(after)[0]).toMatchObject({ status: "planned", completion: null });
  expect(
    after.jobs.find((j: any) => j.id === rows(after)[0].jobId).status,
  ).toBe("completed");
  await page.goto(
    "/#calendar?date=2027-04-01&view=day&gardenFilter=garden-1&kindFilter=work",
  );
  await expect(
    page
      .locator(".calendar-agenda")
      .getByRole("button", { name: "Nawożenie GM-005", exact: true }),
  ).toHaveCount(1);
});
test("two stale tabs confirm the same performance simultaneously in one serialized transaction", async ({
  page,
  context,
}) => {
  await page.goto(careURL);
  const other = await context.newPage();
  await other.clock.setFixedTime(careClock);
  await other.goto("http://127.0.0.1:5173" + careURL);
  await Promise.all([completion(page), completion(other)]);
  await holdFinanceWrites(page);
  await Promise.all([
    page.evaluate(() => {
      (
        document.querySelector(
          'form[aria-label="Potwierdzenie wykonania zabiegu"]',
        ) as HTMLFormElement
      ).requestSubmit();
    }),
    other.evaluate(() => {
      (
        document.querySelector(
          'form[aria-label="Potwierdzenie wykonania zabiegu"]',
        ) as HTMLFormElement
      ).requestSubmit();
    }),
  ]);
  await expect(page.locator("html")).toHaveAttribute("aria-busy", "true");
  await expect(other.locator("html")).toHaveAttribute("aria-busy", "true");
  await page.evaluate(() => (window as any).releaseFinanceWrite());
  await Promise.all([settled(page), settled(other)]);
  await expect(history(page)).toContainText("Faktycznie wykonano: 2027-04-08");
  await expect(history(other)).toContainText("Faktycznie wykonano: 2027-04-08");
  const after = await snapshot(page);
  expect(rows(after)).toHaveLength(2);
  expect(rows(after).filter((o: any) => o.completion)).toHaveLength(1);
  expect(rows(after).filter((o: any) => o.status === "planned")).toHaveLength(
    1,
  );
  await page.reload();
  expect(rows(await snapshot(page))).toEqual(rows(after));
  await other.close();
});
test("async completion blocks navigation and duplicate submissions until commit", async ({
  page,
}) => {
  await page.goto("/#calendar?date=2027-04-01&view=day");
  await page
    .locator(".calendar-agenda")
    .getByRole("button", { name: "Nawożenie GM-005", exact: true })
    .click();
  await completion(page);
  await holdFinanceWrites(page);
  await details(page)
    .getByRole("button", { name: "Zapisz wykonanie zabiegu", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("aria-busy", "true");
  await page.evaluate(() => {
    const form = document.querySelector(
      'form[aria-label="Potwierdzenie wykonania zabiegu"]',
    ) as HTMLFormElement;
    form.requestSubmit();
    form.requestSubmit();
  });
  await page.goBack();
  await expect(details(page)).toBeVisible();
  await page.evaluate(() => (window as any).releaseFinanceWrite());
  await settled(page);
  await expect(history(page)).toContainText("Faktycznie wykonano: 2027-04-08");
  expect(rows(await snapshot(page))).toHaveLength(2);
});
test("quota failure preserves the draft and all data; unsaved Back can be rejected", async ({
  page,
}) => {
  await page.goto("/#calendar?date=2027-04-01&view=day");
  await page
    .locator(".calendar-agenda")
    .getByRole("button", { name: "Nawożenie GM-005", exact: true })
    .click();
  await completion(page);
  const before = await snapshot(page);
  page.once("dialog", (d) => d.dismiss());
  await page.goBack();
  await expect(
    details(page).getByLabel("Faktyczna data wykonania", { exact: true }),
  ).toHaveValue("2027-04-08");
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    let once = true;
    IDBObjectStore.prototype.put = function (
      ...args: Parameters<IDBObjectStore["put"]>
    ) {
      if (once && this.name === "state") {
        once = false;
        throw new DOMException("Brak miejsca", "QuotaExceededError");
      }
      return put.apply(this, args);
    };
  });
  await details(page)
    .getByRole("button", { name: "Zapisz wykonanie zabiegu", exact: true })
    .click();
  await expect(details(page).getByRole("alert")).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
  await expect(
    details(page).getByLabel("Faktyczna data wykonania", { exact: true }),
  ).toHaveValue("2027-04-08");
  await details(page)
    .getByRole("button", { name: "Zapisz wykonanie zabiegu", exact: true })
    .click();
  await expect(history(page)).toContainText("Faktycznie wykonano: 2027-04-08");
});
test("unknown care cycles fail safely without writing", async ({ page }) => {
  await page.goto(careURL.replace("cycle=1", "cycle=999"));
  await expect(details(page)).toContainText("Ten termin zmienił się");
  expect(rows(await snapshot(page))).toHaveLength(1);
});
for (const width of [360, 390, 430])
  test(`care details and completion at ${width}px preserve context and avoid overflow`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(careURL);
    await completion(page);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    expect(
      await details(page).evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
    ).toBe(true);
    await details(page)
      .getByRole("button", { name: "Zapisz wykonanie zabiegu", exact: true })
      .click();
    await expect(history(page)).toContainText(
      "Najbliższy niewykonany zabieg: 2027-05-08",
    );
    await page.reload();
    await expect(history(page)).toContainText(
      "Faktycznie wykonano: 2027-04-08",
    );
  });
test("JSON and full ZIP export/import restore completed care, the pending cursor, photos and legacy data", async ({
  page,
}) => {
  await page.goto("/#jobs?job=job-1&section=photos");
  const gallery = page
    .getByRole("dialog", { name: "Szczegóły zlecenia", exact: true })
    .getByRole("region", { name: "Galeria zlecenia i wizyty", exact: true });
  await gallery
    .getByRole("button", { name: "Dodaj zdjęcia", exact: true })
    .click();
  const image = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 40;
    c.height = 40;
    c.getContext("2d")!.fillRect(0, 0, 40, 40);
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
      name: "zabieg.png",
      mimeType: "image/png",
      buffer: Buffer.from(image),
    });
  await gallery
    .getByRole("button", { name: "Zapisz zdjęcia", exact: true })
    .click();
  await expect(gallery.locator(".photo-card")).toHaveCount(1);
  await page.goto(careURL);
  await completion(page, "2027-04-08", "job-1");
  await details(page)
    .getByRole("button", { name: "Zapisz wykonanie zabiegu", exact: true })
    .click();
  await settled(page);
  const before = await snapshot(page);
  await page.goto("/#dashboard?dialog=settings");
  const panel = page.getByRole("dialog", { name: "Ustawienia", exact: true });
  const jsonDownload = page.waitForEvent("download");
  await panel
    .getByRole("button", { name: "Eksportuj dane", exact: true })
    .click();
  const jsonFile = await jsonDownload;
  const json = JSON.parse(await readFile((await jsonFile.path())!, "utf8"));
  expect(json.version).toBe(STORAGE_VERSION);
  expect(json.data.taskOccurrences).toEqual(before.taskOccurrences);
  const download = page.waitForEvent("download");
  await panel
    .getByRole("button", { name: "Pobierz pełną kopię ZIP", exact: true })
    .click();
  const file = await download;
  const buffer = await readFile((await file.path())!);
  await panel
    .getByLabel("Wczytaj pełną kopię ZIP", { exact: true })
    .setInputFiles({ name: "care.zip", mimeType: "application/zip", buffer });
  await panel
    .getByRole("checkbox", {
      name: "Rozumiem, że bieżący zestaw zostanie zastąpiony.",
      exact: true,
    })
    .check();
  await panel.getByLabel("Wpisz ODTWÓRZ", { exact: true }).fill("ODTWÓRZ");
  await panel
    .getByRole("button", { name: "Odtwórz dane i zdjęcia", exact: true })
    .click();
  await settled(page);
  await expect(panel).toContainText("Dane i zdjęcia zostały odtworzone");
  const restored = await snapshot(page);
  expect(restored.taskSchedules).toEqual(before.taskSchedules);
  expect(restored.taskOccurrences).toEqual(before.taskOccurrences);
  expect(restored.jobs).toEqual(before.jobs);
  expect(
    restored.photos.map((p: any) => ({ ...p, assetId: undefined })),
  ).toEqual(before.photos.map((p: any) => ({ ...p, assetId: undefined })));
  await page.goto("/#jobs?job=job-1&section=photos");
  await expect(gallery.locator(".photo-card img")).toBeVisible();
  await page.goto(careURL);
  await expect(history(page)).toContainText("Faktycznie wykonano: 2027-04-08");
});

test("season crossing resumes on the first active day of next year with no winter copies", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2027-10-20T12:00:00Z"));
  await page.goto(careURL);
  await details(page)
    .getByRole("button", { name: "Edytuj całą serię", exact: true })
    .click();
  const edit = page.getByRole("dialog", {
    name: "Edytuj harmonogram",
    exact: true,
  });
  await edit.getByLabel("Ogranicz do sezonu", { exact: true }).check();
  await edit
    .getByRole("button", { name: "Zapisz harmonogram", exact: true })
    .click();
  await expect(edit).toBeHidden();
  await page.goto(careURL);
  await completion(page, "2027-09-25");
  await expect(details(page)).toContainText(
    "Następny termin od faktycznego wykonania: 2028-04-01",
  );
  await details(page)
    .getByRole("button", { name: "Zapisz wykonanie zabiegu", exact: true })
    .click();
  await expect(history(page)).toContainText(
    "Najbliższy niewykonany zabieg: 2028-04-01",
  );
  await settled(page);
  const data = await snapshot(page);
  expect(rows(data)).toHaveLength(2);
  expect(rows(data)[1].date).toBe("2028-04-01");
  await page.goto(
    "/#calendar?date=2027-12-01&view=month&gardenFilter=garden-1&kindFilter=work",
  );
  await expect(
    page.locator(".calendar-event").filter({ hasText: "Nawożenie GM-005" }),
  ).toHaveCount(0);
});
test("switching panels protects an unsaved actual date", async ({ page }) => {
  await page.goto(careURL);
  await completion(page);
  page.once("dialog", (d) => d.dismiss());
  await details(page)
    .getByRole("button", { name: "Przesuń ten termin", exact: true })
    .click();
  await expect(
    details(page).getByLabel("Faktyczna data wykonania", { exact: true }),
  ).toHaveValue("2027-04-08");
  page.once("dialog", (d) => d.accept());
  await details(page)
    .getByRole("button", { name: "Przesuń ten termin", exact: true })
    .click();
  await expect(
    details(page).getByLabel("Nowa data terminu", { exact: true }),
  ).toBeVisible();
  expect(rows(await snapshot(page))).toHaveLength(1);
});

for (const width of [360, 390, 430])
  test(`care creation with seasonal controls at ${width}px fits the phone`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/#calendar?date=2027-04-01&view=day");
    await page
      .getByRole("button", { name: "+ Nowe zadanie na ten dzień", exact: true })
      .click();
    const form = page.getByRole("dialog", {
      name: "Nowe zadanie",
      exact: true,
    });
    await form
      .getByLabel("Sposób planowania", { exact: true })
      .selectOption("care");
    await form.getByLabel("Ogranicz do sezonu", { exact: true }).check();
    await expect(
      form.getByLabel("Dzień początku sezonu", { exact: true }),
    ).toHaveValue("1");
    expect(await form.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(
      true,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  });
