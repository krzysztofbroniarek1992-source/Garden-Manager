import { jobTotalCents, remainingCents, sumCents, type Data } from "../domain";
/** Cash result is received job payments minus actual approved purchases. Job material
 * charges and imported bank credits are deliberately absent from this calculation. */
export function companySummary(data: Data, period: string, now = Date.now()) {
  const jobs = data.jobs.filter((j) => j.date.startsWith(period));
  const payments = data.payments.filter((p) =>
    p.receivedDate.startsWith(period),
  );
  const expenses = data.expenses.filter(
    (e) =>
      e.date.startsWith(period) &&
      e.status === "approved" &&
      e.direction === "outgoing",
  );
  const received = sumCents(payments.map((p) => p.amountCents)),
    costs = sumCents(expenses.map((e) => e.amountCents));
  return {
    value: sumCents(jobs.map((j) => jobTotalCents(j, now, data.timer))),
    approvedValue: sumCents(
      jobs
        .filter((j) => j.settlement)
        .map((j) => jobTotalCents(j, now, data.timer)),
    ),
    outstanding: sumCents(
      jobs
        .filter((j) => j.settlement)
        .map((j) => remainingCents(j, data.payments, now, data.timer)),
    ),
    received,
    costs,
    cash: sumCents([received, -costs]),
    categories: data.expenseCategories
      .map((c) => ({
        ...c,
        total: sumCents(
          expenses
            .filter((e) => e.categoryId === c.id)
            .map((e) => e.amountCents),
        ),
      }))
      .filter((c) => c.total),
  };
}
