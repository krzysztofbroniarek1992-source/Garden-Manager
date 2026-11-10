import type { Data } from "../domain";
import { isDate } from "../planning/dates";

export type ExpenseStatus = "approved" | "excluded";
export type Direction = "outgoing" | "incoming";
export interface Versioned {
  id: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
}
export interface ExpenseCategory extends Versioned {
  name: string;
  archived: boolean;
}
export interface ExpenseRule extends Versioned {
  name: string;
  field: "counterparty" | "description" | "any";
  pattern: string;
  categoryId: string;
  action: "category" | "exclude";
  enabled: boolean;
  priority: number;
}
export interface CsvMapping {
  date: number;
  amount: number;
  debit: number;
  credit: number;
  counterparty: number;
  description: number;
  transactionId: number;
  currency: number;
}
export interface CsvOptions {
  delimiter: string;
  encoding: string;
  headerRow: number;
  mode: "signed" | "split";
  positiveIsExpense: boolean;
  decimal: "," | ".";
  dateFormat: "auto" | "dmy" | "ymd" | "mdy";
  mapping: CsvMapping;
}
export interface ExpenseProfile extends Versioned {
  name: string;
  headers: string[];
  options: CsvOptions;
  archived: boolean;
}
export interface BankRow {
  line: number;
  date: string;
  signedCents: number;
  counterparty: string;
  description: string;
  transactionId: string | null;
  occurrence: number;
}
export interface ExpenseOrigin {
  profileId: string;
  transactionId: string | null;
  statementKey: string;
  identity: string;
  match: string;
  occurrence: number;
  importId: string;
  line: number;
}
export interface ExpenseChange {
  at: number;
  status: ExpenseStatus;
  categoryId: string;
  amountCents: number;
  reason: string;
}
export interface Expense extends Versioned {
  date: string;
  amountCents: number;
  direction: Direction;
  counterparty: string;
  description: string;
  categoryId: string;
  source: "manual" | "csv";
  origin: ExpenseOrigin | null;
  status: ExpenseStatus;
  note: string;
  history: ExpenseChange[];
}
export type RowState = "new" | "duplicate" | "ambiguous" | "conflict" | "error";
export interface ImportLine {
  line: number;
  row: BankRow | null;
  error: string;
  identity: string;
  match: string;
  state: RowState;
  existingId: string | null;
  selected: boolean;
  separate: boolean;
  status: ExpenseStatus;
  categoryId: string;
  reason: string;
}
export interface ImportDecision {
  line: number;
  date: string | null;
  signedCents: number | null;
  counterparty: string;
  description: string;
  decision: "approved" | "excluded" | "duplicate" | "skipped" | "error";
  expenseId: string | null;
  reason: string;
}
export interface ExpenseImport extends Versioned {
  profileId: string;
  profileName: string;
  filename: string;
  statementKey: string;
  fileHash: string;
  requestKey: string;
  approved: number;
  excluded: number;
  duplicates: number;
  skipped: number;
  errors: number;
  rows: ImportDecision[];
}
export interface ExpenseData {
  expenses: Expense[];
  expenseCategories: ExpenseCategory[];
  expenseRules: ExpenseRule[];
  expenseProfiles: ExpenseProfile[];
  expenseImports: ExpenseImport[];
}
export interface ImportRequest {
  id: string;
  profile: ExpenseProfile;
  rulesKey: string;
  statementKey: string;
  fileHash: string;
  filename: string;
  rows: ImportLine[];
  requestKey: string;
}
export const csvLimits = {
  bytes: 5 * 1024 * 1024,
  rows: 2000,
  columns: 64,
  cell: 4096,
} as const;
export const categoryNames = [
  "Sprzęt i narzędzia",
  "Materiały ogrodnicze",
  "Paliwo",
  "Serwis i części pojazdów",
  "Serwis maszyn",
  "ZUS i składki",
  "Księgowość",
  "Ubezpieczenia",
  "Opłaty i abonamenty",
  "Pozostałe",
];
export const categoryId = (index: number) => `expense-category-${index}`;
export const otherCategory = categoryId(9);
export const emptyMapping = (): CsvMapping => ({
  date: -1,
  amount: -1,
  debit: -1,
  credit: -1,
  counterparty: -1,
  description: -1,
  transactionId: -1,
  currency: -1,
});
export const defaultOptions = (): CsvOptions => ({
  delimiter: ";",
  encoding: "utf-8",
  headerRow: 0,
  mode: "signed",
  positiveIsExpense: false,
  decimal: ",",
  dateFormat: "auto",
  mapping: emptyMapping(),
});
export function initialExpenseData(): ExpenseData {
  const stamp = { revision: 1, createdAt: 0, updatedAt: 0 };
  const expenseCategories = categoryNames.map((name, i) => ({
    id: categoryId(i),
    name,
    archived: false,
    ...stamp,
  }));
  const defs: [string, string, number, ExpenseRule["action"]][] = [
    ["Przelew własny", "przelew własny", 9, "exclude"],
    ["Przelew wewnętrzny", "przelew wewnętrzny", 9, "exclude"],
    ["Wypłata gotówki", "wypłata gotówki", 9, "exclude"],
    ["Spłata kredytu", "spłata kredytu", 9, "exclude"],
    ["Rata kredytu", "rata kredytu", 9, "exclude"],
    ["ZUS", "ZUS", 5, "category"],
    ["Księgowość", "biuro rachunkowe", 6, "category"],
    ["Paliwo ORLEN", "ORLEN", 2, "category"],
    ["Paliwo Shell", "SHELL", 2, "category"],
    ["Sklep ogrodniczy", "ogrodnicz", 1, "category"],
  ];
  return {
    expenses: [],
    expenseProfiles: [],
    expenseImports: [],
    expenseCategories,
    expenseRules: defs.map(([name, pattern, c, action], i) => ({
      id: `expense-rule-${i}`,
      name,
      pattern,
      categoryId: categoryId(c),
      action,
      field: "any",
      enabled: true,
      priority: i,
      ...stamp,
    })),
  };
}
/** Only add absent fields; current-format snapshots must be validated without this upgrade. */
export function withExpenses(data: Data): Data {
  const defaults = initialExpenseData();
  return {
    ...data,
    ...Object.fromEntries(
      Object.entries(defaults).map(([key, value]) => [
        key,
        (data as unknown as Record<string, unknown>)[key] === undefined
          ? value
          : (data as unknown as Record<string, unknown>)[key],
      ]),
    ),
  } as Data;
}
export const normalized = (text: string) =>
  text.normalize("NFC").trim().replace(/\s+/g, " ");
