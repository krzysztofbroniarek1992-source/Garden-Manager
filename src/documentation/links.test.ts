import { describe, it, expect } from "vitest";
import { createDemoData } from "../data/demo";
import { documentationLinks } from "./links";
import {
  address,
  parseAddress,
  openCard,
  type Card,
} from "../navigation/routes";
describe("documentation links and addresses", () => {
  it.each<Card>([
    { kind: "note", id: "notatka / Łódź" },
    { kind: "photo", id: "photo-1" },
    { kind: "checklist", id: "list-1" },
    { kind: "report", id: "job-1" },
    { kind: "report", id: "job-1", reportId: "version / #1" },
    { kind: "job", id: "job-1", section: "summary" },
  ])("round trips $kind", (card) => {
    const route = { page: "gardens" as const, cards: [card] };
    expect(parseAddress(`http://localhost:5173/${address(route)}`)).toEqual({
      route,
      invalid: false,
    });
  });
  it.each([
    "#notes?note=n&photo=p",
    "#jobs?report=j&reportVersion=",
    "#jobs?note=n&reportVersion=r",
    "#jobs?report=j&original=2026-01-01",
    "#notes?note=%00",
    "#jobs?report=j&reportVersion=r&reportVersion=s",
  ])("rejects invalid URL %s", (hash) =>
    expect(parseAddress(`http://localhost:5173/${hash}`).invalid).toBe(true),
  );
  it("distinguishes saved versions from their builder and keeps one card per version", () => {
    let route = openCard(
      { page: "jobs", cards: [] },
      { kind: "report", id: "j" },
    );
    route = openCard(route, { kind: "report", id: "j", reportId: "r1" });
    route = openCard(route, { kind: "report", id: "j", reportId: "r2" });
    expect(route.cards).toHaveLength(3);
    expect(
      openCard(route, { kind: "report", id: "j", reportId: "r1" }).cards,
    ).toHaveLength(2);
  });
  it("uses live foreign keys from a job, with the requested sections", () => {
    const data = createDemoData(),
      job = data.jobs[0],
      garden = data.gardens.find((g) => g.id === job.gardenId)!;
    const before = structuredClone(data);
    const links = documentationLinks(
      data,
      { jobId: job.id },
      "gallery",
      "photos",
    );
    expect(links.map((l) => l.card)).toEqual([
      { kind: "client", id: garden.clientId },
      { kind: "garden", id: garden.id, section: "gallery" },
      { kind: "job", id: job.id, section: "photos" },
    ]);
    expect(data).toEqual(before);
  });
  it("never resolves detached historical names by matching another object", () => {
    const data = createDemoData(),
      history = {
        clientId: null,
        gardenId: null,
        jobId: null,
        clientName: data.clients[0].name,
        gardenName: data.gardens[0].name,
        jobTitle: data.jobs[0].title,
      };
    expect(documentationLinks(data, history)).toEqual([]);
  });
  it("ignores missing IDs and zones outside their actual garden", () => {
    const data = createDemoData();
    expect(
      documentationLinks(data, {
        clientId: "missing",
        gardenId: "missing",
        jobId: "missing",
        zoneId: "missing",
      }),
    ).toEqual([]);
    expect(
      documentationLinks(data, {
        gardenId: data.gardens[0].id,
        zoneId: "missing",
      }).some((l) => l.label.startsWith("Strefa:")),
    ).toBe(false);
  });
});
