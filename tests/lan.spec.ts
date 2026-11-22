import {test,expect} from "@playwright/test";
import {snapshot} from "./atomic-report-helpers";
for(const width of [360,390,430,1280]){
 test("LAN native-only notice, menu, reload and unchanged data at "+width+"px",async({page})=>{
  await page.setViewportSize({width,height:844});await page.goto("/");await expect(page.locator(".app-shell")).toBeVisible();const before=await snapshot(page);
  if(width<700){await page.getByRole("button",{name:"Więcej",exact:true}).click();await page.locator(".mobile-more-list").getByRole("button",{name:"Synchronizacja",exact:true}).click();}
  else await page.locator(".sidebar").getByRole("button",{name:"Synchronizacja",exact:true}).click();
  await expect(page).toHaveURL(/#sync$/);await expect(page.getByRole("heading",{name:"Wymagana aplikacja natywna",exact:true})).toBeVisible();
  await expect(page.locator(".lan-page")).toContainText("Synchronizacja danych firmowych nie jest jeszcze dostępna");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.reload();await expect(page.locator(".lan-page")).toBeVisible();expect(await snapshot(page)).toEqual(before);
 });
}
