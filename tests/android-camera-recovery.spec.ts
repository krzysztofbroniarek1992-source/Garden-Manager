import { test, expect } from "@playwright/test";
import { mockAndroid } from "./android-bridge-fixture";
import { fieldURL } from "./field-fixture";
import { snapshot } from "./atomic-report-helpers";
import { settled } from "./atomic-fixture";

test("promise/restored-result race delivers one selection to the existing field form and saves once", async ({
  page,
}) => {
  await mockAndroid(page);
  await page.goto(fieldURL);
  await page.evaluate(() => ((window as any).gmNative.holdCamera = true));
  await page.getByRole("button", { name: "Zrób zdjęcie", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => sessionStorage.getItem("mock-pending-media")),
    )
    .not.toBeNull();
  await page.evaluate(() => {
    const w = window as any;
    const op = JSON.parse(sessionStorage.getItem("mock-pending-media")!);
    w.gmEmit("appRestoredResult", {
      pluginId: "GardenCamera",
      methodName: "acquire",
      success: true,
      data: op,
    });
    w.gmNative.deliverCamera();
    w.gmEmit("appRestoredResult", {
      pluginId: "GardenCamera",
      methodName: "acquire",
      success: true,
      data: op,
    });
  });
  await settled(page);
  await expect(page.getByText(/Wybrano 1 zdjęć/)).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Wybrane zdjęcia", exact: true }),
  ).toBeHidden();
  expect((await snapshot(page)).photos).toHaveLength(0);
  await expect(page.getByLabel(/^Zlecenie\ zdjęcia/)).toHaveValue(
    "field-today",
  );
  await page
    .getByRole("button", { name: "Zapisz zdjęcia", exact: true })
    .click();
  await settled(page);
  expect((await snapshot(page)).photos).toHaveLength(1);
  await page.evaluate(() =>
    (window as any).gmEmit("appRestoredResult", {
      pluginId: "GardenCamera",
      methodName: "acquire",
      success: true,
    }),
  );
  await page.reload();
  await expect(
    page.getByRole("dialog", { name: "Wybrane zdjęcia", exact: true }),
  ).toBeHidden();
  expect((await snapshot(page)).photos).toHaveLength(1);
});
for (const stale of [false, true])
  test(`cold recovery of a gallery selection requires confirmation; stale scope=${stale}`, async ({
    page,
  }) => {
    await mockAndroid(page);
    await page.goto("/#jobs?job=field-today&section=photos");
    await page
      .getByRole("button", { name: "Dodaj zdjęcia", exact: true })
      .click();
    await page.evaluate(() => ((window as any).gmNative.holdCamera = true));
    await page.getByLabel("Zdjęcia z urządzenia", { exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(() => sessionStorage.getItem("mock-pending-media")),
      )
      .not.toBeNull();
    if (stale)
      await page.evaluate(() => {
        const op = JSON.parse(sessionStorage.getItem("mock-pending-media")!);
        op.scope.jobId = "deleted-job";
        sessionStorage.setItem("mock-pending-media", JSON.stringify(op));
      });
    await page.reload();
    const form = page.getByRole("dialog", {
      name: "Wybrane zdjęcia",
      exact: true,
    });
    await expect(form).toBeVisible();
    await expect(form.getByText(/Wybrano 1 zdjęć/)).toBeVisible();
    expect((await snapshot(page)).photos).toHaveLength(0);
    if (stale) {
      await expect(form.getByRole("alert")).toContainText("Poprzedni cel");
      await expect(form.getByLabel(/^Klient\ zdjęcia/)).toHaveValue("");
      await form.getByLabel(/^Klient\ zdjęcia/).selectOption("client-1");
      await form.getByLabel(/^Ogród\ zdjęcia/).selectOption("garden-1");
      await form.getByLabel(/^Zlecenie\ zdjęcia/).selectOption("field-today");
    } else
      await expect(form.getByLabel(/^Zlecenie\ zdjęcia/)).toHaveValue(
        "field-today",
      );
    await page.evaluate(() =>
      (window as any).gmEmit("appRestoredResult", {
        pluginId: "GardenCamera",
        methodName: "acquire",
        success: true,
      }),
    );
    await expect(
      page.getByRole("dialog", { name: "Wybrane zdjęcia", exact: true }),
    ).toHaveCount(1);
    await form
      .getByRole("button", { name: "Zapisz zdjęcia", exact: true })
      .click();
    await expect(form).toBeHidden();
    await settled(page);
    expect((await snapshot(page)).photos).toHaveLength(1);
    expect((await snapshot(page)).photos[0].jobId).toBe("field-today");
    await page.reload();
    await expect(form).toBeHidden();
    expect((await snapshot(page)).photos).toHaveLength(1);
  });
test("unrelated restored file operation produces no process-death warning", async ({
  page,
}) => {
  await mockAndroid(page);
  await page.goto(fieldURL);
  const before = await snapshot(page);
  await page.evaluate(() =>
    (window as any).gmEmit("appRestoredResult", {
      pluginId: "GardenFiles",
      methodName: "pickBackup",
      success: false,
      error: { message: "cancelled" },
    }),
  );
  await expect(page.locator(".native-notice")).toBeHidden();
  expect(await snapshot(page)).toEqual(before);
});

test('unmounting a gallery keeps an unconfirmed native selection available without writing it',async({page})=>{
  await mockAndroid(page);await page.goto(fieldURL);
  await page.getByRole('button',{name:'Zrób zdjęcie',exact:true}).click();await settled(page);
  await expect(page.getByText(/Wybrano 1 zdjęć/)).toBeVisible();
  page.once('dialog',d=>d.accept());
  await page.getByRole('navigation',{name:'Nawigacja główna',exact:true}).getByRole('button',{name:'Pulpit',exact:true}).click();
  const recovered=page.getByRole('dialog',{name:'Wybrane zdjęcia',exact:true});await expect(recovered).toBeVisible();
  expect((await snapshot(page)).photos).toHaveLength(0);await expect(recovered.getByLabel(/^Zlecenie zdjęcia/)).toHaveValue('field-today');
  await recovered.getByRole('button',{name:'Zapisz zdjęcia',exact:true}).click();await expect(recovered).toBeHidden();await settled(page);
  expect((await snapshot(page)).photos).toHaveLength(1);
});
