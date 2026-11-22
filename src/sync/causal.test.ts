import { describe, expect, it } from "vitest";
import {
  appendLocal, canonical, covers, dominates, dotId, join, missingOperations,
  newLog, receive, recordView, same, validateOperation, validateVector,
} from "./causal";
import { SyncError, type Json, type Mutation, type Operation, type ReplicaLog } from "./model";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const key = "clients/synthetic";
const base = { id: "synthetic", name: "Klient testowy", phone: "000", notes: "" };
function write(log: ReplicaLog, name: string, before: Json, after: Json, resolution = false) {
  return appendLocal(log, [{ key: name, before, after }], { resolution }).log;
}
function exchange(a: ReplicaLog, b: ReplicaLog): [ReplicaLog, ReplicaLog] {
  return [receive(a, missingOperations(b, a.known)), receive(b, missingOperations(a, b.known))];
}
function shared() {
  const a = write(newLog(A), key, null, base);
  return [a, receive(newLog(B), a.operations)] as const;
}
function errorCode(fn: () => unknown, code: SyncError["code"]) {
  try { fn(); throw Error("Expected rejection"); } catch (e) {
    expect(e).toBeInstanceOf(SyncError); expect((e as SyncError).code).toBe(code);
  }
}
describe("GM-011B causal operations (no business application receipt)", () => {
  it("uses canonical JSON and vector partial order, without wall clocks", () => {
    expect(canonical({ b: 2, a: [1, null] })).toBe('{"a":[1,null],"b":2}');
    expect(same({ b: 2, a: 1 }, { a: 1, b: 2 })).toBe(true);
    expect(dominates({ [A]: 2 }, { [A]: 1 })).toBe(true);
    expect(dominates({ [A]: 2 }, { [B]: 1 })).toBe(false);
    expect(join({ [A]: 2 }, { [A]: 1, [B]: 3 })).toEqual({ [A]: 2, [B]: 3 });
    errorCode(() => validateVector({ [A]: 0 }), "INVALID");
  });
  it("keeps independent creates from both installations", () => {
    const a = write(newLog(A), "clients/a", null, { id: "a", phone: "000" });
    const b = write(newLog(B), "clients/b", null, { id: "b", phone: "000" });
    const [aa, bb] = exchange(a, b);
    for (const log of [aa, bb]) {
      expect(recordView(log, "clients/a").status).toBe("value");
      expect(recordView(log, "clients/b").status).toBe("value");
      expect(log.operations).toHaveLength(2);
    }
  });
  it("forwards immutable origin/id/counter A -> B -> C and C -> B -> A", () => {
    let a = write(newLog(A), "clients/a", null, { name: "Synthetic A" });
    let b = write(newLog(B), "shoppingItems/b", null, { name: "Synthetic B" });
    [a, b] = exchange(a, b);
    let c = write(newLog(C), "expenses/c", null, { amountCents: 12345 });
    [b, c] = exchange(b, c); [a, b] = exchange(a, b);
    const original = a.operations.find(o => o.origin === A)!;
    expect(c.operations.find(o => o.origin === A)).toEqual(original);
    expect(new Set(a.operations.map(dotId)).size).toBe(3);
    expect(c.operations.find(o => o.origin === B)?.sequence).toBe(1);
    for (let i = 0; i < 5; i++) { [a, b] = exchange(a, b); [b, c] = exchange(b, c); }
    for (const log of [a, b, c]) {
      expect(log.operations).toHaveLength(3);
      expect(recordView(log, "expenses/c").value).toEqual({ amountCents: 12345 });
    }
  });
  it("safely merges independent phone and note edits of a shared client", () => {
    let [a, b] = shared();
    a = write(a, key, base, { ...base, phone: "111" });
    b = write(b, key, base, { ...base, notes: "Syntetyczna notatka" });
    [a, b] = exchange(a, b);
    const expected = { ...base, phone: "111", notes: "Syntetyczna notatka" };
    expect(recordView(a, key).value).toEqual(expected);
    expect(recordView(b, key).value).toEqual(expected);
  });
  it("retains an earlier phone write when a later local operation only edits notes", () => {
    let [a, b] = shared();
    a = write(a, key, base, { ...base, phone: "111" });
    a = write(a, key, { ...base, phone: "111" }, { ...base, phone: "111", notes: "Later" });
    b = write(b, key, base, { ...base, phone: "222" });
    [a, b] = exchange(a, b);
    for (const log of [a, b]) {
      const v = recordView(log, key);
      expect(v.status).toBe("conflict");
      expect(v.conflicts[0].field).toBe("phone");
      expect(v.conflicts[0].base).toBe("000");
      expect(v.conflicts[0].baseAvailable).toBe(true);
      expect(v.conflicts[0].alternatives.map(x => x.value).sort()).toEqual(["111", "222"]);
    }
  });
  it("finds the causal common base instead of a coincidentally equal intermediate value", () => {
    let [a, b] = shared();
    const intermediate = { ...base, phone: "same but independently written" };
    a = write(a, key, base, intermediate);
    b = write(b, key, base, intermediate);
    a = write(a, key, intermediate, { ...base, phone: "111" });
    b = write(b, key, intermediate, { ...base, phone: "222" });
    [a, b] = exchange(a, b);
    const field = recordView(a, key).conflicts.find(c => c.field === "phone")!;
    expect(field.baseAvailable).toBe(true);
    expect(field.base).toBe("000");
    expect(field.alternatives.map(x => x.value).sort()).toEqual(["111", "222"]);
  });
  it("does not merge independent different creations just because their IDs match", () => {
    const a = write(newLog(A), key, null, base);
    const b = write(newLog(B), key, null, { ...base, phone: "222" });
    const [aa, bb] = exchange(a, b);
    expect(recordView(aa, key).reason).toBe("independent-create");
    expect(recordView(bb, key).status).toBe("conflict");
  });
  it("does not infer common ancestry from equal independent roots followed by unshared edits", () => {
    let a = write(newLog(A), key, null, base), b = write(newLog(B), key, null, base);
    a = write(a, key, base, { ...base, phone: "111" });
    b = write(b, key, base, { ...base, notes: "Independent" });
    [a, b] = exchange(a, b);
    expect(recordView(a, key).reason).toBe("independent-create");
  });
  it("coalesces identical values and can edit after both roots were explicitly observed", () => {
    let a = write(newLog(A), key, null, base), b = write(newLog(B), key, null, base);
    [a, b] = exchange(a, b);
    expect(recordView(a, key).value).toEqual(base);
    a = write(a, key, base, { ...base, phone: "111" });
    b = write(b, key, base, { ...base, notes: "Shared value observed" });
    [a, b] = exchange(a, b);
    expect(recordView(a, key).value).toEqual({ ...base, phone: "111", notes: "Shared value observed" });
  });
  it("keeps finance-like records atomic instead of combining fields", () => {
    const k = "visits/synthetic";
    let a = write(newLog(A), k, null, { amountCents: 10000, paidCents: 0 });
    let b = receive(newLog(B), a.operations);
    a = write(a, k, { amountCents: 10000, paidCents: 0 }, { amountCents: 5000, paidCents: 0 });
    b = write(b, k, { amountCents: 10000, paidCents: 0 }, { amountCents: 10000, paidCents: 8000 });
    [a, b] = exchange(a, b);
    expect(recordView(a, k).reason).toBe("record");
    expect(recordView(a, k).conflicts[0].base).toEqual({ amountCents: 10000, paidCents: 0 });
    expect(recordView(b, k).status).toBe("conflict");
  });
  it("retains tombstones when an old known copy comes back", () => {
    const [start, offline] = shared();
    let a = write(start, key, base, null);
    a = receive(a, offline.operations);
    expect(recordView(a, key).status).toBe("deleted");
    expect(recordView(a, key).heads).toHaveLength(1);
    const stale = write(newLog(C), key, null, base);
    a = receive(a, stale.operations);
    expect(recordView(a, key).reason).toBe("edit-delete");
  });
  it("makes edit-versus-delete an explicit conflict, including keeping the deletion", () => {
    let [a, b] = shared();
    a = write(a, key, base, null); b = write(b, key, base, { ...base, notes: "Edited offline" });
    [a, b] = exchange(a, b);
    expect(recordView(a, key).reason).toBe("edit-delete");
    errorCode(() => write(b, key, { ...base, notes: "Edited offline" }, base), "CONFLICT");
    const resolution = appendLocal(a, [{ key, before: null, after: null }], { resolution: true });
    expect(resolution.operation).not.toBeNull();
    a = resolution.log; b = receive(b, missingOperations(a, b.known));
    expect(recordView(a, key).status).toBe("deleted");
    expect(recordView(b, key).status).toBe("deleted");
    expect(a.operations).toHaveLength(4);
  });
  it("resolves a same-field conflict without rewriting either original operation", () => {
    let [a, b] = shared();
    a = write(a, key, base, { ...base, phone: "111" });
    b = write(b, key, base, { ...base, phone: "222" });
    [a, b] = exchange(a, b);
    const original = canonical(a.operations);
    a = write(a, key, { ...base, phone: "111" }, { ...base, phone: "111" }, true);
    b = receive(b, missingOperations(a, b.known));
    expect(canonical(a.operations.slice(0, 3))).toBe(original);
    expect(recordView(b, key).value).toEqual({ ...base, phone: "111" });
  });
  it("holds a causal gap and drains it when its predecessor arrives", () => {
    let a = write(newLog(A), key, null, base);
    a = write(a, key, base, { ...base, notes: "Second" });
    let b = receive(newLog(B), [a.operations[1]]);
    expect(b.known[A]).toBeUndefined(); expect(b.waiting).toHaveLength(1);
    expect(recordView(b, key).status).toBe("missing");
    b = receive(b, [a.operations[0]]);
    expect(b.waiting).toHaveLength(0); expect(b.known[A]).toBe(2);
    expect(recordView(b, key).value).toEqual({ ...base, notes: "Second" });
  });
  it("receives atomically and does not keep earlier input when a later input is invalid", () => {
    const a = write(newLog(A), key, null, base), b = newLog(B), before = canonical(b);
    const invalid = { ...a.operations[0], sequence: 0 };
    errorCode(() => receive(b, [a.operations[0], invalid]), "INVALID");
    expect(canonical(b)).toBe(before); expect(b.operations).toHaveLength(0);
  });
  it("rejects changed contents under the same dot and reused UUIDs", () => {
    const a = write(newLog(A), key, null, base);
    const b = receive(newLog(B), a.operations);
    const forged = structuredClone(a.operations[0]); forged.changes[0].after = { ...base, phone: "forged" };
    errorCode(() => receive(b, [forged]), "EQUIVOCATION");
    const reused = { ...a.operations[0], origin: C };
    errorCode(() => receive(b, [reused]), "EQUIVOCATION");
  });
  it("rejects impossible claims of local future operations", () => {
    const op = write(newLog(A), key, null, base).operations[0];
    errorCode(() => receive(newLog(B), [{ ...op, context: { [B]: 1 } }]), "ORIGIN");
  });
  it("rejects a context that observes a predecessor but omits that predecessor's dependency", () => {
    const a = write(newLog(A), "clients/a", null, { name: "Synthetic A" });
    let b = receive(newLog(B), a.operations);
    b = write(b, "clients/b", null, { name: "Synthetic B" });
    const c = receive(newLog(C), b.operations), before = canonical(c);
    const forged: Operation = { protocol: 1, id: crypto.randomUUID(), origin: B, sequence: 2,
      context: { [B]: 1 }, resolution: false,
      changes: [{ key: "clients/c", before: null, after: { name: "Impossible history" } }] };
    errorCode(() => receive(c, [forged]), "PRECONDITION");
    expect(canonical(c)).toBe(before);
    expect(c.known[B]).toBe(1);
  });
  it("does not resurrect fields from before deletion while merging edits to a recreated client", () => {
    let a = write(newLog(A), key, null, base);
    a = write(a, key, base, null);
    const recreated = { id: "synthetic", name: "Recreated" };
    a = write(a, key, null, recreated);
    let b = receive(newLog(B), a.operations);
    a = write(a, key, recreated, { ...recreated, name: "New name" });
    b = write(b, key, recreated, { ...recreated, notes: "New notes" });
    [a, b] = exchange(a, b);
    for (const log of [a, b]) {
      expect(recordView(log, key).value).toEqual({ ...recreated, name: "New name", notes: "New notes" });
      expect(recordView(log, key).value).not.toHaveProperty("phone");
    }
  });
  it("rejects a wrong predecessor without acknowledging or partially changing the log", () => {
    const a = write(newLog(A), key, null, base), b = receive(newLog(B), a.operations);
    const wrong: Operation = { protocol: 1, id: crypto.randomUUID(), origin: C, sequence: 1,
      context: { [A]: 1 }, resolution: false, changes: [{ key, before: { ...base, phone: "wrong" }, after: null }] };
    const before = canonical(b);
    errorCode(() => receive(b, [wrong]), "PRECONDITION");
    expect(canonical(b)).toBe(before); expect(b.known[C]).toBeUndefined();
  });
  it("rejects prototype payloads, non-JSON data, unknown fields and oversized operations", () => {
    errorCode(() => canonical(JSON.parse('{"__proto__":{"polluted":true}}')), "INVALID");
    errorCode(() => canonical({ at: new Date() }), "INVALID");
    errorCode(() => canonical({ missing: undefined }), "INVALID");
    const op = write(newLog(A), key, null, base).operations[0];
    errorCode(() => validateOperation({ ...op, extra: true }), "INVALID");
    errorCode(() => validateOperation({ ...op, changes: [{ key, before: null, after: "x".repeat(8 * 1024 * 1024) }] }), "LIMIT");
    errorCode(() => validateOperation({ ...op, changes: [op.changes[0], op.changes[0]] }), "INVALID");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it("survives serialization/restart without losing pending gaps or tombstones", () => {
    let a = write(newLog(A), key, null, base);
    a = write(a, key, base, null);
    let b = receive(newLog(B), [a.operations[1]]);
    b = JSON.parse(JSON.stringify(b)) as ReplicaLog;
    b = receive(b, [a.operations[0]]);
    expect(recordView(b, key).status).toBe("deleted");
    expect(receive(b, a.operations).operations).toHaveLength(2);
  });
  it("does not allocate a new counter for a no-op or an operation merely forwarded by the phone", () => {
    const a = write(newLog(A), key, null, base);
    const b = receive(newLog(B), a.operations);
    const result = appendLocal(b, [{ key, before: base, after: base }]);
    expect(result.operation).toBeNull(); expect(result.log.nextSequence).toBe(1);
    expect(result.log.operations[0].id).toBe(a.operations[0].id);
    expect(covers(result.log.known, a.operations[0])).toBe(true);
  });
  it("keeps a multi-record operation indivisible as journal data", () => {
    const changes: Mutation[] = [
      { key: "expenses/e", before: null, after: { amountCents: 1500 } },
      { key: "shoppingItems/s", before: null, after: { expenseId: "e" } },
    ];
    const a = appendLocal(newLog(A), changes).log, b = receive(newLog(B), a.operations);
    expect(b.operations).toHaveLength(1);
    expect(b.operations[0].changes).toHaveLength(2);
    // This is receipt only. The business adapter must validate/apply the whole
    // operation in one IDB transaction before issuing an application receipt.
    expect("applied" in b).toBe(false);
  });
  it("converges and preserves exact synthetic amounts under seeded reorder/replay sequences", () => {
    let seed = 0x31b;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
    const ids = [A, B, C]; let replicas = ids.map(newLog);
    let expectedSum = 0;
    for (let n = 0; n < 120; n++) {
      const i = random() % 3, amountCents = random() % 100000 + 1;
      expectedSum += amountCents;
      replicas[i] = write(replicas[i], "expenses/" + n, null, { amountCents });
      if (n % 5 === 0) {
        const j = (i + 1) % 3;
        replicas[j] = receive(replicas[j], [...missingOperations(replicas[i], replicas[j].known)].reverse());
      }
    }
    for (let round = 0; round < 6; round++) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (i !== j) {
      const shuffled = [...replicas[i].operations].sort(() => (random() & 1) ? 1 : -1);
      replicas[j] = receive(replicas[j], shuffled);
    }
    for (const log of replicas) {
      expect(log.waiting).toHaveLength(0); expect(log.operations).toHaveLength(120);
      const total = Array.from({ length: 120 }, (_, n) =>
        (recordView(log, "expenses/" + n).value as { amountCents: number }).amountCents).reduce((a, b) => a + b, 0);
      expect(total).toBe(expectedSum);
      const before = canonical(log);
      expect(canonical(receive(log, [...log.operations, ...log.operations]))).toBe(before);
    }
  });
});
