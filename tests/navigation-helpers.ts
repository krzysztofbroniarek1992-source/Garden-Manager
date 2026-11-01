import type { Dialog, Page } from "@playwright/test";

/** Older module tests deliberately navigate to an aggregate view. Reload now
 * restores core cards, so close those views explicitly before using the menu.
 * Unsaved-change rejection itself is tested in shared-navigation.spec.ts. */
export async function closeOpenDialogs(page: Page) {
  const discard = async (dialog: Dialog) => {
    await dialog.accept();
  };
  page.on("dialog", discard);
  try {
    for (let index = 0; index < 20; index++) {
      const dialog = page.getByRole("dialog").last();
      if (!(await dialog.count())) return;
      const element = await dialog.elementHandle();
      await dialog
        .getByRole("button", { name: "Zamknij okno", exact: true })
        .click();
      await element?.waitForElementState("hidden");
    }
    throw new Error("Nie udało się wrócić do widoku zbiorczego.");
  } finally {
    page.off("dialog", discard);
  }
}
