import type { DesktopBridge, DesktopMime } from "../../desktop/contracts";
import { pendingWrite } from "../data/pending";
export const isDesktop = () =>
  typeof window !== "undefined" && window.gardenDesktop?.platform === "windows";
const port = (): DesktopBridge => {
  if (!window.gardenDesktop)
    throw new Error("Mostek Windows jest niedostępny.");
  return window.gardenDesktop;
};
const CHUNK = 192 * 1024,
  MAX_FILE = 200 * 1024 * 1024;
export async function desktopFile(
  blob: Blob,
  name: string,
  action: "save" | "share" | "open",
) {
  return pendingWrite(async () => {
    if (blob.size > MAX_FILE) throw new Error("Plik przekracza limit 200 MB.");
    if (
      !["application/pdf", "application/json", "application/zip"].includes(
        blob.type,
      )
    )
      throw new Error("Nieobsługiwany typ eksportu.");
    const p = port(),
      result = await p.beginSave({
        name,
        mime: blob.type as DesktopMime,
        size: blob.size,
      });
    if (result.cancelled) return false;
    if (!result.token) throw new Error("Nie rozpoczęto zapisu.");
    try {
      for (let offset = 0; offset < blob.size; offset += CHUNK)
        await p.write({
          token: result.token,
          offset,
          bytes: new Uint8Array(
            await blob.slice(offset, offset + CHUNK).arrayBuffer(),
          ),
        });
      await p.finish({ token: result.token, open: action === "open" });
      return true;
    } finally {
      await p.abort({ token: result.token }).catch(() => {});
    }
  });
}
export async function desktopPick(kind: "csv" | "zip"): Promise<File | null> {
  return pendingWrite(async () => {
    const p = port(),
      picked = await p.pick({ kind });
    if (picked.cancelled) return null;
    if (
      !picked.token ||
      !picked.name ||
      !Number.isSafeInteger(picked.size) ||
      !picked.size ||
      picked.size > (kind === "csv" ? 5 * 1024 * 1024 : MAX_FILE)
    )
      throw new Error("Nieprawidłowy rozmiar wybranego pliku.");
    try {
      const parts: ArrayBuffer[] = [];
      for (let offset = 0; offset < picked.size; offset += CHUNK) {
        const bytes = await p.read({
          token: picked.token,
          offset,
          size: Math.min(CHUNK, picked.size - offset),
        });
        parts.push(new Uint8Array(bytes).buffer);
      }
      return new File(parts, picked.name, {
        type: kind === "csv" ? "text/csv" : "application/zip",
      });
    } finally {
      await p.release({ token: picked.token }).catch(() => {});
    }
  });
}
