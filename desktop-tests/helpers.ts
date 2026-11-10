import {
  _electron,
  expect,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
export async function launch(
  profile?: string,
  executablePath?: string,
  args: string[] = [],
) {
  const dir = profile ?? (await mkdtemp(path.join(tmpdir(), "gm010-")));
  const instance = await _electron.launch({
    executablePath,
    args: executablePath ? args : [path.resolve("."), ...args],
    env: { ...process.env, GM_DESKTOP_TEST: "1", GM_DESKTOP_TEST_PROFILE: dir },
    timeout: 45000,
  });
  const page = await instance.firstWindow();
  page.on("pageerror", (error) =>
    console.error("Electron renderer error:", error.message),
  );
  page.on("console", (message) => {
    if (message.type() === "error")
      console.error("Electron console:", message.text());
  });
  await page.locator(".app-shell").waitFor();
  return { instance, page, profile: dir };
}
export async function route(p: Page, hash: string) {
  await p.evaluate((hash) => {
    location.hash = hash;
  }, hash);
}
export async function snapshot(p: Page) {
  return p.evaluate(
    () =>
      new Promise<any>((resolve, reject) => {
        const q = indexedDB.open("garden-manager-state", 1);
        q.onerror = () => reject(q.error);
        q.onsuccess = () => {
          const db = q.result,
            t = db.transaction("state"),
            r = t.objectStore("state").get("current");
          r.onsuccess = () => resolve(r.result.data);
          t.oncomplete = () => db.close();
        };
      }),
  );
}
export async function metadata(p: Page) {
  return p.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const q = indexedDB.open("garden-manager-photos", 1);
      q.onsuccess = () => resolve(q.result);
      q.onerror = () => reject(q.error);
    });
    const list = await new Promise<any[]>((resolve, reject) => {
      const t = db.transaction("assets"),
        q = t.objectStore("assets").getAll();
      q.onsuccess = () => resolve(q.result);
      q.onerror = () => reject(q.error);
    });
    db.close();
    const digest = async (b: Blob) =>
      Array.from(
        new Uint8Array(
          await crypto.subtle.digest("SHA-256", await b.arrayBuffer()),
        ),
      )
        .map((x) => x.toString(16).padStart(2, "0"))
        .join("");
    return Promise.all(
      list.map(async (a) => ({
        id: a.id,
        image: await digest(a.image),
        thumbnail: await digest(a.thumbnail),
      })),
    );
  });
}
/** Only the native OS dialog is controlled; production IPC, fs writes and parser stay real. */
export async function saveDialog(
  app: ElectronApplication,
  file: string | null,
) {
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = async () =>
      file
        ? { canceled: false, filePath: file }
        : { canceled: true, filePath: "" };
  }, file);
}
export async function openDialog(
  app: ElectronApplication,
  file: string | null,
) {
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () =>
      file
        ? { canceled: false, filePaths: [file] }
        : { canceled: true, filePaths: [] };
  }, file);
}
export async function addExpense(page: Page, name = "Wydatek Łódź") {
  await route(page, "#expenses");
  await page
    .getByRole("button", { name: "Dodaj wydatek", exact: true })
    .click();
  const f = page.getByRole("dialog", { name: "Nowy wydatek", exact: true });
  await f.getByLabel("Kontrahent", { exact: true }).fill(name);
  await f.getByLabel("Kwota (zł)", { exact: true }).fill("123,45");
  await f.getByRole("button", { name: "Zapisz wydatek", exact: true }).click();
  await expect(f).toHaveCount(0);
}
export async function addPhoto(page: Page) {
  await route(page, "#jobs?job=job-1&section=photos");
  const gallery = page.getByRole("region", {
    name: "Galeria zlecenia i wizyty",
    exact: true,
  });
  await gallery
    .getByRole("button", { name: "Dodaj zdjęcia", exact: true })
    .click();
  await gallery
    .getByLabel("Zdjęcia z urządzenia", { exact: true })
    .setInputFiles(path.resolve("src/reports/fixtures/garden.jpg"));
  await gallery
    .getByRole("button", { name: "Zapisz zdjęcia", exact: true })
    .click();
  await expect(gallery.locator(".photo-card")).toHaveCount(1);
}
export async function exportButton(page: Page, name: string) {
  await page
    .getByRole("dialog", { name: "Ustawienia", exact: true })
    .getByRole("button", { name, exact: true })
    .click();
  await expect(page.locator("html")).not.toHaveAttribute("aria-busy", "true");
}
export async function jsonFile(file: string) {
  return JSON.parse(await readFile(file, "utf8"));
}
