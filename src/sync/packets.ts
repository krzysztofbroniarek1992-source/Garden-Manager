import { canonical, covers, missingOperations, newLog, validateOperation, validateVector } from "./causal";
import { SyncError, type Operation, type ReplicaLog, type Vector } from "./model";

/** Business capability codec, NOT a native network listener or database API.
 * Native GM-011A integration must negotiate this capability before sending it. */
export const businessProtocol = 1, businessDataVersion = 12;
export const packetLimits = { bytes: 10 * 1024 * 1024, chunkBytes: 64 * 1024, operations: 2000 } as const;
export interface BusinessBundle {
  businessProtocol: 1; dataVersion: 12; transferId: string; sender: string; known: Vector; operations: Operation[];
}
export interface BusinessOffer {
  businessProtocol: 1; dataVersion: 12; transferId: string; sender: string;
  bytes: number; chunks: number; sha256: string;
}
export interface BusinessChunk { transferId: string; index: number; body: Uint8Array }
const error = (code: ConstructorParameters<typeof SyncError>[0], text: string): never => { throw new SyncError(code, text); };
function fields(v: unknown, names: string[]): asserts v is Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v) ||
    Object.keys(v).sort().join("|") !== [...names].sort().join("|"))
    error("INVALID", "Nieprawidłowy komunikat synchronizacji biznesowej.");
}
function id(value: unknown): asserts value is string {
  if (typeof value !== "string") error("INVALID", "Nieprawidłowa tożsamość transferu.");
  newLog(value as string);
}
export async function sha256(bytes: Uint8Array): Promise<string> {
  const owned = bytes.slice().buffer as ArrayBuffer;
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", owned)))
    .map(v => v.toString(16).padStart(2, "0")).join("");
}
function validateOffer(v: unknown): asserts v is BusinessOffer {
  fields(v, ["businessProtocol", "dataVersion", "transferId", "sender", "bytes", "chunks", "sha256"]);
  if (v.businessProtocol !== businessProtocol || v.dataVersion !== businessDataVersion)
    error("INVALID", "Urządzenia nie uzgodniły wersji synchronizacji biznesowej i danych.");
  id(v.transferId); id(v.sender);
  if (!Number.isSafeInteger(v.bytes) || (v.bytes as number) < 1 || (v.bytes as number) > packetLimits.bytes ||
    v.chunks !== Math.ceil((v.bytes as number) / packetLimits.chunkBytes) ||
    typeof v.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(v.sha256))
    error("LIMIT", "Oferta przekracza limity transferu.");
}
export function validateBundle(v: unknown): asserts v is BusinessBundle {
  fields(v, ["businessProtocol", "dataVersion", "transferId", "sender", "known", "operations"]);
  if (v.businessProtocol !== businessProtocol || v.dataVersion !== businessDataVersion)
    error("INVALID", "Niezgodna wersja pakietu biznesowego.");
  id(v.transferId); id(v.sender); validateVector(v.known);
  if (!Array.isArray(v.operations) || v.operations.length > packetLimits.operations)
    error("LIMIT", "Pakiet zawiera zbyt wiele operacji.");
  const dots = new Set<string>(), ids = new Set<string>();
  for (const op of v.operations as Operation[]) {
    validateOperation(op);
    const dot = op.origin + ":" + op.sequence;
    if (!covers(v.known as Vector, op) || dots.has(dot) || ids.has(op.id))
      error("INVALID", "Pakiet zawiera niezgodne lub powtórzone operacje.");
    dots.add(dot); ids.add(op.id);
  }
}
export async function prepareTransfer(source: { log: ReplicaLog; mode: "active" | "restore-review" }, peerKnown: Vector) {
  if (source.mode !== "active") error("PRECONDITION", "Po przywróceniu kopii najpierw uzgodnij historię. Nie wysłano zmian.");
  const log = source.log;
  newLog(log.installation); validateVector(log.known); validateVector(peerKnown);
  const missing = missingOperations(log, peerKnown), transferId = crypto.randomUUID();
  const bundle: BusinessBundle = { businessProtocol, dataVersion: businessDataVersion, transferId,
    sender: log.installation, known: { ...log.known }, operations: [] };
  let length = new TextEncoder().encode(canonical(bundle)).byteLength;
  for (const op of missing) {
    validateOperation(op);
    const bytes = new TextEncoder().encode(canonical(op)).byteLength + (bundle.operations.length ? 1 : 0);
    if (bundle.operations.length === packetLimits.operations || length + bytes > packetLimits.bytes) break;
    bundle.operations.push(op); length += bytes;
  }
  if (missing.length && !bundle.operations.length) error("LIMIT", "Pojedyncza operacja nie mieści się w pakiecie.");
  validateBundle(bundle);
  const body = new TextEncoder().encode(canonical(bundle));
  if (body.byteLength > packetLimits.bytes) error("LIMIT", "Przekroczono limit pakietu.");
  const offer: BusinessOffer = { businessProtocol, dataVersion: businessDataVersion, transferId,
    sender: log.installation, bytes: body.byteLength, chunks: Math.ceil(body.byteLength / packetLimits.chunkBytes),
    sha256: await sha256(body) };
  validateOffer(offer);
  const chunks: BusinessChunk[] = Array.from({ length: offer.chunks }, (_, index) => ({
    transferId, index, body: body.slice(index * packetLimits.chunkBytes, (index + 1) * packetLimits.chunkBytes),
  }));
  return { offer, chunks, remaining: missing.length - bundle.operations.length };
}
export class TransferAssembler {
  private readonly parts = new Map<number, Uint8Array>();
  private failed = false;
  readonly offer: BusinessOffer;
  constructor(offer: unknown) { validateOffer(offer); this.offer = structuredClone(offer); }
  get receivedBytes() { return [...this.parts.values()].reduce((n, b) => n + b.byteLength, 0); }
  accept(chunk: unknown) {
    if (this.failed) error("INVALID", "Transfer został odrzucony.");
    try {
      fields(chunk, ["transferId", "index", "body"]);
      if (chunk.transferId !== this.offer.transferId || !Number.isInteger(chunk.index) ||
        (chunk.index as number) < 0 || (chunk.index as number) >= this.offer.chunks || !(chunk.body instanceof Uint8Array))
        error("INVALID", "Nieprawidłowa część transferu.");
      const index = chunk.index as number, body = chunk.body as Uint8Array;
      const expected = Math.min(packetLimits.chunkBytes, this.offer.bytes - index * packetLimits.chunkBytes);
      if (body.byteLength !== expected) error("LIMIT", "Część transferu ma nieprawidłowy rozmiar.");
      const existing = this.parts.get(index);
      if (existing) {
        if (existing.some((v, n) => v !== body[n])) error("EQUIVOCATION", "Powtórzona część ma inną treść.");
        return;
      }
      this.parts.set(index, body.slice());
    } catch (e) { this.failed = true; throw e; }
  }
  async finish(): Promise<BusinessBundle> {
    if (this.failed) error("INVALID", "Transfer został odrzucony.");
    if (this.parts.size !== this.offer.chunks || this.receivedBytes !== this.offer.bytes)
      error("PRECONDITION", "Transfer niekompletny. Nie potwierdzono zastosowania danych.");
    try {
      const bytes = new Uint8Array(this.offer.bytes);
      for (const [index, body] of this.parts) bytes.set(body, index * packetLimits.chunkBytes);
      if (await sha256(bytes) !== this.offer.sha256) error("INVALID", "Suma SHA256 transferu jest niezgodna.");
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes), value: unknown = JSON.parse(text);
      validateBundle(value);
      if (value.transferId !== this.offer.transferId || value.sender !== this.offer.sender || canonical(value) !== text)
        error("INVALID", "Treść pakietu nie odpowiada ofercie.");
      // Integrity + schema only. Caller must stage, plan, obtain user approval,
      // and commit to IndexedDB BEFORE returning a durable application receipt.
      return value;
    } catch (e) { this.failed = true; throw e; }
  }
}
