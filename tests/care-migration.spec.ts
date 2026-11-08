import { test, expect, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { finalData, finalClock } from "./final-navigation-fixture";
import {
  STORAGE_KEY,
  STORAGE_VERSION,
  validateData,
} from "../src/data/repository";
import { taskOccurrencesBetween } from "../src/planning/occurrences";
import { settled, setChecked } from "./atomic-fixture";

// Start on an inert same-origin document: no v10 application can touch the v9
// authority until the actual browser databases and photo blobs are in place.
async function seedV9(
  page: Page,
  options: { marker?: 9; mirror?: "corrupt" | "v9"; timer?: boolean } = {},
) {
  await page.clock.setFixedTime(finalClock);
  await page.route("**/__gm005_v9_probe", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>v9 database probe</title>",
    }),
  );
  await page.goto("/__gm005_v9_probe");
  const source = finalData();
  if (options.timer !== false) {
    source.jobs.find((j) => j.id === "finance-pending")!.status = "in-progress";
    source.timer = {
      jobId: "finance-pending",
      startedAt: finalClock.getTime() - 61500,
      paused: true,
      remainderMs: 500,
    };
  }
  const data = await page.evaluate(
    async ({ source, at, marker, mirror }) => {
      const canvas = document.createElement("canvas");
      canvas.width = 40;
      canvas.height = 30;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#397346";
      ctx.fillRect(0, 0, 40, 30);
      const image = await new Promise<Blob>((r) =>
        canvas.toBlob((b) => r(b!), "image/jpeg", 0.85),
      );
      canvas.width = 20;
      canvas.height = 15;
      canvas.getContext("2d")!.fillRect(0, 0, 20, 15);
      const thumbnail = await new Promise<Blob>((r) =>
        canvas.toBlob((b) => r(b!), "image/jpeg", 0.8),
      );
      const hash = async (blob: Blob) =>
        Array.from(
          new Uint8Array(
            await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()),
          ),
          (n) => n.toString(16).padStart(2, "0"),
        ).join("");
      const job = source.jobs.find((j) => j.id === "job-1")!,
        garden = source.gardens.find((g) => g.id === job.gardenId)!,
        client = source.clients.find((c) => c.id === garden.clientId)!,
        zone = garden.zones[0];
      source.photos = [
        {
          id: "photo-v9-native",
          assetId: "asset-v9-native",
          filename: "v9-ogrod.jpg",
          category: "before",
          description: "Dokumentacja zachowana z v9",
          capturedDate: "2026-11-01",
          clientId: client.id,
          gardenId: garden.id,
          zoneId: zone.id,
          jobId: job.id,
          clientName: client.name,
          gardenName: garden.name,
          zoneName: zone.name,
          jobTitle: job.title,
          addedAt: at,
          updatedAt: at,
          deletedAt: null,
          revision: 1,
          mimeType: "image/jpeg",
          width: 40,
          height: 30,
          thumbnailWidth: 20,
          thumbnailHeight: 15,
          size: image.size,
          thumbnailSize: thumbnail.size,
          sha256: await hash(image),
          thumbnailSha256: await hash(thumbnail),
        },
      ];
      const [{ IndexedDbPhotoRepository }] = await Promise.all(
        ["/src/photos/assets.ts"].map((p) => import(p)),
      );
      const assets = new IndexedDbPhotoRepository();
      await assets.putMany([
        { id: "asset-v9-native", image, thumbnail, createdAt: at },
      ]);
      await new Promise<void>((resolve, reject) => {
        const r = indexedDB.open("garden-manager-state", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("state");
        r.onerror = () => reject(r.error);
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction("state", "readwrite");
          tx.objectStore("state").put(
            {
              revision: 73,
              data: source,
              ...(marker === 9 ? { formatVersion: 9 } : {}),
            },
            "current",
          );
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onabort = () => reject(tx.error);
        };
      });
      localStorage.setItem(
        "garden-manager:v1",
        mirror === "corrupt"
          ? "deliberately invalid mirror"
          : JSON.stringify({ version: 9, data: source }),
      );
      return source;
    },
    {
      source,
      at: finalClock.getTime(),
      marker: options.marker,
      mirror: options.mirror,
    },
  );
  validateData(data);
  expect(data.taskSchedules.every((s) => s.care === undefined)).toBe(true);
  return {
    data,
    old: {
      revision: 73,
      data,
      ...(options.marker === 9 ? { formatVersion: 9 } : {}),
    },
  };
}
async function rawState(page: Page) {
  return page.evaluate(
    () =>
      new Promise<any>((resolve, reject) => {
        const open =
            (window as any).migrationNativeOpen ??
            indexedDB.open.bind(indexedDB),
          r = open("garden-manager-state", 1) as IDBOpenDBRequest;
        r.onerror = () => reject(r.error);
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction("state", "readonly"),
            s = tx.objectStore("state"),
            a = s.get("current"),
            b = s.get("format-v9-source");
          tx.oncomplete = () => {
            db.close();
            resolve({ current: a.result, backup: b.result });
          };
          tx.onabort = () => reject(tx.error);
        };
      }),
  );
}
async function photoHashes(page: Page) {
  return page.evaluate(async () => {
    const rows = await new Promise<any[]>((resolve, reject) => {
      const r = indexedDB.open("garden-manager-photos", 1);
      r.onerror = () => reject(r.error);
      r.onsuccess = () => {
        const db = r.result,
          tx = db.transaction("assets", "readonly"),
          get = tx.objectStore("assets").getAll();
        tx.oncomplete = () => {
          db.close();
          resolve(get.result);
        };
      };
    });
    const hash = async (b: Blob) =>
      Array.from(
        new Uint8Array(
          await crypto.subtle.digest("SHA-256", await b.arrayBuffer()),
        ),
        (n) => n.toString(16).padStart(2, "0"),
      ).join("");
    return Promise.all(
      rows.map(async (a) => ({
        id: a.id,
        image: await hash(a.image),
        thumbnail: await hash(a.thumbnail),
      })),
    );
  });
}
const settings = (p: Page) =>
  p.getByRole("dialog", { name: "Ustawienia", exact: true });
