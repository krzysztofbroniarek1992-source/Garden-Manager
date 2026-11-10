import type { Data } from "../domain";
import { isDate } from "../planning/dates";
import {
  reviewRows,
  rowIdentity,
  rowMatch,
  rulesKey,
  validateExpenseData,
  type Expense,
  type ExpenseCategory,
  type ExpenseProfile,
  type ExpenseRule,
  type ImportRequest,
  type Versioned,
} from "./model";

const conflict = () =>
  new Error(
    "Wydatki lub ustawienia zmieniły się w innej karcie. Wczytaj aktualne dane i ponów weryfikację.",
  );
function check<T extends Versioned>(
  current: T | undefined,
  expected: T | null,
) {
  if (
    expected === null
      ? !!current
      : !current || JSON.stringify(current) !== JSON.stringify(expected)
  )
    throw conflict();
}
function stamp<T extends Versioned>(
  value: T,
  current: T | undefined,
  now: number,
): T {
  return {
    ...value,
    revision: (current?.revision ?? 0) + 1,
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
  };
}
function validated(data: Data) {
  validateExpenseData(data);
  return data;
}
export function saveExpense(
  data: Data,
  input: Expense,
  expected: Expense | null,
  now: number,
) {
  const current = data.expenses.find((e) => e.id === input.id);
  check(current, expected);
  if (
    !current &&
    (input.source !== "manual" ||
      input.origin !== null ||
      input.direction !== "outgoing")
  )
    throw new Error("Ręcznie można dodać wyłącznie wydatek.");
  if (
    current &&
    JSON.stringify([input.source, input.origin, input.direction]) !==
      JSON.stringify([current.source, current.origin, current.direction])
  )
    throw new Error("Pochodzenie operacji bankowej jest niezmienne.");
  if (
    !data.expenseCategories.some(
      (c) =>
        c.id === input.categoryId &&
        (!c.archived || current?.categoryId === c.id),
    )
  )
    throw new Error("Wybierz aktywną kategorię.");
  const value = stamp(
    {
      ...input,
      counterparty: input.counterparty.trim(),
      description: input.description.trim(),
      note: input.note.trim(),
      history: [
        ...(current?.history ?? []),
        {
          at: now,
          status: input.status,
          categoryId: input.categoryId,
          amountCents: input.amountCents,
          reason: input.note.trim() || "Zapis formularza wydatku",
        },
      ],
    },
    current,
    now,
  );
  return validated({
    ...data,
    expenses: current
      ? data.expenses.map((e) => (e.id === value.id ? value : e))
      : [...data.expenses, value],
  });
}
export function saveSetting<
  K extends "expenseCategories" | "expenseRules" | "expenseProfiles",
>(
  data: Data,
  key: K,
  input: Data[K][number],
  expected: Data[K][number] | null,
  now: number,
) {
  const list = data[key] as (ExpenseCategory | ExpenseRule | ExpenseProfile)[];
  const current = list.find((e) => e.id === input.id);
  check(current, expected);
  const value = stamp(input, current, now);
  return validated({
    ...data,
    [key]: current
      ? list.map((e) => (e.id === value.id ? value : e))
      : [...list, value],
  });
}
/** Called synchronously inside the authoritative IndexedDB readwrite transaction. */
export function importExpenses(
  data: Data,
  request: ImportRequest,
  now: number,
): Data {
  const prior = data.expenseImports.find((i) => i.id === request.id);
  if (prior) {
    if (prior.requestKey !== request.requestKey) throw conflict();
    return data;
  }
  const profile = data.expenseProfiles.find((p) => p.id === request.profile.id);
  if (
    !profile ||
    profile.archived ||
    JSON.stringify(profile) !== JSON.stringify(request.profile) ||
    rulesKey(data) !== request.rulesKey
  )
    throw conflict();
  if (
    !request.rows.length ||
    request.rows.length > 2000 ||
    new Set(request.rows.map((r) => r.line)).size !== request.rows.length
  )
    throw new Error("Nieprawidłowe wiersze importu.");
  const fresh = reviewRows(
    data,
    profile.id,
    request.statementKey,
    request.rows,
  );
  const expenses = [...data.expenses];
  const decisions = fresh.map((line, index) => {
    const selected = request.rows[index],
      row = line.row;
    const result = {
      line: line.line,
      date: row?.date ?? null,
      signedCents: row?.signedCents ?? null,
      counterparty: row?.counterparty ?? "",
      description: row?.description ?? "",
      decision: "skipped" as
        | "approved"
        | "excluded"
        | "duplicate"
        | "skipped"
        | "error",
      expenseId: null as string | null,
      reason: selected.reason,
    };
    if (!row)
      return { ...result, decision: "error" as const, reason: line.error };
    if (
      !isDate(row.date) ||
      !Number.isSafeInteger(row.signedCents) ||
      !row.signedCents ||
      row.occurrence < 1 ||
      !Number.isInteger(row.occurrence) ||
      rowIdentity(profile.id, request.statementKey, row) !==
        selected.identity ||
      rowMatch(row) !== selected.match
    )
      throw new Error("Niespójny podgląd importu. Wczytaj plik ponownie.");
    if (line.state === "conflict")
      throw new Error(
        `ID bankowe w wierszu ${line.line} ma inne dane. Wyjaśnij konflikt przed importem.`,
      );
    if (line.state === "duplicate")
      return {
        ...result,
        decision: "duplicate" as const,
        expenseId: line.existingId,
        reason: "Operacja jest już zapisana lub powtarza ID bankowe.",
      };
    if (!selected.selected)
      return {
        ...result,
        reason: selected.reason || "Pominięto decyzją użytkownika.",
      };
    if (line.state === "ambiguous" && !selected.separate)
      throw new Error(
        `Wiersz ${line.line} przypomina wcześniejszą operację. Potwierdź osobną operację lub pomiń.`,
      );
    if (
      !data.expenseCategories.some(
        (c) => c.id === selected.categoryId && !c.archived,
      )
    )
      throw conflict();
    const status = row.signedCents > 0 ? "excluded" : selected.status;
    const id = `${request.id}-${line.line}`;
    expenses.push({
      id,
      revision: 1,
      createdAt: now,
      updatedAt: now,
      date: row.date,
      amountCents: Math.abs(row.signedCents),
      direction: row.signedCents > 0 ? "incoming" : "outgoing",
      counterparty: row.counterparty,
      description: row.description,
      categoryId: selected.categoryId,
      source: "csv",
      origin: {
        profileId: profile.id,
        transactionId: row.transactionId,
        statementKey: request.statementKey,
        identity: line.identity,
        match: line.match,
        occurrence: row.occurrence,
        importId: request.id,
        line: line.line,
      },
      status,
      note: "",
      history: [
        {
          at: now,
          status,
          categoryId: selected.categoryId,
          amountCents: Math.abs(row.signedCents),
          reason: selected.reason,
        },
      ],
    });
    return { ...result, decision: status, expenseId: id };
  });
  const count = (decision: string) =>
    decisions.filter((r) => r.decision === decision).length;
  return validated({
    ...data,
    expenses,
    expenseImports: [
      ...data.expenseImports,
      {
        id: request.id,
        revision: 1,
        createdAt: now,
        updatedAt: now,
        profileId: profile.id,
        profileName: profile.name,
        filename: request.filename,
        statementKey: request.statementKey,
        fileHash: request.fileHash,
        requestKey: request.requestKey,
        approved: count("approved"),
        excluded: count("excluded"),
        duplicates: count("duplicate"),
        skipped: count("skipped"),
        errors: count("error"),
        rows: decisions,
      },
    ],
  });
}
