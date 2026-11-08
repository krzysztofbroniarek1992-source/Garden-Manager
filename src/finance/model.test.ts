import { it, expect, describe } from "vitest";
import { validateData } from "../data/repository";
import { financeData, financeClock } from "../../tests/finance-fixture";
import { financeScope, filterFinanceJobs, paymentContext } from "./model";
import {
  address,
  parseAddress,
  openCard,
  type Card,
} from "../navigation/routes";
const empty = { from: "", to: "", gardenId: "", status: "", search: "" },
  now = financeClock.getTime();
describe("finance navigation uses the existing model and monetary rules", () => {
  it("explains 750 PLN by approved completed work without subtracting an unrelated advance", () => {
    const d = financeData();
    validateData(d);
    const s = financeScope(d, "client", "client-1", now);
    expect(s.summary).toMatchObject({
      completedValueCents: 150000,
      receivedCents: 85000,
      outstandingCents: 75000,
    });
    expect(
      filterFinanceJobs(d, s.jobs, "outstanding", empty, now).map((j) => j.id),
    ).toEqual(["job-1"]);
  });
  it.each([
    ["all", 4],
    ["completed", 2],
    ["outstanding", 1],
    ["received", 3],
    ["pending", 1],
  ] as const)(
    "selects %s from real settlement/payment records",
    (mode, count) => {
      const d = financeData();
      expect(
        filterFinanceJobs(
          d,
          financeScope(d, "client", "client-1", now).jobs,
          mode,
          empty,
          now,
        ),
      ).toHaveLength(count);
    },
  );
  it("keeps gardens and other clients separate", () => {
    const d = financeData();
    expect(
      financeScope(d, "garden", "garden-1", now).jobs.map((j) => j.id),
    ).toEqual(["job-1", "finance-pending"]);
    expect(financeScope(d, "garden", "garden-6", now).summary).toMatchObject({
      completedValueCents: 50000,
      receivedCents: 60000,
      outstandingCents: 0,
    });
    expect(
      financeScope(d, "client", "client-2", now).summary.outstandingCents,
    ).toBe(200000);
  });
  it("combines date, garden, payment status and search without writing data", () => {
    const d = financeData(),
      before = structuredClone(d);
    expect(
      filterFinanceJobs(
        d,
        financeScope(d, "client", "client-1", now).jobs,
        "received",
        {
          ...empty,
          gardenId: "garden-6",
          status: "paid",
          from: "2026-11-01",
          to: "2026-11-30",
          search: "działka",
        },
        now,
      ).map((j) => j.id),
    ).toEqual(["finance-paid"]);
    expect(d).toEqual(before);
  });
  it("does not invent a client or job for an unassigned/orphan payment", () => {
    const d = financeData();
    d.payments[0].jobId = "";
    expect(paymentContext(d, "finance-partial")).toMatchObject({
      job: undefined,
      client: undefined,
      garden: undefined,
    });
    expect(paymentContext(d, "missing").payment).toBeUndefined();
  });
  it("handles a missing owner without borrowing another scope", () => {
    const d = financeData();
    expect(financeScope(d, "client", "garden-1", now)).toMatchObject({
      exists: false,
      jobs: [],
    });
    expect(financeScope(d, "garden", "missing", now)).toMatchObject({
      exists: false,
      jobs: [],
    });
  });
  it.each<Card>([
    { kind: "finance", owner: "client", id: "client-1", filter: "outstanding" },
    { kind: "finance", owner: "garden", id: "garden-1", filter: "received" },
    { kind: "finance", owner: "client", id: "client / Łódź" },
    { kind: "payment", id: "payment / 1" },
    { kind: "job", id: "job-1", section: "payments" },
  ])("round trips $kind safely", (card) => {
    const route = { page: "clients" as const, cards: [card] };
    expect(parseAddress("http://localhost:5173/" + address(route))).toEqual({
      route,
      invalid: false,
    });
  });
  it.each([
    "#clients?finance=c",
    "#clients?finance=c&owner=other",
    "#clients?finance=c&owner=client&financeFilter=bogus",
    "#clients?payment=p&owner=client",
    "#clients?finance=c&owner=client&owner=garden",
    "#clients?finance=c&owner=client&financeFilter=all&financeFilter=received",
    "#clients?finance=c&owner=client&reportVersion=r",
  ])("rejects malformed finance address %s", (hash) =>
    expect(parseAddress("http://localhost:5173/" + hash).invalid).toBe(true),
  );
  it("keeps one scoped history card and separates identical client/garden IDs", () => {
    let r = openCard(
      { page: "clients", cards: [] },
      { kind: "finance", owner: "client", id: "same" },
    );
    r = openCard(r, { kind: "finance", owner: "garden", id: "same" });
    expect(r.cards).toHaveLength(2);
    expect(
      openCard(r, {
        kind: "finance",
        owner: "client",
        id: "same",
        filter: "outstanding",
      }).cards,
    ).toHaveLength(1);
  });
});

it("rejects unsupported unassigned payments at the existing import boundary without reassigning them", () => {
  const d = financeData();
  d.payments[0].jobId = "";
  const before = structuredClone(d);
  expect(() => validateData(d)).toThrow();
  expect(d).toEqual(before);
});