async function download(page: Page, label: string) {
  const promise = page.waitForEvent("download");
  await settings(page)
    .getByRole("button", { name: label, exact: true })
    .click();
  const file = await promise;
  return readFile((await file.path())!);
}
async function restore(page: Page, bytes: Uint8Array) {
  await settings(page)
    .getByLabel("Wczytaj pełną kopię ZIP", { exact: true })
    .setInputFiles({
      name: "migracja.zip",
      mimeType: "application/zip",
      buffer: Buffer.from(bytes),
    });
  await setChecked(
    settings(page).getByRole("checkbox", {
      name: "Rozumiem, że bieżący zestaw zostanie zastąpiony.",
      exact: true,
    }),
    true,
  );
  await settings(page)
    .getByLabel("Wpisz ODTWÓRZ", { exact: true })
    .fill("ODTWÓRZ");
  await settings(page)
    .getByRole("button", { name: "Odtwórz dane i zdjęcia", exact: true })
    .click();
  await expect(settings(page)).toContainText(
    "Dane i zdjęcia zostały odtworzone",
  );
  await settled(page);
}
async function expectPhoto(page: Page) {
  await page.goto("/#gardens?photo=photo-v9-native");
  const image = page
    .getByRole("dialog", { name: "Podgląd zdjęcia", exact: true })
    .locator("img");
  await expect
    .poll(() => image.evaluate((i: HTMLImageElement) => i.naturalWidth))
    .toBe(40);
}

for (const marker of [undefined, 9] as const)
  test(`native v9 IndexedDB (${marker ?? "original unmarked state"}) beats a corrupt mirror and preserves a readable pre-migration backup`, async ({
    page,
    context,
  }) => {
    const source = await seedV9(page, { marker, mirror: "corrupt" }),
      photos = await photoHashes(page),
      projection = taskOccurrencesBetween(
        source.data,
        "2026-11-01",
        "2027-02-28",
      );
    await page.goto("/#dashboard");
    await page.locator(".app-shell").waitFor();
    await settled(page);
    const migrated = await rawState(page);
    expect(migrated.current).toEqual({
      ...source.old,
      formatVersion: STORAGE_VERSION,
    });
    expect(migrated.backup).toEqual(source.old);
    expect(await photoHashes(page)).toEqual(photos);
    expect(
      taskOccurrencesBetween(migrated.current.data, "2026-11-01", "2027-02-28"),
    ).toEqual(projection);
    const backupRead = await page.evaluate(async () => {
      const [{ LocalRepository }] = await Promise.all(
        ["/src/data/repository.ts"].map((p) => import(p)),
      );
      const state = await new Promise<any>((resolve) => {
        const r = indexedDB.open("garden-manager-state", 1);
        r.onsuccess = () => {
          const db = r.result,
            tx = db.transaction("state", "readonly"),
            get = tx.objectStore("state").get("format-v9-source");
          tx.oncomplete = () => {
            db.close();
            resolve(get.result);
          };
        };
      });
      const values = new Map([
        ["garden-manager:v1", JSON.stringify({ version: 9, data: state.data })],
      ]);
      return new LocalRepository({
        getItem: (k: string) => values.get(k) ?? null,
        setItem: (k: string, v: string) => {
          values.set(k, v);
        },
      }).load();
    });
    expect(backupRead).toEqual(source.data);
    await expectPhoto(page);
    await page.reload();
    expect((await rawState(page)).backup).toEqual(source.old);
    const reopened = await context.newPage();
    await reopened.clock.setFixedTime(finalClock);
    await reopened.goto("/#dashboard");
    await reopened.locator(".app-shell").waitFor();
    expect((await rawState(reopened)).current.data).toEqual(source.data);
    expect(await photoHashes(reopened)).toEqual(photos);
    await reopened.close();
  });

