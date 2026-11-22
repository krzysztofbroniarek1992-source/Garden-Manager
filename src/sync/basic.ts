import type { Client, Garden, Data } from "../domain";
import { materialUnits, toCents } from "../domain";
import { validateData } from "../data/repository";
import { GardenStore } from "../data/store";
import { validateDeskData, type Note, type Todo, type DeskTombstone } from "../desk/model";
import { businessRecords, recordChanges } from "./records";
import { SyncError, type Json, type Mutation } from "./model";

export class ApplyBlocked extends Error {
  constructor(readonly code: "unsupported" | "dependency" | "domain" | "photos", text: string) { super(text); }
}
export const basicKinds = ["clients", "gardens", "materialCatalog", "notes", "todos", "deskTombstones"] as const;
export function keyParts(key: string) {
  const slash = key.indexOf("/");
  if (slash < 1) throw new SyncError("INVALID", "Nieprawidłowy klucz jednostki.");
  const kind = key.slice(0, slash), encoded = key.slice(slash + 1);
  let id: string;
  try { id = decodeURIComponent(encoded); } catch { throw new SyncError("INVALID", "Nieprawidłowy identyfikator jednostki."); }
  if (!id.trim() || encodeURIComponent(id) !== encoded)
    throw new SyncError("INVALID", "Niejednoznaczny identyfikator jednostki.");
  return { kind, id };
}
const object = (v: Json): v is { [key: string]: Json } => v !== null && typeof v === "object" && !Array.isArray(v);
const positive = (v: Json) => typeof v === "number" && Number.isFinite(v) && v >= 0;
const price = (v: Json) => { try { return positive(v) && Number.isSafeInteger(toCents(v as number)); } catch { return false; } };
function shape(v: Json, fields: string[], texts: string[] = []) {
  if (!object(v) || Object.keys(v).sort().join("|") !== [...fields].sort().join("|") ||
    texts.some(k => typeof v[k] !== "string")) throw new SyncError("INVALID", "Nieprawidłowe pola rekordu podstawowego.");
  return v;
}
const common = ["id","title","createdAt","updatedAt","revision","priority","clientName","gardenName","zoneName","jobTitle","clientId","gardenId","zoneId","jobId"];
/** Intrinsic validation is independent of receipt/application status. Unknown
 * business types are opaque and blocked as WHOLE operations, never cast to Data. */
