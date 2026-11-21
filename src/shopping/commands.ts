import { localDate, type Data } from "../domain";
import { saveExpense } from "../expenses/commands";
import type { Expense } from "../expenses/model";
import { validateShopping, type ShoppingItem } from "./model";

function current(data: Data, id: string, revision: number) {
  const p = data.shoppingItems.find(p => p.id === id && p.deletedAt === null);
  if (!p || p.revision !== revision) throw Error("Pozycja zakupowa zmieniła się lub została usunięta. Zachowaj szkic i otwórz aktualną wersję przed ponownym zapisem.");
  return p;
}
function replace(data: Data, item: ShoppingItem, now: number) {
  const old = data.shoppingItems.find(p => p.id === item.id);
  const value = { ...item, createdAt: old?.createdAt ?? now, updatedAt: Math.max(now, old?.updatedAt ?? now), revision: (old?.revision ?? 0) + 1 };
  const next = { ...data, shoppingItems: old ? data.shoppingItems.map(p => p.id === item.id ? value : p) : [...data.shoppingItems, value] };
  validateShopping(next);
  return next;
}
export function saveShopping(data: Data, input: ShoppingItem, expected: number | null, now: number) {
  const old = expected === null ? undefined : current(data, input.id, expected);
  if (!old && data.shoppingItems.some(p => p.id === input.id)) throw Error("Ta pozycja została już zapisana.");
  if (input.jobId && input.jobId !== old?.jobId && !data.jobs.some(j => j.id === input.jobId)) throw Error("Powiązane zlecenie nie jest już dostępne.");
  if (old?.expenseId && input.status !== "purchased") throw Error("Zakup ma powiązany wydatek. Aby kupić produkt ponownie, użyj Ponów zakup.");
  return replace(data, {
    ...input, name: input.name.normalize("NFC").trim(), unit: input.unit.trim(), category: input.category.normalize("NFC").trim(),
    vendor: input.vendor.trim(), url: input.url.trim(), notes: input.notes.trim(),
    expenseId: old?.expenseId ?? null, deletedAt: old?.deletedAt ?? null,
    archivedAt: input.status === "purchased" ? old?.archivedAt ?? null : null,
    jobTitle: data.jobs.find(j => j.id === input.jobId)?.title ?? (input.jobId === old?.jobId ? old?.jobTitle ?? "" : ""),
    purchasedOn: input.status === "purchased" ? input.purchasedOn ?? localDate(new Date(now)) : null,
  }, now);
}
export function addShoppingBatch(data: Data, items: ShoppingItem[], now: number) {
  if (!items.length || items.length > 100 || new Set(items.map(p => p.id)).size !== items.length) throw Error("Dodaj od 1 do 100 różnych pozycji naraz.");
  // The caller commits this immutable result once. Failure at any row commits nothing.
  return items.reduce((d, p) => saveShopping(d, p, null, now), data);
}
export function shoppingAction(data: Data, id: string, revision: number, action: "ordered" | "purchased" | "archive" | "restore" | "delete", now: number) {
  const p = current(data, id, revision);
  if (action === "ordered" && p.expenseId) throw Error("Zakup ma powiązany wydatek. Użyj Ponów zakup.");
  if (action === "archive" && p.status !== "purchased") throw Error("Archiwizować można wyłącznie kupione produkty.");
  return replace(data, {
    ...p,
    ...(action === "ordered" ? { status: "ordered" as const, purchasedOn: null, archivedAt: null } : {}),
    ...(action === "purchased" ? { status: "purchased" as const, purchasedOn: p.purchasedOn ?? localDate(new Date(now)) } : {}),
    ...(action === "archive" ? { archivedAt: now } : {}),
    ...(action === "restore" ? { archivedAt: null } : {}),
    ...(action === "delete" ? { deletedAt: now } : {}),
  }, now);
}
export function repeatShopping(data: Data, id: string, revision: number, newId: string, now: number) {
  const p = current(data, id, revision);
  if (p.status !== "purchased") throw Error("Ponowić można zakup kupionego produktu.");
  return saveShopping(data, {
    ...p, id: newId, jobId: data.jobs.some(j => j.id === p.jobId) ? p.jobId : null,
    status: "needed", actualPrice: null, expenseId: null, purchasedOn: null, archivedAt: null, deletedAt: null,
  }, null, now);
}
function expenseTarget(data: Data, id: string, revision: number) {
  const p = current(data, id, revision);
  if (p.status !== "purchased" || p.expenseId !== null) throw Error("Ten zakup ma już powiązany wydatek lub nie jest jeszcze kupiony.");
  return p;
}
/** Allocation, expense save and purchase association are ONE IndexedDB command. */
export function createShoppingExpense(data: Data, id: string, revision: number, expense: Expense, now: number) {
  const p = expenseTarget(data, id, revision);
  if (expense.status !== "approved" || expense.direction !== "outgoing") throw Error("Potwierdź rzeczywisty koszt firmowy.");
  return replace(saveExpense(data, expense, null, now), { ...p, expenseId: expense.id }, now);
}
export function linkShoppingExpense(data: Data, id: string, revision: number, expenseId: string, expenseRevision: number, now: number) {
  const p = expenseTarget(data, id, revision);
  const expense = data.expenses.find(e => e.id === expenseId && e.revision === expenseRevision && e.direction === "outgoing");
  if (!expense) throw Error("Wydatek zmienił się lub nie jest kosztem wychodzącym. Sprawdź go ponownie.");
  return replace(data, { ...p, expenseId }, now);
}
