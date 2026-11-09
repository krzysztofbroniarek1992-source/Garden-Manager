import { test, expect, type Page } from "@playwright/test";
import { mockAndroid, androidBack } from "./android-bridge-fixture";
import { snapshot } from "./atomic-report-helpers";
import { holdFinanceWrites } from "./finance-fixture";
import { settled } from "./atomic-fixture";
const dialog = (page: Page, name: string) =>
  page.getByRole("dialog", { name, exact: true });
const job = (page: Page) => dialog(page, "Nowe zlecenie");
async function open(page: Page) {
  await mockAndroid(page);
  await page.goto("/#jobs?dialog=new-job");
  await expect(job(page)).toBeVisible();
}
async function fillChild(page: Page, kind: "client" | "garden" | "material") {
  const name =
    kind === "client"
      ? "Nowy klient"
      : kind === "garden"
        ? "Nowy ogród"
        : "Nowy materiał";
  await job(page)
    .getByRole("button", {
      name:
        kind === "client"
          ? "+ Nowy klient"
          : kind === "garden"
            ? "+ Nowy ogród"
            : "+ Nowy materiał w katalogu",
      exact: true,
    })
    .click();
  const child = dialog(page, name);
  if (kind === "client")
    await child
      .getByLabel("Imię i nazwisko / nazwa firmy *", { exact: true })
      .fill("Klient szybki");
  if (kind === "garden") {
    await child
      .getByLabel("Nazwa ogrodu *", { exact: true })
      .fill("Ogród szybki");
    await child.getByLabel("Adres *", { exact: true }).fill("Polna 1");
  }
  if (kind === "material") {
    await child
      .getByLabel("Nazwa materiału", { exact: true })
      .fill("Kora szybka");
    await child.getByLabel("Kategoria", { exact: true }).fill("Podłoża");
    await child.getByLabel(/^Jednostka\ miary/).selectOption("kg");
    await child.getByLabel(/Domyślna cena zakupu/).fill("12.5");
  }
  return child;
}
for (const width of [320, 360, 390, 430, 1280])
  test(`job draft survives inline client → garden → catalog creation at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page);
    const before = await snapshot(page);
    await job(page)
      .getByLabel("Nazwa pracy", { exact: true })
      .fill("Zachowany szkic");
    await job(page).getByLabel("Data", { exact: true }).fill("2027-01-02");
    await job(page).getByLabel("Godzina", { exact: true }).fill("11:35");
    await job(page).getByLabel("Stawka (zł/h)", { exact: true }).fill("123");
    await job(page)
      .getByLabel(/^Sposób\ rozliczenia/)
      .selectOption("fixed");
    await job(page)
      .getByLabel("Kwota ryczałtu (zł)", { exact: true })
      .fill("725");
    await job(page)
      .getByLabel("Notatka", { exact: true })
      .fill("Szkic i dojazd");
    await job(page)
      .getByRole("button", { name: "Dodaj czynność", exact: true })
      .click();
    await job(page)
      .getByLabel("Czynność 1", { exact: true })
      .fill("Pielęgnacja");
    await job(page).getByRole("button", { name: "Dodaj", exact: true }).click();
    await job(page)
      .getByLabel("Nazwa materiału 1", { exact: true })
      .fill("Własny materiał");
    await job(page).getByLabel("Cena materiału 1", { exact: true }).fill("7");
    let child = await fillChild(page, "client");
    await child
      .getByRole("button", { name: "Dodaj klienta", exact: true })
      .click();
    await expect(child).toBeHidden();
    const client = (await snapshot(page)).clients.find(
      (c: any) => c.name === "Klient szybki",
    );
    await expect(job(page).getByLabel(/^Klient/)).toHaveValue(client.id);
    child = await fillChild(page, "garden");
    await expect(child.getByLabel(/^Klient\ \*/)).toHaveValue(client.id);
    await child
      .getByRole("button", { name: "Dodaj ogród", exact: true })
      .click();
    await expect(child).toBeHidden();
    const garden = (await snapshot(page)).gardens.find(
      (g: any) => g.name === "Ogród szybki",
    );
    await expect(job(page).getByLabel(/^Ogród\ i\ klient/)).toHaveValue(
      garden.id,
    );
    child = await fillChild(page, "material");
    await child.locator("form").evaluate((form) => {
      (form as HTMLFormElement).requestSubmit();
      (form as HTMLFormElement).requestSubmit();
    });
    await expect(child).toBeHidden();
    await expect(
      job(page).getByLabel("Nazwa materiału 1", { exact: true }),
    ).toHaveValue("Własny materiał");
    await expect(
      job(page).getByLabel("Nazwa materiału 2", { exact: true }),
    ).toHaveValue("Kora szybka");
    await expect(
      job(page).getByLabel("Cena zakupu materiału 2", { exact: true }),
    ).toHaveValue("12.5");
    await job(page).getByLabel("Cena materiału 2", { exact: true }).fill("19");
    expect((await snapshot(page)).jobs).toEqual(before.jobs);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await job(page)
      .getByRole("button", { name: "Zapisz zlecenie", exact: true })
      .click();
    await expect(job(page)).toBeHidden();
    await settled(page);
    const data = await snapshot(page),
      saved = data.jobs.find((j: any) => j.title === "Zachowany szkic");
    expect(saved).toMatchObject({
      gardenId: garden.id,
      date: "2027-01-02",
      time: "11:35",
      rate: 123,
      fixedPrice: 725,
      notes: "Szkic i dojazd",
      activities: ["Pielęgnacja"],
    });
    expect(saved.materials).toHaveLength(2);
    expect(saved.materials[1]).toMatchObject({
      catalogId: data.materialCatalog.find((m: any) => m.name === "Kora szybka")
        .id,
      quantity: 1,
      unit: "kg",
      purchaseUnitPrice: 12.5,
      unitPrice: 19,
    });
    expect(
      data.materialCatalog.filter((m: any) => m.name === "Kora szybka"),
    ).toHaveLength(1);
    expect(data.timer).toEqual(before.timer);
    expect(data.payments).toEqual(before.payments);
    await page.reload();
    expect(
      (await snapshot(page)).jobs.find((j: any) => j.id === saved.id),
    ).toEqual(saved);
  });
for (const kind of ["client", "garden", "material"] as const)
  test(`cancel and failed ${kind} creation retain the parent draft and all data`, async ({
    page,
  }) => {
    await open(page);
    await job(page).getByLabel("Nazwa pracy", { exact: true }).fill("Nie zgub");
    const before = await snapshot(page),
      child = await fillChild(page, kind);
    await page.evaluate(() => {
      const put = IDBObjectStore.prototype.put;
      (window as any).restorePut = () => (IDBObjectStore.prototype.put = put);
      IDBObjectStore.prototype.put = function (...args: any[]) {
        if (args[1] === "current")
          throw new DOMException("Brak miejsca", "QuotaExceededError");
        return put.apply(this, args as any);
      };
    });
    await child
      .getByRole("button", {
        name:
          kind === "client"
            ? "Dodaj klienta"
            : kind === "garden"
              ? "Dodaj ogród"
              : "Zapisz materiał",
        exact: true,
      })
      .click();
    await expect(child.getByRole("alert")).toContainText("Brak miejsca");
    expect(await snapshot(page)).toEqual(before);
    page.once("dialog", (d) => d.dismiss());
    await androidBack(page);
    await expect(child).toBeVisible();
    page.once("dialog", (d) => d.accept());
    await androidBack(page);
    await expect(child).toBeHidden();
    await expect(
      job(page).getByLabel("Nazwa pracy", { exact: true }),
    ).toHaveValue("Nie zgub");
    expect(await snapshot(page)).toEqual(before);
    expect(
      await job(page)
        .getByRole("button", {
          name:
            kind === "client"
              ? "+ Nowy klient"
              : kind === "garden"
                ? "+ Nowy ogród"
                : "+ Nowy materiał w katalogu",
          exact: true,
        })
        .evaluate((e) => document.activeElement === e),
    ).toBe(true);
  });
test("a pending child commit blocks Android Back; parent is never submitted by the nested form", async ({
  page,
}) => {
  await open(page);
  await job(page)
    .getByLabel("Nazwa pracy", { exact: true })
    .fill("Niezapisane zlecenie");
  const before = await snapshot(page);
  const child = await fillChild(page, "client");
  await holdFinanceWrites(page);
  await child
    .getByRole("button", { name: "Dodaj klienta", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("aria-busy", "true");
  await androidBack(page);
  await expect(child).toBeVisible();
  await page.evaluate(() => (window as any).releaseFinanceWrite());
  await expect(child).toBeHidden();
  await settled(page);
  await expect(
    job(page).getByLabel("Nazwa pracy", { exact: true }),
  ).toHaveValue("Niezapisane zlecenie");
  expect((await snapshot(page)).jobs).toEqual(before.jobs);
});
test("a conflicting new client never overwrites an existing record or changes job selection", async ({
  page,
}) => {
  await open(page);
  const before = await snapshot(page),
    selected = await job(page)
      .getByLabel(/^Klient/)
      .inputValue();
  await page.evaluate((id) => {
    const original = crypto.randomUUID.bind(crypto);
    (window as any).restoreUUID = () => (crypto.randomUUID = original);
    crypto.randomUUID = () => id;
  }, before.clients[0].id);
  const child = await fillChild(page, "client");
  await page.evaluate(() => (window as any).restoreUUID());
  await child
    .getByRole("button", { name: "Dodaj klienta", exact: true })
    .click();
  await expect(child.getByRole("alert")).toBeVisible();
  expect(await snapshot(page)).toEqual(before);
  page.once("dialog", (d) => d.accept());
  await child.getByRole("button", { name: "Anuluj", exact: true }).click();
  await expect(job(page).getByLabel(/^Klient/)).toHaveValue(selected);
});
test("without a selected client, a garden cannot be assigned by guesswork", async ({
  page,
}) => {
  await open(page);
  await job(page)
    .getByLabel(/^Klient/)
    .selectOption("");
  await expect(
    job(page).getByRole("button", { name: "+ Nowy ogród", exact: true }),
  ).toBeDisabled();
  await expect(
    job(page).getByText("Wybierz lub dodaj klienta, aby utworzyć jego ogród."),
  ).toBeVisible();
});
