import { test as base, expect, type Page } from "@playwright/test";
import {
  financeData,
  financeClock,
  holdFinanceWrites,
} from "./finance-fixture";
import { STORAGE_KEY, STORAGE_VERSION } from "../src/data/repository";
import { snapshot } from "./atomic-report-helpers";
import { settled, setChecked } from "./atomic-fixture";
import { closeOpenDialogs } from "./navigation-helpers";
const test = base.extend<{ errors: string[] }>({
  errors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await use(errors);
      expect(errors).toEqual([]);
    },
    { auto: true },
  ],
});
const finance = (p: Page) =>
  p.getByRole("dialog", { name: /^Rozliczenia (klienta|ogrodu):/ });
const job = (p: Page) =>
  p.getByRole("dialog", { name: "Szczegóły zlecenia", exact: true });
const payment = (p: Page) =>
  p.getByRole("dialog", { name: "Szczegóły płatności", exact: true });
const report = (p: Page) =>
  p.getByRole("dialog", { name: "Raport PDF dla klienta", exact: true });
const partial = "Wizyta częściowo opłacona";
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(financeClock);
  await page.addInitScript(
    ({ key, version, data }) => {
      if (!localStorage.getItem(key))
        localStorage.setItem(key, JSON.stringify({ version, data }));
    },
    { key: STORAGE_KEY, version: STORAGE_VERSION, data: financeData() },
  );
});
async function openFinance(
  p: Page,
  filter = "all",
  owner = "client",
  id = "client-1",
) {
  await p.goto(
    `/#clients?finance=${id}&owner=${owner}&financeFilter=${filter}`,
  );
  await expect(finance(p)).toBeVisible();
}
async function rows(p: Page) {
  return finance(p).locator("table.client-jobs-table > tbody > tr");
}

