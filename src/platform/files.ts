import { Capacitor, registerPlugin } from "@capacitor/core";

export const isAndroid = () => Capacitor.getPlatform() === "android";
export type FileAction = "save" | "share" | "open";
export interface NativeFiles {
  begin(options: {
    name: string;
    mime: string;
    size: number;
  }): Promise<{ token: string }>;
  append(options: {
    token: string;
    offset: number;
    base64: string;
  }): Promise<void>;
  finish(options: {
    token: string;
    action: FileAction;
  }): Promise<{ cancelled?: boolean }>;
  discard(options: { token: string }): Promise<void>;
  pickBackup(options?: { kind?: "csv" }): Promise<{
    cancelled?: boolean;
    token?: string;
    uri?: string;
    name?: string;
  }>;
}
export const gardenFiles = registerPlugin<
  NativeFiles & {
    releasePhoto(options: { uri: string }): Promise<void>;
    readNavigation(): Promise<{ address?: string }>;
    saveNavigation(options: { address: string }): Promise<void>;
  }
>("GardenFiles");
export const MAX_NATIVE_FILE = 200 * 1024 * 1024;
const CHUNK = 192 * 1024;

/** Bounded bridge messages, never persisted as base64 in localStorage. */
export async function nativeFile(
  blob: Blob,
  name: string,
  action: FileAction,
  port: NativeFiles = gardenFiles,
) {
  if (blob.size > MAX_NATIVE_FILE)
    throw new Error("Plik przekracza limit 200 MB.");
  const { token } = await port.begin({
    name,
    mime: blob.type,
    size: blob.size,
  });
  let retained = false;
  try {
    for (let offset = 0; offset < blob.size; offset += CHUNK) {
      const bytes = new Uint8Array(
        await blob.slice(offset, offset + CHUNK).arrayBuffer(),
      );
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      await port.append({ token, offset, base64: btoa(binary) });
    }
    const result = await port.finish({ token, action });
    // Readers need the granted URI after the chooser returns. Native cache expires it.
    retained = !result.cancelled && action !== "save";
    return !result.cancelled;
  } finally {
    if (!retained) await port.discard({ token }).catch(() => {});
  }
}
export async function deliverFile(
  blob: Blob,
  name: string,
  action: FileAction = "save",
) {
  if (isAndroid()) return nativeFile(blob, name, action);
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
export async function pickBackup(
  port: NativeFiles = gardenFiles,
  kind?: "csv",
): Promise<File | null> {
  const result = await port.pickBackup(kind ? { kind } : undefined);
  if (result.cancelled) return null;
  try {
    if (!result.uri || !result.token)
      throw new Error("Nie udało się odczytać wybranej kopii.");
    const response = await fetch(Capacitor.convertFileSrc(result.uri));
    if (!response.ok) throw new Error("Nie udało się odczytać wybranej kopii.");
    const blob = await response.blob();
    if (blob.size > (kind === "csv" ? 5 * 1024 * 1024 : MAX_NATIVE_FILE))
      throw new Error(kind === "csv" ? "CSV przekracza limit 5 MB." : "Kopia przekracza limit 200 MB.");
    return new File([blob], result.name || (kind === "csv" ? "wyciag.csv" : "kopia.zip"), {
      type: kind === "csv" ? "text/csv" : "application/zip",
    });
  } finally {
    if (result.token)
      await port.discard({ token: result.token }).catch(() => {});
  }
}
