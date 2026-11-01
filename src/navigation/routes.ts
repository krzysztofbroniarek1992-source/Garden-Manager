/** UI addresses only. No persisted business data or commands belong here. */
export const pages = [
  "dashboard",
  "clients",
  "gardens",
  "jobs",
  "calendar",
  "history",
  "materials",
  "calculators",
  "notes",
  "todos",
  "templates",
] as const;
export type Page = (typeof pages)[number];
export const gardenSections = [
  "overview",
  "zones",
  "jobs",
  "plans",
  "billing",
  "gallery",
  "notes",
] as const;
export const jobSections = [
  "work",
  "billing",
  "checklists",
  "notes",
  "photos",
] as const;
export type GardenSection = (typeof gardenSections)[number];
export type JobSection = (typeof jobSections)[number];
export type Card =
  | { kind: "client"; id: string }
  | { kind: "garden"; id: string; section?: GardenSection }
  | {
      kind: "job";
      id: string;
      section?: JobSection;
      initialBilling?: boolean;
      editBilling?: boolean;
    };
export interface Route {
  page: Page;
  cards: Card[];
}
export const cardKey = (card: Card) => `${card.kind}:${card.id}`;
export const routeKey = (route: Route) =>
  `${route.page}:${JSON.stringify(route.cards)}`;
const validId = (id: unknown): id is string =>
  typeof id === "string" &&
  !!id.trim() &&
  id.length <= 256 &&
  !/[\u0000-\u001f\u007f]/.test(id);
export function validCard(value: unknown): value is Card {
  if (!value || typeof value !== "object") return false;
  const c = value as Card;
  return (
    validId(c.id) &&
    (c.kind === "client" ||
      (c.kind === "garden" &&
        (c.section === undefined || gardenSections.includes(c.section))) ||
      (c.kind === "job" &&
        (c.section === undefined || jobSections.includes(c.section))))
  );
}
export function validRoute(value: unknown): value is Route {
  if (!value || typeof value !== "object") return false;
  const r = value as Route;
  return (
    pages.includes(r.page) &&
    Array.isArray(r.cards) &&
    r.cards.length <= 20 &&
    r.cards.every(validCard) &&
    new Set(r.cards.map(cardKey)).size === r.cards.length
  );
}
export function parseAddress(href: string): { route: Route; invalid: boolean } {
  const url = new URL(href, "http://localhost:5173/");
  const [rawPage, query = ""] = url.hash.slice(1).split("?");
  const page = pages.includes(rawPage as Page)
    ? (rawPage as Page)
    : "dashboard";
  const params = new URLSearchParams(query);
  const selected = ["client", "garden", "job"].filter((kind) =>
    params.has(kind),
  );
  // The former client query is accepted only on its original tab.
  const legacy =
    !selected.length && page === "clients"
      ? url.searchParams.get("client")
      : null;
  let invalid = !!rawPage && !pages.includes(rawPage as Page);
  if (selected.length > 1) invalid = true;
  const kind = selected[0] as Card["kind"] | undefined;
  const id = kind ? params.get(kind) : legacy;
  if (!kind && !legacy)
    return {
      route: { page, cards: [] },
      invalid: invalid || params.has("section"),
    };
  const card: unknown = {
    kind: kind ?? "client",
    id,
    ...(params.has("section") ? { section: params.get("section") } : {}),
  };
  if (!validCard(card) || (card.kind === "client" && params.has("section")))
    return { route: { page, cards: [] }, invalid: true };
  return { route: { page, cards: [card] }, invalid };
}
export function address(route: Route): string {
  const params = new URLSearchParams();
  const card = route.cards.at(-1);
  if (card) {
    params.set(card.kind, card.id);
    if ("section" in card && card.section) params.set("section", card.section);
  }
  return `#${route.page}${params.size ? `?${params}` : ""}`;
}
export function openCard(route: Route, input: Card): Route {
  const card: Card =
    input.kind === "job" && input.initialBilling
      ? { kind: "job", id: input.id, section: "billing" }
      : input;
  const index = route.cards.findIndex(
    (item) => cardKey(item) === cardKey(card),
  );
  const merged = index >= 0 ? { ...route.cards[index], ...card } : card;
  const cards: Card[] =
    index < 0
      ? [...route.cards, card]
      : [...route.cards.slice(0, index), validCard(merged) ? merged : card];
  return { ...route, cards: cards.slice(-20) };
}
