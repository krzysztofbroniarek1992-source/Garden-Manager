import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import {
  launch,
  route,
  snapshot,
  metadata,
  addExpense,
  addPhoto,
} from "./helpers";
const phase = process.env.GM_UPGRADE_PHASE;
test(`actual NSIS installation ${phase}: one persistent v11 profile, photo, expense and running timer`, async () => {
  const executable = process.env.GM_INSTALLED_APP!,
    profile = process.env.GM_UPGRADE_PROFILE!,
    expectedFile = process.env.GM_UPGRADE_EXPECTED!;
  const { instance, page } = await launch(profile, executable);
  try {
    const version = await instance.evaluate(({ app }) => app.getVersion());
    expect(version).toBe(phase === "seed" ? "0.5.0-test.1" : "0.5.0-test.2");
    if (phase === "seed") {
      await route(page, "#clients");
      await page
        .getByRole("button", { name: "Dodaj klienta", exact: true })
        .click();
      const f = page.getByRole("dialog", { name: "Nowy klient", exact: true });
      await f
        .getByLabel("Imię i nazwisko / nazwa firmy *", { exact: true })
        .fill("Windows aktualizacja Łódź");
      await f
        .getByRole("button", { name: "Dodaj klienta", exact: true })
        .click();
      await expect(f).toHaveCount(0);
      await addExpense(page, "Aktualizacja — koszt");
      await addPhoto(page);
      await route(page, "#field?field=job-1");
      await page
        .getByRole("button", { name: /START — Rozpocznij pomiar/ })
        .click();
      await expect
        .poll(async () => (await snapshot(page)).timer?.jobId)
        .toBe("job-1");
      const data = await snapshot(page),
        assets = await metadata(page);
      await writeFile(
        expectedFile,
        JSON.stringify({ data, assets, at: Date.now() }),
        "utf8",
      );
    } else {
      const expected = JSON.parse(await readFile(expectedFile, "utf8"));
      expect(await snapshot(page)).toEqual(expected.data);
      expect(await metadata(page)).toEqual(expected.assets);
      expect(
        expected.data.clients.some(
          (c: any) => c.name === "Windows aktualizacja Łódź",
        ),
      ).toBe(true);
      expect(Date.now() - expected.data.timer.startedAt).toBeGreaterThan(
        expected.at - expected.data.timer.startedAt,
      );
      expect(new URL(page.url()).hash).toContain("field=job-1");
      await page.getByRole("button", { name: "PAUZA", exact: false }).click();
      await expect
        .poll(async () => (await snapshot(page)).timer?.paused)
        .toBe(true);
      await page.getByRole("button", { name: /WZNÓW/ }).click();
      await expect
        .poll(async () => (await snapshot(page)).timer?.paused)
        .toBe(false);
      page.once("dialog", async (dialog) => {
        expect(dialog.message()).toContain("zakończyć pomiar czasu pracy");
        await dialog.accept();
      });
      await page.getByRole("button", { name: /STOP/ }).click();
      await expect.poll(async () => (await snapshot(page)).timer).toBeNull();
    }
    const exit = new Promise<void>((resolve) =>
      instance.process().once("exit", () => resolve()),
    );
    await instance.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].close(),
    );
    await exit;
  } finally {
    await instance.close().catch(() => {});
  }
});
