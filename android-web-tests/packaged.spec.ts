import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { mockAndroid } from "../tests/android-bridge-fixture";
import { data, preview, snapshot } from "../tests/atomic-report-helpers";
import { settled } from "../tests/atomic-fixture";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

test("packaged assets: first boot, PDF fonts and reload without a server or network (Chromium simulation)", async ({
  page,
  context,
}) => {
  await mockAndroid(page, data());
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== "http://127.0.0.1:4197")
      throw new Error("Unexpected external request: " + url);
    const path = resolve(
      "dist",
      "." + (url.pathname === "/" ? "/index.html" : url.pathname),
    );
    if (!path.startsWith(resolve("dist") + "/"))
      throw new Error("Unsafe asset path");
    const types: Record<string, string> = {
      ".html": "text/html",
      ".js": "application/javascript",
      ".css": "text/css",
      ".ttf": "font/ttf",
      ".png": "image/png",
      ".svg": "image/svg+xml",
    };
    try {
      await route.fulfill({
        body: await readFile(path),
        contentType: types[extname(path)] || "application/octet-stream",
      });
    } catch {
      await route.fulfill({ status: 404, body: "Missing packaged asset" });
    }
  });
  await context.setOffline(true);
  await page.goto("/#dashboard");
  await expect(page.locator(".app-shell")).toBeVisible();
  expect(await page.evaluate(() => navigator.onLine)).toBe(false);
  expect(
    await page.evaluate(
      async () => (await navigator.serviceWorker.getRegistrations()).length,
    ),
  ).toBe(0);
  const panel = await preview(page, "Raport atomowy 1");
  await panel
    .getByRole("button", { name: "Zapisz raport i pobierz PDF", exact: true })
    .click();
  await settled(page);
  const exported = await page.evaluate(() => (window as any).gmNative.lastFile);
  const bytes = Uint8Array.from(
    Buffer.concat(
      exported.chunks.map((c: any) => Buffer.from(c.base64, "base64")),
    ),
  );
  expect(Buffer.from(bytes).subarray(0, 4).toString()).toBe("%PDF");
  const pdf = await getDocument({
    data: bytes,
    useSystemFonts: false,
    isEvalSupported: false,
  }).promise;
  const content = await (await pdf.getPage(1)).getTextContent();
  expect(content.items.map((i: any) => i.str ?? "").join(" ")).toContain(
    "RAPORT WYKONANYCH PRAC",
  );
  await pdf.destroy();
  const before = await snapshot(page);
  expect(before.reportSequence).toBe(1);
  await page.reload();
  await expect(page.locator(".app-shell")).toBeVisible();
  expect((await snapshot(page)).jobs).toEqual(before.jobs);
  expect(errors).toEqual([]);
});
