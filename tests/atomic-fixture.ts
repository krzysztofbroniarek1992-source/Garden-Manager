import { expect, type Locator, type Page } from "@playwright/test";
/** A fixture that previously replaced localStorage now simulates a fresh install.
 * It deliberately clears only the new authoritative state, never photo assets. */
export async function resetCanonical(page: Page) {
  await page.locator(".app-shell").waitFor();
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("garden-manager-state", 1);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("state", "readwrite");
          tx.objectStore("state").clear();
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onabort = () => {
            db.close();
            reject(tx.error);
          };
        };
        request.onerror = () => reject(request.error);
      }),
  );
}
/** Simulate an external writer at the authoritative boundary, never through
 * a compatibility mirror that startup is allowed to refresh. */
export async function changeCanonical(
  page: Page,
  change: { removeJob?: string; payment?: { id: string; amountCents: number } },
) {
  await page.evaluate(
    (change) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("garden-manager-state", 1);
        request.onsuccess = () => {
          const db = request.result,
            tx = db.transaction("state", "readwrite"),
            store = tx.objectStore("state");
          const get = store.get("current");
          let next: any;
          get.onsuccess = () => {
            next = get.result;
            if (change.removeJob)
              next.data.jobs = next.data.jobs.filter(
                (j: { id: string }) => j.id !== change.removeJob,
              );
            if (change.payment)
              next.data.payments.find(
                (p: { id: string }) => p.id === change.payment!.id,
              ).amountCents = change.payment.amountCents;
            store.put({ ...next, revision: next.revision + 1 }, "current");
          };
          tx.oncomplete = () => {
            db.close();
            localStorage.setItem(
              "garden-manager:v1",
              JSON.stringify({ version: 9, data: next.data }),
            );
            const channel = new BroadcastChannel("garden-manager-state");
            channel.postMessage("changed");
            channel.close();
            resolve();
          };
          tx.onabort = () => {
            db.close();
            reject(tx.error);
          };
        };
        request.onerror = () => reject(request.error);
      }),
    change,
  );
}

export async function settled(page: Page) {
  await page.waitForFunction(
    () => document.documentElement.getAttribute("aria-busy") !== "true",
  );
}
export async function setChecked(locator: Locator, checked: boolean) {
  if ((await locator.isChecked()) !== checked) await locator.click();
  await expect(locator).toBeChecked({ checked });
}