for (const target of ["current", "format-v9-source"] as const)
  test(`aborted native migration at ${target} rolls back data and the backup together, then retries safely`, async ({
    page,
  }) => {
    const source = await seedV9(page),
      photos = await photoHashes(page);
    await page.evaluate(() =>
      sessionStorage.setItem("gm005-migration-fault", "yes"),
    );
    await page.addInitScript((target) => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (
        ...args: Parameters<IDBObjectStore["put"]>
      ) {
        const r = put.apply(this, args);
        if (
          sessionStorage.getItem("gm005-migration-fault") === "yes" &&
          this.name === "state" &&
          args[1] === target
        )
          this.transaction.abort();
        return r;
      };
    }, target);
    await page.goto("/#dashboard");
    await page.locator(".app-shell").waitFor();
    await expect(
      page.getByRole("alert").filter({ hasText: "Zapis zablokowano" }),
    ).toBeVisible();
    expect(await rawState(page)).toEqual({
      current: source.old,
      backup: undefined,
    });
    expect(await photoHashes(page)).toEqual(photos);
    expect(
      await page.evaluate(() => localStorage.getItem("garden-manager:v1")),
    ).toBe(JSON.stringify({ version: 9, data: source.data }));
    await page.evaluate(() =>
      sessionStorage.removeItem("gm005-migration-fault"),
    );
    await page.reload();
    await page.locator(".app-shell").waitFor();
    expect((await rawState(page)).current).toEqual({
      ...source.old,
      formatVersion: STORAGE_VERSION,
    });
    expect((await rawState(page)).backup).toEqual(source.old);
    expect(await photoHashes(page)).toEqual(photos);
  });

test("quota during v9 migration keeps authority, photos and raw JSON intact and blocks application saves", async ({
  page,
}) => {
  const source = await seedV9(page),
    photos = await photoHashes(page);
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (
      ...args: Parameters<IDBObjectStore["put"]>
    ) {
      if (
        this.name === "state" &&
        args[1] === "current" &&
        (args[0] as any).formatVersion === 10
      )
        throw new DOMException(
          "Brak miejsca podczas migracji",
          "QuotaExceededError",
        );
      return put.apply(this, args);
    };
  });
  await page.goto("/#dashboard?dialog=settings");
  await expect(settings(page)).toBeVisible();
  await settings(page)
    .getByLabel("Domyślna stawka godzinowa (zł/h)", { exact: true })
    .fill("999");
  await settings(page)
    .getByRole("button", { name: "Zapisz ustawienia", exact: true })
    .click();
  await expect(
    settings(page)
      .getByRole("alert")
      .filter({ hasText: "Brak miejsca podczas migracji" }),
  ).toBeVisible();
  expect(await rawState(page)).toEqual({
    current: source.old,
    backup: undefined,
  });
  expect(await photoHashes(page)).toEqual(photos);
  expect(
    await page.evaluate(() => localStorage.getItem("garden-manager:v1")),
  ).toBe(JSON.stringify({ version: 9, data: source.data }));
});

