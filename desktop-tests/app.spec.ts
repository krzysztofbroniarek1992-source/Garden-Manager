import { test, expect } from "@playwright/test";
import { readFile, writeFile, mkdtemp, stat } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { PDFDocument } from "pdf-lib";
import { createHash } from "node:crypto";
import {
  launch,
  route,
  snapshot,
  metadata,
  saveDialog,
  openDialog,
  addExpense,
  addPhoto,
  exportButton,
  jsonFile,
} from "./helpers";

test("real Electron: private secure origin, isolated renderer, offline modules, external content and file traversal denied", async () => {
  const { instance, page, profile } = await launch();
  try {
    expect(new URL(page.url()).protocol).toBe("app:");
    expect(
      await instance.evaluate(({ app }) => [
        app.getPath("userData"),
        app.getPath("sessionData"),
      ]),
    ).toEqual([profile, profile]);
    expect(
      await page.evaluate(async () => ({
        origin: location.origin,
        secure: isSecureContext,
        idb: !!indexedDB,
        node: typeof (window as any).require,
        locks: await navigator.locks.request("gm010", () => true),
        workers: navigator.serviceWorker
          ? (await navigator.serviceWorker.getRegistrations().catch(() => []))
              .length
          : 0,
      })),
    ).toEqual({
      origin: "app://garden-manager",
      secure: true,
      idb: true,
      node: "undefined",
      locks: true,
      workers: 0,
    });
    expect(await page.evaluate(() => window.gardenDesktop!.security)).toEqual({
      sandboxed: true,
      isolated: true,
    });
    const before = await snapshot(page);
    await instance.context().setOffline(true);
    const labels: Record<string, string> = {
      dashboard: "Panel główny",
      field: "Tryb terenowy",
      clients: "Klienci",
      gardens: "Obiekty i ogrody",
      jobs: "Zlecenia",
      calendar: "Kalendarz",
      history: "Historia prac",
      materials: "Materiały",
      calculators: "Kalkulatory",
      notes: "Notatki",
      todos: "Do zrobienia",
      templates: "Szablony prac",
      expenses: "Wydatki firmowe",
    };
    for (const id of [
      "dashboard",
      "field",
      "clients",
      "gardens",
      "jobs",
      "calendar",
      "history",
      "materials",
      "calculators",
      "notes",
      "todos",
      "templates",
      "expenses",
    ]) {
      await route(page, "#" + id);
      await expect(
        page.locator(".sidebar .nav-item[aria-current=page]"),
      ).toContainText(labels[id]);
      await expect(page.locator("main")).toBeVisible();
      await expect(page.locator("main h1")).toHaveCount(1);
    }
    await route(page, "#calendar");
    await page.reload();
    await expect(page.locator(".app-shell")).toBeVisible();
    expect(await snapshot(page)).toEqual(before);
    await page.keyboard.press("Alt+ArrowLeft");
    await expect(page).toHaveURL(/#expenses$/);
    await page.keyboard.press("Alt+ArrowRight");
    await expect(page).toHaveURL(/#calendar$/);
    expect(
      await page.evaluate(async () => {
        try {
          await fetch("https://example.com/");
          return "loaded";
        } catch {
          return "blocked";
        }
      }),
    ).toBe("blocked");
    for (const url of [
      "app://garden-manager/%2e%2e%2fpackage.json",
      "app://garden-manager/desktop/build/main.cjs",
      "app://garden-manager/%5c..%5cpackage.json",
    ])
      expect(
        await page.evaluate(async (u) => (await fetch(u)).status, url),
      ).toBe(404);
    await page.evaluate(() => window.open("https://example.com/"));
    expect(
      await instance.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
      ),
    ).toBe(1);
    expect(
      await page.evaluate(async () => {
        try {
          await window.gardenDesktop!.beginSave({
            name: "bad.pdf",
            mime: "application/pdf",
            size: 1,
            path: "C:/bad",
          } as any);
          return "allowed";
        } catch {
          return "blocked";
        }
      }),
    ).toBe("blocked");
  } finally {
    await instance.close();
  }
});

test("nested client, garden and material forms preserve the job draft in Electron", async () => {
  const { instance, page } = await launch();
  try {
    await route(page, "#jobs?dialog=new-job");
    const job = page.getByRole("dialog", {
      name: "Nowe zlecenie",
      exact: true,
    });
    await job
      .getByLabel("Nazwa pracy", { exact: true })
      .fill("Wizyta Windows Łódź");
    for (const kind of ["client", "garden", "material"]) {
      await job
        .getByRole("button", {
          name:
            kind === "client"
              ? "+ Nowy klient"
              : kind === "garden"
                ? "+ Nowy ogród"
                : "+ Nowy materiał w katalogu",
          exact: true,
        })
        .click();
      const child = page.getByRole("dialog", {
        name:
          kind === "client"
            ? "Nowy klient"
            : kind === "garden"
              ? "Nowy ogród"
              : "Nowy materiał",
        exact: true,
      });
      if (kind === "client")
        await child
          .getByLabel("Imię i nazwisko / nazwa firmy *", { exact: true })
          .fill("Łódź — Windows");
      if (kind === "garden") {
        await child
          .getByLabel("Nazwa ogrodu *", { exact: true })
          .fill("Żółty ogród");
        await child.getByLabel("Adres *", { exact: true }).fill("Łąkowa 10");
      }
      if (kind === "material") {
        await child
          .getByLabel("Nazwa materiału", { exact: true })
          .fill("Kora Windows");
        await child.getByLabel("Kategoria", { exact: true }).fill("Podłoża");
      }
      await child
        .getByRole("button", {
          name:
            kind === "client"
              ? "Dodaj klienta"
              : kind === "garden"
                ? "Dodaj ogród"
                : "Zapisz materiał",
          exact: true,
        })
        .click();
      await expect(child).toHaveCount(0);
    }
    await expect(job.getByLabel("Nazwa pracy", { exact: true })).toHaveValue(
      "Wizyta Windows Łódź",
    );
    await job
      .getByRole("button", { name: "Zapisz zlecenie", exact: true })
      .click();
    await expect(job).toHaveCount(0);
    const d = await snapshot(page);
    expect(
      d.jobs.some(
        (j: any) =>
          j.title === "Wizyta Windows Łódź" &&
          j.materials.some((m: any) => m.name === "Kora Windows"),
      ),
    ).toBe(true);
  } finally {
    await instance.close();
  }
});

test("native file bridge: CSV decisions, actual PDF, JSON, ZIP with photo and restore, cancellation and invalid input", async () => {
  const { instance, page, profile } = await launch();
  const folder = await mkdtemp(path.join(tmpdir(), "Łódź-GM010-"));
  try {
    await addExpense(page);
    await addPhoto(page);
    const before = await snapshot(page);
    const csv = path.join(folder, "wyciąg.csv");
    await writeFile(
      csv,
      "Data;Kwota;Kontrahent;Opis;ID\n10.11.2026;-12,30;ORLEN;Paliwo;1\n10.11.2026;200,00;Klient;Wpłata;2",
      "utf8",
    );
    await openDialog(instance, csv);
    await route(page, "#expenses");
    await page
      .getByRole("button", { name: "Importuj CSV", exact: true })
      .click();
    const m = page.getByRole("dialog", {
      name: "Import wyciągu CSV",
      exact: true,
    });
    await m
      .getByLabel("Nazwa profilu rachunku", { exact: true })
      .fill("Konto Windows");
    await m
      .getByRole("button", { name: "Wybierz CSV z urządzenia", exact: true })
      .click();
    for (const [name, value] of [
      ["Data", "0"],
      ["Kwota ze znakiem", "1"],
      ["Kontrahent", "2"],
      ["Opis", "3"],
      ["ID operacji bankowej", "4"],
    ])
      await m.getByRole("combobox", { name, exact: true }).selectOption(value);
    await m
      .getByRole("button", {
        name: "Zapisz profil i sprawdź operacje",
        exact: true,
      })
      .click();
    await expect(m).toContainText("Nowe: 2");
    await m
      .getByRole("button", {
        name: "Zatwierdź nowe obciążenia bez ostrzeżeń",
        exact: true,
      })
      .click();
    page.once("dialog", (d) => d.accept());
    await m.getByRole("button", { name: /^Zapisz import/ }).click();
    await expect(m).toHaveCount(0);
    let d = await snapshot(page);
    expect(d.expenses).toHaveLength(3);
    expect(d.payments).toEqual(before.payments);
    expect(d.jobs).toEqual(before.jobs);
    // Production renderer and local fonts, rather than a replacement PDF engine.
    await route(page, "#history?report=job-5");
    const report = page.getByRole("dialog", {
      name: "Raport PDF dla klienta",
      exact: true,
    });
    await report
      .getByRole("button", { name: "Przygotuj podgląd raportu", exact: true })
      .click();
    await expect(
      report.getByRole("region", { name: "Podgląd raportu", exact: true }),
    ).toBeVisible();
    const pdf = path.join(folder, "raport Łódź.pdf");
    await saveDialog(instance, pdf);
    await report
      .getByRole("button", { name: "Zapisz raport i pobierz PDF", exact: true })
      .click();
    await expect(report).toContainText("Raport zapisany w historii");
    expect(
      (await PDFDocument.load(await readFile(pdf))).getPageCount(),
    ).toBeGreaterThan(0);
    await report
      .getByRole("button", { name: "Pokaż plik PDF", exact: true })
      .click();
    await expect(report.locator("iframe")).toBeVisible();
    await route(page, "#dashboard?dialog=settings");
    const json = path.join(folder, "dane.json");
    await saveDialog(instance, json);
    await exportButton(page, "Eksportuj dane");
    expect((await jsonFile(json)).version).toBe(11);
    const zip = path.join(folder, "pełna kopia.zip");
    await saveDialog(instance, zip);
    await exportButton(page, "Pobierz pełną kopię ZIP");
    await expect
      .poll(async () => {
        try {
          return (await stat(zip)).size;
        } catch {
          return 0;
        }
      })
      .toBeGreaterThan(1000);
    const saved = await snapshot(page),
      hashes = await metadata(page);
    await openDialog(instance, zip);
    const settings = page.getByRole("dialog", {
      name: "Ustawienia",
      exact: true,
    });
    await settings
      .getByRole("button", { name: "Wczytaj pełną kopię ZIP", exact: true })
      .click();
    await settings
      .getByRole("checkbox", {
        name: "Rozumiem, że bieżący zestaw zostanie zastąpiony.",
        exact: true,
      })
      .check();
    await settings.getByLabel("Wpisz ODTWÓRZ", { exact: true }).fill("ODTWÓRZ");
    await settings
      .getByRole("button", { name: "Odtwórz dane i zdjęcia", exact: true })
      .click();
    await expect(settings).toContainText("Dane i zdjęcia zostały odtworzone");
    const restored = await snapshot(page);
    for (const k of [
      "clients",
      "gardens",
      "jobs",
      "expenses",
      "expenseImports",
      "expenseProfiles",
      "payments",
      "timer",
    ])
      expect(restored[k]).toEqual(saved[k]);
    expect(
      (await metadata(page))
        .filter((a) => restored.photos.some((p: any) => p.assetId === a.id))
        .map((a) => a.image),
    ).toEqual(hashes.map((a) => a.image));
    await saveDialog(instance, null);
    await exportButton(page, "Eksportuj dane");
    await expect(settings).toContainText("Anulowano zapis JSON");
    await openDialog(instance, null);
    await settings
      .getByRole("button", { name: "Wczytaj pełną kopię ZIP", exact: true })
      .click();
    expect((await snapshot(page)).expenses).toEqual(saved.expenses);
    const bad = path.join(folder, "uszkodzona.zip");
    await writeFile(bad, "not a ZIP");
    await openDialog(instance, bad);
    await settings
      .getByRole("button", { name: "Wczytaj pełną kopię ZIP", exact: true })
      .click();
    await expect(settings.getByRole("alert")).toBeVisible();
    expect((await snapshot(page)).jobs).toEqual(saved.jobs);
  } finally {
    await instance.close();
  }
  // The actual profile is independent from the working directory and installation.
  const reopened = await launch(profile);
  try {
    expect((await snapshot(reopened.page)).expenses).toHaveLength(3);
  } finally {
    await reopened.instance.close();
  }
});

test("close guard rejects dirty drafts and pending writes; reopening preserves the timer", async () => {
  const a = await launch();
  let closed = false;
  try {
    await route(a.page, "#expenses");
    await a.page
      .getByRole("button", { name: "Dodaj wydatek", exact: true })
      .click();
    const f = a.page.getByRole("dialog", { name: "Nowy wydatek", exact: true });
    await f.getByLabel("Kontrahent", { exact: true }).fill("Szkic Windows");
    a.page.once("dialog", (d) => d.dismiss());
    await a.instance.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].close(),
    );
    await expect(f).toBeVisible();
    await f.getByLabel("Kwota (zł)", { exact: true }).fill("12,34");
    await a.page.evaluate(() => {
      const q = indexedDB.open("garden-manager-state", 1);
      q.onsuccess = () => {
        const db = q.result,
          t = db.transaction("state", "readwrite"),
          s = t.objectStore("state");
        let done = false;
        (window as any).releaseWrite = () => (done = true);
        const pump = () => {
          s.get("current").onsuccess = () => {
            if (!done) pump();
          };
        };
        pump();
        t.oncomplete = () => db.close();
      };
    });
    await a.page.waitForFunction(() => !!(window as any).releaseWrite);
    await f
      .getByRole("button", { name: "Zapisz wydatek", exact: true })
      .click();
    await expect(a.page.locator("html")).toHaveAttribute("aria-busy", "true");
    await a.instance.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].close(),
    );
    await expect(f).toBeVisible();
    await a.page.evaluate(() => (window as any).releaseWrite());
    await expect(f).toHaveCount(0);
    await route(a.page, "#field?field=job-1");
    await a.page
      .getByRole("button", { name: /START — Rozpocznij pomiar/ })
      .click();
    await expect
      .poll(async () => (await snapshot(a.page)).timer?.jobId)
      .toBe("job-1");
    const initial = await snapshot(a.page);
    await a.instance.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].minimize(),
    );
    await a.instance.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].restore(),
    );
    expect((await snapshot(a.page)).timer).toEqual(initial.timer);
    const exited = new Promise<void>((resolve) =>
      a.instance.process().once("exit", () => resolve()),
    );
    await a.instance.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].close(),
    );
    await exited;
    closed = true;
    const b = await launch(a.profile);
    try {
      const after = await snapshot(b.page);
      expect(after.timer).toEqual(initial.timer);
      expect(after.expenses).toEqual(initial.expenses);
      expect(Date.now() - after.timer.startedAt).toBeGreaterThan(0);
    } finally {
      await b.instance.close();
    }
  } finally {
    if (!closed) await a.instance.close();
  }
});

