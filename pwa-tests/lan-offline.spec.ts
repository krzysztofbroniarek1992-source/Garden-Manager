import {test,expect} from "@playwright/test";
import {snapshot} from "../tests/atomic-report-helpers";
test("LAN native-only notice works offline and never changes business data",async({page,context})=>{
 await page.goto("/#sync");await page.evaluate(()=>navigator.serviceWorker.ready);
 await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);const before=await snapshot(page);
 await context.setOffline(true);await page.reload();await expect(page.getByRole("heading",{name:"Wymagana aplikacja natywna",exact:true})).toBeVisible();
 expect(await snapshot(page)).toEqual(before);const second=await context.newPage();await second.goto("/#sync");
 await expect(second.locator(".lan-page")).toContainText("GM-011A");expect(await snapshot(second)).toEqual(before);
});
