import { isDate } from "../planning/dates";

/** UI addresses only. No persisted business data or commands belong here. */
export const pages = [
  "dashboard",
  "field",
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
  "expenses",
] as const;
export type Page = (typeof pages)[number];
export const dialogs = ["menu", "settings", "new-job"] as const;
export type ViewDialog = (typeof dialogs)[number];
export const gardenSections = [
  "overview",
  "zones",
  "jobs",
  "plans",
  "billing",
  "gallery",
  "notes",
] as const;
export const zoneSections = [
  "overview",
  "plans",
  "history",
  "gallery",
  "notes",
] as const;
export type ZoneSection = (typeof zoneSections)[number];
export const financeFilters = [
  "all",
  "completed",
  "outstanding",
  "received",
  "pending",
] as const;
export type FinanceFilter = (typeof financeFilters)[number];
export const jobSections = [
  "summary",
  "work",
  "billing",
  "payments",
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
export const fieldSections = ["work", "photos", "notes", "checklists", "materials"] as const;
export type FieldSection = (typeof fieldSections)[number];
export type Card =
  | { kind: "field"; id: string; section?: FieldSection }
  | { kind: "availability"; id: string; dates?: string[] }
  | { kind: "client"; id: string }
  | { kind: "zone"; id: string; gardenId: string; section?: ZoneSection }
  | { kind: "garden"; id: string; section?: GardenSection; zoneId?: string }
  | {
      kind: "job";
      id: string;
      section?: JobSection;
      initialBilling?: boolean;
      editBilling?: boolean;
    }
  | { kind: "note" | "todo" | "photo" | "checklist" | "payment"; id: string }
  | {
      kind: "finance";
      id: string;
      owner: "client" | "garden";
      filter?: FinanceFilter;
    }
  | { kind: "report"; id: string; reportId?: string }
  | { kind: "schedule"; id: string }
  | { kind: "task"; id: string; originalDate: string; cycle?: number };
export interface Route {
  page: Page;
  cards: Card[];
  calendar?: CalendarState;
  returnLabel?: string;
  dialog?: ViewDialog;
}
export const cardKey = (card: Card) =>
  card.kind === "availability"
    ? `availability:${JSON.stringify(card.dates ?? [card.id])}`
    : card.kind === "zone"
      ? `zone:${JSON.stringify([card.gardenId, card.id])}`
      : card.kind === "finance"
        ? `finance:${JSON.stringify([card.owner, card.id])}`
        : card.kind === "report"
          ? `report:${JSON.stringify([card.id, card.reportId ?? null])}`
          : card.kind === "task"
            ? `task:${JSON.stringify(card.cycle === undefined ? [card.id, card.originalDate] : [card.id, card.originalDate, card.cycle])}`
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
    ((c.kind === "field" && (c.section === undefined || fieldSections.includes(c.section))) || (c.kind === "availability" &&
      isDate(c.id) &&
      (c.dates === undefined ||
        (Array.isArray(c.dates) &&
          c.dates.length > 0 &&
          c.dates.length <= 366 &&
          c.dates[0] === c.id &&
          c.dates.every(
            (d, i) => isDate(d) && (i === 0 || d > c.dates![i - 1]),
          )))) ||
      (c.kind === "zone" &&
        validId(c.gardenId) &&
        (c.section === undefined || zoneSections.includes(c.section))) ||
      c.kind === "client" ||
      c.kind === "payment" ||
      (c.kind === "finance" &&
        (c.owner === "client" || c.owner === "garden") &&
        (c.filter === undefined || financeFilters.includes(c.filter))) ||
      c.kind === "note" ||
      c.kind === "todo" ||
      c.kind === "photo" ||
      c.kind === "checklist" ||
      (c.kind === "report" &&
        (c.reportId === undefined || validId(c.reportId))) ||
      c.kind === "schedule" ||
      (c.kind === "task" &&
        isDate(c.originalDate) &&
        (c.cycle === undefined ||
          (Number.isSafeInteger(c.cycle) && c.cycle > 0))) ||
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
    (r.dialog === undefined ||
      (dialogs.includes(r.dialog) &&
        (r.dialog !== "new-job" ||
          (r.page === "jobs" && r.cards?.length === 0)))) &&
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
  const selected = [
    "field",
    "availability",
    "client",
    "garden",
    "job",
    "schedule",
    "task",
    "note",
    "todo",
    "photo",
    "checklist",
    "report",
    "payment",
    "finance",
    "zone",
  ].filter(
    (kind) => params.has(kind) && (kind !== "zone" || !params.has("garden")),
  );
  const legacy =
    !selected.length && page === "clients"
      ? url.searchParams.get("client")
      : null;
  let invalid = !!rawPage && !pages.includes(rawPage as Page);
  const route: Route = { page, cards: [] };
  if (params.has("dialog")) {
    const dialog = params.get("dialog") as ViewDialog;
    if (
      params.getAll("dialog").length !== 1 ||
      !dialogs.includes(dialog) ||
      (dialog === "new-job" && (page !== "jobs" || selected.length > 0))
    )
      invalid = true;
    else route.dialog = dialog;
  }
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
    params.getAll("reportVersion").length > 1 ||
    params.getAll("cycle").length > 1 ||
    params.getAll("availabilityDates").length > 1 ||
    params.getAll("zone").length > 1 ||
    params.getAll("zoneGarden").length > 1 ||
    params.getAll("owner").length > 1 ||
    params.getAll("financeFilter").length > 1 ||
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
        params.has("availabilityDates") ||
        params.has("original") ||
        params.has("cycle") ||
        params.has("zone") ||
        params.has("reportVersion") ||
        params.has("owner") ||
        params.has("financeFilter") ||
        params.has("zoneGarden"),
    };
  const card: unknown = {
    kind: kind ?? "client",
    id,
    ...(kind === "availability" && params.has("availabilityDates")
      ? { dates: params.get("availabilityDates")!.split(",") }
      : {}),
    ...(params.has("section") ? { section: params.get("section") } : {}),
    ...(kind === "zone" ? { gardenId: params.get("zoneGarden") } : {}),
    ...(kind === "finance"
      ? {
          owner: params.get("owner"),
          ...(params.has("financeFilter")
            ? { filter: params.get("financeFilter") }
            : {}),
        }
      : {}),
    ...(kind === "report" && params.has("reportVersion")
      ? { reportId: params.get("reportVersion") }
      : {}),
    ...(kind === "task"
      ? {
          originalDate: params.get("original"),
          ...(params.has("cycle")
            ? {
                cycle: /^\d+$/.test(params.get("cycle")!)
                  ? Number(params.get("cycle"))
                  : NaN,
              }
            : {}),
        }
      : {}),
    ...(kind === "garden" && params.has("zone")
      ? { zoneId: params.get("zone") }
      : {}),
  };
  if (
    !validCard(card) ||
    (params.has("availabilityDates") && card.kind !== "availability") ||
    (params.has("section") &&
      card.kind !== "field" &&
      card.kind !== "garden" &&
      card.kind !== "job" &&
      card.kind !== "zone") ||
    ((params.has("original") || params.has("cycle")) && card.kind !== "task") ||
    (params.has("zone") && card.kind !== "garden" && card.kind !== "zone") ||
    (params.has("zoneGarden") && card.kind !== "zone") ||
    (params.has("reportVersion") && card.kind !== "report") ||
    ((params.has("owner") || params.has("financeFilter")) &&
      card.kind !== "finance")
  )
    return { route, invalid: true };
  route.cards = [card];
  if (card.kind === "availability" && !route.calendar)
    route.calendar = { date: card.id, anchor: card.id, view: "day" };
  return { route, invalid };
}
export function address(route: Route): string {
  const p = new URLSearchParams(),
    c = route.cards.at(-1);
  if (c) {
    p.set(c.kind, c.id);
    if (c.kind === "availability" && c.dates)
      p.set("availabilityDates", c.dates.join(","));
    if (c.kind === "zone") p.set("zoneGarden", c.gardenId);
    if (c.kind === "finance") {
      p.set("owner", c.owner);
      if (c.filter) p.set("financeFilter", c.filter);
    }
    if ("section" in c && c.section) p.set("section", c.section);
    if (c.kind === "report" && c.reportId) p.set("reportVersion", c.reportId);
    if (c.kind === "task") {
      p.set("original", c.originalDate);
      if (c.cycle !== undefined) p.set("cycle", String(c.cycle));
    }
    if (c.kind === "garden" && c.zoneId) p.set("zone", c.zoneId);
  }
  if (route.dialog) p.set("dialog", route.dialog);
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
  const { dialog: _dialog, ...context } = route;
  return { ...context, cards: cards.slice(-20) };
}