test("client → 750 PLN receivable → settlement → work and return preserves approved amounts and browser history", async ({
  page,
}) => {
  await page.goto("/#clients?client=client-1");
  await expect(page.getByTestId("client-completed-value")).toContainText(
    "1500,00",
  );
  await expect(page.getByTestId("client-received")).toContainText("850,00");
  await expect(page.getByTestId("client-outstanding")).toContainText("750,00");
  const before = await snapshot(page);
  await page
    .getByRole("button", {
      name: "Szczegóły: POZOSTAŁO DO ZAPŁATY",
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(/financeFilter=outstanding/);
  await expect(await rows(page)).toHaveCount(1);
  await finance(page)
    .getByRole("button", {
      name: `Rozliczenie zlecenia ${partial}`,
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(/job=job-1&section=billing/);
  await expect(job(page).getByTestId("payment-job-total")).toContainText(
    "1000,00",
  );
  await expect(job(page).getByTestId("payment-job-paid")).toContainText(
    "250,00",
  );
  await expect(job(page).getByTestId("payment-job-remaining")).toContainText(
    "750,00",
  );
  await job(page)
    .getByRole("button", { name: "Zakres i czas", exact: true })
    .click();
  await expect(page).toHaveURL(/section=work/);
  await page.goBack();
  await expect(finance(page)).toBeVisible();
  await expect(
    finance(page).getByLabel("Zakres rozliczeń", { exact: true }),
  ).toHaveValue("outstanding");
  await page.goForward();
  await expect(job(page)).toBeVisible();
  await page.reload();
  await expect(job(page).getByTestId("payment-job-total")).toContainText(
    "1000,00",
  );
  expect(await snapshot(page)).toEqual(before);
});
test("one client history includes both gardens while a garden history excludes all other gardens and clients", async ({
  page,
}) => {
  await openFinance(page);
  await expect(await rows(page)).toHaveCount(4);
  await expect(finance(page).getByTestId("finance-value")).toContainText(
    "1500,00",
  );
  await expect(finance(page).getByTestId("finance-received")).toContainText(
    "850,00",
  );
  await expect(finance(page).getByTestId("finance-outstanding")).toContainText(
    "750,00",
  );
  await finance(page)
    .getByLabel("Ogród rozliczeń", { exact: true })
    .selectOption("garden-6");
  await expect(await rows(page)).toHaveCount(2);
  await expect(finance(page)).toContainText("Opłacona działka");
  await expect(finance(page)).not.toContainText("Praca innego klienta");
  await openFinance(page, "all", "garden", "garden-1");
  await expect(await rows(page)).toHaveCount(2);
  await expect(finance(page).getByTestId("finance-value")).toContainText(
    "1000,00",
  );
  await expect(finance(page).getByTestId("finance-received")).toContainText(
    "250,00",
  );
  await expect(finance(page)).not.toContainText("Opłacona działka");
  await finance(page)
    .getByRole("button", { name: "Ogród: Ogród przy Lipowej", exact: true })
    .click();
  const garden = page.getByRole("dialog", {
    name: "Karta ogrodu: Ogród przy Lipowej",
    exact: true,
  });
  await expect(
    garden.getByRole("tab", { name: "Rozliczenia", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await garden
    .getByRole("button", { name: "Pozostałe należności ogrodu", exact: true })
    .click();
  await expect(
    finance(page).getByLabel("Zakres rozliczeń", { exact: true }),
  ).toHaveValue("outstanding");
  await expect(await rows(page)).toHaveCount(1);
});
test("paid, partial, pending and advance amounts stay distinct and filters survive returning from work", async ({
  page,
}) => {
  await openFinance(page, "received");
  await expect(await rows(page)).toHaveCount(3);
  const before = await snapshot(page);
  await finance(page)
    .getByLabel("Status płatności w rozliczeniach", { exact: true })
    .selectOption("paid");
  await expect(await rows(page)).toHaveCount(1);
  await expect(finance(page)).toContainText("Opłacona działka");
  await finance(page)
    .getByLabel("Szukaj pracy w rozliczeniach", { exact: true })
    .fill("działka");
  await finance(page)
    .getByLabel("Kolejność historii", { exact: true })
    .selectOption("asc");
  await finance(page)
    .getByRole("button", {
      name: "Rozliczenie zlecenia Opłacona działka",
      exact: true,
    })
    .click();
  await expect(job(page).getByTestId("payment-job-remaining")).toContainText(
    "0,00",
  );
  await page.goBack();
  await expect(
    finance(page).getByLabel("Status płatności w rozliczeniach", {
      exact: true,
    }),
  ).toHaveValue("paid");
  await expect(
    finance(page).getByLabel("Szukaj pracy w rozliczeniach", { exact: true }),
  ).toHaveValue("działka");
  await page.reload();
  await expect(
    finance(page).getByLabel("Kolejność historii", { exact: true }),
  ).toHaveValue("asc");
  await finance(page)
    .getByRole("button", { name: "Wyczyść filtry historii", exact: true })
    .click();
  await finance(page)
    .getByLabel("Zakres rozliczeń", { exact: true })
    .selectOption("pending");
  await expect(await rows(page)).toHaveCount(1);
  await expect(finance(page)).toContainText("Wizyta bez zatwierdzenia");
  expect(await snapshot(page)).toEqual(before);
});
test("a real payment opens its client, settlement and report then restores the expanded history", async ({
  page,
}) => {
  await openFinance(page, "received");
  const before = await snapshot(page);
  const list = finance(page)
    .locator("details.finance-job-payments")
    .filter({ hasText: partial });
  await list.locator("summary").click();
  await list
    .locator('[data-payment-id="finance-partial"]')
    .getByRole("button")
    .click();
  await expect(page).toHaveURL(/payment=finance-partial/);
  await expect(
    payment(page).getByTestId("payment-detail-amount"),
  ).toContainText("250,00");
  await payment(page)
    .getByRole("button", {
      name: `Rozliczenie zlecenia ${partial}`,
      exact: true,
    })
    .click();
  await expect(job(page).getByTestId("payment-job-total")).toContainText(
    "1000,00",
  );
  await page.goBack();
  await expect(payment(page)).toBeVisible();
  await payment(page)
    .getByRole("button", { name: "Raporty zlecenia (1)", exact: true })
    .click();
  await report(page)
    .getByRole("button", { name: "Podgląd wersji 1", exact: true })
    .click();
  await expect(report(page)).toContainText(
    "Zapisana historyczna wersja raportu.",
  );
  await report(page)
    .getByRole("button", { name: "Rozliczenie zlecenia", exact: true })
    .click();
  await expect(job(page)).toBeVisible();
  await expect(page).toHaveURL(/section=billing/);
  expect(await snapshot(page)).toEqual(before);
});
test("payment direct URL survives reload and reopening; missing IDs and malformed scope stay safe", async ({
  page,
  context,
}) => {
  await page.goto("/#jobs?payment=finance-full");
  await expect(payment(page)).toContainText("Pełna wpłata");
  const before = await snapshot(page);
  await page.reload();
  await expect(payment(page)).toContainText("500,00");
  const other = await context.newPage();
  await other.goto(page.url());
  await expect(payment(other)).toContainText("500,00");
  await other.close();
  for (const hash of [
    "#clients?finance=missing&owner=client",
    "#gardens?finance=garden-1&owner=client",
    "#jobs?payment=missing",
  ]) {
    await page.goto("/" + hash);
    await expect(page.getByRole("dialog")).toContainText(
      /nie jest już dostęp|nie jest już dostępn|nie są już dostępn|nie jest już dostępny|nie jest już dostępna/i,
    );
  }
  await page.goto("/#clients?finance=client-1&owner=unknown");
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(finance(page)).toHaveCount(0);
  expect(await snapshot(page)).toEqual(before);
});
test("dirty payment and settlement forms block contextual navigation and Back", async ({
  page,
}) => {
  await openFinance(page, "outstanding");
  await finance(page)
    .getByRole("button", {
      name: `Rozliczenie zlecenia ${partial}`,
      exact: true,
    })
    .click();
  const before = await snapshot(page),
    address = page.url();
  await job(page)
    .getByRole("button", { name: "Dodaj płatność", exact: true })
    .click();
  await job(page).getByLabel("Kwota (zł)", { exact: true }).fill("15");
  page.once("dialog", (d) => d.dismiss());
  await job(page)
    .getByRole("button", { name: "Raporty wizyty (1)", exact: true })
    .click();
  await expect(page).toHaveURL(address);
  page.once("dialog", (d) => d.dismiss());
  await page.goBack();
  await expect(page).toHaveURL(address);
  await expect(job(page).getByLabel("Kwota (zł)", { exact: true })).toHaveValue(
    "15",
  );
  page.once("dialog", (d) => d.accept());
  await job(page)
    .getByRole("button", { name: "Anuluj formularz płatności", exact: true })
    .click();
  await job(page)
    .getByRole("button", { name: "Skoryguj cenę", exact: true })
    .click();
  const panel = job(page).getByRole("region", {
    name: "Korekta ceny robocizny",
    exact: true,
  });
  await panel
    .getByLabel("Ustalona cena robocizny (zł)", { exact: true })
    .fill("1100");
  page.once("dialog", (d) => d.dismiss());
  await job(page)
    .getByRole("button", { name: "Klient: Anna Kowalska", exact: true })
    .click();
  await expect(job(page)).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
});
test("pending payment waits for IndexedDB commit before Back and preserves approved balances", async ({
  page,
}) => {
  await openFinance(page);
  await finance(page)
    .getByRole("button", {
      name: `Rozliczenie zlecenia ${partial}`,
      exact: true,
    })
    .click();
  const before = await snapshot(page),
    address = page.url();
  await job(page)
    .getByRole("button", { name: "Dodaj płatność", exact: true })
    .click();
  await job(page).getByLabel("Kwota (zł)", { exact: true }).fill("5");
  await holdFinanceWrites(page);
  await job(page)
    .getByRole("button", { name: "Zapisz płatność", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("aria-busy", "true");
  await page.goBack();
  await expect(page).toHaveURL(address);
  await expect(job(page).getByLabel("Kwota (zł)", { exact: true })).toHaveValue(
    "5",
  );
  await page.evaluate(() => (window as any).releaseFinanceWrite());
  await settled(page);
  await expect(job(page).getByTestId("payment-job-paid")).toContainText(
    "255,00",
  );
  const after = await snapshot(page);
  expect(after.jobs).toEqual(before.jobs);
  expect(after.payments).toHaveLength(before.payments.length + 1);
  expect(after.timer).toEqual(before.timer);
  expect(after.reportSequence).toBe(before.reportSequence);
  await page.goBack();
  await page.reload();
  await expect(finance(page).getByTestId("finance-outstanding")).toContainText(
    "745,00",
  );
  expect(await snapshot(page)).toEqual(after);
});
test("monthly groups and payment expansion survive reload while closed old months remain lazy", async ({
  page,
}) => {
  await openFinance(page);
  const before = await snapshot(page);
  await finance(page)
    .getByLabel("Data prac od", { exact: true })
    .fill("2026-11-01");
  await finance(page)
    .locator(".finance-job-payments")
    .filter({ hasText: partial })
    .locator("summary")
    .click();
  await finance(page)
    .locator('[data-payment-id="finance-partial"]')
    .getByRole("button")
    .click();
  await page.reload();
  await expect(payment(page)).toBeVisible();
  await page.goBack();
  await expect(
    finance(page).locator('[data-payment-id="finance-partial"]'),
  ).toBeVisible();
  await expect(
    finance(page).getByLabel("Data prac od", { exact: true }),
  ).toHaveValue("2026-11-01");
  expect(await snapshot(page)).toEqual(before);
});
for (const width of [360, 390, 430])
  test(`finance and payment navigation works at ${width}px without page overflow`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await openFinance(page, "outstanding");
    const metricButton = finance(page).getByRole("button", {
      name: "Szczegóły: POZOSTAŁO DO ZAPŁATY",
      exact: true,
    });
    expect((await metricButton.boundingBox())!.height).toBeGreaterThanOrEqual(
      44,
    );
    await finance(page)
      .locator(".finance-job-payments")
      .filter({ hasText: partial })
      .locator("summary")
      .click();
    await finance(page)
      .locator('[data-payment-id="finance-partial"]')
      .getByRole("button")
      .click();
    await expect(payment(page)).toBeVisible();
    expect(
      await payment(page).evaluate(
        (el) => el.scrollWidth <= el.clientWidth + 1,
      ),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await payment(page)
      .getByRole("button", { name: "Historia płatności zlecenia", exact: true })
      .click();
    await expect(page).toHaveURL(/section=payments/);
    await page.goBack();
    await page.goBack();
    await page.reload();
    await expect(finance(page)).toBeVisible();
    expect(
      await finance(page).evaluate(
        (el) => el.scrollWidth <= el.clientWidth + 1,
      ),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  });

test("JSON and ZIP preserve financial history, report numbers and photo IDs after restoring a backup", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto("/#jobs?job=job-1&section=photos");
  await job(page)
    .getByRole("button", { name: "Dodaj zdjęcia", exact: true })
    .click();
  const bytes = await page.evaluate(async () => {
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
  await job(page)
    .getByLabel("Zdjęcia z urządzenia", { exact: true })
    .setInputFiles({
      name: "rozliczenie-ogrod.png",
      mimeType: "image/png",
      buffer: Buffer.from(bytes),
    });
  await job(page)
    .getByRole("button", { name: "Zapisz zdjęcia", exact: true })
    .click();
  await expect(job(page).locator(".photo-card img")).toBeVisible();
  const before = await snapshot(page);
  await closeOpenDialogs(page);
  await page
    .getByRole("button", {
      name: "Ustawienia konta demonstracyjnego",
      exact: true,
    })
    .click();
  const settings = page.getByRole("dialog", {
    name: "Ustawienia",
    exact: true,
  });
  const readDownload = async (name: string) => {
    const event = page.waitForEvent("download");
    await settings.getByRole("button", { name, exact: true }).click();
    const stream = await (await event).createReadStream();
    const chunks: Buffer[] = [];
    for await (const c of stream!) chunks.push(Buffer.from(c));
    return Buffer.concat(chunks);
  };
  const json = await readDownload("Eksportuj dane");
  const exported = JSON.parse(json.toString());
  expect(exported.version).toBe(9);
  expect(exported.data.payments).toEqual(before.payments);
  expect(exported.data.jobs).toEqual(before.jobs);
  const zip = await readDownload("Pobierz pełną kopię ZIP");
  await settings
    .getByLabel("Wczytaj pełną kopię ZIP", { exact: true })
    .setInputFiles({
      name: "finanse.zip",
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
  await expect(
    settings.getByText(/Dane i zdjęcia zostały odtworzone/).last(),
  ).toBeVisible();
  await settled(page);
  await page.reload();
  const after = await snapshot(page);
  expect(after.jobs).toEqual(before.jobs);
  expect(after.payments).toEqual(before.payments);
  expect(after.reportSequence).toBe(before.reportSequence);
  expect(after.photos.map((p: any) => p.id)).toEqual(
    before.photos.map((p: any) => p.id),
  );
  await page.goto(
    "/#clients?finance=client-1&owner=client&financeFilter=outstanding",
  );
  await expect(finance(page).getByTestId("finance-outstanding")).toContainText(
    "750,00",
  );
  await page.goto("/#jobs?photo=" + before.photos[0].id);
  await expect(
    page
      .getByRole("dialog", { name: "Podgląd zdjęcia", exact: true })
      .locator("img"),
  ).toBeVisible();
});

test("a summary amount resets stale finance filters and returning from a payment restores its context", async ({
  page,
}) => {
  await page.goto("/#clients?client=client-1");
  await page
    .getByRole("button", {
      name: "Rozliczenia i płatności klienta",
      exact: true,
    })
    .click();
  await finance(page)
    .getByLabel("Ogród rozliczeń", { exact: true })
    .selectOption("garden-6");
  await page.goBack();
  await page
    .getByRole("button", {
      name: "Szczegóły: POZOSTAŁO DO ZAPŁATY",
      exact: true,
    })
    .click();
  await expect(
    finance(page).getByLabel("Ogród rozliczeń", { exact: true }),
  ).toHaveValue("");
  await expect(await rows(page)).toHaveCount(1);
  await expect(finance(page)).toContainText("Wizyta częściowo opłacona");
});

test("a mounted ancestor finance card resets search after a client summary link", async ({
  page,
}) => {
  await openFinance(page, "received");
  await finance(page)
    .getByLabel("Ogród rozliczeń", { exact: true })
    .selectOption("garden-6");
  await finance(page)
    .locator(".finance-job-payments")
    .filter({ hasText: "Opłacona działka" })
    .locator("summary")
    .click();
  await finance(page)
    .locator('[data-payment-id="finance-full"]')
    .getByRole("button")
    .click();
  await payment(page)
    .getByRole("button", { name: "Klient: Anna Kowalska", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Szczegóły: POZOSTAŁO DO ZAPŁATY",
      exact: true,
    })
    .click();
  await expect(
    finance(page).getByLabel("Ogród rozliczeń", { exact: true }),
  ).toHaveValue("");
  await expect(await rows(page)).toHaveCount(1);
  await expect(finance(page)).toContainText("Wizyta częściowo opłacona");
});

test("hundreds of settlements reuse monthly grouping and lazy rows instead of mounting the full history", async ({
  page,
}) => {
  const { resetCanonical } = await import("./atomic-fixture");
  await page.goto("/");
  await resetCanonical(page);
  const data = financeData(),
    base = data.jobs[0];
  data.jobs.push(
    ...Array.from({ length: 270 }, (_, i) => ({
      ...base,
      id: `finance-bulk-${i}`,
      title: `Praca archiwalna ${i}`,
      date: i < 200 ? "2025-10-10" : "2026-11-03",
      reports: undefined,
    })),
  );
  await page.evaluate(
    (data) =>
      localStorage.setItem(
        "garden-manager:v1",
        JSON.stringify({ version: 9, data }),
      ),
    data,
  );
  await page.reload();
  await page.goto("/#clients?finance=client-1&owner=client&financeFilter=all");
  await expect(finance(page)).toBeVisible();
  await expect(
    finance(page).locator('details[data-month="2025-10"]'),
  ).not.toHaveAttribute("open", "");
  await expect(await rows(page)).toHaveCount(50);
  await finance(page)
    .getByRole("button", { name: /Pokaż kolejne 50 zleceń/ })
    .click();
  await expect(await rows(page)).toHaveCount(74);
  await page.reload();
  await expect(await rows(page)).toHaveCount(74);
});
