import { createHash } from "node:crypto";
import { createDemoData } from "../src/data/demo";
import { newNote } from "../src/desk/model";
import {
  createBlankChecklist,
  applyGardenPlan,
} from "../src/checklists/commands";
import { newChecklistItem } from "../src/checklists/model";
import {
  buildReportSnapshot,
  defaultReportOptions,
} from "../src/reports/model";
export const documentationClock = new Date("2026-11-03T09:00:00Z");
export function documentationData() {
  let d = createDemoData(documentationClock);
  const now = documentationClock.getTime();
  d.gardens[0].zones = [
    {
      id: "zone-doc",
      name: "Rabata dokumentacji",
      type: "rabata",
      area: 12,
      length: null,
      plants: "Róże",
      requirements: "",
      treatments: "",
    },
  ];
  d.jobs[0] = {
    ...d.jobs[0],
    title: "Wizyta dokumentacji",
    status: "completed",
    settlement: null,
    seconds: 3600,
  };
  d.payments = [];
  d.notes = [
    {
      ...newNote(d, { jobId: "job-1", zoneId: "zone-doc" }, "2026-11-03"),
      id: "note-doc",
      title: "Obserwacja dokumentacji",
      body: "Ważna obserwacja po wizycie",
      category: "observation",
      createdAt: now,
      updatedAt: now,
      revision: 1,
    },
  ];
  const plan = createBlankChecklist(
    d,
    { kind: "plan", gardenId: "garden-1", zoneId: "zone-doc" },
    "Plan dokumentacji",
    now,
  );
  d = plan.data;
  d.checklists[0].id = "plan-doc";
  d.checklists[0].items = [newChecklistItem("Sprawdzenie roślin", now)];
  const visit = applyGardenPlan(d, "plan-doc", "job-1", now);
  d = visit.data;
  d.checklists.find((c) => c.id === visit.id)!.id = "checklist-doc";
  const options = defaultReportOptions(),
    snapshot = buildReportSnapshot(d, "job-1", options);
  d.jobs[0].reports = [
    {
      id: "report-doc",
      number: "BO/2026/000001",
      version: 1,
      generatedAt: now,
      rendererVersion: 1,
      fingerprint: createHash("sha256")
        .update(JSON.stringify(snapshot))
        .digest("hex"),
      options,
      snapshot,
    },
  ];
  d.reportSequence = 1;
  return d;
}
