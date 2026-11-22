import {
  SyncError, syncLimits, type Json, type Vector, type Dot,
  type Mutation, type Operation, type ReplicaLog, type RecordView, type FieldConflict,
} from "./model";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function fail(code: ConstructorParameters<typeof SyncError>[0], text: string): never { throw new SyncError(code, text); }
const plain = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(v));
const exact = (v: unknown, keys: string[]): v is Record<string, unknown> => {
  if (!plain(v) || Object.keys(v).sort().join("|") !== [...keys].sort().join("|"))
    fail("INVALID", "Nieprawidłowa struktura operacji synchronizacji.");
  return true;
};
const identity = (v: unknown): v is string => typeof v === "string" && uuid.test(v);
const counter = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;

/** Canonical JSON equality, not a cryptographic hash. Wire integrity uses SHA256.
 * Reject executable/prototype-bearing values before touching any persistence. */
export function canonical(value: unknown): string {
  let nodes = 0;
  function visit(v: unknown, depth: number): string {
    if (++nodes > 1_000_000 || depth > syncLimits.depth) fail("LIMIT", "Przekroczono limit złożoności danych.");
    if (v === null) return "null";
    if (typeof v === "string" || typeof v === "boolean") return JSON.stringify(v);
    if (typeof v === "number" && Number.isFinite(v)) return JSON.stringify(v);
    if (Array.isArray(v)) return "[" + v.map(x => visit(x, depth + 1)).join(",") + "]";
    if (!plain(v)) fail("INVALID", "Wiadomość musi zawierać wyłącznie JSON.");
    return "{" + Object.keys(v).sort().map(k => {
      if (["__proto__", "constructor", "prototype"].includes(k)) fail("INVALID", "Niedozwolone pole danych.");
      return JSON.stringify(k) + ":" + visit(v[k], depth + 1);
    }).join(",") + "}";
  }
  return visit(value, 0);
}
export const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
export const dotId = (d: Dot) => d.origin + ":" + d.sequence;
export const covers = (v: Vector, d: Dot) => (v[d.origin] ?? 0) >= d.sequence;
export function validateVector(value: unknown): asserts value is Vector {
  if (!plain(value) || Object.keys(value).length > syncLimits.replicas ||
    Object.entries(value).some(([k, n]) => !identity(k) || !counter(n)))
    fail("INVALID", "Nieprawidłowy zegar przyczynowy.");
}
export function dominates(a: Vector, b: Vector) {
  return Object.entries(b).every(([key, n]) => (a[key] ?? 0) >= n);
}
export function join(a: Vector, b: Vector): Vector {
  validateVector(a); validateVector(b);
  const out: Vector = { ...a };
  for (const [key, n] of Object.entries(b)) out[key] = Math.max(out[key] ?? 0, n);
  validateVector(out); return out;
}
export function validateOperation(value: unknown): asserts value is Operation {
  exact(value, ["protocol", "id", "origin", "sequence", "context", "resolution", "changes"]);
  const o = value as unknown as Operation;
  if (o.protocol !== 1 || !identity(o.id) || !identity(o.origin) || !counter(o.sequence) ||
    typeof o.resolution !== "boolean") fail("INVALID", "Nieprawidłowa tożsamość operacji.");
  validateVector(o.context);
  if ((o.context[o.origin] ?? 0) !== o.sequence - 1) fail("INVALID", "Niespójny licznik źródła.");
  if (!Array.isArray(o.changes) || !o.changes.length || o.changes.length > syncLimits.changes)
    fail("LIMIT", "Nieprawidłowa liczba zmian w jednostce atomowej.");
  const keys = new Set<string>();
  for (const c of o.changes) {
    exact(c, ["key", "before", "after"]);
    if (typeof c.key !== "string" || !c.key || c.key.length > syncLimits.key ||
      /[\u0000-\u001f\u007f]/.test(c.key) || keys.has(c.key)) fail("INVALID", "Nieprawidłowy klucz rekordu.");
    keys.add(c.key);
    if (!o.resolution && same(c.before, c.after)) fail("INVALID", "Pusta zmiana nie jest operacją.");
  }
  if (new TextEncoder().encode(canonical(o)).byteLength > syncLimits.operationBytes)
    fail("LIMIT", "Operacja synchronizacji przekracza limit 8 MiB.");
}
export function newLog(installation: string): ReplicaLog {
  if (!identity(installation)) fail("INVALID", "Nieprawidłowa tożsamość instalacji.");
  return { protocol: 1, installation, nextSequence: 1, known: {}, operations: [], waiting: [] };
}
interface Write { op: Operation; change: Mutation }
const concurrentHeads = <T extends { op: Operation }>(all: T[]): T[] =>
  all.filter(a => !all.some(b => b !== a && covers(b.op.context, a.op)))
    .sort((a, b) => dotId(a.op).localeCompare(dotId(b.op), "en"));

