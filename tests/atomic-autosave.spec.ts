import { test, expect } from "@playwright/test";
import { data, snapshot } from "./atomic-report-helpers";
import {
  createBlankChecklist,
  addChecklistItem,
} from "../src/checklists/commands";
test("a newer autosave draft survives blur while an earlier write is waiting", async ({
  page,
}) => {
  const created = createBlankChecklist(
    data(),
    { kind: "visit", jobId: "job-1", zoneId: null },
    "Szkic atomowy",
    Date.now(),
  );
  const fixture = addChecklistItem(
    created.data,
    created.id,
    1,
    "Kontrola",
    Date.now(),
  );
  await page.addInitScript((data) => {
    if (!localStorage.getItem("garden-manager:v1"))
      localStorage.setItem(
        "garden-manager:v1",
        JSON.stringify({ version: 9, data }),
      );
  }, fixture);
  await page.goto("/#history");
  await page
    .locator(".job-title-button")
    .filter({ hasText: "Raport atomowy 1" })
    .click();
  await page.getByRole("button", { name: /^Checklisty wizyty \(/ }).click();
  await page
    .getByRole("button", { name: "Szkic atomowy", exact: true })
    .click();
  const checklist = page.getByRole("dialog", { name: /^Checklista:/ }),
    note = checklist.getByLabel("Uwagi: Kontrola", { exact: true });
  await note.waitFor();
  // Keep the real IndexedDB transaction active through requests, not through a
  // timer. Both saves are allowed to reach the queued transaction boundary.
  await page.evaluate(() => {
    const open = indexedDB.open("garden-manager-state", 1);
    open.onsuccess = () => {
      const db = open.result,
        tx = db.transaction("state", "readwrite"),
        store = tx.objectStore("state");
      let release = false;
      (window as any).releaseAutosave = () => {
        release = true;
      };
      const pump = () => {
        const get = store.get("current");
        get.onsuccess = () => {
          if (!release) pump();
        };
      };
      pump();
      tx.oncomplete = () => db.close();
    };
  });
  await page.waitForFunction(() => !!(window as any).releaseAutosave);
  await note.fill("Pierwszy szkic");
  await note.fill("Najnowszy szkic");
  await page.keyboard.press("Tab");
  await page.evaluate(() => (window as any).releaseAutosave());
  await expect(checklist.locator(".checklist-unsaved")).toBeVisible();
  await expect(note).toHaveValue("Najnowszy szkic");
  await checklist
    .getByRole("button", { name: "Ponów zapis", exact: true })
    .click();
  await expect(checklist.locator(".checklist-unsaved")).toHaveCount(0);
  expect((await snapshot(page)).checklists[0].items[0].note).toBe(
    "Najnowszy szkic",
  );
});
