import { test, expect } from "@playwright/test";
import {
  planningClock,
  planningNavigationData,
} from "./planning-navigation-fixture";
import { snapshot } from "./atomic-report-helpers";
for (const initial of ["dashboard", "calendar"])
  test(`the live calendar URL wins over the initial ${initial} render before navigation effects`, async ({
    page,
  }) => {
    const data = planningNavigationData();
    await page.clock.setFixedTime(planningClock);
    await page.addInitScript((data) => {
      localStorage.setItem(
        "garden-manager:v1",
        JSON.stringify({ version: 9, data }),
      );
      const observer = new MutationObserver(() => {
        if (!document.querySelector(".app-shell")) return;
        observer.disconnect();
        (window as any).addressChangedBeforeNavigation =
          !history.state?.gardenNavigation;
        location.hash =
          "#calendar?date=2026-11-03&view=week&gardenFilter=garden-1&kindFilter=work";
      });
      observer.observe(document, { childList: true, subtree: true });
    }, data);
    await page.goto(`/#${initial}`);
    await page.waitForFunction(
      () => typeof (window as any).addressChangedBeforeNavigation === "boolean",
    );
    expect(
      await page.evaluate(() => (window as any).addressChangedBeforeNavigation),
    ).toBe(true);
    await expect(page).toHaveURL(
      /#calendar\?date=2026-11-03&view=week&gardenFilter=garden-1&kindFilter=work$/,
    );
    await expect(
      page.getByRole("heading", { name: "Kalendarz prac", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Tydzień", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(await snapshot(page)).toEqual(data);
  });
