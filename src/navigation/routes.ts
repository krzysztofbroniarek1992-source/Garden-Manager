import { isDate } from "../planning/dates";

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
export const calendarViews = ["month", "week", "day"] as const;
export const calendarKinds = [
  "all",
  "job",
  "work",
  "reminder",
  "todo",
] as const;
export const calendarStatuses = [
  "all",
  "planned",
  "in-progress",
  "completed",
  "cancelled",
] as const;
export interface CalendarState {
  date: string;
  anchor: string;
  view: (typeof calendarViews)[number];
  gardenId?: string;
  kind?: (typeof calendarKinds)[number];
  status?: (typeof calendarStatuses)[number];
}
export type Card =
  | { kind: "client"; id: string }
  | { kind: "garden"; id: string; section?: GardenSection; zoneId?: string }
  | {
      kind: "job";
      id: string;
      section?: JobSection;
      initialBilling?: boolean;
      editBilling?: boolean;
    }
  | { kind: "schedule"; id: string }
  | { kind: "task"; id: string; originalDate: string };
export interface Route {
  page: Page;
  cards: Card[];
  calendar?: CalendarState;
  returnLabel?: string;
}
export const cardKey = (card: Card) =>
  card.kind === "task"
    ? `task:${JSON.stringify([card.id, card.originalDate])}`
    : `${card.kind}:${card.id}`;
export const routeKey = (route: Route) =>
  `${route.page}:${JSON.stringify(route)}`;
const validId = (id: unknown): id is string =>
  typeof id === "string" &&
  !!id.trim() &&
  id.length <= 256 &&
  !/[\u0000-\u001f\u007f]/.test(id);
export function validCalendar(value: unknown): value is CalendarState {
  if (!value || typeof value !== "object") return false;
  const c = value as CalendarState;
  return (
    isDate(c.date) &&
    isDate(c.anchor) &&
    // A month grid may select an adjacent day. A forged anchor many years
    // away must not expand the read projection over the intervening years.
    Math.abs(Date.parse(c.date) - Date.parse(c.anchor)) <= 62 * 86_400_000 &&
    calendarViews.includes(c.view) &&
    (c.gardenId === undefined || validId(c.gardenId)) &&
    (c.kind === undefined || calendarKinds.includes(c.kind)) &&
    (c.status === undefined || calendarStatuses.includes(c.status))
  );
}
export function validCard(value: unknown): value is Card {
  if (!value || typeof value !== "object") return false;
  const c = value as Card;
  return (
    validId(c.id) &&
    (c.kind === "client" ||
      c.kind === "schedule" ||
      (c.kind === "task" && isDate(c.originalDate)) ||
      (c.kind === "garden" &&
        (c.section === undefined || gardenSections.includes(c.section)) &&
        (c.zoneId === undefined || validId(c.zoneId))) ||
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
    new Set(r.cards.map(cardKey)).size === r.cards.length &&
    (r.calendar === undefined || validCalendar(r.calendar)) &&
    (r.returnLabel === undefined ||
      (typeof r.returnLabel === "string" && r.returnLabel.length <= 200))
  );
}
export function parseAddress(href: string): { route: Route; invalid: boolean } {
  const url = new URL(href, "http://localhost:5173/");
  const [rawPage, query = ""] = url.hash.slice(1).split("?");
  const page = pages.includes(rawPage as Page)
    ? (rawPage as Page)
    : "dashboard";
  const params = new URLSearchParams(query);
  const selected = ["client", "garden", "job", "schedule", "task"].filter(
    (kind) => params.has(kind),
  );
  const legacy =
    !selected.length && page === "clients"
      ? url.searchParams.get("client")
      : null;
  let invalid = !!rawPage && !pages.includes(rawPage as Page);
  const route: Route = { page, cards: [] };
  if (
    params.has("date") ||
    params.has("view") ||
    params.has("anchor") ||
    params.has("gardenFilter") ||
    params.has("kindFilter") ||
    params.has("statusFilter")
  ) {
    const calendar = {
      date: params.get("date"),
      anchor: params.get("anchor") ?? params.get("date"),
      view: params.get("view") ?? "month",
      ...(params.has("gardenFilter")
        ? { gardenId: params.get("gardenFilter") }
        : {}),
      ...(params.has("kindFilter") ? { kind: params.get("kindFilter") } : {}),
      ...(params.has("statusFilter")
        ? { status: params.get("statusFilter") }
        : {}),
    };
    if (validCalendar(calendar)) route.calendar = calendar;
    else invalid = true;
  }
  if (
    selected.length > 1 ||
    selected.some((kind) => params.getAll(kind).length !== 1)
  )
    return { route, invalid: true };
  const kind = selected[0] as Card["kind"] | undefined,
    id = kind ? params.get(kind) : legacy;
  if (!kind && !legacy)
    return {
      route,
      invalid:
        invalid ||
        params.has("section") ||
        params.has("original") ||
        params.has("zone"),
    };
  const card: unknown = {
    kind: kind ?? "client",
    id,
    ...(params.has("section") ? { section: params.get("section") } : {}),
    ...(kind === "task" ? { originalDate: params.get("original") } : {}),
    ...(kind === "garden" && params.has("zone")
      ? { zoneId: params.get("zone") }
      : {}),
  };
  if (
    !validCard(card) ||
    (params.has("section") && card.kind !== "garden" && card.kind !== "job") ||
    (params.has("original") && card.kind !== "task") ||
    (params.has("zone") && card.kind !== "garden")
  )
    return { route, invalid: true };
  route.cards = [card];
  return { route, invalid };
}
export function address(route: Route): string {
  const p = new URLSearchParams(),
    c = route.cards.at(-1);
  if (c) {
    p.set(c.kind, c.id);
    if ("section" in c && c.section) p.set("section", c.section);
    if (c.kind === "task") p.set("original", c.originalDate);
    if (c.kind === "garden" && c.zoneId) p.set("zone", c.zoneId);
  }
  if (route.calendar) {
    const v = route.calendar;
    p.set("date", v.date);
    p.set("view", v.view);
    if (v.anchor !== v.date) p.set("anchor", v.anchor);
    if (v.gardenId) p.set("gardenFilter", v.gardenId);
    if (v.kind && v.kind !== "all") p.set("kindFilter", v.kind);
    if (v.status && v.status !== "all") p.set("statusFilter", v.status);
  }
  return `#${route.page}${p.size ? `?${p}` : ""}`;
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
