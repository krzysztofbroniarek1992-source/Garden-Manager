import {
  clientSummary,
  paidCents,
  remainingCents,
  settlementStatus,
  type Data,
  type Job,
} from "../domain";
import { gardenSummary } from "../features/job-history";
import type { FinanceFilter } from "../navigation/routes";
export type FinanceOwner = "client" | "garden";
export const financeFilterLabels: Record<FinanceFilter, string> = {
  all: "Wszystkie rozliczenia",
  completed: "Wykonane i zatwierdzone",
  outstanding: "Pozostałe należności",
  received: "Otrzymane płatności",
  pending: "Ceny do zatwierdzenia",
};
/** Read projection only. Monetary rules stay in domain.ts and job-history.ts. */
export function financeScope(
  data: Data,
  owner: FinanceOwner,
  id: string,
  now: number,
) {
  const garden =
    owner === "garden" ? data.gardens.find((g) => g.id === id) : undefined;
  const client = data.clients.find(
    (c) => c.id === (owner === "client" ? id : garden?.clientId),
  );
  const exists = owner === "client" ? !!client : !!garden;
  const gardens = data.gardens.filter((g) =>
    owner === "garden" ? g.id === id : g.clientId === id,
  );
  const ids = new Set(gardens.map((g) => g.id));
  return {
    exists,
    client,
    garden,
    gardens,
    jobs: exists ? data.jobs.filter((j) => ids.has(j.gardenId)) : [],
    summary:
      owner === "client"
        ? clientSummary(data, id, now)
        : gardenSummary(data, id, now),
  };
}
export function filterFinanceJobs(
  data: Data,
  jobs: Job[],
  filter: FinanceFilter,
  query: {
    from: string;
    to: string;
    gardenId: string;
    status: string;
    search: string;
  },
  now: number,
) {
  const needle = query.search.trim().toLocaleLowerCase("pl-PL");
  return jobs.filter(
    (j) =>
      (!query.from || j.date >= query.from) &&
      (!query.to || j.date <= query.to) &&
      (!query.gardenId || j.gardenId === query.gardenId) &&
      (!query.status ||
        settlementStatus(j, data.payments, now, data.timer) === query.status) &&
      (!needle ||
        [j.title, j.notes].some((t) =>
          t.toLocaleLowerCase("pl-PL").includes(needle),
        )) &&
      (filter === "all" ||
        (filter === "completed" &&
          j.status === "completed" &&
          !!j.settlement) ||
        (filter === "outstanding" &&
          j.status === "completed" &&
          !!j.settlement &&
          remainingCents(j, data.payments, now, data.timer) > 0) ||
        (filter === "received" && paidCents(j.id, data.payments) > 0) ||
        (filter === "pending" && j.status === "completed" && !j.settlement)),
  );
}
export function paymentContext(data: Data, id: string) {
  const payment = data.payments.find((p) => p.id === id),
    job = data.jobs.find((j) => j.id === payment?.jobId),
    garden = data.gardens.find((g) => g.id === job?.gardenId),
    client = data.clients.find((c) => c.id === garden?.clientId);
  return { payment, job, garden, client };
}
