import type { Data } from "../domain";
import { isDate } from "../planning/dates";

export const shoppingStatuses = { needed: "Do kupienia", ordered: "Zamówione", purchased: "Kupione" } as const;
export const shoppingPriorities = { normal: "Normalny", urgent: "Pilny", bargain: "Okazja cenowa" } as const;
export interface ShoppingPrice { amountCents: number; basis: "unit" | "total" }
export interface ShoppingItem {
  id: string; revision: number; createdAt: number; updatedAt: number; deletedAt: number | null;
  name: string; quantityMilli: number; unit: string; category: string;
  status: keyof typeof shoppingStatuses; priority: keyof typeof shoppingPriorities;
  plannedPrice: ShoppingPrice | null; actualPrice: ShoppingPrice | null;
  vendor: string; url: string; notes: string; jobId: string | null; jobTitle: string;
  purchasedOn: string | null; archivedAt: number | null; expenseId: string | null;
}
export interface ShoppingData { shoppingItems: ShoppingItem[] }
/** Upgrade only missing fields of older envelopes; never repair current-format records. */
export const withShopping = (data: Data): Data => ({
  ...data, shoppingItems: data.shoppingItems === undefined ? [] : data.shoppingItems,
});
export function productUrl(value: string) {
  if (!value) return true;
  try {
    const u = new URL(value);
    return ["http:", "https:"].includes(u.protocol) && !!u.hostname && !u.username && !u.password && !/[\u0000-\u0020]/.test(value);
  } catch { return false; }
}
export function quantityMilli(value: string) {
  const m = /^(\d{1,10})(?:[,.](\d{1,3}))?$/.exec(value.trim());
  if (!m) throw Error("Podaj dodatnią ilość, z najwyżej trzema miejscami po przecinku.");
  const n = BigInt(m[1]) * 1000n + BigInt((m[2] ?? "").padEnd(3, "0"));
  if (n <= 0n || n > 1_000_000_000_000n) throw Error("Ilość jest poza dozwolonym zakresem.");
  return Number(n);
}
export function quantityText(value: number) {
  const rest = value % 1000;
  return String(Math.floor(value / 1000)) + (rest ? "," + String(rest).padStart(3, "0").replace(/0+$/, "") : "");
}
export function priceText(value: number) {
  return String(BigInt(value) / 100n) + "," + String(BigInt(value) % 100n).padStart(2, "0");
}
/** Exact arithmetic: a fractional grosz is rounded once, half up. No labor pricing is involved. */
export function shoppingTotal(price: ShoppingPrice | null, quantity: number): number | null {
  if (price === null) return null;
  if (!Number.isSafeInteger(price.amountCents) || price.amountCents < 0 || !Number.isSafeInteger(quantity) || quantity <= 0)
    throw Error("Podaj poprawną cenę i ilość.");
  const n = price.basis === "total" ? BigInt(price.amountCents) : (BigInt(price.amountCents) * BigInt(quantity) + 500n) / 1000n;
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw Error("Łączna cena jest zbyt duża.");
  return Number(n);
}
export const newShoppingItem = (name = ""): ShoppingItem => ({
  id: crypto.randomUUID(), revision: 1, createdAt: 0, updatedAt: 0, deletedAt: null,
  name, quantityMilli: 1000, unit: "szt.", category: "Inne", status: "needed", priority: "normal",
  plannedPrice: null, actualPrice: null, vendor: "", url: "", notes: "", jobId: null, jobTitle: "",
  purchasedOn: null, archivedAt: null, expenseId: null,
});
export function validateShopping(data: Data) {
  const fail = (): never => { throw Error("Nieprawidłowa lista zakupów. Oryginalne dane pozostają zachowane."); };
  const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  const text = (v: unknown, max: number) => typeof v === "string" && v.length <= max;
  const ident = (v: unknown) => text(v, 256) && !!(v as string).trim();
  const stamp = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= 8.64e15;
  const price = (v: unknown) => v === null || obj(v) && Number.isSafeInteger(v.amountCents) && (v.amountCents as number) >= 0 && ["unit", "total"].includes(v.basis as string);
  if (!Array.isArray(data.shoppingItems) || data.shoppingItems.length > 20000) fail();
  const ids = new Set<string>();
  for (const p of data.shoppingItems) {
    if (!obj(p) || !ident(p.id) || ids.has(p.id) || !Number.isSafeInteger(p.revision) || p.revision < 1 ||
      !stamp(p.createdAt) || !stamp(p.updatedAt) || p.updatedAt < p.createdAt ||
      !(p.deletedAt === null || stamp(p.deletedAt) && p.deletedAt >= p.createdAt) ||
      !text(p.name, 200) || !p.name.trim() || !Number.isSafeInteger(p.quantityMilli) || p.quantityMilli <= 0 || p.quantityMilli > 1e12 ||
      !text(p.unit, 40) || !p.unit.trim() || !text(p.category, 100) || !p.category.trim() ||
      !Object.hasOwn(shoppingStatuses, p.status) || !Object.hasOwn(shoppingPriorities, p.priority) ||
      !price(p.plannedPrice) || !price(p.actualPrice) || !text(p.vendor, 300) || !text(p.url, 2048) || !productUrl(p.url) || !text(p.notes, 3000) ||
      !(p.jobId === null || ident(p.jobId)) || !text(p.jobTitle, 300) ||
      !(p.purchasedOn === null || isDate(p.purchasedOn)) ||
      (p.status === "purchased" ? p.purchasedOn === null : p.purchasedOn !== null) ||
      !(p.archivedAt === null || stamp(p.archivedAt) && p.archivedAt >= p.createdAt && p.status === "purchased") ||
      !(p.expenseId === null || ident(p.expenseId) && p.status === "purchased" && data.expenses.some(e => e.id === p.expenseId && e.direction === "outgoing"))) fail();
    ids.add(p.id);
    shoppingTotal(p.plannedPrice, p.quantityMilli);
    shoppingTotal(p.actualPrice, p.quantityMilli);
  }
}
