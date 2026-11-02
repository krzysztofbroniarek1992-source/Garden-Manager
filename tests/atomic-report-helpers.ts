import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { createDemoData } from "../src/data/demo";
const clock = new Date("2026-10-31T10:00:00+01:00");
export function data() {
  const d = createDemoData(clock);
  d.jobs.slice(0, 2).forEach((j, i) => {
    j.status = "completed";
    j.settlement = null;
    j.seconds = 3600;
    j.title = `Raport atomowy ${i + 1}`;
  });
  d.payments = [];
  return d;
}
export async function snapshot(page: Page) {
  return page.evaluate(
    () =>
      new Promise<any>((resolve, reject) => {
        const req = indexedDB.open("garden-manager-state", 1);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction("state", "readonly");
          const get = tx.objectStore("state").get("current");
          get.onsuccess = () => resolve(get.result.data);
          tx.oncomplete = () => db.close();
        };
        req.onerror = () => reject(req.error);
      }),
  );
}
export async function preview(page: Page, title: string) {
  await page.goto("/#history");
  await page.locator(".job-title-button").filter({ hasText: title }).click();
  await page
    .getByRole("button", { name: "Podsumowanie wizyty", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Generuj raport PDF", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Raport PDF dla klienta",
    exact: true,
  });
  await dialog
    .getByRole("button", { name: "Przygotuj podgląd raportu", exact: true })
    .click();
  await expect(
    dialog.getByRole("region", { name: "Podgląd raportu", exact: true }),
  ).toBeVisible();
  return dialog;
}
