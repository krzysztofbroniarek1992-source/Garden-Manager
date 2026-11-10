import { isDate } from "../planning/dates";
import {
  csvLimits,
  normalized,
  rowMatch,
  type BankRow,
  type CsvMapping,
  type CsvOptions,
} from "./model";

export interface CsvRecord {
  cells: string[];
  line: number;
}
export function parseCsv(text: string, delimiter: string): CsvRecord[] {
  if (![";", ",", "\t", "|"].includes(delimiter))
    throw new Error("Wybierz obsługiwany separator.");
  const result: CsvRecord[] = [];
  let cells: string[] = [],
    field = "",
    quoted = false,
    closed = false,
    line = 1,
    start = 1;
  const cell = () => {
    if (field.length > csvLimits.cell)
      throw new Error(`Zbyt długie pole w wierszu ${start}.`);
    cells.push(field);
    field = "";
    closed = false;
    if (cells.length > csvLimits.columns)
      throw new Error("CSV ma zbyt wiele kolumn (limit 64).");
  };
  const row = () => {
    cell();
    if (cells.some((c) => c.trim())) result.push({ cells, line: start });
    cells = [];
    if (result.length > csvLimits.rows + 51)
      throw new Error("CSV ma zbyt wiele wierszy (limit 2000 operacji).");
  };
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else {
        field += c;
        if (c === "\n") line++;
      }
    } else if (c === '"') {
      if (field.trim() || closed)
        throw new Error(`Nieprawidłowy cudzysłów w wierszu ${line}.`);
      field = "";
      quoted = true;
    } else if (c === delimiter) cell();
    else if (c === "\r" || c === "\n") {
      row();
      if (c === "\r" && text[i + 1] === "\n") i++;
      line++;
      start = line;
    } else if (closed) {
      if (!/\s/.test(c))
        throw new Error(`Znak po zamknięciu pola w wierszu ${line}.`);
    } else field += c;
    if (field.length > csvLimits.cell)
      throw new Error(`Zbyt długie pole w wierszu ${start}.`);
  }
  if (quoted)
    throw new Error(`Niezamknięte pole w cudzysłowie (wiersz ${start}).`);
  if (field.length || cells.length || closed) row();
  return result;
}
export function detectDelimiter(text: string): string {
  const candidates = [";", ",", "\t", "|"]
    .map((delimiter) => {
      try {
        const rows = parseCsv(text, delimiter).slice(0, 12);
        const widths = rows.map((r) => r.cells.length);
        const width = Math.max(1, ...widths);
        return {
          delimiter,
          score:
            width > 1
              ? widths.filter((w) => w === width).length * 100 + width
              : 0,
        };
      } catch {
        return { delimiter, score: -1 };
      }
    })
    .sort((a, b) => b.score - a.score);
  return candidates[0].delimiter;
}
export async function decodeCsv(
  blob: Blob,
  encoding = "auto",
): Promise<{ text: string; encoding: string; hash: string }> {
  if (!blob.size || blob.size > csvLimits.bytes)
    throw new Error("Wybierz niepusty CSV do 5 MB.");
  const bytes = await blob.arrayBuffer();
  let selected = encoding;
  if (selected === "auto") {
    const b = new Uint8Array(bytes);
    if (b[0] === 255 && b[1] === 254) selected = "utf-16le";
    else {
      try {
        new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        selected = "utf-8";
      } catch {
        selected = "windows-1250";
      }
    }
  }
  if (!["utf-8", "windows-1250", "iso-8859-2", "utf-16le"].includes(selected))
    throw new Error("Nieobsługiwane kodowanie CSV.");
  let text: string;
  try {
    text = new TextDecoder(selected, { fatal: true }).decode(bytes);
  } catch {
    throw new Error(
      "Nie można odczytać tego kodowania. Zmień je i sprawdź podgląd polskich znaków.",
    );
  }
  if (text.includes("\u0000"))
    throw new Error("CSV zawiera niedozwolone znaki. Sprawdź kodowanie.");
  return {
    text: text.replace(/^\uFEFF/, ""),
    encoding: selected,
    hash: await digest(bytes),
  };
}
export async function digest(value: string | ArrayBuffer) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        typeof value === "string" ? new TextEncoder().encode(value) : value,
      ),
    ),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