export const rowMatch = (row: BankRow) =>
  JSON.stringify([
    row.date,
    row.signedCents,
    normalized(row.counterparty),
    normalized(row.description),
  ]);
export const rowIdentity = (
  profileId: string,
  statementKey: string,
  row: BankRow,
) =>
  row.transactionId
    ? JSON.stringify([profileId, "bank", normalized(row.transactionId)])
    : JSON.stringify([
        profileId,
        "statement",
        statementKey,
        rowMatch(row),
        row.occurrence,
      ]);
export const rulesKey = (data: ExpenseData) =>
  JSON.stringify(data.expenseRules);
export function suggest(data: ExpenseData, row: BankRow) {
  const active = new Set(
    data.expenseCategories.filter((c) => !c.archived).map((c) => c.id),
  );
  const rule = [...data.expenseRules]
    .filter((r) => r.enabled && active.has(r.categoryId))
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
    .find((r) =>
      normalized(
        r.field === "counterparty"
          ? row.counterparty
          : r.field === "description"
            ? row.description
            : `${row.counterparty} ${row.description}`,
      )
        .toLocaleLowerCase("pl-PL")
        .includes(normalized(r.pattern).toLocaleLowerCase("pl-PL")),
    );
  return {
    categoryId:
      rule?.categoryId ??
      (active.has(otherCategory) ? otherCategory : ([...active][0] ?? "")),
    status: "excluded" as const,
    reason:
      row.signedCents > 0
        ? "Wpływ bankowy — poza kosztami i rejestrem płatności zleceń."
        : rule?.action === "exclude"
          ? `Propozycja wyłączenia: ${rule.name}. Zweryfikuj operację.`
          : rule
            ? `Propozycja kategorii: ${rule.name}. Zatwierdź koszt świadomie.`
            : "Sprawdź kategorię i zdecyduj, czy jest to koszt firmy.",
    exclusion: row.signedCents > 0 || rule?.action === "exclude",
  };
}
export function reviewRows(
  data: ExpenseData,
  profileId: string,
  statementKey: string,
  rows: { row: BankRow | null; line: number; error: string }[],
): ImportLine[] {
  const byIdentity = new Map(
    data.expenses.filter((e) => e.origin).map((e) => [e.origin!.identity, e]),
  );
  const byMatch = new Map<string, Expense>();
  for (const e of data.expenses)
    if (e.origin?.profileId === profileId) byMatch.set(e.origin.match, e);
  const seen = new Map<string, string>();
  return rows.map((input) => {
    if (!input.row)
      return {
        ...input,
        identity: "",
        match: "",
        state: "error",
        existingId: null,
        selected: false,
        separate: false,
        status: "excluded",
        categoryId: "",
        reason: input.error,
      };
    const row = input.row,
      match = rowMatch(row),
      identity = rowIdentity(profileId, statementKey, row),
      existing = byIdentity.get(identity),
      previous = seen.get(identity);
    seen.set(identity, match);
    const state: RowState = existing
      ? existing.origin!.match === match
        ? "duplicate"
        : "conflict"
      : previous
        ? previous === match
          ? "duplicate"
          : "conflict"
        : !row.transactionId && byMatch.has(match)
          ? "ambiguous"
          : "new";
    return {
      ...input,
      identity,
      match,
      state,
      existingId: existing?.id ?? byMatch.get(match)?.id ?? null,
      selected: state === "new",
      separate: false,
      ...suggest(data, row),
    };
  });
}
const obj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max: number) =>
  typeof v === "string" && v.length <= max;