test("unavailable authoritative IndexedDB prevents writes without deleting v9 data and can recover on reopen", async ({
  page,
}) => {
  const source = await seedV9(page),
    photos = await photoHashes(page);
  await page.evaluate(() =>
    sessionStorage.setItem("gm005-migration-fault", "yes"),
  );
  await page.addInitScript(() => {
    const open = IDBFactory.prototype.open;
    (window as any).migrationNativeOpen = open.bind(indexedDB);
    IDBFactory.prototype.open = function (name: string, version?: number) {
      if (
        name === "garden-manager-state" &&
        sessionStorage.getItem("gm005-migration-fault") === "yes"
      )
        throw new DOMException("Blocked state database", "SecurityError");
      return version === undefined
        ? open.call(this, name)
        : open.call(this, name, version);
    };
  });
  await page.goto("/#dashboard?dialog=settings");
  await expect(settings(page)).toBeVisible();
  await settings(page)
    .getByLabel("Domyślna stawka godzinowa (zł/h)", { exact: true })
    .fill("999");
  await settings(page)
    .getByRole("button", { name: "Zapisz ustawienia", exact: true })
    .click();
  await expect(
    settings(page).getByRole("alert").filter({ hasText: "Zapis zablokowano" }),
  ).toBeVisible();
  expect(await rawState(page)).toEqual({
    current: source.old,
    backup: undefined,
  });
  expect(await photoHashes(page)).toEqual(photos);
  await page.evaluate(() => sessionStorage.removeItem("gm005-migration-fault"));
  await page.reload();
  await page.locator(".app-shell").waitFor();
  expect((await rawState(page)).current.data).toEqual(source.data);
  expect((await rawState(page)).backup).toEqual(source.old);
});

test("v9 JSON and ZIP remain readable and a v10 JSON/ZIP roundtrip preserves legacy schedules, history and photo bytes", async ({
  page,
}) => {
  const source = await seedV9(page, { timer: false });
  await page.goto("/#dashboard?dialog=settings");
  await expect(settings(page)).toBeVisible();
  const json = JSON.parse((await download(page, "Eksportuj dane")).toString());
  expect(json).toEqual({ version: STORAGE_VERSION, data: source.data });
  const archive = await download(page, "Pobierz pełną kopię ZIP"),
    files = unzipSync(archive),
    envelope = JSON.parse(strFromU8(files["data.json"]));
  envelope.version = 9;
  files["data.json"] = strToU8(JSON.stringify(envelope));
  const manifest = JSON.parse(strFromU8(files["manifest.json"]));
  manifest.dataSha256 = createHash("sha256")
    .update(files["data.json"])
    .digest("hex");
  files["manifest.json"] = strToU8(JSON.stringify(manifest));
  await restore(page, zipSync(files));
  let restored = (await rawState(page)).current.data;
  for (const key of [
    "clients",
    "gardens",
    "taskSchedules",
    "taskOccurrences",
    "jobs",
    "payments",
    "timer",
    "notes",
    "checklists",
    "reportSequence",
  ] as const)
    expect(restored[key]).toEqual(source.data[key]);
  expect(restored.photos[0].sha256).toBe(source.data.photos[0].sha256);
  await expectPhoto(page);
  await page.goto("/#dashboard?dialog=settings");
  await settings(page)
    .getByRole("button", { name: "Usuń punkt odzyskiwania", exact: true })
    .click();
  await settings(page)
    .getByRole("button", { name: "Potwierdź usunięcie punktu", exact: true })
    .click();
  await expect(
    settings(page).getByRole("button", {
      name: "Pobierz punkt odzyskiwania ZIP",
      exact: true,
    }),
  ).toHaveCount(0);
  const v10 = await download(page, "Pobierz pełną kopię ZIP"),
    before = (await rawState(page)).current.data;
  await restore(page, v10);
  restored = (await rawState(page)).current.data;
  for (const key of [
    "clients",
    "gardens",
    "taskSchedules",
    "taskOccurrences",
    "jobs",
    "payments",
    "timer",
    "notes",
    "checklists",
    "reportSequence",
  ] as const)
    expect(restored[key]).toEqual(before[key]);
  expect(restored.photos[0].sha256).toBe(before.photos[0].sha256);
  await expectPhoto(page);
  const jsonRead = await page.evaluate(async (raw) => {
    const [{ LocalRepository }] = await Promise.all(
      ["/src/data/repository.ts"].map((p) => import(p)),
    );
    const values = new Map([["garden-manager:v1", raw]]);
    return new LocalRepository({
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => {
        values.set(k, v);
      },
    }).load();
  }, JSON.stringify(json));
  expect(jsonRead).toEqual(source.data);
});