export function validateBasicValue(data: Data, key: string, value: Json) {
  const { kind, id } = keyParts(key);
  if (!(basicKinds as readonly string[]).includes(kind) || value === null) return;
  if (!object(value)) throw new SyncError("INVALID", "Rekord musi być obiektem.");
  if (kind !== "deskTombstones" && value.id !== id) throw new SyncError("INVALID", "ID rekordu nie odpowiada kluczowi.");
  if (kind === "clients") {
    shape(value, ["id","name","phone","email","notes"], ["id","name","phone","email","notes"]);
    if (!(value.name as string).trim()) throw new SyncError("INVALID", "Klient musi mieć nazwę.");
  } else if (kind === "gardens") {
    shape(value, ["id","clientId","name","address","area","notes","zones"], ["id","clientId","name","address","notes"]);
    if (!(value.name as string).trim() || !(value.clientId as string).trim() || !positive(value.area) ||
      !Array.isArray(value.zones)) throw new SyncError("INVALID", "Nieprawidłowy ogród.");
    const ids = new Set<string>();
    for (const zone of value.zones as Json[]) {
      const z = shape(zone, ["id","name","type","area","length","plants","requirements","treatments"],
        ["id","name","type","plants","requirements","treatments"]);
      if (!(z.id as string).trim() || !(z.name as string).trim() || !(z.type as string).trim() ||
        ids.has(z.id as string) || !(z.area === null || positive(z.area)) || !(z.length === null || positive(z.length)))
        throw new SyncError("INVALID", "Nieprawidłowa lub powtórzona strefa.");
      ids.add(z.id as string);
    }
  } else if (kind === "materialCatalog") {
    shape(value, ["id","name","category","unit","purchaseUnitPrice","packageName","packageQuantity","notes"],
      ["id","name","category","unit","packageName","notes"]);
    if (!(value.name as string).trim() || !(value.category as string).trim() ||
      !(materialUnits as readonly Json[]).includes(value.unit) || !price(value.purchaseUnitPrice) ||
      !(value.packageQuantity === null || positive(value.packageQuantity) && (value.packageQuantity as number) > 0))
      throw new SyncError("INVALID", "Nieprawidłowy materiał katalogowy.");
  } else if (kind === "notes" || kind === "todos") {
    shape(value, [...common, ...(kind === "notes" ? ["body","category","archivedAt","reminder","photoId","photoName"] :
      ["description","dueDate","dueTime","status","completedAt"])]);
    // Scoped records stay blocked; the existing validator still checks their full
    // content when their actual parents exist at application time.
    if (kind === "notes" && (value.photoId !== null || value.photoName !== null))
      throw new SyncError("INVALID", "Odebrane referencje lokalnych zdjęć są niedozwolone.");
    if (["clientId","gardenId","zoneId","jobId"].every(k => value[k] === null)) {
      const probe = { ...data, notes: kind === "notes" ? [value as unknown as Note] : [],
        todos: kind === "todos" ? [value as unknown as Todo] : [], deskTombstones: [] };
      try { validateDeskData(probe); } catch { throw new SyncError("INVALID", "Nieprawidłowa notatka lub sprawa."); }
    }
  } else {
    shape(value, ["id","kind","deletedAt","revision"]);
    if (!["note","todo"].includes(value.kind as string) || id !== value.kind + "/" + value.id)
      throw new SyncError("INVALID", "Nieprawidłowy tombstone sprawy.");
    try { validateDeskData({ ...data, notes: [], todos: [], deskTombstones: [value as unknown as DeskTombstone] }); }
    catch { throw new SyncError("INVALID", "Nieprawidłowy tombstone sprawy."); }
  }
}
export function eligibility(data: Data, changes: Mutation[]) {
  for (const c of changes) {
    const { kind } = keyParts(c.key);
    if (!(basicKinds as readonly string[]).includes(kind))
      throw new ApplyBlocked("unsupported", "Nieobsługiwana jednostka " + kind + "; cała operacja pozostaje zablokowana.");
    for (const value of [c.before, c.after]) {
      validateBasicValue(data, c.key, value);
      if ((kind === "notes" || kind === "todos") && object(value) &&
        ["clientId","gardenId","zoneId","jobId"].some(k => value[k] !== null))
        throw new ApplyBlocked("unsupported", "Ten punkt obsługuje wyłącznie niezależne notatki i sprawy.");
    }
  }
}
/** Controlled projection, not a database replacement or ordinary command.
 * Domain commands are used only as a validation probe on a detached copy.
 * Their timestamps, reconciliation and generated tombstones are NOT persisted. */