/** Integer arithmetic only. Decimal format is explicit; ambiguous grouping is rejected. */
export function parseMoney(value: string, decimal: "," | "."): number {
  let s = value
    .normalize("NFC")
    .trim()
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/\s*(?:PLN|zł)\s*$/iu, "")
    .trim();
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  if (s.endsWith("-")) {
    if (negative) throw new Error("Podwójny znak kwoty.");
    negative = true;
    s = s.slice(0, -1).trim();
  }
  if (/^[+-]/.test(s)) {
    if (negative) throw new Error("Podwójny znak kwoty.");
    negative = s[0] === "-";
    s = s.slice(1).trim();
  }
  const parts = s.split(decimal);
  if (parts.length > 2) throw new Error("Nieprawidłowy separator dziesiętny.");
  const fraction = parts[1] ?? "";
  if (!/^\d{0,2}$/.test(fraction) || (parts.length === 2 && !fraction))
    throw new Error("Kwota musi mieć najwyżej dwa miejsca po przecinku.");
  let integer = parts[0];
  const group = decimal === "," ? "." : ",";
  if (integer.includes(" ") && integer.includes(group))
    throw new Error("Mieszane separatory tysięcy.");
  const separator = integer.includes(" ")
    ? " "
    : integer.includes(group)
      ? group
      : null;
  if (separator) {
    const groups = integer.split(separator);
    if (
      !/^\d{1,3}$/.test(groups[0]) ||
      !groups.slice(1).every((g) => /^\d{3}$/.test(g))
    )
      throw new Error("Nieprawidłowy zapis tysięcy. Sprawdź format liczb.");
    integer = groups.join("");
  }
  if (!/^\d+$/.test(integer))
    throw new Error("Kwota zawiera nieprawidłowe znaki lub inną walutę.");
  const cents = BigInt(integer) * 100n + BigInt(fraction.padEnd(2, "0") || "0");
  if (cents > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Kwota przekracza bezpieczny zakres.");
  return Number(cents) * (negative ? -1 : 1);
}
export function parseDate(
  value: string,
  format: CsvOptions["dateFormat"],
): string {
  const s = value.trim();
  let date = "";
  const iso = s.match(
    /^(\d{4})[-/.](\d{2})[-/.](\d{2})(?:[ T]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/,
  );
  const local = s.match(
    /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?: \d{2}:\d{2}(?::\d{2})?)?$/,
  );
  if (iso && (format === "auto" || format === "ymd"))
    date = `${iso[1]}-${iso[2]}-${iso[3]}`;
  else if (
    local &&
    (format === "auto" || format === "dmy" || format === "mdy")
  ) {
    const day = format === "mdy" ? local[2] : local[1],
      month = format === "mdy" ? local[1] : local[2];
    date = `${local[3]}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  if (!isDate(date))
    throw new Error(
      "Nieprawidłowa data. Wybierz format daty dla tego wyciągu.",
    );
  return date;
}
export function remapColumns(
  oldHeaders: string[],
  nextHeaders: string[],
  mapping: CsvMapping,
): CsvMapping {
  return Object.fromEntries(
    Object.entries(mapping).map(([key, index]) => {
      if (index < 0) return [key, -1];
      const name = normalized(oldHeaders[index] ?? "");
      const matches = nextHeaders
        .map((h, i) => (normalized(h) === name ? i : -1))
        .filter((i) => i >= 0);
      return [key, matches.length === 1 ? matches[0] : -1];
    }),
  ) as unknown as CsvMapping;
}
export async function mappedRows(records: CsvRecord[], options: CsvOptions) {
  const header = records[options.headerRow];
  if (!header) throw new Error("Nie znaleziono wiersza nagłówków.");
  const m = options.mapping,
    required = [
      m.date,
      ...(options.mode === "signed" ? [m.amount] : [m.debit, m.credit]),
    ];
  if (required.some((i) => i < 0 || i >= header.cells.length))
    throw new Error("Wskaż kolumnę daty i kwoty (lub obciążeń oraz wpływów).");
  const selected = Object.values(m).filter((i) => i >= 0);
  if (new Set(selected).size !== selected.length)
    throw new Error(
      "Każdą kolumnę można przypisać tylko raz. Usuń nieużywane mapowania.",
    );
  if (records.length - options.headerRow - 1 > csvLimits.rows)
    throw new Error("Limit to 2000 operacji w jednym imporcie.");
  const occurrences = new Map<string, number>();
  const rows = records.slice(options.headerRow + 1).map((record) => {
    const get = (index: number) =>
      index < 0 ? "" : (record.cells[index] ?? "");
    try {
      if (record.cells.length !== header.cells.length)
        throw new Error("Liczba pól nie zgadza się z nagłówkiem.");
      const currency = get(m.currency).trim().toLocaleUpperCase("pl-PL");
      if (m.currency >= 0 && !["PLN", "ZŁ"].includes(currency))
        throw new Error(
          "Obsługiwane są wyłącznie kwoty PLN, bez przeliczania walut.",
        );
      let signedCents: number;
      if (options.mode === "signed")
        signedCents =
          parseMoney(get(m.amount), options.decimal) *
          (options.positiveIsExpense ? -1 : 1);
      else {
        const debit = get(m.debit).trim()
            ? Math.abs(parseMoney(get(m.debit), options.decimal))
            : 0,
          credit = get(m.credit).trim()
            ? Math.abs(parseMoney(get(m.credit), options.decimal))
            : 0;
        if (debit && credit)
          throw new Error("Wiersz zawiera równocześnie wpływ i obciążenie.");
        signedCents = credit - debit;
      }
      if (signedCents === 0) throw new Error("Kwota operacji jest zerowa.");
      const row: BankRow = {
        line: record.line,
        date: parseDate(get(m.date), options.dateFormat),
        signedCents,
        counterparty: normalized(get(m.counterparty)),
        description: normalized(get(m.description)),
        transactionId: get(m.transactionId).trim()
          ? normalized(get(m.transactionId))
          : null,
        occurrence: 1,
      };
      if (
        row.counterparty.length > 300 ||
        row.description.length > 2000 ||
        (row.transactionId?.length ?? 0) > 200
      )
        throw new Error("Zbyt długi kontrahent, opis lub identyfikator.");
      const key = rowMatch(row);
      row.occurrence = (occurrences.get(key) ?? 0) + 1;
      occurrences.set(key, row.occurrence);
      return { row, line: record.line, error: "" };
    } catch (error) {
      return { row: null, line: record.line, error: (error as Error).message };
    }
  });
  const canonical = rows
    .map((r) =>
      r.row
        ? [rowMatch(r.row), r.row.transactionId, r.row.occurrence]
        : ["error", r.line, r.error],
    )
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return {
    rows,
    statementKey: await digest(JSON.stringify(canonical)),
    headers: header.cells,
  };
}
