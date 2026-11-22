/** GM-011B protocol is independent of business Data v12 and TLS framing v1.
 * A received/known operation is NOT a durable business-application receipt. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Vector = Record<string, number>;
export interface Dot { origin: string; sequence: number }
export interface Mutation { key: string; before: Json; after: Json }
export interface Operation extends Dot {
  protocol: 1;
  id: string;
  context: Vector;
  resolution: boolean;
  changes: Mutation[];
}
export interface ReplicaLog {
  protocol: 1;
  installation: string;
  nextSequence: number;
  known: Vector;
  operations: Operation[];
  waiting: Operation[];
}
export interface Alternative { dot: Dot; value: Json }
export interface FieldConflict {
  field: string;
  baseAvailable: boolean;
  base: Json;
  alternatives: Alternative[];
}
export interface RecordView {
  key: string;
  status: "value" | "deleted" | "conflict" | "missing";
  value: Json;
  heads: Dot[];
  reason?: "edit-delete" | "independent-create" | "record" | "fields";
  conflicts: FieldConflict[];
}
export const syncLimits = {
  operationBytes: 8 * 1024 * 1024,
  historyBytes: 64 * 1024 * 1024,
  operations: 20000,
  waiting: 2000,
  changes: 5000,
  replicas: 64,
  key: 2048,
  depth: 48,
} as const;
export class SyncError extends Error {
  constructor(readonly code: "INVALID" | "LIMIT" | "EQUIVOCATION" | "PRECONDITION" | "CONFLICT" | "ORIGIN", text: string) {
    super(text); this.name = "SyncError";
  }
}
