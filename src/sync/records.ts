import type { Data } from "../domain";
import type { VisitReport } from "../reports/model";
import { canonical, same } from "./causal";
import type { Json, Mutation } from "./model";

/** Wire-eligible projection only. Does NOT apply received records to Data.
 * No photos, thumbnails, Timer, restore ID, native credentials or trust.
 * Assets-dependent issued reports stay local; their immutable identity is
 * reserved in the visit unit so number collisions cannot be silently ignored. */
const needsLocalAssets = (r: VisitReport) =>
  r.snapshot.photos.length > 0 || r.snapshot.logo !== null ||
  r.options.photoIds.length > 0 || r.options.logoPhotoId !== null;
export function businessRecords(data: Data): Map<string, Json> {
  const result = new Map<string, Json>();
  const json = (v: unknown): Json => JSON.parse(JSON.stringify(v)) as Json;
  function put(collection: string, id: string, value: unknown) {
    const key = collection + "/" + encodeURIComponent(id);
    if (result.has(key)) throw Error("Powtórzony klucz jednostki synchronizacji.");
    const normalized = json(value); canonical(normalized); result.set(key, normalized);
  }
  for (const item of data.clients) put("clients", item.id, item);
  for (const item of data.gardens) put("gardens", item.id, item);
  for (const item of data.materialCatalog) put("materialCatalog", item.id, item);
  for (const item of data.jobs) {
    const { reports, ...job } = item;
    put("visits", item.id, {
      job,
      payments: data.payments.filter(p => p.jobId === item.id).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      reportIdentities: (reports ?? []).map(r => ({
        id: r.id, number: r.number, version: r.version, generatedAt: r.generatedAt, fingerprint: r.fingerprint,
        requiresAssets: needsLocalAssets(r),
      })),
    });
    for (const report of reports ?? []) {
      if (needsLocalAssets(report)) continue;
      put("reports", item.id + "/" + report.id, { jobId: item.id, report });
    }
  }
  const collections = [
    "expenses", "expenseCategories", "expenseRules", "expenseProfiles", "expenseImports",
    "shoppingItems", "workTemplates", "taskSchedules", "taskOccurrences", "todos",
  ] as const;
  for (const key of collections) for (const item of data[key]) put(key, item.id, item);
  for (const note of data.notes) put("notes", note.id, { ...note, photoId: null, photoName: null });
  for (const checklist of data.checklists) put("checklists", checklist.id, {
    ...checklist, items: checklist.items.map(item => ({ ...item, photoId: null, photoName: null })),
  });
  for (const item of data.deskTombstones) put("deskTombstones", item.kind + "/" + item.id, item);
  for (const item of data.checklistTombstones) put("checklistTombstones", item.kind + "/" + item.id, item);
  for (const item of data.availability ?? []) put("availability", item.date, item);
  put("settings", "business", data.settings);
  put("counters", "reportSequence", data.reportSequence);
  return result;
}
export function recordChanges(before: Map<string, Json>, after: Map<string, Json>): Mutation[] {
  return [...new Set([...before.keys(), ...after.keys()])].sort().flatMap(key => {
    const a = before.get(key) ?? null, b = after.get(key) ?? null;
    return same(a, b) ? [] : [{ key, before: a, after: b }];
  });
}
