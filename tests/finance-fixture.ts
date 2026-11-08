import type { Page } from "@playwright/test";
import { documentationData, documentationClock } from "./documentation-fixture";
import type { Job } from "../src/domain";
export { documentationClock as financeClock };
export function financeData() {
  const d = documentationData(),
    base = d.jobs[0];
  const job = (
    id: string,
    title: string,
    gardenId: string,
    price: number,
    approved = true,
    status: Job["status"] = "completed",
  ): Job => ({
    ...base,
    id,
    title,
    gardenId,
    date: "2026-11-03",
    status,
    billing: "fixed",
    fixedPrice: price,
    rate: 100,
    seconds: 3601,
    materials: [],
    reports: undefined,
    settlement: approved
      ? {
          calculatedLaborCents: price * 100,
          suggestedLaborCents: null,
          finalLaborCents: price * 100,
          materialsCents: 0,
          approvedAt: documentationClock.getTime(),
          source: "fixed",
        }
      : null,
  });
  d.jobs = [
    job("job-1", "Wizyta częściowo opłacona", "garden-1", 1000),
    job("finance-paid", "Opłacona działka", "garden-6", 500),
    job("finance-pending", "Wizyta bez zatwierdzenia", "garden-1", 200, false),
    job(
      "finance-advance",
      "Zaplanowana praca z zaliczką",
      "garden-6",
      300,
      false,
      "planned",
    ),
    job("finance-other", "Praca innego klienta", "garden-2", 2000),
  ];
  d.jobs[0].reports = base.reports;
  d.payments = [
    {
      id: "finance-partial",
      jobId: "job-1",
      amountCents: 25000,
      receivedDate: "2026-11-02",
      method: "transfer",
      note: "Pierwsza część",
    },
    {
      id: "finance-full",
      jobId: "finance-paid",
      amountCents: 50000,
      receivedDate: "2026-11-03",
      method: "cash",
      note: "Pełna wpłata",
    },
    {
      id: "finance-deposit",
      jobId: "finance-advance",
      amountCents: 10000,
      receivedDate: "2026-11-01",
      method: "blik",
      note: "Zaliczka na planowane prace",
    },
  ];
  return d;
}
export async function holdFinanceWrites(page: Page) {
  await page.evaluate(() => {
    const r = indexedDB.open("garden-manager-state", 1);
    r.onsuccess = () => {
      const db = r.result,
        tx = db.transaction("state", "readwrite"),
        store = tx.objectStore("state");
      let released = false;
      (window as any).releaseFinanceWrite = () => {
        released = true;
      };
      const pump = () => {
        store.get("current").onsuccess = () => {
          if (!released) pump();
        };
      };
      pump();
      tx.oncomplete = () => db.close();
    };
  });
  await page.waitForFunction(() => !!(window as any).releaseFinanceWrite);
}
