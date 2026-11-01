import { describe, expect, it } from "vitest";
import {
  address,
  openCard,
  parseAddress,
  validRoute,
  type Route,
} from "./routes";

describe("addresses without business operations", () => {
  it("accepts legacy client links only on the clients tab", () => {
    expect(
      parseAddress("http://localhost:5173/?client=c1#clients").route,
    ).toEqual({ page: "clients", cards: [{ kind: "client", id: "c1" }] });
    expect(
      parseAddress("http://localhost:5173/?client=c1#gardens").route.cards,
    ).toEqual([]);
  });
  it.each([
    { kind: "client", id: "klient / Łódź & # ?" },
    { kind: "garden", id: "ogród:1", section: "zones" },
    { kind: "job", id: "wizyta/1", section: "billing" },
  ] as const)("round trips an encoded target $kind", (card) => {
    const route: Route = { page: "clients", cards: [card] };
    expect(parseAddress(`http://localhost:5173/${address(route)}`)).toEqual({
      route,
      invalid: false,
    });
  });
  it.each([
    "#unknown",
    "#jobs?job=",
    "#gardens?garden=g&section=payments",
    "#jobs?client=c&job=j",
    "#jobs?job=%00",
  ])("handles invalid address %s", (hash) => {
    expect(parseAddress(`http://localhost:5173/${hash}`).invalid).toBe(true);
  });
  it("keeps one card per object and updates the billing destination", () => {
    const input: Route = {
      page: "history",
      cards: [
        { kind: "job", id: "j", section: "notes" },
        { kind: "garden", id: "g", section: "billing" },
      ],
    };
    const before = structuredClone(input);
    expect(
      openCard(input, { kind: "job", id: "j", initialBilling: true }),
    ).toEqual({
      page: "history",
      cards: [{ kind: "job", id: "j", section: "billing" }],
    });
    expect(input).toEqual(before);
  });
  it("rejects malformed, duplicated and unbounded history payloads", () => {
    expect(
      validRoute({
        page: "clients",
        cards: [{ kind: "job", id: "j", section: "zones" }],
      }),
    ).toBe(false);
    expect(
      validRoute({
        page: "jobs",
        cards: [
          { kind: "job", id: "j" },
          { kind: "job", id: "j" },
        ],
      }),
    ).toBe(false);
    expect(
      validRoute({
        page: "jobs",
        cards: Array.from({ length: 21 }, (_, i) => ({
          kind: "job",
          id: String(i),
        })),
      }),
    ).toBe(false);
    expect(validRoute(null)).toBe(false);
  });
});

describe("calendar and planning addresses", () => {
  it.each([
    { kind: "schedule", id: "seria / żółta" },
    { kind: "task", id: "seria:1", originalDate: "2026-10-31" },
    { kind: "garden", id: "garden-1", section: "zones", zoneId: "strefa/1" },
  ] as const)("round trips $kind", (card) => {
    const route: Route = {
      page: "calendar",
      cards: [card],
      calendar: {
        date: "2026-11-03",
        anchor: "2026-11-01",
        view: "week",
        gardenId: "garden-1",
        kind: "work",
        status: "cancelled",
      },
    };
    expect(parseAddress(`http://localhost:5173/${address(route)}`)).toEqual({
      route,
      invalid: false,
    });
  });
  it("distinguishes dates of the same series and returns to an existing occurrence", () => {
    const first = {
      kind: "task" as const,
      id: "s",
      originalDate: "2026-10-31",
    };
    const next = { kind: "task" as const, id: "s", originalDate: "2026-11-14" };
    const route: Route = {
      page: "calendar",
      cards: [first, { kind: "schedule", id: "s" }, next],
    };
    expect(validRoute(route)).toBe(true);
    expect(openCard(route, first).cards).toEqual([first]);
  });
  it.each([
    "#calendar?task=s",
    "#calendar?date=2000-01-01&anchor=2099-01-01&view=month",
    "#calendar?task=s&original=2026-02-30",
    "#calendar?schedule=",
    "#calendar?date=invalid&view=month",
    "#calendar?date=2026-11-03&view=quarter",
    "#calendar?date=2026-11-03&statusFilter=paid",
    "#calendar?task=s&original=2026-10-31&job=j",
  ])("safely rejects %s", (hash) => {
    expect(parseAddress(`http://localhost:5173/${hash}`).invalid).toBe(true);
  });
});
