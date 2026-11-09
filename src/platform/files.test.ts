import { describe, expect, it, vi } from "vitest";
import {
  MAX_NATIVE_FILE,
  nativeFile,
  pickBackup,
  type NativeFiles,
} from "./files";
import { validNativeAddress } from "./navigation";
function port() {
  return {
    begin: vi.fn(async () => ({ token: "safe-token" })),
    append: vi.fn(async () => {}),
    finish: vi.fn(async () => ({})),
    discard: vi.fn(async () => {}),
    pickBackup: vi.fn(async () => ({ cancelled: true })),
  } satisfies NativeFiles;
}
describe("Android file adapter (mock bridge, not device tests)", () => {
  it("streams ordered bounded chunks with exact binary integrity", async () => {
    const bytes = Uint8Array.from({ length: 500_001 }, (_, i) => i % 256),
      p = port();
    await nativeFile(
      new Blob([bytes], { type: "application/pdf" }),
      "raport.pdf",
      "save",
      p,
    );
    expect(p.begin).toHaveBeenCalledWith({
      size: bytes.length,
      mime: "application/pdf",
      name: "raport.pdf",
    });
    const chunks = p.append.mock.calls as unknown as [
      { offset: number; base64: string },
    ][];
    const reconstructed: number[] = [];
    for (const [chunk] of chunks) {
      expect(chunk.offset).toBe(reconstructed.length);
      const decoded = Uint8Array.from(atob(chunk.base64), (c) =>
        c.charCodeAt(0),
      );
      expect(decoded.length).toBeLessThanOrEqual(192 * 1024);
      for (const byte of decoded) reconstructed.push(byte);
    }
    expect(Uint8Array.from(reconstructed)).toEqual(bytes);
    expect(p.finish).toHaveBeenCalledWith({
      token: "safe-token",
      action: "save",
    });
    expect(p.discard).toHaveBeenCalledOnce();
  });
  it("rejects oversized files before invoking native code", async () => {
    const p = port();
    await expect(
      nativeFile({ size: MAX_NATIVE_FILE + 1 } as Blob, "bad.zip", "save", p),
    ).rejects.toThrow("200 MB");
    expect(p.begin).not.toHaveBeenCalled();
  });
  it("does not claim a cancelled export succeeded", async () => {
    const p = port();
    p.finish.mockResolvedValue({ cancelled: true } as never);
    expect(await nativeFile(new Blob(["hello"]), "a.json", "save", p)).toBe(
      false,
    );
    expect(p.discard).toHaveBeenCalledOnce();
  });
  it.each(["open", "share"] as const)(
    "retains the granted URI after %s",
    async (action) => {
      const p = port();
      await nativeFile(new Blob(["pdf"]), "a.pdf", action, p);
      expect(p.discard).not.toHaveBeenCalled();
    },
  );
  it("cleans partial files and propagates disk errors without finishing", async () => {
    const p = port();
    p.append.mockRejectedValue(new Error("Brak miejsca"));
    await expect(
      nativeFile(new Blob(["zip"]), "a.zip", "save", p),
    ).rejects.toThrow("Brak miejsca");
    expect(p.finish).not.toHaveBeenCalled();
    expect(p.discard).toHaveBeenCalledOnce();
  });
  it("propagates missing PDF reader errors and permits retry using the same bytes", async () => {
    const p = port();
    p.finish.mockRejectedValueOnce(new Error("Brak aplikacji"));
    const blob = new Blob(["saved PDF"]);
    await expect(
      nativeFile(blob, "R-2026-0001.pdf", "open", p),
    ).rejects.toThrow("Brak aplikacji");
    await nativeFile(blob, "R-2026-0001.pdf", "save", p);
    expect(p.begin.mock.calls).toHaveLength(2);
    expect(p.discard).toHaveBeenCalledTimes(2);
  });
  it("cancelled import never reads a file", async () => {
    const p = port();
    expect(await pickBackup(p)).toBeNull();
    expect(p.discard).not.toHaveBeenCalled();
  });
  it("rejects malformed picker results and discards their temporary file", async () => {
    const p = port();
    p.pickBackup.mockResolvedValue({ token: "safe-token" } as never);
    await expect(pickBackup(p)).rejects.toThrow("odczytać");
    expect(p.discard).toHaveBeenCalledWith({ token: "safe-token" });
  });
  it.each([
    "https://external.example",
    "/#jobs",
    "#jobs\n",
    "#" + "x".repeat(16000),
    null,
  ])("rejects an unsafe UI bookmark %s", (value) => {
    expect(validNativeAddress(value)).toBe(false);
  });
  it("accepts a hash-only bookmark without changing the native origin", () => {
    expect(validNativeAddress("#gardens?garden=garden-1&section=gallery")).toBe(
      true,
    );
  });
});