const id = (v: unknown) => text(v, 256) && !!(v as string).trim();
const unique = (rows: { id: string }[]) =>
  rows.every((r) => obj(r) && id(r.id)) &&
  new Set(rows.map((r) => r.id)).size === rows.length;
const stamp = (v: Versioned) =>
  id(v.id) &&
  Number.isSafeInteger(v.revision) &&
  v.revision > 0 &&
  [v.createdAt, v.updatedAt].every(
    (n) => Number.isSafeInteger(n) && n >= 0 && n <= 8.64e15,
  ) &&
  v.updatedAt >= v.createdAt;
export function validateOptions(value: unknown): value is CsvOptions {
  if (!obj(value)) return false;
  const o = value as unknown as CsvOptions;
  return (
    [";", ",", "\t", "|"].includes(o.delimiter) &&
    ["utf-8", "windows-1250", "iso-8859-2", "utf-16le"].includes(o.encoding) &&
    Number.isInteger(o.headerRow) &&
    o.headerRow >= 0 &&
    o.headerRow <= 50 &&
    ["signed", "split"].includes(o.mode) &&
    typeof o.positiveIsExpense === "boolean" &&
    [",", "."].includes(o.decimal) &&
    ["auto", "dmy", "ymd", "mdy"].includes(o.dateFormat) &&
    obj(o.mapping) &&
    Object.keys(emptyMapping()).every(
      (k) =>
        Number.isInteger(o.mapping[k as keyof CsvMapping]) &&
        o.mapping[k as keyof CsvMapping] >= -1 &&
        o.mapping[k as keyof CsvMapping] < csvLimits.columns,
    )
  );
}
export function validateExpenseData(data: ExpenseData) {
  const fail = (): never => {
    throw new Error(
      "Nieprawidłowy rejestr wydatków lub importów. Oryginalny zapis pozostaje zachowany.",
    );
  };
  for (const key of [
    "expenses",
    "expenseCategories",
    "expenseRules",
    "expenseProfiles",
    "expenseImports",
  ] as const)
    if (!Array.isArray(data[key]) || !unique(data[key])) fail();
  if (
    data.expenseCategories.length > 500 ||
    !data.expenseCategories.every(
      (c) =>
        obj(c) &&
        stamp(c) &&
        text(c.name, 100) &&
        c.name.trim() &&
        typeof c.archived === "boolean",
    )
  )
    fail();
  const cats = new Set(data.expenseCategories.map((c) => c.id));
  if (!cats.size || !data.expenseCategories.some((c) => !c.archived)) fail();
  if (
    data.expenseRules.length > 1000 ||
    !data.expenseRules.every(
      (r) =>
        obj(r) &&
        stamp(r) &&
        text(r.name, 100) &&
        r.name.trim() &&
        text(r.pattern, 200) &&
        r.pattern.trim().length >= 2 &&
        ["any", "description", "counterparty"].includes(r.field) &&
        ["category", "exclude"].includes(r.action) &&
        cats.has(r.categoryId) &&
        typeof r.enabled === "boolean" &&
        Number.isInteger(r.priority) &&
        r.priority >= 0 &&
        r.priority <= 9999,
    )
  )
    fail();
  if (
    data.expenseProfiles.length > 100 ||
    !data.expenseProfiles.every(
      (p) =>
        obj(p) &&
        stamp(p) &&
        text(p.name, 100) &&
        p.name.trim() &&
        typeof p.archived === "boolean" &&
        Array.isArray(p.headers) &&
        p.headers.length <= 64 &&
        p.headers.every((h) => text(h, 4096)) &&
        validateOptions(p.options),
    )
  )
    fail();
  const expenseIds = new Set(data.expenses.map((e) => e.id));
  const importProfiles = new Map(
    data.expenseImports.map((i) => [i.id, i.profileId]),
  );
  const profiles = new Set(data.expenseProfiles.map((p) => p.id)),
    imports = new Set(data.expenseImports.map((i) => i.id)),
    identities = new Set<string>();
  for (const e of data.expenses) {
    if (
      !obj(e) ||
      !stamp(e) ||
      !isDate(e.date) ||
      !Number.isSafeInteger(e.amountCents) ||
      e.amountCents <= 0 ||
      !["incoming", "outgoing"].includes(e.direction) ||
      !text(e.counterparty, 300) ||
      !text(e.description, 2000) ||
      !text(e.note, 3000) ||
      !cats.has(e.categoryId) ||
      !["approved", "excluded"].includes(e.status) ||
      (e.direction === "incoming" && e.status !== "excluded") ||
      !["csv", "manual"].includes(e.source) ||
      !Array.isArray(e.history) ||
      e.history.length > 1000
    )
      fail();
    if (
      !e.history.every(
        (h) =>
          obj(h) &&
          Number.isSafeInteger(h.at) &&
          h.at >= 0 &&
          ["approved", "excluded"].includes(h.status) &&
          cats.has(h.categoryId) &&
          Number.isSafeInteger(h.amountCents) &&
          h.amountCents > 0 &&
          text(h.reason, 3000),
      )
    )
      fail();
    if (
      (e.source === "manual" && e.origin !== null) ||
      (e.source === "csv" && !obj(e.origin))
    )
      fail();
    if (e.origin) {
      const o = e.origin;
      if (
        !profiles.has(o.profileId) ||
        !imports.has(o.importId) ||
        !text(o.identity, 5000) ||
        !o.identity ||
        !text(o.match, 5000) ||
        !/^[a-f0-9]{64}$/.test(o.statementKey) ||
        !(
          o.transactionId === null ||
          (text(o.transactionId, 200) && o.transactionId.trim())
        ) ||
        !Number.isInteger(o.occurrence) ||
        o.occurrence < 1 ||
        !Number.isInteger(o.line) ||
        o.line < 1 ||
        identities.has(o.identity)
      )
        fail();
      identities.add(o.identity);
      let tuple: unknown;
      try {
        tuple = JSON.parse(o.match);
      } catch {
        fail();
      }
      if (
        !Array.isArray(tuple) ||
        tuple.length !== 4 ||
        !isDate(tuple[0]) ||
        !Number.isSafeInteger(tuple[1]) ||
        !tuple[1] ||
        !text(tuple[2], 300) ||
        !text(tuple[3], 2000)
      )
        fail();
      const parts = tuple as [string, number, string, string];
      const original: BankRow = {
        line: o.line,
        date: parts[0],
        signedCents: parts[1],
        counterparty: parts[2],
        description: parts[3],
        transactionId: o.transactionId,
        occurrence: o.occurrence,
      };
      if (
        (original.signedCents > 0 ? "incoming" : "outgoing") !== e.direction ||
        rowMatch(original) !== o.match ||
        rowIdentity(o.profileId, o.statementKey, original) !== o.identity ||
        importProfiles.get(o.importId) !== o.profileId
      )
        fail();
    }
  }
  for (const i of data.expenseImports)
    if (
      !obj(i) ||
      !stamp(i) ||
      !profiles.has(i.profileId) ||
      !text(i.profileName, 100) ||
      !text(i.filename, 200) ||
      !(
        /^[a-f0-9]{64}$/.test(i.statementKey) &&
        /^[a-f0-9]{64}$/.test(i.fileHash) &&
        /^[a-f0-9]{64}$/.test(i.requestKey)
      ) ||
      ![i.approved, i.excluded, i.duplicates, i.skipped, i.errors].every(
        (n) => Number.isSafeInteger(n) && n >= 0,
      ) ||
      !Array.isArray(i.rows) ||
      i.rows.length > csvLimits.rows ||
      !i.rows.every(
        (r) =>
          obj(r) &&
          Number.isInteger(r.line) &&
          r.line > 0 &&
          (r.date === null || isDate(r.date)) &&
          (r.signedCents === null || Number.isSafeInteger(r.signedCents)) &&
          text(r.counterparty, 300) &&
          text(r.description, 2000) &&
          ["approved", "excluded", "duplicate", "skipped", "error"].includes(
            r.decision,
          ) &&
          (r.expenseId === null || id(r.expenseId)) &&
          text(r.reason, 3000),
      )
    )
      fail();
  for (const i of data.expenseImports) {
    const counters = [
      ["approved", i.approved],
      ["excluded", i.excluded],
      ["duplicate", i.duplicates],
      ["skipped", i.skipped],
      ["error", i.errors],
    ] as const;
    if (
      new Set(i.rows.map((r) => r.line)).size !== i.rows.length ||
      counters.some(
        ([decision, count]) =>
          i.rows.filter((r) => r.decision === decision).length !== count,
      )
    )
      fail();
    for (const r of i.rows)
      if (r.expenseId !== null && !expenseIds.has(r.expenseId)) fail();
  }
}
