import { expect, type Dialog, type Page } from "@playwright/test";
import { settled } from "./atomic-fixture";

/** Module tests deliberately return to an aggregate view. Wait for committed
 * saves and close the same modal we inspected: a lazy child or an autosave can
 * change the last visible dialog between two Playwright calls. Guard rejection
 * itself is exercised separately in shared-navigation.spec.ts. */
export async function closeOpenDialogs(page: Page) {
  await page.locator(".app-shell").waitFor();
  const discard = async (dialog: Dialog) => {
    await dialog.accept();
  };
  page.on("dialog", discard);
  try {
    await expect
      .poll(
        async () => {
          await settled(page);
          const dialogs = await page.getByRole("dialog").elementHandles();
          const current = dialogs.at(-1);
          if (!current) return 0;
          const heading = await current.getAttribute("aria-labelledby");
          if (!heading)
            throw new Error("Brak identyfikatora okna do zamknięcia.");
          const target = page.locator(
            `[role="dialog"][aria-labelledby=${JSON.stringify(heading)}]`,
          );
          if (!(await target.isVisible()))
            return page.getByRole("dialog").count();
          try {
            await target
              .getByRole("button", { name: "Zamknij okno", exact: true })
              .click({ timeout: 1000 });
          } catch (error) {
            // Only tolerate an actual disappearing/replaced top modal. A visible,
            // still topmost close button that cannot be clicked remains a failure.
            const next = (await page.getByRole("dialog").elementHandles()).at(
              -1,
            );
            if (
              (await target.isVisible()) &&
              (await next?.getAttribute("aria-labelledby")) === heading
            )
              throw error;
          }
          return page.getByRole("dialog").count();
        },
        { timeout: 15000, intervals: [50, 100, 250] },
      )
      .toBe(0);
  } finally {
    page.off("dialog", discard);
  }
}
