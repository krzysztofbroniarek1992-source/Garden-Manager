/** Technical audit v1. Never part of business Data v12 or its JSON/ZIP.
 * This module proves a proposal's sources; it does not authorize a Data write. */
import { canonical, covers, dotId, recordView, same, validateOperation } from "./causal";
import type { Json, Operation, ReplicaLog, Vector } from "./model";
import { SyncError } from "./model";

export interface PaymentDisposition {
  id: string;
  action: "keep" | "cancel" | "correct";
  sourceOperationId: string;
  amountCents?: number;
  receivedDate?: string;
  method?: "cash" | "transfer" | "blik" | "other";
  note?: string;
}
export type FinancialIntent =
  | { kind: "visit"; basisOperationId: string;
      labor: { kind: "source" } | { kind: "amount"; cents: number };
      time: { kind: "source" } | { kind: "seconds"; seconds: number };
      payments: PaymentDisposition[] }
  | { kind: "expense"; basisOperationId: string; amountCents: number;
      categoryId: string; status: "approved" | "excluded" };
export interface SourceVersion {
  operationId: string;
  origin: string;
  sequence: number;
  context: Vector;
  before: Json;
  after: Json;
}
export interface FinancialEvidence {
  version: 1;
  id: string;
  key: string;
  token: string;
  sources: SourceVersion[];
  baseAvailable: boolean;
  base: Json;
  intent: FinancialIntent;
  rationale: string;
  at: number;
  result: Json;
}
export interface FinancialDecisionRequest {
  id: string;
  conflictId: string;
  token: string;
  rationale: string;
  intent: FinancialIntent;
}
export const decisionKey = (id: string) => "financialDecisions/" + encodeURIComponent(id);
export const isDecisionKey = (key: string) => key.startsWith("financialDecisions/");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function invalid(text = "Nieprawidłowy audyt świadomej decyzji."): never {
  throw new SyncError("INVALID", "FINANCIAL_DECISION: " + text);
}
function object(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(v));
}
function exact(v: unknown, keys: string[]): asserts v is Record<string, unknown> {
  if (!object(v) || Object.keys(v).sort().join("|") !== [...keys].sort().join("|")) invalid();
}
const text = (v: unknown): v is string => typeof v === "string" && !!v.trim() && v.length <= 2000;
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
export function validateFinancialIntent(value: unknown): asserts value is FinancialIntent {
  if (!object(value) || !text(value.basisOperationId) || !uuid.test(value.basisOperationId)) invalid();
  if (value.kind === "visit") {
    exact(value, ["kind","basisOperationId","labor","time","payments"]);
    if (!object(value.labor) || !object(value.time)) invalid();
    if (value.labor.kind === "source") exact(value.labor, ["kind"]);
    else {
      exact(value.labor, ["kind","cents"]);
      if (value.labor.kind !== "amount" || !integer(value.labor.cents)) invalid();
    }
    if (value.time.kind === "source") exact(value.time, ["kind"]);
    else {
      exact(value.time, ["kind","seconds"]);
      if (value.time.kind !== "seconds" || !integer(value.time.seconds)) invalid();
    }
    if (!Array.isArray(value.payments) || value.payments.length > 5000) invalid();
    const ids = new Set<string>();
    for (const p of value.payments) {
      if (!object(p) || !text(p.id) || ids.has(p.id) ||
        !text(p.sourceOperationId) || !uuid.test(p.sourceOperationId)) invalid();
      ids.add(p.id);
      if (p.action === "keep" || p.action === "cancel") exact(p, ["id","action","sourceOperationId"]);
      else {
        exact(p, ["id","action","sourceOperationId","amountCents","receivedDate","method","note"]);
        if (p.action !== "correct" || !integer(p.amountCents) || p.amountCents === 0 ||
          typeof p.receivedDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(p.receivedDate) ||
          !["cash","transfer","blik","other"].includes(p.method as string) ||
          typeof p.note !== "string" || p.note.length > 2000) invalid();
      }
    }
  } else if (value.kind === "expense") {
    exact(value, ["kind","basisOperationId","amountCents","categoryId","status"]);
    if (!integer(value.amountCents) || !text(value.categoryId) ||
      !["approved","excluded"].includes(value.status as string)) invalid();
  } else invalid();
}
export function validateDecisionRequest(value: unknown): asserts value is FinancialDecisionRequest {
  canonical(value);
  exact(value, ["id","conflictId","token","rationale","intent"]);
  if (typeof value.id !== "string" || !uuid.test(value.id) || !text(value.conflictId) ||
    typeof value.token !== "string" || !text(value.rationale)) invalid();
  validateFinancialIntent(value.intent);
}
export function validateFinancialEvidence(value: unknown): asserts value is FinancialEvidence {
  canonical(value);
  exact(value, ["version","id","key","token","sources","baseAvailable","base","intent","rationale","at","result"]);
  if (value.version !== 1 || typeof value.id !== "string" || !uuid.test(value.id) ||
    typeof value.key !== "string" || !/^(visits|expenses)\/[^/]+$/.test(value.key) ||
    typeof value.token !== "string" || !text(value.rationale) || !integer(value.at) ||
    typeof value.baseAvailable !== "boolean" || !Array.isArray(value.sources) ||
    value.sources.length < 2 || value.sources.length > 64 || value.result === null) invalid();
  validateFinancialIntent(value.intent);
  if ((value.key.startsWith("visits/") ? "visit" : "expense") !== value.intent.kind) invalid();
  const ids = new Set<string>();
  for (const s of value.sources) {
    exact(s, ["operationId","origin","sequence","context","before","after"]);
    // Reuse the protocol's identity, counter, vector and JSON validation.
    validateOperation({ protocol:1,id:s.operationId,origin:s.origin,sequence:s.sequence,
      context:s.context,resolution:true,changes:[{key:value.key,before:s.before,after:s.after}] });
    if (ids.has(s.operationId as string)) invalid();
    ids.add(s.operationId as string);
  }
  if (!ids.has(value.intent.basisOperationId)) invalid("Wariant bazowy nie należy do konfliktu.");
  if (value.intent.kind === "visit" && value.intent.payments.some(p => !ids.has(p.sourceOperationId)))
    invalid("Wpłata nie pochodzi z historii konfliktu.");
}
/** Reconstruct sources at a causal frontier, never at a device clock. */
export function financialSources(log: ReplicaLog, key: string, at: Vector = log.known) {
  const view = recordView(log,key,at);
  if (view.status !== "conflict") throw new SyncError("PRECONDITION", "Konflikt został już zmieniony lub rozstrzygnięty.");
  const heads = view.heads.map(h => log.operations.find(o => dotId(o) === dotId(h))!);
  const context: Vector = {};
  for (const [origin,n] of Object.entries(heads[0].context)) {
    const shared = Math.min(n,...heads.slice(1).map(o => o.context[origin] ?? 0));
    if (shared) context[origin] = shared;
  }
  const base = recordView(log,key,context);
  return {
    token: canonical(view.heads),
    sources: heads.map(o => {
      const c = o.changes.find(c => c.key === key)!;
      return {operationId:o.id,origin:o.origin,sequence:o.sequence,context:structuredClone(o.context),
        before:structuredClone(c.before),after:structuredClone(c.after)};
    }),
    baseAvailable: base.status === "value" || base.status === "deleted",
    base: base.status === "value" || base.status === "deleted" ? structuredClone(base.value) : null,
  };
}
/** Source proof only; the controlled adapter must also reconstruct the result
 * from the intent, verify dependencies and enforce all domain invariants. */
export function verifyFinancialEvidence(log: ReplicaLog, operation: Operation): FinancialEvidence {
  const records = operation.changes.filter(c => isDecisionKey(c.key));
  if (!operation.resolution || records.length !== 1 || records[0].before !== null) invalid();
  const evidence = records[0].after;
  validateFinancialEvidence(evidence);
  if (records[0].key !== decisionKey(evidence.id) || operation.id !== evidence.id ||
    operation.changes.length !== 2 || !operation.changes.some(c => c.key === evidence.key && same(c.after,evidence.result)))
    invalid("Decyzja nie odpowiada swojej niepodzielnej operacji.");
  const proof = financialSources(log,evidence.key,operation.context);
  if (!same(proof, {token:evidence.token,sources:evidence.sources,baseAvailable:evidence.baseAvailable,base:evidence.base}) ||
    evidence.sources.some(s => !covers(operation.context,s)))
    invalid("Nie udowodniono pełnej historii konfliktu.");
  return evidence;
}
