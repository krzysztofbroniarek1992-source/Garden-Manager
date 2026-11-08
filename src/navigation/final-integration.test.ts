import { describe, expect, it } from "vitest";
import {
  address,
  parseAddress,
  validRoute,
  openCard,
  pages,
  type Route,
} from "./routes";
import { pageReturnLabel } from "./labels";
import { finalData } from "../../tests/final-navigation-fixture";
import { validateData } from "../data/repository";
import { documentationLinks } from "../documentation/links";
describe("final navigation integration uses only view state and existing IDs", () => {
  it("validates the existing v9 scope for tasks and calculator materials", () => {
    const d = finalData();
    expect(() => validateData(d)).not.toThrow();
    const before = structuredClone(d);
    expect(documentationLinks(d, d.todos[0]).map((x) => x.card.kind)).toEqual([
      "client",
      "garden",
      "zone",
      "job",
    ]);
    expect(d).toEqual(before);
  });
  it.each<Route>([
    { page: "todos", cards: [{ kind: "todo", id: "todo-final" }] },
    {
      page: "calendar",
      cards: [{ kind: "todo", id: "todo-final" }],
      calendar: {
        date: "2026-11-17",
        anchor: "2026-11-17",
        view: "week",
        kind: "todo",
      },
    },
    { page: "dashboard", cards: [], dialog: "menu" },
    { page: "materials", cards: [], dialog: "settings" },
    { page: "jobs", cards: [], dialog: "new-job" },
    {
      page: "gardens",
      cards: [
        {
          kind: "zone",
          gardenId: "garden-1",
          id: "zone-doc",
          section: "plans",
        },
      ],
      dialog: "settings",
    },
  ])("round trips $page and its view dialog/card", (r) => {
    expect(validRoute(r)).toBe(true);
    expect(parseAddress("http://localhost:5173/" + address(r))).toEqual({
      route: r,
      invalid: false,
    });
  });
  it.each([
    "#todos?todo=",
    "#todos?todo=x&note=y",
    "#todos?todo=x&todo=y",
    "#jobs?dialog=unknown",
    "#jobs?dialog=settings&dialog=menu",
    "#calendar?dialog=new-job",
    "#jobs?job=x&dialog=new-job",
  ])("rejects ambiguous or invalid address %s", (hash) =>
    expect(parseAddress("http://localhost:5173/" + hash).invalid).toBe(true),
  );
  it.each(pages)("has a correct aggregate return label for %s", (p) =>
    expect(pageReturnLabel(p)).toMatch(/^Wróć do /),
  );
  it("keeps a real todo card on the same shared return stack", () => {
    const source: Route = {
        page: "todos",
        cards: [{ kind: "todo", id: "todo-final" }],
      },
      garden = openCard(source, { kind: "garden", id: "garden-1" });
    expect(openCard(garden, { kind: "todo", id: "todo-final" })).toEqual(
      source,
    );
  });
  it("rejects unsupported new-job view combinations even in restored history", () => {
    expect(validRoute({ page: "calendar", cards: [], dialog: "new-job" })).toBe(
      false,
    );
    expect(
      validRoute({
        page: "jobs",
        cards: [{ kind: "job", id: "job-1" }],
        dialog: "new-job",
      }),
    ).toBe(false);
  });
  it("opening an existing card dismisses a view dialog without leaving invalid route combinations", () => {
    const r = openCard(
      { page: "jobs", cards: [], dialog: "new-job" },
      { kind: "job", id: "job-1" },
    );
    expect(r).toEqual({ page: "jobs", cards: [{ kind: "job", id: "job-1" }] });
    expect(validRoute(r)).toBe(true);
  });
  it("does not turn historical task names into live object links", () => {
    const d = finalData(),
      record = {
        ...d.todos[0],
        clientId: null,
        gardenId: null,
        zoneId: null,
        jobId: null,
      };
    expect(documentationLinks(d, record)).toEqual([]);
  });
});
