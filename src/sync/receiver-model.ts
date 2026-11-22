import type { Json, Operation, FieldConflict } from "./model";
export const RECEIVER_KEY = "receiver-v1";
export const RECEIVE_SOURCE = "before-first-receive-apply";
export const RECEIVE_LAST_SOURCE = "before-last-receive-apply";
export type ReceiptStage = "received" | "waiting-dependencies" | "verified" | "planned" |
  "waiting-records" | "conflict" | "blocked" | "applied" | "resolved" | "rejected";
export interface Receipt {
  operation: Operation;
  stage: ReceiptStage;
  reason: string;
  appliedRevision: number | null;
  resolvedBy: string | null;
}
export interface StoredConflict {
  id: string;
  key: string;
  kind: string;
  token: string;
  operations: string[];
  baseAvailable: boolean;
  base: Json;
  local: Json;
  remote: { operationId: string; value: Json }[];
  fields: FieldConflict[];
  reason: string;
  status: "open" | "resolved" | "superseded";
  resolvedBy: string | null;
}
export interface SyncPlan {
  id: string;
  stateRevision: number;
  receiverRevision: number;
  knowledge: string;
  operations: string[];
}
export interface CommitReceipt {
  planId: string;
  stateRevision: number;
  operations: string[];
  resolved: string[];
}
export interface ReceiverState {
  version: 1;
  revision: number;
  receipts: Receipt[];
  conflicts: StoredConflict[];
  rejections: { id: string; operationId: string | null; code: string }[];
  plan: SyncPlan | null;
  commits: CommitReceipt[];
}
export type ResolutionChoice = { kind: "local" } | { kind: "remote"; operationId: string } |
  { kind: "custom"; value: Json };
export interface ConflictDecision { conflictId: string; token: string; choice: ResolutionChoice }
export const newReceiver = (): ReceiverState => ({
  version: 1, revision: 0, receipts: [], conflicts: [], rejections: [], plan: null, commits: [],
});
export interface PlanSummary {
  plan: SyncPlan | null;
  planned: number;
  conflicts: number;
  blocked: number;
  dependencies: number;
  rejected: number;
}
