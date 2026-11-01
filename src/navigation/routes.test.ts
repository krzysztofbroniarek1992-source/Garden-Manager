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
