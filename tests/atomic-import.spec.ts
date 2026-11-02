import { settled } from "./atomic-fixture";
import { test, expect, type Page } from "@playwright/test";
import { data, snapshot } from "./atomic-report-helpers";
test.setTimeout(60_000);
for (const first of ["report", "restore"] as const)
  test(`report versus ZIP restore: ${first} wins without a lost committed report`, async ({
    page,
    context,
  }) => {
    await page.addInitScript((data) => {
      if (!localStorage.getItem("garden-manager:v1"))
        localStorage.setItem(
          "garden-manager:v1",
          JSON.stringify({ version: 9, data }),
        );
    }, data());
    await page.goto("/#history");
    await page.locator(".app-shell").waitFor();
    const other = await context.newPage();
    await other.goto("/#history");
    await other.locator(".app-shell").waitFor();
    const initial = await snapshot(page);
    await page.evaluate(async () => {
      const [
        { AtomicRepository, atomicStore },
        { ReportService },
        { defaultReportOptions },
      ] = await Promise.all(
        [
          "/src/data/atomic.ts",
          "/src/reports/service.ts",
          "/src/reports/model.ts",
        ].map((p) => import(p)),
      );
      const repo = new AtomicRepository(localStorage),
        store = atomicStore(
          repo,
          await repo.initialize(),
          () => {},
          () => {},
        );
      const service = new ReportService(
        store,
        {},
        async () => new Uint8Array([37, 80, 68, 70]),
      );
      (window as any).race = {
        service,
        prepared: await service.prepare("job-1", defaultReportOptions()),
      };
    });
    await other.evaluate(async () => {
      const [
        { AtomicRepository, atomicStore },
        { PhotoService },
        { IndexedDbPhotoRepository },
        { makeFullBackup },
      ] = await Promise.all(
        [
          "/src/data/atomic.ts",
          "/src/photos/service.ts",
          "/src/photos/assets.ts",
          "/src/photos/backup.ts",
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
      const service = new PhotoService(store, assets, {});
      const replacement = structuredClone(await store.snapshot());
      replacement.jobs[0].activities = ["Zakres z odtwarzanej kopii"];
      const archive = await makeFullBackup(replacement, assets, Date.now());
      (window as any).race = { service, ...(await service.prepare(archive)) };
    });
    await page.evaluate(() => {
      void navigator.locks.request(
        "garden-manager-photos",
        () =>
          new Promise<void>((r) => {
            (window as any).releaseRace = r;
          }),
      );
    });
    await page.waitForFunction(() => !!(window as any).releaseRace);
    const begin = async (p: Page, kind: "report" | "restore") =>
      p.evaluate((kind) => {
        const r = (window as any).race;
        r.result = null;
        const operation =
          kind === "report"
            ? r.service.save("job-1", r.prepared)
            : r.service.importFull(r.prepared, r.expected);
        void operation.then(
          () => {
            r.result = { ok: true };
          },
          (e: Error) => {
            r.result = { ok: false, message: e.message };
          },
        );
      }, kind);
    if (first === "report") {
      await begin(page, "report");
    } else {
      await begin(other, "restore");
    }
    await page.waitForFunction(
      async () =>
        ((await navigator.locks.query()).pending ?? []).filter(
          (l) => l.name === "garden-manager-photos",
        ).length === 1,
    );
    if (first === "report") {
      await begin(other, "restore");
    } else {
      await begin(page, "report");
    }
    await page.waitForFunction(
      async () =>
        ((await navigator.locks.query()).pending ?? []).filter(
          (l) => l.name === "garden-manager-photos",
        ).length === 2,
    );
    await page.evaluate(() => (window as any).releaseRace());
    await Promise.all([
      page.waitForFunction(() => (window as any).race.result),
      other.waitForFunction(() => (window as any).race.result),
    ]);
    const report = await page.evaluate(() => (window as any).race.result),
      restore = await other.evaluate(() => (window as any).race.result),
      saved = await snapshot(page);
    if (first === "report") {
      expect(report.ok).toBe(true);
      expect(restore.ok).toBe(false);
      expect(restore.message).toContain("Dane zmieniły");
      expect(saved.reportSequence).toBe(1);
      expect(saved.jobs[0].reports).toHaveLength(1);
      expect(saved.jobs[0].activities).toEqual(initial.jobs[0].activities);
    } else {
      expect(restore.ok).toBe(true);
      expect(report.ok).toBe(false);
      expect(report.message).toContain("zmieniły");
      expect(saved.reportSequence).toBe(0);
      expect(saved.jobs[0].activities).toEqual(["Zakres z odtwarzanej kopii"]);
      const recovery = await other.evaluate(
        async () => await (window as any).race.service.recovery(),
      );
      expect(recovery.data).toEqual(initial);
    }
    await settled(page);
    await page.reload();
    expect(await snapshot(page)).toEqual(saved);
  });
