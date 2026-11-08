import { describe, it, expect } from "vitest";
import { zonesData } from "../../tests/zones-fixture";
import { zoneScope, jobZones } from "./model";
import {
  address,
  parseAddress,
  openCard,
  type Card,
} from "../navigation/routes";
import { documentationLinks } from "../documentation/links";
import { validateData } from "../data/repository";
import { nextScheduleOccurrence } from "../navigation/planning-links";
describe("zone navigation is a read projection of actual v9 relations", () => {
  it("preserves text descriptions without creating plant or treatment records", () => {
    const d = zonesData();
    validateData(d);
    const before = structuredClone(d),
      s = zoneScope(d, "garden-1", "zone-doc");
    expect(s.zone?.plants).toBe("Róże 'New Dawn'\nSzałwia");
    expect(s.zone?.treatments).toContain("2026-10-20: Przycięto róże");
    expect(s.schedules.map((x) => x.id)).toEqual(["care-series"]);
    expect(s.jobs.map((j) => j.id)).toEqual(["job-1"]);
    expect(d).toEqual(before);
  });
  it("scopes duplicate zone IDs by garden", () => {
    const d = zonesData();
    expect(zoneScope(d, "garden-6", "zone-doc").zone?.name).toBe(
      "Rabata weekendowa",
    );
    expect(zoneScope(d, "garden-6", "zone-doc").jobs.map((j) => j.id)).toEqual([
      "finance-paid",
    ]);
    expect(
      zoneScope(d, "garden-1", "zone-doc").schedules.map((s) => s.id),
    ).not.toContain("care-weekend-series");
  });
  it("does not infer work from names, activities or notes", () => {
    const d = zonesData();
    expect(jobZones(d, "care-unassigned").zones).toEqual([]);
    expect(
      zoneScope(d, "garden-1", "zone-doc").jobs.map((j) => j.id),
    ).not.toContain("care-unassigned");
  });
  it("recognizes declared visit, occurrence and checklist associations, once per zone", () => {
    const d = zonesData();
    expect(jobZones(d, "job-1").zones.map((z) => z.id)).toEqual(["zone-doc"]);
    expect(jobZones(d, "finance-pending").zones.map((z) => z.id)).toEqual([
      "zone-lawn",
    ]);
    d.jobs[0].taskOccurrenceId = undefined;
    expect(jobZones(d, "job-1").zones.map((z) => z.id)).toEqual(["zone-doc"]);
    d.checklists = [];
    expect(jobZones(d, "job-1").zones).toEqual([]);
  });
  it("requires reciprocal occurrence ownership and a consistent garden", () => {
    const d = zonesData();
    d.checklists = [];
    d.taskOccurrences[0].jobId = "finance-paid";
    expect(jobZones(d, "job-1").zones).toEqual([]);
  });
  it("keeps missing and deleted scopes empty, never matching historical names", () => {
    const d = zonesData();
    d.gardens[0].zones = [];
    expect(zoneScope(d, "garden-1", "zone-doc")).toMatchObject({
      zone: undefined,
      schedules: [],
      jobs: [],
    });
    expect(zoneScope(d, "missing", "zone-doc").zone).toBeUndefined();
    expect(jobZones(d, "missing").zones).toEqual([]);
  });
  it("links documentation to the scoped zone with its relevant section", () => {
    const d = zonesData();
    expect(
      documentationLinks(
        d,
        { gardenId: "garden-1", zoneId: "zone-doc" },
        "gallery",
      ).find((x) => x.label.startsWith("Strefa:"))?.card,
    ).toEqual({
      kind: "zone",
      gardenId: "garden-1",
      id: "zone-doc",
      section: "gallery",
    });
  });
  it("reads a moved original identity without materializing or duplicating occurrences", () => {
    const d = zonesData(),
      before = structuredClone(d),
      next = nextScheduleOccurrence(d, "care-series", "2026-11-16");
    expect(next).toMatchObject({
      originalDate: "2026-11-15",
      date: "2026-11-17",
    });
    expect(d).toEqual(before);
  });
  it.each<Card>([
    { kind: "zone", gardenId: "garden-1", id: "zone-doc" },
    { kind: "zone", gardenId: "garden-1", id: "zone-doc", section: "plans" },
    { kind: "zone", gardenId: "g / #", id: "z / Łódź", section: "history" },
    { kind: "garden", id: "garden-1", section: "zones", zoneId: "zone-doc" },
  ])("round trips a $kind address", (card) => {
    const route = { page: "gardens" as const, cards: [card] };
    expect(parseAddress("http://localhost:5173/" + address(route))).toEqual({
      route,
      invalid: false,
    });
  });
  it.each([
    "#gardens?zone=z",
    "#gardens?zone=z&zoneGarden=",
    "#gardens?zone=z&zoneGarden=g&section=billing",
    "#gardens?zone=z&zoneGarden=g&zoneGarden=h",
    "#gardens?garden=g&zone=z&zoneGarden=g",
    "#jobs?job=j&zoneGarden=g",
    "#gardens?zone=z&zoneGarden=g&reportVersion=r",
  ])("rejects malformed scoped address %s", (hash) =>
    expect(parseAddress("http://localhost:5173/" + hash).invalid).toBe(true),
  );
  it("separates the same zone ID in different gardens in the shared stack", () => {
    let route = openCard(
      { page: "gardens", cards: [] },
      { kind: "zone", gardenId: "g1", id: "same" },
    );
    route = openCard(route, { kind: "zone", gardenId: "g2", id: "same" });
    expect(route.cards).toHaveLength(2);
    expect(
      openCard(route, {
        kind: "zone",
        gardenId: "g1",
        id: "same",
        section: "plans",
      }).cards,
    ).toHaveLength(1);
  });
});