/** Only flat client fields may merge automatically. Financial/linked aggregates
 * are whole records. No timestamp or maximum business revision chooses a winner. */
const mayMergeFields = (key: string) => key.startsWith("clients/");
const objectValue = (v: Json): v is { [key: string]: Json } =>
  plain(v) && Object.values(v).every(x => x === null || ["string", "number", "boolean"].includes(typeof x));
const dot = (o: Operation): Dot => ({ origin: o.origin, sequence: o.sequence });

export function recordView(log: ReplicaLog, key: string, at?: Vector): RecordView {
  const writes: Write[] = log.operations.filter(o => !at || covers(at, o))
    .flatMap(op => op.changes.filter(c => c.key === key).map(change => ({ op, change })));
  const heads = concurrentHeads(writes), ids = heads.map(x => dot(x.op));
  const view: RecordView = { key, status: "missing", value: null, heads: ids, conflicts: [] };
  if (!heads.length) return view;
  const first = heads[0].change.after;
  if (heads.every(x => same(x.change.after, first)))
    return { ...view, value: structuredClone(first), status: first === null ? "deleted" : "value" };
  const commonAncestor = (ops: Operation[]) => {
    const context: Vector = {};
    for (const [origin, n] of Object.entries(ops[0].context)) {
      const shared = Math.min(n, ...ops.slice(1).map(o => o.context[origin] ?? 0));
      if (shared > 0) context[origin] = shared;
    }
    return recordView(log, key, context);
  };
  const conflict = (reason: NonNullable<RecordView["reason"]>, conflicts?: FieldConflict[]): RecordView => {
    if (!conflicts) {
      const ancestor = commonAncestor(heads.map(h => h.op));
      conflicts = [{ field: "*", baseAvailable: ancestor.status === "value",
        base: ancestor.status === "value" ? ancestor.value : null,
        alternatives: heads.map(h => ({ dot: dot(h.op), value: structuredClone(h.change.after) })) }];
    }
    return { ...view, status: "conflict", reason, conflicts };
  };
  if (heads.some(x => x.change.after === null)) return conflict("edit-delete");
  const roots = concurrentHeads(writes.filter(x => x.change.before === null));
  if (roots.length > 1 && !heads.every(h => roots.every(r => covers(h.op.context, r.op))))
    return conflict("independent-create");
  if (!mayMergeFields(key) || !writes.every(x => (x.change.before === null || objectValue(x.change.before)) &&
    (x.change.after === null || objectValue(x.change.after)))) return conflict("record");
  // Field registers retain the last actual write, including writes preceding a
  // later edit to another field; using only the final whole-record delta loses it.
  const names = new Set(writes.flatMap(x => [
    ...Object.keys(x.change.before ?? {}), ...Object.keys(x.change.after ?? {}),
  ]));
  const output: { [key: string]: Json } = {}, conflicts: FieldConflict[] = [];
  type Field = { exists: boolean; value: Json };
  const field = (v: Json, name: string): Field => plain(v) && Object.hasOwn(v, name) ?
    { exists: true, value: v[name] as Json } : { exists: false, value: null };
  for (const name of [...names].sort()) {
    const changes = writes.filter(x => x.change.after !== null)
      .map(x => ({ ...x, before: field(x.change.before, name), after: field(x.change.after, name) }))
      .filter(x => x.op.resolution || x.change.before === null || !same(x.before, x.after));
    const active = concurrentHeads(changes);
    if (!active.length) continue;
    const winner = active[0].after;
    if (!active.every(x => same(x.after, winner))) {
      const ancestor = commonAncestor(active.map(x => x.op));
      const baseAvailable = ancestor.status === "value" && plain(ancestor.value) && Object.hasOwn(ancestor.value, name);
      conflicts.push({ field: name, baseAvailable, base: baseAvailable ? (ancestor.value as { [key: string]: Json })[name] : null,
        alternatives: active.map(x => ({ dot: dot(x.op), value: structuredClone(x.after.value) })) });
    } else if (winner.exists) output[name] = structuredClone(winner.value);
  }
  return conflicts.length ? conflict("fields", conflicts) : { ...view, status: "value", value: output };
}
/** Every causal frontier must include the dependencies of its own entries.
 * A peer must not construct a snapshot that could never have existed. */