for (const scale of ["1", "1.25", "1.5", "2"])
  test(`real Electron layout at ${scale} scale, resize and keyboard focus`, async () => {
    const { instance, page } = await launch(undefined, undefined, [
      "--force-device-scale-factor=" + scale,
    ]);
    try {
      await instance.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setSize(1000, 760),
      );
      await route(page, "#expenses");
      await page
        .getByRole("button", { name: "Dodaj wydatek", exact: true })
        .click();
      const f = page.getByRole("dialog", { name: "Nowy wydatek", exact: true });
      await f.getByLabel("Kwota (zł)", { exact: true }).focus();
      await page.keyboard.press("Tab");
      await expect(f.getByLabel("Kontrahent", { exact: true })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(f).toHaveCount(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    } finally {
      await instance.close();
    }
  });

test("the native file bridge streams 200 MB without base64 or arbitrary destination paths", async () => {
  test.setTimeout(180000);
  const { instance, page } = await launch();
  try {
    const file = path.join(
      await mkdtemp(path.join(tmpdir(), "gm010-large-")),
      "pełna.zip",
    );
    await saveDialog(instance, file);
    await page.evaluate(async () => {
      const p = window.gardenDesktop!,
        size = 200 * 1024 * 1024;
      const { token } = await p.beginSave({
        name: "pełna.zip",
        mime: "application/zip",
        size,
      });
      const chunk = new Uint8Array(192 * 1024);
      for (let offset = 0; offset < size; offset += chunk.length)
        await p.write({
          token: token!,
          offset,
          bytes: chunk.subarray(0, Math.min(chunk.length, size - offset)),
        });
      await p.finish({ token: token!, open: false });
    });
    expect((await stat(file)).size).toBe(200 * 1024 * 1024);
    const actual = createHash("sha256");
    const { createReadStream } = await import("node:fs");
    for await (const chunk of createReadStream(file)) actual.update(chunk);
    const expected = createHash("sha256"),
      zero = Buffer.alloc(1024 * 1024);
    for (let i = 0; i < 200; i++) expected.update(zero);
    expect(actual.digest("hex")).toBe(expected.digest("hex"));
  } finally {
    await instance.close();
  }
});
test("second process activates the existing instance and cannot open another database window", async () => {
  const { instance, page, profile } = await launch();
  try {
    const { spawn } = await import("node:child_process");
    const child = spawn(instance.process().spawnfile, [path.resolve(".")], {
      env: {
        ...process.env,
        GM_DESKTOP_TEST: "1",
        GM_DESKTOP_TEST_PROFILE: profile,
      },
      stdio: "ignore",
    });
    const code = await new Promise<number | null>((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill();
        reject(Error("Second instance did not exit"));
      }, 15000);
      child.once("exit", (code) => {
        clearTimeout(timeout);
        resolve(code);
      });
      child.once("error", reject);
    });
    expect(code).toBe(0);
    expect(
      await instance.evaluate(
        ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
      ),
    ).toBe(1);
    await expect(page.locator(".app-shell")).toBeVisible();
  } finally {
    await instance.close();
  }
});
