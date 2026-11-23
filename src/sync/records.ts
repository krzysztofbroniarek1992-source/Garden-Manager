import type { Data } from "../domain";
import type { VisitReport } from "../reports/model";
import { canonical, same } from "./causal";
import { SyncError, type Json, type Mutation } from "./model";

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

/** Receiver boundary for the v12 portable projection. Unknown/local-only kinds
 * are not opaque future business records and must never be relayed. */
export function validateWireProjection(key:string,value:Json) {
  const kind=key.slice(0,key.indexOf("/"));
  const kinds=["clients","gardens","materialCatalog","visits","reports","expenses","expenseCategories",
    "expenseRules","expenseProfiles","expenseImports","shoppingItems","workTemplates","taskSchedules","taskOccurrences",
    "todos","notes","checklists","deskTombstones","checklistTombstones","availability","settings","counters","reportNamespaces","reportDocuments","financialDecisions"];
  function reject():never {throw new SyncError("INVALID","Niedozwolony typ lub lokalne referencje w projekcji v12.");}
  if(!kinds.includes(kind))reject();
  if(value===null)return;
  const obj=(v:Json|undefined):v is {[key:string]:Json}=>!!v&&typeof v==="object"&&!Array.isArray(v);
  if(kind==="notes" && (!obj(value)||value.photoId!==null||value.photoName!==null))reject();
  if(kind==="checklists") {
    if(!obj(value)||!Array.isArray(value.items)||value.items.some(i=>!obj(i)||i.photoId!==null||i.photoName!==null))reject();
  }
  if(kind==="visits") {
    if(!obj(value)||!obj(value.job))reject();
    const job=value.job;
    if(Object.keys(value).sort().join("|")!=="job|payments|reportIdentities" ||
      ["reports","photos","timer","photoRestoreId"].some(k=>Object.hasOwn(job,k)) ||
      !Array.isArray(value.reportIdentities)||value.reportIdentities.some(r=>!obj(r)||
        Object.keys(r).sort().join("|")!=="fingerprint|generatedAt|id|number|requiresAssets|version"))reject();
  }
  if(kind==="reports") {
    if(!obj(value)||!obj(value.report)||!obj(value.report.snapshot)||!obj(value.report.options))reject();
    const report=(value as {[key:string]:Json}).report as {[key:string]:Json};
    const snapshot=report.snapshot as {[key:string]:Json}, options=report.options as {[key:string]:Json};
    if(!Array.isArray(snapshot.photos)||snapshot.photos.length||snapshot.logo!==null||
      !Array.isArray(options.photoIds)||options.photoIds.length||options.logoPhotoId!==null)reject();
  }
}
