import { expect, it } from "vitest";
import { appendLocal, newLog, receive, recordView } from "./causal";
import { prepareTransfer, TransferAssembler, packetLimits, sha256, validateBundle } from "./packets";
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222", C = "33333333-3333-4333-8333-333333333333";
const prepare = (log: ReturnType<typeof newLog>, known = {}) => prepareTransfer({ log, mode: "active" }, known);
function source(size = 100) {
  return appendLocal(newLog(A), [{ key: "clients/synthetic", before: null, after: { notes: "x".repeat(size) } }]).log;
}
it("encodes real SHA256, binary chunks, reverse delivery and identical duplicates", async () => {
  const log = source(180000), transfer = await prepare(log, {});
  expect(transfer.chunks.length).toBeGreaterThan(2);
  expect(transfer.chunks.every(c => c.body.byteLength <= packetLimits.chunkBytes)).toBe(true);
  const assembler = new TransferAssembler(transfer.offer);
  for (const chunk of [...transfer.chunks].reverse()) { assembler.accept(chunk); assembler.accept(chunk); }
  const bundle = await assembler.finish();
  expect(bundle.operations).toEqual(log.operations);
  expect(assembler.receivedBytes).toBe(transfer.offer.bytes);
  expect(transfer.remaining).toBe(0);
});
it("does not declare an incomplete or interrupted transfer applied", async () => {
  const t = await prepare(source(180000), {}), a = new TransferAssembler(t.offer);
  a.accept(t.chunks[0]);
  await expect(a.finish()).rejects.toThrow("niekompletny");
  expect("applied" in a).toBe(false);
  for (const chunk of t.chunks.slice(1)) a.accept(chunk);
  expect((await a.finish()).operations).toHaveLength(1);
});
it("retains original operation identity across A -> phone B -> C", async () => {
  const a = source(), ab = await prepare(a, {}), toPhone = new TransferAssembler(ab.offer);
  ab.chunks.forEach(c => toPhone.accept(c));
  const b = receive(newLog(B), (await toPhone.finish()).operations), bc = await prepare(b, {});
  const toWork = new TransferAssembler(bc.offer); bc.chunks.forEach(c => toWork.accept(c));
  const c = receive(newLog(C), (await toWork.finish()).operations);
  expect(c.operations[0]).toEqual(a.operations[0]);
  expect(recordView(c, "clients/synthetic").value).toEqual({ notes: "x".repeat(100) });
  const again = await prepare(b, c.known), empty = new TransferAssembler(again.offer);
  again.chunks.forEach(part => empty.accept(part));
  expect((await empty.finish()).operations).toHaveLength(0);
});
it("refuses outbound business changes while a restored history requires review", async () => {
  await expect(prepareTransfer({ log: source(), mode: "restore-review" }, {})).rejects.toThrow("uzgodnij historię");
});
it("rejects a changed duplicate chunk and latches the failed state", async () => {
  const t = await prepare(source(), {}), a = new TransferAssembler(t.offer);
  a.accept(t.chunks[0]); const bad = structuredClone(t.chunks[0]); bad.body[0] ^= 1;
  expect(() => a.accept(bad)).toThrow("inną treść");
  await expect(a.finish()).rejects.toThrow("odrzucony");
});
it("rejects corruption before returning a bundle", async () => {
  const t = await prepare(source(), {}), a = new TransferAssembler(t.offer);
  const bad = structuredClone(t.chunks[0]); bad.body[bad.body.length - 1] ^= 1;
  a.accept(bad);
  await expect(a.finish()).rejects.toThrow("SHA256");
});
it("rejects a different transfer, oversized chunk and bad index", async () => {
  const t = await prepare(source(), {});
  expect(() => new TransferAssembler(t.offer).accept({ ...t.chunks[0], transferId: B })).toThrow();
  expect(() => new TransferAssembler(t.offer).accept({ ...t.chunks[0], index: -1 })).toThrow();
  expect(() => new TransferAssembler(t.offer).accept({ ...t.chunks[0], body: new Uint8Array(packetLimits.chunkBytes + 1) })).toThrow();
});
it("rejects unsupported versions, unknown envelope fields and oversized offers", async () => {
  const t = await prepare(source(), {});
  expect(() => new TransferAssembler({ ...t.offer, dataVersion: 13 })).toThrow("wersji");
  expect(() => new TransferAssembler({ ...t.offer, businessProtocol: 2 })).toThrow();
  expect(() => new TransferAssembler({ ...t.offer, bytes: packetLimits.bytes + 1 })).toThrow();
  expect(() => new TransferAssembler({ ...t.offer, secret: "synthetic" })).toThrow();
});
it("rejects a canonical-looking bundle which changes the sender or reuses operation identities", async () => {
  const t = await prepare(source(), {}), a = new TransferAssembler(t.offer);
  t.chunks.forEach(c => a.accept(c)); const original = await a.finish();
  expect(() => validateBundle({ ...original, operations: [...original.operations, original.operations[0]] })).toThrow("powtórzone");
  expect(() => validateBundle({ ...original, known: {} })).toThrow("niezgodne");
  const text = JSON.stringify({ ...original, sender: B });
  const body = new TextEncoder().encode(text);
  const offer = { ...t.offer, bytes: body.length, chunks: 1, sha256: await sha256(body) };
  const wrong = new TransferAssembler(offer); wrong.accept({ transferId: offer.transferId, index: 0, body });
  await expect(wrong.finish()).rejects.toThrow("ofercie");
});
it("rejects the old synthetic-only schema instead of treating it as business data", () => {
  expect(() => validateBundle({ v: 1, mode: "synthetic-only", versions: [1] })).toThrow();
});
