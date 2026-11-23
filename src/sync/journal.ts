import type { Data } from "../domain";
import { appendLocal, canonical, newLog, validateOperation, validateVector, dominates, dotId, validateCausalContext } from "./causal";
import { SyncError, syncLimits, type ReplicaLog, type Vector } from "./model";
import { businessRecords, recordChanges } from "./records";
import { bootstrapGroups } from "./bootstrap";
import { bankRisk } from "./bank-identity";
import { protectRemoteMeasurement } from "./visits";

export const JOURNAL_STORE = "sync";
export const JOURNAL_DATABASE_VERSION = 2;
export const JOURNAL_KEY = "journal-v1";
export const JOURNAL_SOURCE = "source-v12-before-activation";
export const DATABASE_SOURCE = "source-before-db-v2";
export interface JournalState {
  version: 1 | 2;
  log: ReplicaLog;
  lastRevision: number;
  mode: "active" | "restore-review";
  appliedLocal: string[];
  restoreCount: number;
}
const invalid = () => new SyncError("INVALID", "Dziennik synchronizacji jest niespójny. Zachowano oryginalny stan i zapis.");
export function validateJournal(value: unknown): asserts value is JournalState {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  const j = value as JournalState, l = j.log;
  if ((j.version !== 1 && j.version !== 2) || !Number.isSafeInteger(j.lastRevision) || j.lastRevision < 0 ||
    !["active", "restore-review"].includes(j.mode) || !Number.isSafeInteger(j.restoreCount) || j.restoreCount < 0 ||
    !Array.isArray(j.appliedLocal) || new Set(j.appliedLocal).size !== j.appliedLocal.length ||
    !l || l.protocol !== 1 || !Array.isArray(l.operations) || !Array.isArray(l.waiting)) throw invalid();
  if(j.version===2&&!l.operations.some(o=>o.origin===l.installation&&o.changes.some(c=>c.key.startsWith("reportNamespaces/"))))
    throw invalid();
  const localApplied = new Set(j.appliedLocal);
  newLog(l.installation); validateVector(l.known);
  if (l.nextSequence !== (l.known[l.installation] ?? 0) + 1 || !Number.isSafeInteger(l.nextSequence) ||
    l.operations.length + l.waiting.length > syncLimits.operations || l.waiting.length > syncLimits.waiting) throw invalid();
  const known: Vector = {}, dots = new Set<string>(), ids = new Set<string>();
  const predecessors = new Map<string, typeof l.operations[number]>();
  for (const op of l.operations) {
    validateOperation(op);
    if (!dominates(known, op.context) || (known[op.origin] ?? 0) !== op.sequence - 1 ||
      dots.has(dotId(op)) || ids.has(op.id)) throw invalid();
    validateCausalContext(op, (origin, sequence) => predecessors.get(dotId({ origin, sequence })));
    predecessors.set(dotId(op), op);
    dots.add(dotId(op)); ids.add(op.id); known[op.origin] = op.sequence;
  }
  if (canonical(known) !== canonical(l.known)) throw invalid();
  for (const op of l.waiting) {
    validateOperation(op);
    if (op.origin === l.installation || dots.has(dotId(op)) || ids.has(op.id) ||
      (known[op.origin] ?? 0) >= op.sequence) throw invalid();
    dots.add(dotId(op)); ids.add(op.id);
  }
  if (j.appliedLocal.some(id => predecessors.get(id)?.origin !== l.installation) ||
    l.operations.some(o => o.origin === l.installation && !localApplied.has(dotId(o))) ||
    new TextEncoder().encode(canonical(j)).byteLength > syncLimits.historyBytes) throw invalid();
}
export function activateJournal(data: Data, revision: number, installation: string): JournalState {
  // Activation remains one transaction. Only CSV cyclic units need a group;
  // existing log operations/identities are never rewritten.
  let log = newLog(installation);
  const appliedLocal: string[] = [];
  for (const group of bootstrapGroups(data)) {
    const next = appendLocal(log, group); log = next.log;
    appliedLocal.push(dotId(next.operation!));
  }
  return { version: 1, log, lastRevision: revision, mode: "active", appliedLocal, restoreCount: 0 };
}
export function captureJournal(journal: JournalState, before: Data, after: Data, beforeRevision: number, afterRevision: number, restored: boolean) {
  validateJournal(journal);
  if (journal.lastRevision !== beforeRevision) throw new SyncError("PRECONDITION",
    "Wykryto zapis pomijający dziennik. Dane zachowano; przed synchronizacją trzeba uzgodnić historię.");
  const change = recordChanges(businessRecords(before), businessRecords(after));
  // A profile received by sync must not enable a second local import of an
  // unverified account namespace. This preflight is opt-in with the journal;
  // ordinary v12 import behavior and explicit restore remain unchanged.
  if(!restored && journal.mode==="active") {
    protectRemoteMeasurement(before,after);
    const old=new Set(before.expenses.map(e=>e.id));
    const added=after.expenses.filter(e=>e.source==="csv" && e.origin && !old.has(e.id));
    const risk=bankRisk(before,added,after.expenseImports,false);
    if(risk)throw new SyncError("CONFLICT",risk);
  }
  let result:ReturnType<typeof appendLocal>;
  try {result=appendLocal(journal.log,change);}
  catch(error) {
    // A business restore can intentionally replace a local materialization
    // behind already RECEIVED but unapplied report/financial history. Do not
    // forge a before value or rewrite those operations to make a rollback fit.
    // Keep the entire log and quarantine the restored branch for onboarding.
    if(!restored||!(error instanceof SyncError)||!["PRECONDITION","CONFLICT"].includes(error.code))throw error;
    result={log:structuredClone(journal.log),operation:null};
  }
  const next: JournalState = {
    ...journal, log: result.log, lastRevision: afterRevision,
    mode: restored ? "restore-review" : journal.mode,
    restoreCount: journal.restoreCount + (restored ? 1 : 0),
    appliedLocal: result.operation ? [...journal.appliedLocal, dotId(result.operation)] : [...journal.appliedLocal],
  };
  validateJournal(next); return next;
}
/** Schedule inside the SAME IDB transaction as current.put. oncomplete is the
 * only commit signal. A journal failure aborts both writes, never falls back. */
export function captureInTransaction(
  store: IDBObjectStore | undefined, before: Data, after: Data, beforeRevision: number, afterRevision: number,
  restored: boolean, abort: (error: unknown) => void,
) {
  if (!store) return;
  const request = store.get(JOURNAL_KEY);
  request.onsuccess = () => {
    try {
      if (request.result === undefined) return; // Activation is explicit, not an automatic LAN side effect.
      const next = captureJournal(request.result, before, after, beforeRevision, afterRevision, restored);
      if(restored) {
        const checkpoint={before,after,journal:request.result,beforeRevision,afterRevision};
        const first=store.get("before-first-business-restore");
        first.onsuccess=()=>{if(first.result===undefined)store.put(checkpoint,"before-first-business-restore");};
        store.put(checkpoint,"before-last-business-restore");
      }
      store.put(next, JOURNAL_KEY);
    } catch (error) { abort(error); }
  };
}
