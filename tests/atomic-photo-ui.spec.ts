import { test, expect } from "@playwright/test";
import { data } from "./atomic-report-helpers";
test("a late background read cannot resurrect a deleted recovery point", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.addInitScript((data) => {
    if (!localStorage.getItem("garden-manager:v1"))
      localStorage.setItem(
        "garden-manager:v1",
        JSON.stringify({ version: 9, data }),
      );
  }, data());
  await page.goto("/");
  await page.locator(".app-shell").waitFor();
  await page.evaluate(async () => {
    const [
      { AtomicRepository, atomicStore },
      { PhotoService },
      { IndexedDbPhotoRepository },
      { sha256 },
    ] = await Promise.all(
      [
        "/src/data/atomic.ts",
        "/src/photos/service.ts",
        "/src/photos/assets.ts",
        "/src/photos/images.ts",
      ].map((p) => import(p)),
    );
    const repo = new AtomicRepository(localStorage),
      store = atomicStore(
        repo,
        await repo.initialize(),
        () => {},
        () => {},
      ),
      assets = new IndexedDbPhotoRepository();
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 16;
    const blob = await new Promise<Blob>((r) =>
      canvas.toBlob((b) => r(b!), "image/jpeg"),
    );
    const hash = await sha256(blob);
    const processor = {
      process: async () => ({
        image: blob,
        thumbnail: blob,
        width: 16,
        height: 16,
        thumbnailWidth: 16,
        thumbnailHeight: 16,
        sha256: hash,
        thumbnailSha256: hash,
      }),
    };
    const photos = new PhotoService(store, assets, processor);
    const archive = await photos.exportFull(),
      preview = await photos.prepare(archive);
    await photos.importFull(preview.prepared, preview.expected);
    await photos.add([{ name: "obserwacja.jpg", blob }], {
      category: "before",
      description: "",
      capturedDate: "2026-11-02",
      clientId: "client-1",
      gardenId: "garden-1",
      zoneId: null,
      jobId: null,
    });
    store.dispose();
    await repo.close();
  });
  await page.reload();
  await page
    .getByRole("button", {
      name: "Ustawienia konta demonstracyjnego",
      exact: true,
    })
    .click();
  const settings = page.getByRole("dialog", {
    name: "Ustawienia",
    exact: true,
  });
  await expect(
    settings.getByRole("button", {
      name: "Usuń punkt odzyskiwania",
      exact: true,
    }),
  ).toBeVisible();
  await page.evaluate(async () => {
    const [{ AtomicRepository }, { PhotoService }] = await Promise.all(
      ["/src/data/atomic.ts", "/src/photos/service.ts"].map((p) => import(p)),
    );
    const original = PhotoService.prototype.recovery;
    let arm = true;
    PhotoService.prototype.recovery = async function () {
      const result = await original.call(this);
      if (arm) {
        arm = false;
        return new Promise((r) => {
          (window as any).releaseOldRecovery = () => r(result);
        });
      }
      return result;
    };
    const repo = new AtomicRepository(localStorage);
    await repo.initialize();
    await repo.command((s: any) => {
      const photo = s.data.photos[0];
      s.markPhotoDeleted(photo.id, photo.revision);
      s.finalizePhotoDeletion([photo.id]);
      s.appendPhotos([{ ...photo, id: crypto.randomUUID(), revision: 1 }]);
    });
    const channel = new BroadcastChannel("garden-manager-state");
    channel.postMessage("changed");
    channel.close();
  });
  await page.waitForFunction(() => !!(window as any).releaseOldRecovery);
  await settings
    .getByRole("button", { name: "Usuń punkt odzyskiwania", exact: true })
    .click();
  await settings
    .getByRole("button", { name: "Potwierdź usunięcie punktu", exact: true })
    .click();
  await expect(
    settings.getByRole("button", {
      name: "Usuń punkt odzyskiwania",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.evaluate(() => (window as any).releaseOldRecovery());
  await page.evaluate(
    () =>
      new Promise<void>((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => r())),
      ),
  );
  await expect(
    settings.getByRole("button", {
      name: "Usuń punkt odzyskiwania",
      exact: true,
    }),
  ).toHaveCount(0);
});
