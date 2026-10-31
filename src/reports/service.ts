import type { Data } from '../domain';
import type { PhotoAssetRepository } from '../photos/model';
import { sha256 } from '../photos/images';
import {
  buildReportSnapshot,
  reportSourceSignature,
  type ReportOptions,
  type VisitReport,
} from './model';
import { nextReportIdentity } from './commands';
import { validateReportOptions } from './validation';
export interface ReportDataPort {
  snapshot(): Data;
  saveVisitReport(jobId: string, record: VisitReport, expected: string): void;
}
export type PdfGenerator = (
  record: VisitReport,
  data: Data,
  assets: PhotoAssetRepository,
) => Promise<Uint8Array>;
export interface PreparedReport {
  record: VisitReport;
  bytes: Uint8Array;
  expected: string;
  reused: boolean;
}
const defaultGenerator: PdfGenerator = async (...args) =>
  (await import('./pdf')).generateReportPdf(...args);
let saveQueue: Promise<unknown> = Promise.resolve();
export class ReportService {
  constructor(
    private readonly data: ReportDataPort,
    private readonly assets: PhotoAssetRepository,
    private readonly generator: PdfGenerator = defaultGenerator,
    private readonly clock = Date.now,
  ) {}
  async prepare(
    jobId: string,
    options: ReportOptions,
  ): Promise<PreparedReport> {
    validateReportOptions(options);
    const data = this.data.snapshot(),
      snapshot = buildReportSnapshot(data, jobId, options),
      job = data.jobs.find((j) => j.id === jobId)!,
      expected = reportSourceSignature(data, jobId, options),
      fingerprint = await sha256(new Blob([JSON.stringify(snapshot)]));
    const latest = job.reports?.at(-1),
      reused =
        !!latest &&
        latest.fingerprint === fingerprint &&
        JSON.stringify(latest.options) === JSON.stringify(options);
    const now = this.clock(),
      record: VisitReport = reused
        ? structuredClone(latest!)
        : {
            id: crypto.randomUUID(),
            ...nextReportIdentity(data, job, now),
            generatedAt: now,
            rendererVersion: 1,
            fingerprint,
            options: structuredClone(options),
            snapshot,
          };
    return {
      record,
      bytes: await this.generator(record, data, this.assets),
      expected,
      reused,
    };
  }
  async save(jobId: string, prepared: PreparedReport): Promise<void> {
    const action = () => {
      if (!prepared.reused)
        this.data.saveVisitReport(jobId, prepared.record, prepared.expected);
    };
    // Share the existing photo/restore lock so two report saves, or a restore and
    // report save, cannot allocate a number from the same local snapshot.
    if (typeof navigator !== 'undefined' && navigator.locks) {
      await navigator.locks.request('garden-manager-photos', async () => {
        action();
      });
      return;
    }
    const pending = saveQueue.then(action, action);
    saveQueue = pending.catch(() => {});
    await pending;
  }
  async regenerate(record: VisitReport) {
    return this.generator(
      structuredClone(record),
      this.data.snapshot(),
      this.assets,
    );
  }
}
