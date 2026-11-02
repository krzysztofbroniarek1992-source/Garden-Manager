import { test, expect, type Page } from "@playwright/test";
import type { GardenStore } from "../src/data/store";
import { data, snapshot, preview } from "./atomic-report-helpers";
import { STORAGE_KEY, STORAGE_VERSION } from "../src/data/repository";
test.setTimeout(90_000);
const clock = new Date("2026-10-31T10:00:00+01:00");
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(clock);
  await page.addInitScript(
    ({ key, version, data }) => {
      if (!localStorage.getItem(key))
        localStorage.setItem(key, JSON.stringify({ version, data }));
    },
    { key: STORAGE_KEY, version: STORAGE_VERSION, data: data() },
  );
});
test("two queued UI report saves have one conflict, then two unique durable reports across reload and reopen", async ({
  page,
  context,
}) => {
  const first = await preview(page, "Raport atomowy 1");
  const other = await context.newPage();
  await other.clock.setFixedTime(clock);
  const second = await preview(other, "Raport atomowy 2");
  await expect(
    first.getByRole("button", { name: "Pokaż plik PDF", exact: true }),
  ).toBeDisabled();
  await expect(
    second.getByRole("button", { name: "Pokaż plik PDF", exact: true }),
  ).toBeDisabled();
  const downloads: string[] = [];
  page.on("download", (d) => downloads.push(d.suggestedFilename()));
  other.on("download", (d) => downloads.push(d.suggestedFilename()));
  await page.evaluate(() => {
    void navigator.locks.request(
      "garden-manager-photos",
      () =>
        new Promise<void>((r) => {
          (window as any).releaseReports = r;
        }),
    );
  });
  await page.waitForFunction(() => !!(window as any).releaseReports);
  await Promise.all([
    first
      .getByRole("button", { name: "Zapisz raport i pobierz PDF", exact: true })
      .click(),
    second
      .getByRole("button", { name: "Zapisz raport i pobierz PDF", exact: true })
      .click(),
  ]);
  await page.waitForFunction(
    async () =>
      ((await navigator.locks.query()).pending ?? []).filter(
        (l) => l.name === "garden-manager-photos",
      ).length >= 2,
  );
  await page.evaluate(() => {
    (window as any).releaseReports();
  });
  await expect.poll(() => downloads.length).toBe(1);
  const one = await snapshot(page);
  expect(one.reportSequence).toBe(1);
  expect(one.jobs.flatMap((j: any) => j.reports ?? [])).toHaveLength(1);
  const winner = one.jobs[0].reports?.length ? first : second;
  await expect(
    winner.getByRole("button", { name: "Pokaż plik PDF", exact: true }),
  ).toBeEnabled();
  const loser = one.jobs[0].reports?.length ? second : first;
  await expect(loser.getByRole("alert")).toContainText("zmieniły");
  await loser
    .getByRole("button", { name: "Przygotuj podgląd raportu", exact: true })
    .click();
  await loser
    .getByRole("button", { name: "Zapisz raport i pobierz PDF", exact: true })
    .click();
  await expect.poll(() => downloads.length).toBe(2);
  expect(new Set(downloads).size).toBe(2);
  const saved = await snapshot(page);
  expect(saved.reportSequence).toBe(2);
  expect(
    new Set(
      saved.jobs.flatMap((j: any) => j.reports ?? []).map((r: any) => r.number),
    ).size,
  ).toBe(2);
  await page.reload();
  expect(await snapshot(page)).toEqual(saved);
  await page.close();
  await other.close();
  const reopened = await context.newPage();
  await reopened.goto("/#history");
  expect(await snapshot(reopened)).toEqual(saved);
});
test("authoritative transactions work without Web Locks and with deliberately stale localStorage", async ({
  page,
  context,
}) => {
  await context.addInitScript(() =>
    Object.defineProperty(navigator, "locks", {
      value: undefined,
      configurable: true,
    }),
  );
  await page.goto("/#history");
  await page.getByRole("navigation", { name: "Nawigacja główna" }).waitFor();
  const second = await context.newPage();
  await second.goto("/#history");
  const prepare = async (p: Page, job: string) =>
    p.evaluate(async (job) => {
      const [
        { AtomicRepository },
        { ReportService },
        { defaultReportOptions },
      ] = await Promise.all([
        ...[
          "/src/data/atomic.ts",
          "/src/reports/service.ts",
          "/src/reports/model.ts",
        ].map((path) => import(path)),
      ]);
      const stale = localStorage.getItem("garden-manager:v1");
      const cache = { getItem: () => stale, setItem: () => {} };
      const repo = new AtomicRepository(cache as unknown as Storage);
      await repo.initialize();
      const service = new ReportService(
        {
          snapshot: async () => (await repo.read()).data,
          saveVisitReport: async (
            ...args: Parameters<GardenStore["saveVisitReport"]>
          ) => {
            await repo.command((s: GardenStore) => s.saveVisitReport(...args));
          },
        },
        {} as any,
        async () => new Uint8Array([37, 80, 68, 70]),
      );
      (window as any).atomicTrial = {
        repo,
        service,
        prepared: await service.prepare(job, defaultReportOptions()),
        job,
      };
    }, job);
  for (let i = 0; i < 10; i++) {
    if (i) {
      // Add another version of each source without replacing existing history.
      await page.evaluate(async () => {
        const p = (window as any).atomicTrial;
        await p.repo.command((s: any) => {
          const j = s.data.jobs[0];
          s.saveVisitDetails(
            j.id,
            {
              publicWork: `Wersja ${crypto.randomUUID()}`,
              clientRemarks: "",
              zoneId: null,
            },
            j.visitDetails?.revision ?? 0,
          );
        });
      });
      await second.evaluate(async () => {
        const p = (window as any).atomicTrial;
        await p.repo.command((s: any) => {
          const j = s.data.jobs[1];
          s.saveVisitDetails(
            j.id,
            {
              publicWork: `Wersja ${crypto.randomUUID()}`,
              clientRemarks: "",
              zoneId: null,
            },
            j.visitDetails?.revision ?? 0,
          );
        });
      });
    }
    await Promise.all([prepare(page, "job-1"), prepare(second, "job-2")]);
    const save = (p: Page) =>
      p.evaluate(async () => {
        const t = (window as any).atomicTrial;
        try {
          await t.service.save(t.job, t.prepared);
          return true;
        } catch (e) {
          return (e as Error).message;
        }
      });
    const beforeReports = (await snapshot(page)).jobs.flatMap(
      (j: any) => j.reports ?? [],
    );
    const results = await Promise.all([save(page), save(second)]);
    // On the first allocation both previews share a number. Later independent
    // existing-document versions may both commit safely if no new number is used.
    if (!i) expect(results.filter((r) => r === true)).toHaveLength(1);
    const current = await snapshot(page);
    const reports = current.jobs.flatMap((j: any) => j.reports ?? []);
    expect(reports).toHaveLength(
      beforeReports.length + results.filter((r) => r === true).length,
    );
    const retained = new Set(reports.map((r: any) => r.id));
    expect(beforeReports.every((r: any) => retained.has(r.id))).toBe(true);
    const byNumber = new Map<string, Set<string>>();
    for (const r of reports) {
      const ids = byNumber.get(r.number) ?? new Set();
      ids.add(r.snapshot.jobId);
      byNumber.set(r.number, ids);
    }
    expect([...byNumber.values()].every((ids) => ids.size === 1)).toBe(true);
  }
});
