import path from "node:path";
export const ORIGIN = "app://garden-manager/";
export const APP_ID = "pl.broniarek.gardenmanager.windows";
export const MAX_FILE = 200 * 1024 * 1024,
  CHUNK = 192 * 1024;
export const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; worker-src 'none'; frame-src blob:; object-src 'none'; base-uri 'none'; form-action 'none'";
export function appUrl(value: string) {
  try {
    const u = new URL(value);
    return (
      u.protocol === "app:" &&
      u.hostname === "garden-manager" &&
      !u.username &&
      !u.password &&
      !u.port
    );
  } catch {
    return false;
  }
}
export function entryUrl(value: string) {
  if (!appUrl(value)) return false;
  const u = new URL(value);
  return u.pathname === "/" || u.pathname === "/index.html";
}
export function assetPath(value: string, root: string) {
  if (!appUrl(value)) throw new Error("Nieprawidłowy adres zasobu.");
  const p = decodeURIComponent(new URL(value).pathname);
  if (
    /[\\\x00-\x1f]/.test(p) ||
    p.split("/").some((s) => s === "." || s === "..")
  )
    throw new Error("Niedozwolona ścieżka.");
  const target = path.resolve(root, "." + (p === "/" ? "/index.html" : p));
  if (!inside(root, target)) throw new Error("Niedozwolona ścieżka.");
  return target;
}
export function inside(root: string, file: string) {
  const relative = path.relative(root, file);
  return (
    !!relative &&
    !relative.startsWith(".." + path.sep) &&
    relative !== ".." &&
    !path.isAbsolute(relative)
  );
}
export function payload(
  value: unknown,
  keys: string[],
): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== keys.sort().join(",")
  )
    throw new Error("Nieprawidłowe żądanie aplikacji.");
}
export function text(value: unknown, max: number): asserts value is string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > max ||
    /[\x00-\x1f]/.test(value)
  )
    throw new Error("Nieprawidłowy tekst żądania.");
}
export function integer(value: unknown, max: number) {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 0 ||
    (value as number) > max
  )
    throw new Error("Nieprawidłowy rozmiar lub pozycja pliku.");
  return value as number;
}
export const mimeExtensions = {
  "application/pdf": "pdf",
  "application/json": "json",
  "application/zip": "zip",
} as const;
export function saveOptions(value: unknown) {
  payload(value, ["name", "mime", "size"]);
  text(value.name, 180);
  if (
    !(
      typeof value.mime === "string" &&
      Object.hasOwn(mimeExtensions, value.mime)
    )
  )
    throw new Error("Nieobsługiwany typ eksportu.");
  const mime = value.mime as keyof typeof mimeExtensions,
    ext = mimeExtensions[mime];
  const name = path.basename(value.name).replace(/[<>:"/\\|?*]/g, "_");
  if (path.extname(name).toLowerCase() !== "." + ext)
    throw new Error("Rozszerzenie nie pasuje do typu pliku.");
  return { name, mime, ext, size: integer(value.size, MAX_FILE) };
}
export function bookmark(value: unknown): asserts value is string {
  text(value, 16000);
  if (!value.startsWith("#")) throw new Error("Nieprawidłowy adres widoku.");
}
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export function windowBounds(saved: unknown, areas: Rect[]): Rect {
  const primary = areas[0] ?? { x: 0, y: 0, width: 1280, height: 850 };
  const s = saved as Rect | undefined,
    valid =
      s &&
      ["x", "y", "width", "height"].every((k) =>
        Number.isSafeInteger(s[k as keyof Rect]),
      ) &&
      s.width > 0 &&
      s.height > 0;
  const r = valid
    ? s
    : { x: primary.x + 40, y: primary.y + 30, width: 1280, height: 850 };
  const overlap = (a: Rect) =>
    Math.max(0, Math.min(a.x + a.width, r.x + r.width) - Math.max(a.x, r.x)) *
    Math.max(0, Math.min(a.y + a.height, r.y + r.height) - Math.max(a.y, r.y));
  const area = [...areas].sort((a, b) => overlap(b) - overlap(a))[0] ?? primary;
  const width = Math.min(Math.max(360, r.width), area.width),
    height = Math.min(Math.max(480, r.height), area.height);
  return {
    x: Math.max(area.x, Math.min(r.x, area.x + area.width - width)),
    y: Math.max(area.y, Math.min(r.y, area.y + area.height - height)),
    width,
    height,
  };
}
/** Filesystem failures are actionable without exposing a raw Node stack to the UI. */
export function fileError(value: unknown) {
  const error = value as NodeJS.ErrnoException;
  switch (error?.code) {
    case "ENOSPC":
      return "Brak miejsca na wybranym dysku. Zapis nie został ukończony.";
    case "EPERM":
    case "EACCES":
    case "EBUSY":
      return "Nie można zapisać pliku. Sprawdź uprawnienia i zamknij go w innych programach.";
    case "ENOENT":
    case "ENODEV":
    case "EIO":
      return "Nie można odczytać lub zapisać pliku. Sprawdź folder i połączenie z nośnikiem.";
    default:
      return value instanceof Error
        ? value.message
        : "Nie udało się wykonać operacji pliku.";
  }
}
