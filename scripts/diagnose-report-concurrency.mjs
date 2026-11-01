import { chromium } from "@playwright/test";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
const trials = Number(process.argv[2] || 30);
const label = process.argv[3] || "current";
if (
  !Number.isInteger(trials) ||
  trials < 1 ||
  trials > 200 ||
  !/^[a-zA-Z0-9_-]{1,40}$/.test(label)
) {
  throw new Error(
    "Usage: node scripts/diagnose-report-concurrency.mjs [1..200 trials] [label]",
  );
}
// Diagnostic only: a new browser context isolates all writes from user data.
// Serve the desired revision with `npm run dev` on the unchanged port 5173.
const executablePath =
  process.env.CHROMIUM_PATH ||
  (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
const browser = await chromium.launch({ executablePath });
try {
  const context = await browser.newContext();
  await context.route("**/report-concurrency-probe", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Isolated report service diagnostic</title>",
    }),
  );
  const a = await context.newPage(),
    b = await context.newPage();
  await Promise.all([
    a.goto("http://127.0.0.1:5173/report-concurrency-probe"),
    b.goto("http://127.0.0.1:5173/report-concurrency-probe"),
  ]);
  const setup = async (p) =>
    p.evaluate(async () => {
      const [
        { LocalRepository, STORAGE_KEY, STORAGE_VERSION },
        { GardenStore },
        { ReportService },
        { defaultReportOptions },
        { createDemoData },
      ] = await Promise.all([
        import("/src/data/repository.ts"),
        import("/src/data/store.ts"),
        import("/src/reports/service.ts"),
        import("/src/reports/model.ts"),
        import("/src/data/demo.ts"),
      ]);
      const log = [];
      const brief = (raw) => {
        if (!raw) return null;
        const d = JSON.parse(raw).data;
        return {
          seq: d.reportSequence,
          reports: d.jobs.flatMap((j) =>
            (j.reports ?? []).map((r) => ({
              job: j.id,
              id: r.id,
              number: r.number,
            })),
          ),
        };
      };
      const port = {
        getItem(key) {
          const raw = localStorage.getItem(key);
          if (key === STORAGE_KEY)
            log.push({
              op: "read",
              at: performance.timeOrigin + performance.now(),
              value: brief(raw),
            });
          return raw;
        },
        setItem(key, raw) {
          if (key === STORAGE_KEY)
            log.push({
              op: "write",
              at: performance.timeOrigin + performance.now(),
              value: brief(raw),
            });
          localStorage.setItem(key, raw);
        },
      };
      const seed = () => {
        const d = createDemoData(new Date("2026-10-31T10:00:00+01:00"));
        d.jobs.slice(0, 2).forEach((j) => {
          j.status = "completed";
          j.settlement = null;
          j.reports = [];
        });
        d.payments = [];
        d.reportSequence = 0;
        return d;
      };
      window.probe = {
        log,
        seed,
        brief,
        key: STORAGE_KEY,
        version: STORAGE_VERSION,
        setup(job) {
          log.length = 0;
          const repo = new LocalRepository(port);
          const store = new GardenStore(repo);
          this.job = job;
          this.service = new ReportService(
            {
              snapshot: () => repo.load(),
              saveVisitReport: store.saveVisitReport,
            },
            {},
            // Only the PDF encoder is stubbed. Numbering, repository, command,
            // localStorage and Web Locks are the real application code/APIs.
            async () => new Uint8Array([37, 80, 68, 70]),
            () => 1793437200000,
          );
          return this.service.prepare(job, defaultReportOptions()).then((p) => {
            this.prepared = p;
            return { number: p.record.number, reused: p.reused };
          });
        },
        async save() {
          log.push({
            op: "saveStart",
            at: performance.timeOrigin + performance.now(),
          });
          try {
            await this.service.save(this.job, this.prepared);
            return { ok: true, log };
          } catch (e) {
            return { ok: false, error: e.message, log };
          }
        },
      };
      return { locks: !!navigator.locks, userAgent: navigator.userAgent };
    });
  const capabilities = [await setup(a), await setup(b)];
  console.log(JSON.stringify({ label, capabilities }));
  if (capabilities.some((c) => !c.locks))
    throw new Error(
      "This probe requires Web Locks; the per-document fallback cannot verify cross-tab serialization.",
    );
  const records = [];
  for (let i = 0; i < trials; i++) {
    await a.evaluate(() =>
      localStorage.setItem(
        probe.key,
        JSON.stringify({ version: probe.version, data: probe.seed() }),
      ),
    );
    // Synchronize fixture reset only. No wait is inserted between the two
    // application saves: that is the concurrency boundary being diagnosed.
    await b.waitForFunction(() => {
      const raw = localStorage.getItem(probe.key);
      if (!raw) return false;
      const data = JSON.parse(raw).data;
      return (
        data.reportSequence === 0 && data.jobs.every((j) => !j.reports?.length)
      );
    });
    const prepared = await Promise.all([
      a.evaluate(() => probe.setup("job-1")),
      b.evaluate(() => probe.setup("job-2")),
    ]);
    if (
      prepared.some((p) => p.reused) ||
      prepared[0].number !== prepared[1].number
    )
      throw new Error(
        "Both trials must start with fresh previews of the same sequence.",
      );
    // Ensure both writers are queued on the existing shared lock before release.
    await a.evaluate(() => {
      void navigator.locks.request(
        "garden-manager-photos",
        () =>
          new Promise((r) => {
            window.releaseProbeLock = r;
          }),
      );
    });
    await a.waitForFunction(() => !!window.releaseProbeLock);
    const saves = Promise.all([
      a.evaluate(() => probe.save()),
      b.evaluate(() => probe.save()),
    ]);
    await a.waitForFunction(
      async () =>
        (await navigator.locks.query()).pending.filter(
          (l) => l.name === "garden-manager-photos",
        ).length === 2,
    );
    await a.evaluate(() => {
      releaseProbeLock();
      delete window.releaseProbeLock;
    });
    const results = await saves;
    const storage = await Promise.all([
      a.evaluate(() => probe.brief(localStorage.getItem(probe.key))),
      b.evaluate(() => probe.brief(localStorage.getItem(probe.key))),
    ]);
    const entry = { i, prepared, results, storage };
    records.push(entry);
    if (results.filter((r) => r.ok).length !== 1) {
      console.log(JSON.stringify({ duplicate: i, storage }));
    }
  }
  const artifact = join(tmpdir(), `garden-report-probe-${label}.json`);
  await writeFile(artifact, JSON.stringify(records, null, 2));
  console.log(
    JSON.stringify({
      label,
      trials,
      artifact,
      conflicts: records.filter(
        (r) => r.results.filter((s) => s.ok).length === 1,
      ).length,
      duplicates: records.filter(
        (r) => r.results.filter((s) => s.ok).length === 2,
      ).length,
    }),
  );
  // Never report a passing diagnostic when both writers accepted the same number.
  if (records.some((r) => r.results.filter((s) => s.ok).length !== 1))
    process.exitCode = 1;
} finally {
  await browser.close();
}
