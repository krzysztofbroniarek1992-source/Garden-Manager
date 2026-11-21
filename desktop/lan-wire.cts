import { randomUUID, createHash } from "node:crypto";
import type { TLSSocket } from "node:tls";

export const VERSION = 1, MAX_HEADER = 8192, MAX_BODY = 10 * 1024 * 1024;
export const SIZES = [1024, 102400, 1048576, MAX_BODY] as const;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const HASH = /^[0-9a-f]{64}$/;
export const sha = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");
export function fail(code = "PROTOCOL"): never { throw new Error(code); }
export function object(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
}
export function fields(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  object(value); if (Object.keys(value).sort().join() !== [...keys].sort().join()) fail();
}
export function identifier(value: unknown): asserts value is string { if (typeof value !== "string" || !UUID.test(value)) fail(); }
export function deviceName(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 80 || /[\x00-\x1f\x7f<>|\\/"']/.test(value)) fail();
  return value.normalize("NFC").trim();
}
export function privateAddress(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return false;
  const n = value.split(".").map(Number);
  return n.every((v,i) => v <= 255 && String(v) === value.split(".")[i]) &&
    (n[0] === 10 || n[0] === 172 && n[1] >= 16 && n[1] <= 31 || n[0] === 192 && n[1] === 168);
}
export function port(value: unknown): asserts value is number { if (!Number.isInteger(value) || (value as number) < 1024 || (value as number) > 65535) fail(); }
export function probeOptions(bytes: unknown, kind: unknown): asserts kind is "json" | "binary" {
  if (!SIZES.includes(bytes as typeof SIZES[number]) || !["json", "binary"].includes(kind as string)) fail();
}
export function synthetic(bytes: number, kind: string) {
  probeOptions(bytes, kind);
  if (kind === "binary") { const b = Buffer.alloc(bytes); for (let i=0;i<bytes;i++) b[i]=(i*31+17)%251; return b; }
  const prefix = '{"kind":"gm011a-synthetic","padding":"', suffix = '"}';
  return Buffer.from(prefix + "A".repeat(bytes - prefix.length - suffix.length) + suffix);
}
export interface Message { v: number; type: string; id: string; seq: number; sid: string; payload: Record<string, unknown> }
const types = ["hello","probe","data","ack","done","bye","error","pair","pair-pending","pair-confirm","pair-approved","pair-done"];
export function header(value: unknown): Message {
  fields(value, ["v","type","id","seq","sid","payload"]);
  if (value.v !== VERSION) fail("VERSION");
  identifier(value.id); identifier(value.sid); object(value.payload);
  if (typeof value.type !== "string" || !types.includes(value.type) || !Number.isSafeInteger(value.seq) || (value.seq as number) < 0 || (value.seq as number) > 8192) fail();
  return value as unknown as Message;
}
async function exact(socket: TLSSocket, n: number) {
  const output = Buffer.alloc(n); let offset = 0;
  while (offset < n) {
    if (socket.destroyed || socket.readableEnded) fail("DISCONNECTED");
    const chunk = socket.read(Math.min(n - offset, socket.readableLength || 1)) as Buffer | null;
    if (chunk) { chunk.copy(output, offset); offset += chunk.length; continue; }
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => { socket.off("readable", readable); socket.off("close", closed); socket.off("error", errored); };
      const readable = () => { cleanup(); resolve(); };
      const closed = () => { cleanup(); reject(new Error("DISCONNECTED")); };
      const errored = () => { cleanup(); reject(new Error("DISCONNECTED")); };
      socket.once("readable", readable); socket.once("close", closed); socket.once("error", errored);
    });
  }
  return output;
}
/** Length-prefixed UTF-8 JSON header plus a bounded binary body. Never base64 on the wire. */
export class Wire {
  private incoming = 0; private outgoing = 0; private seen = new Set<string>();
  private writing: Promise<void> = Promise.resolve();
  constructor(readonly socket: TLSSocket, public sid: string) { socket.on("error", () => {}); }
  async receive(acceptBody: (m: Message, bytes: number) => boolean = (_m,n) => n === 0) {
    const length = (await exact(this.socket,4)).readUInt32BE();
    if (length < 2 || length > MAX_HEADER) fail("LIMIT");
    const m = header(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await exact(this.socket,length))));
    if (!this.sid && m.type === "hello" && m.seq === 0) this.sid = m.sid;
    if (m.sid !== this.sid || m.seq !== this.incoming++ || this.seen.has(m.id)) fail("REPLAY");
    this.seen.add(m.id);
    const bytes = (await exact(this.socket,4)).readUInt32BE();
    if (bytes > MAX_BODY || !acceptBody(m,bytes)) fail("LIMIT");
    return { message:m, body:await exact(this.socket,bytes) };
  }
  send(type: string, payload: Record<string,unknown> = {}, body = Buffer.alloc(0)): Promise<void> {
    const m = header({v:VERSION,type,id:randomUUID(),seq:this.outgoing++,sid:this.sid,payload});
    const h = Buffer.from(JSON.stringify(m)), a = Buffer.alloc(4), b = Buffer.alloc(4);
    if (h.length > MAX_HEADER || body.length > MAX_BODY) fail("LIMIT");
    a.writeUInt32BE(h.length); b.writeUInt32BE(body.length);
    const work = async () => {
      for (const bytes of [a,h,b,body]) if (bytes.length) await new Promise<void>((resolve,reject) => {
        if (this.socket.destroyed) { reject(new Error("DISCONNECTED")); return; }
        this.socket.write(bytes, error => error ? reject(new Error("DISCONNECTED")) : resolve());
      });
    };
    const next = this.writing.then(work); this.writing = next.catch(() => {}); return next;
  }
}