export function validateCausalContext(op: Operation, lookup: (origin: string, sequence: number) => Operation | undefined) {
  for (const [origin, sequence] of Object.entries(op.context)) {
    const prior = lookup(origin, sequence);
    if (!prior || !dominates(op.context, prior.context))
      fail("PRECONDITION", "Wektor operacji pomija zależności przyczynowe poprzednika.");
  }
}
function checkPreconditions(log: ReplicaLog, op: Operation) {
  validateCausalContext(op, (origin, sequence) => log.operations.find(p => p.origin === origin && p.sequence === sequence));
  for (const c of op.changes) {
    const before = recordView(log, c.key, op.context);
    if (op.resolution) {
      if (before.status !== "conflict") fail("PRECONDITION", "Nie ma konfliktu wymagającego tej decyzji.");
    } else {
      if (before.status === "conflict") fail("CONFLICT", "Najpierw rozstrzygnij konflikt rekordu.");
      if (!same(before.value, c.before)) fail("PRECONDITION", "Operacja nie wynika ze wskazanej poprzedniej wersji.");
    }
  }
}
function limits(log: ReplicaLog) {
  if (log.operations.length + log.waiting.length > syncLimits.operations || log.waiting.length > syncLimits.waiting)
    fail("LIMIT", "Dziennik osiągnął limit. Nie usunięto historii ani tombstones.");
  validateVector(log.known);
  const origins = new Set([...Object.keys(log.known), ...log.waiting.map(o => o.origin)]);
  if (origins.size > syncLimits.replicas ||
    new TextEncoder().encode(canonical(log)).byteLength > syncLimits.historyBytes)
    fail("LIMIT", "Dziennik przekracza bezpieczny limit. Operacja nie została przyjęta.");
}
/** Returns a copy; a rejection leaves the entire supplied log unchanged.
 * known means causally validated RECEIPT, never "business data applied". */
export function receive(log: ReplicaLog, incoming: readonly unknown[]): ReplicaLog {
  const next = structuredClone(log);
  const known = new Map([...next.operations, ...next.waiting].map(o => [dotId(o), o]));
  const ids = new Map([...known.values()].map(o => [o.id, dotId(o)]));
  if (!Array.isArray(incoming) || incoming.length > syncLimits.waiting) fail("LIMIT", "Zbyt wiele operacji w pakiecie.");
  for (const value of incoming) {
    validateOperation(value);
    const id = dotId(value), prior = known.get(id);
    if (prior) {
      if (!same(prior, value)) fail("EQUIVOCATION", "Tożsamość operacji ma różne treści. Synchronizację wstrzymano.");
      continue;
    }
    if (ids.has(value.id) || covers(next.known, value)) fail("EQUIVOCATION", "Powtórzona tożsamość ma inną historię.");
    if (value.origin === next.installation || (value.context[next.installation] ?? 0) > (next.known[next.installation] ?? 0))
      fail("ORIGIN", "Obca wiadomość nie może dopisać ani przewidzieć operacji własnej instalacji.");
    const copy = structuredClone(value); next.waiting.push(copy); known.set(id, copy); ids.set(copy.id, id);
  }
  let progress = true;
  while (progress) {
    progress = false;
    next.waiting.sort((a, b) => dotId(a).localeCompare(dotId(b), "en"));
    for (let i = 0; i < next.waiting.length; i++) {
      const op = next.waiting[i];
      if (!dominates(next.known, op.context) || (next.known[op.origin] ?? 0) !== op.sequence - 1) continue;
      checkPreconditions(next, op);
      next.operations.push(op); next.known[op.origin] = op.sequence;
      next.waiting.splice(i, 1); progress = true; break;
    }
  }
  limits(next); return next;
}
export function appendLocal(log: ReplicaLog, changes: Mutation[], options: { resolution?: boolean; id?: string } = {}):
  { log: ReplicaLog; operation: Operation | null } {
  const actual = changes.filter(c => options.resolution || !same(c.before, c.after));
  if (!actual.length) return { log: structuredClone(log), operation: null };
  const op: Operation = { protocol: 1, id: options.id ?? crypto.randomUUID(), origin: log.installation,
    sequence: log.nextSequence, context: { ...log.known }, resolution: options.resolution ?? false, changes: structuredClone(actual) };
  validateOperation(op);
  if (op.sequence !== (log.known[op.origin] ?? 0) + 1) fail("PRECONDITION", "Nieprawidłowy lokalny licznik.");
  if (log.operations.some(o => o.id === op.id) || log.waiting.some(o => o.id === op.id))
    fail("EQUIVOCATION", "Tożsamość operacji została już wykorzystana.");
  checkPreconditions(log, op);
  const next = structuredClone(log);
  next.operations.push(op); next.known[op.origin] = op.sequence; next.nextSequence = op.sequence + 1;
  if (!Number.isSafeInteger(next.nextSequence)) fail("LIMIT", "Wyczerpano lokalny licznik operacji.");
  limits(next); return { log: next, operation: op };
}
export function missingOperations(log: ReplicaLog, peerKnown: Vector): Operation[] {
  validateVector(peerKnown);
  return structuredClone(log.operations.filter(o => !covers(peerKnown, o)));
}