export function applyBasic(data: Data, values: Map<string, Json>): Data {
  const next = structuredClone(data), allowed = new Set(values.keys());
  const replace = <T extends { id: string }>(rows: T[], id: string, value: Json): T[] =>
    value === null ? rows.filter(v => v.id !== id) :
      rows.some(v => v.id === id) ? rows.map(v => v.id === id ? value as unknown as T : v) : [...rows, value as unknown as T];
  for (const [key, value] of values) {
    validateBasicValue(data, key, value);
    const { kind, id } = keyParts(key);
    if (!(basicKinds as readonly string[]).includes(kind)) throw new ApplyBlocked("unsupported", "Jednostka jest zablokowana.");
    if (kind === "clients") next.clients = replace(next.clients, id, value);
    else if (kind === "gardens") next.gardens = replace(next.gardens, id, value);
    else if (kind === "materialCatalog") next.materialCatalog = replace(next.materialCatalog, id, value);
    else if (kind === "notes") {
      const old = data.notes.find(n => n.id === id);
      const retained = value === null ? null : { ...(value as object), photoId: old?.photoId ?? null, photoName: old?.photoName ?? null } as Json;
      next.notes = replace(next.notes, id, retained);
    } else if (kind === "todos") next.todos = replace(next.todos, id, value);
    else if (kind === "deskTombstones") {
      next.deskTombstones = next.deskTombstones.filter(t => t.kind + "/" + t.id !== id);
      if (value !== null) next.deskTombstones.push(value as unknown as DeskTombstone);
    }
  }
  for (const garden of next.gardens)
    if (!next.clients.some(c => c.id === garden.clientId))
      throw new ApplyBlocked("dependency", "Brak klienta nadrzędnego ogrodu: " + garden.clientId);
  // A remote removal/owner/zone change must not trigger implicit reconciliation
  // of local documentation or unsupported records.
  for (const [key, value] of values) {
    const { kind, id } = keyParts(key);
    if (kind !== "clients" && kind !== "gardens") continue;
    const old = kind === "clients" ? data.clients.find(c => c.id === id) : data.gardens.find(g => g.id === id);
    let probe = structuredClone(next);
    if (old) {
      if (kind === "clients") probe.clients = replace(probe.clients, id, old as unknown as Json);
      else probe.gardens = replace(probe.gardens, id, old as unknown as Json);
    } else {
      if (kind === "clients") probe.clients = probe.clients.filter(c => c.id !== id);
      else probe.gardens = probe.gardens.filter(g => g.id !== id);
    }
    const store = new GardenStore({ load: () => probe, save: v => { probe = v; } }, () => 0);
    try {
      if (kind === "clients") {
        if (value === null) store.deleteClient(id);
        else store.saveClient(value as unknown as Client, old as Client | undefined ?? null);
      } else if (value === null) store.deleteGarden(id);
      else {
        store.saveGarden(value as unknown as Garden, old as Garden | undefined ?? null);
        const previous = old as Garden | undefined, garden = value as unknown as Garden;
        for (const z of previous?.zones ?? []) if (!garden.zones.some(n => n.id === z.id)) store.deleteZone(id, z.id);
        for (const z of previous ? garden.zones : []) store.saveZone(id, z, previous?.zones.find(n => n.id === z.id) ?? null);
      }
    } catch (e) { throw new ApplyBlocked("domain", (e as Error).message); }
    if (JSON.stringify(probe.photos) !== JSON.stringify(next.photos)) throw new ApplyBlocked("photos", "Zmiana naruszyłaby lokalną dokumentację fotograficzną.");
    if (JSON.stringify(probe.timer) !== JSON.stringify(next.timer) ||
      recordChanges(businessRecords(next), businessRecords(probe)).some(c => !allowed.has(c.key)))
      throw new ApplyBlocked("domain", "Zmiana wymaga uzgodnienia innych powiązanych rekordów.");
  }
  for (const [key, value] of values) {
    const { kind, id } = keyParts(key);
    if ((kind === "notes" || kind === "todos") && value === null &&
      (kind === "notes" ? data.notes : data.todos).some(r=>r.id===id) &&
      !next.deskTombstones.some(t=>t.id===id && t.kind===(kind==="notes"?"note":"todo")))
      throw new ApplyBlocked("dependency","Usunięcie notatki/sprawy wymaga powiązanego tombstone.");
    if (kind === "materialCatalog" && value === null &&
      data.jobs.some(j => j.materials.some(m => m.catalogId === id)))
      throw new ApplyBlocked("domain", "Materiał jest powiązany z historią zlecenia.");
  }
  try { validateData(next); } catch (e) { throw new ApplyBlocked("domain", (e as Error).message); }
  // Enforce the whitelist even if a future adapter edit accidentally touches Data.
  for (const property of Object.keys(data) as (keyof Data)[])
    if (!(basicKinds as readonly string[]).includes(property) && JSON.stringify(data[property]) !== JSON.stringify(next[property]))
      throw new SyncError("INVALID", "Adapter próbował zmienić chronione dane.");
  return next;
}
