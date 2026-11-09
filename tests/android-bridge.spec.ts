import { test, expect } from "@playwright/test";
import { mockAndroid, androidBack } from "./android-bridge-fixture";
import { fieldURL, fieldClock, fieldData } from "./field-fixture";
import { snapshot } from "./atomic-report-helpers";
import { settled } from "./atomic-fixture";
import { holdFinanceWrites } from "./finance-fixture";
import { preview, data as reportData } from "./atomic-report-helpers";

test.describe("Android adapter simulation in Chromium", () => {
  for (const width of [320, 360, 390, 430])
    test(`all existing modules and field controls remain available at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 850 });
      await mockAndroid(page);
      for (const hash of [
        "dashboard",
        "clients",
        "gardens",
        "jobs",
        "calendar",
        "history",
        "materials",
        "calculators",
        "notes",
        "todos",
        "templates",
        "field",
      ]) {
        await page.goto("/#" + hash);
        await expect(page.locator(".app-shell")).toBeVisible();
        await expect(page.locator("html")).toHaveClass(/native-android/);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        ).toBe(true);
      }
      await page.goto(fieldURL);
      await expect(
        page.getByRole("button", {
          name: "START — Rozpocznij pomiar",
          exact: true,
        }),
      ).toBeVisible();
      expect((await snapshot(page)).timer).toBeNull();
    });
  test("native Back protects a draft then closes only the top form", async ({
    page,
  }) => {
    await mockAndroid(page);
    await page.goto("/#clients?client=client-1");
    await page
      .getByRole("button", { name: "Edytuj klienta", exact: true })
      .click();
    const form = page.getByRole("dialog", {
      name: "Edytuj klienta",
      exact: true,
    });
    await form.getByLabel("Telefon", { exact: true }).fill("600555111");
    page.once("dialog", (d) => d.dismiss());
    await androidBack(page);
    await expect(form).toBeVisible();
    await expect(form.getByLabel("Telefon", { exact: true })).toHaveValue(
      "600555111",
    );
    page.once("dialog", (d) => d.accept());
    await androidBack(page);
    await expect(form).toBeHidden();
    await expect(
      page.getByRole("button", { name: "Edytuj klienta", exact: true }),
    ).toBeVisible();
    await expect(page).toHaveURL(/#clients\?client=client-1/);
    expect((await snapshot(page)).clients[0].phone).not.toBe("600555111");
  });
  test("native Back waits for the IndexedDB commit", async ({ page }) => {
    await mockAndroid(page);
    await page.goto("/#clients?client=client-1");
    await page
      .getByRole("button", { name: "Edytuj klienta", exact: true })
      .click();
    const form = page.getByRole("dialog", {
      name: "Edytuj klienta",
      exact: true,
    });
    await form.getByLabel("Telefon", { exact: true }).fill("600777111");
    await holdFinanceWrites(page);
    await form
      .getByRole("button", { name: "Zapisz zmiany", exact: true })
      .click();
    await androidBack(page);
    await expect(
      page.getByText("Trwa zapis. Poczekaj na jego zakończenie."),
    ).toBeVisible();
    await expect(form).toBeVisible();
    await page.evaluate(() => (window as any).releaseFinanceWrite());
    await settled(page);
    await expect(form).toBeHidden();
    expect((await snapshot(page)).clients[0].phone).toBe("600777111");
  });
  test("resume and reload reconstruct 3h30m from the existing timer without any command", async ({
    page,
  }) => {
    await page.clock.setFixedTime(fieldClock);
    await mockAndroid(page);
    await page.goto(fieldURL);
    await page
      .getByRole("button", { name: "START — Rozpocznij pomiar", exact: true })
      .click();
    await settled(page);
    const started = await snapshot(page);
    await page.clock.setFixedTime(new Date(fieldClock.getTime() + 12600_000));
    await page.evaluate(() =>
      (window as any).gmEmit("appStateChange", { isActive: true }),
    );
    await expect(page.getByTestId("field-time")).toContainText("03:30:00");
    expect((await snapshot(page)).timer).toEqual(started.timer);
    await page.reload();
    await expect(page.getByTestId("field-time")).toContainText("03:30:00");
    expect((await snapshot(page)).timer).toEqual(started.timer);
    await page.getByRole("button", { name: "PAUZA", exact: true }).click();
    await settled(page);
    expect((await snapshot(page)).timer.paused).toBe(true);
    await page.getByRole("button", { name: "WZNÓW", exact: true }).click();
    await settled(page);
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "STOP", exact: true }).click();
    await settled(page);
    expect((await snapshot(page)).timer).toBeNull();
  });
  test("camera cancellation/permission refusal add no records; success uses the existing photo processor and scope", async ({
    page,
  }) => {
    await mockAndroid(page);
    await page.goto(fieldURL);
    await page.evaluate(() => ((window as any).gmNative.cancelCamera = true));
    await page
      .getByRole("button", { name: "Zrób zdjęcie", exact: true })
      .click();
    await settled(page);
    expect((await snapshot(page)).photos).toHaveLength(0);
    await page.evaluate(() => {
      (window as any).gmNative.cancelCamera = false;
      (window as any).gmNative.deniedCamera = true;
    });
    await page
      .getByRole("button", { name: "Zrób zdjęcie", exact: true })
      .click();
    await settled(page);
    await expect(
      page.getByRole("alert").filter({ hasText: "uprawnienia" }),
    ).toBeVisible();
    await page.evaluate(() => ((window as any).gmNative.deniedCamera = false));
    await page
      .getByRole("button", { name: "Zrób zdjęcie", exact: true })
      .click();
    await settled(page);
    await page
      .getByRole("textbox", { name: "Opis zdjęcia", exact: true })
      .fill("Natywny adapter");
    await page
      .getByRole("button", { name: "Zapisz zdjęcia", exact: true })
      .click();
    await settled(page);
    const photos = (await snapshot(page)).photos;
    expect(photos).toHaveLength(1);
    expect(photos[0]).toMatchObject({
      jobId: "field-today",
      category: "during",
      mimeType: "image/jpeg",
    });
    expect(photos[0].thumbnailSize).toBeGreaterThan(0);
    await page.reload();
    expect((await snapshot(page)).photos).toEqual(photos);
  });
  test("a native PDF open failure and retry share the committed document number/history", async ({
    page,
  }) => {
    await mockAndroid(page, reportData());
    const panel = await preview(page, "Raport atomowy 1");
    await panel
      .getByRole("button", { name: "Zapisz raport i pobierz PDF", exact: true })
      .click();
    await settled(page);
    const before = await snapshot(page);
    await page.evaluate(() => ((window as any).gmNative.failOpen = true));
    await panel
      .getByRole("button", { name: "Otwórz PDF w Androidzie", exact: true })
      .click();
    await settled(page);
    await expect(panel.getByRole("alert")).toContainText("Brak aplikacji");
    await page.evaluate(() => ((window as any).gmNative.failOpen = false));
    await panel
      .getByRole("button", { name: "Udostępnij PDF", exact: true })
      .click();
    await settled(page);
    const file = await page.evaluate(() => (window as any).gmNative.lastFile);
    expect(file.mime).toBe("application/pdf");
    expect(file.action).toBe("share");
    expect(
      file.chunks
        .map((c: any) => Buffer.from(c.base64, "base64"))
        .reduce((n: number, b: Buffer) => n + b.length, 0),
    ).toBe(file.size);
    expect((await snapshot(page)).jobs).toEqual(before.jobs);
    expect((await snapshot(page)).reportSequence).toBe(before.reportSequence);
  });
  test("native ZIP export, system picker and existing confirmed restore preserve a photo", async ({
    page,
  }) => {
    await mockAndroid(page);
    await page.goto(fieldURL);
    await page
      .getByRole("button", { name: "Zrób zdjęcie", exact: true })
      .click();
    await settled(page);
    await page
      .getByRole("button", { name: "Zapisz zdjęcia", exact: true })
      .click();
    await settled(page);
    const photo = (await snapshot(page)).photos[0];
    await page.goto("/#dashboard?dialog=settings");
    // Use the actual settings address through the existing UI if canonicalizer rejected this legacy form.
    if (
      !(await page
        .getByRole("dialog", { name: "Ustawienia", exact: true })
        .isVisible())
    )
      await page
        .getByRole("button", {
          name: "Ustawienia konta demonstracyjnego",
          exact: true,
        })
        .click();
    await page
      .getByRole("button", { name: "Pobierz pełną kopię ZIP", exact: true })
      .click();
    await settled(page);
    const file = await page.evaluate(() => (window as any).gmNative.lastFile);
    const zip = Buffer.concat(
      file.chunks.map((c: any) => Buffer.from(c.base64, "base64")),
    );
    expect(file.mime).toBe("application/zip");
    expect(zip.subarray(0, 2).toString()).toBe("PK");
    await page.evaluate(
      (uri) => ((window as any).gmNative.backupURI = uri),
      "data:application/zip;base64," + zip.toString("base64"),
    );
    await page
      .getByRole("button", { name: "Wczytaj pełną kopię ZIP", exact: true })
      .click();
    await settled(page);
    await page
      .getByLabel("Rozumiem, że bieżący zestaw zostanie zastąpiony.")
      .check();
    await page.getByLabel("Wpisz ODTWÓRZ").fill("ODTWÓRZ");
    await page
      .getByRole("button", { name: "Odtwórz dane i zdjęcia", exact: true })
      .click();
    await settled(page);
    const restored = (await snapshot(page)).photos[0];
    expect(restored.sha256).toBe(photo.sha256);
    await page.reload();
    expect((await snapshot(page)).photos[0].sha256).toBe(photo.sha256);
  });
  test("a cold UI launch restores the last addressed section without replaying writes", async ({
    page,
  }) => {
    await mockAndroid(page);
    await page.goto("/#gardens?garden=garden-1&section=gallery");
    await expect(
      page.getByRole("region", {
        name: "Galeria i historia ogrodu",
        exact: true,
      }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => sessionStorage.getItem("mock-native-bookmark")),
      )
      .toContain("section=gallery");
    const before = await snapshot(page);
    await page.goto("/");
    await expect(page).toHaveURL(/garden=garden-1.*section=gallery/);
    expect(await snapshot(page)).toEqual(before);
  });
  test("root Back requires confirmation; resume never changes data", async ({
    page,
  }) => {
    await mockAndroid(page);
    await page.goto("/#dashboard");
    await expect(page.locator(".app-shell")).toBeVisible();
    const before = await snapshot(page);
    page.once("dialog", (d) => d.dismiss());
    await androidBack(page);
    expect(await page.evaluate(() => (window as any).gmNative.minimized)).toBe(
      0,
    );
    page.once("dialog", (d) => d.accept());
    await androidBack(page);
    await expect
      .poll(() => page.evaluate(() => (window as any).gmNative.minimized))
      .toBe(1);
    await page.evaluate(() =>
      (window as any).gmEmit("appStateChange", { isActive: true }),
    );
    expect(await snapshot(page)).toEqual(before);
  });
});
