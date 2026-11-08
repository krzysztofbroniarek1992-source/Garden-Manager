import type { Data } from "../domain";
import { isDate } from "../planning/dates";
export const availabilityKinds = {
  available: "Cały dzień dostępny",
  unavailable: "Cały dzień niedostępny",
  until: "Dostępny do godziny",
  from: "Dostępny od godziny",
  range: "Dostępny w przedziale",
} as const;
export const availabilityReasons = {
  "": "Bez powodu",
  pawnshop: "Lombard",
  private: "Prywatne",
  holiday: "Urlop",
  other: "Inne",
} as const;
export type AvailabilityKind = keyof typeof availabilityKinds;
export interface AvailabilityRule {
  kind: AvailabilityKind;
  from: string | null;
  to: string | null;
  reason: keyof typeof availabilityReasons;
  note: string;
}
export interface AvailabilityDay extends AvailabilityRule {
  date: string;
  revision: number;
  updatedAt: number;
}
export interface AvailabilityPermit {
  date: string;
  time: string;
  signature: string;
  accepted: true;
}
export type AvailabilityExpected = { date: string; signature: string }[];
export const timeMinutes = (time: string) =>
  /^([01]\d|2[0-3]):[0-5]\d$/.test(time)
    ? Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
    : null;
export const dayAvailability = (data: Data, date: string) =>
  data.availability?.find((d) => d.date === date);
export const availabilitySignature = (data: Data, date: string) =>
  JSON.stringify(dayAvailability(data, date) ?? null);
export const expectedAvailability = (
  data: Data,
  dates: readonly string[],
): AvailabilityExpected =>
  dates.map((date) => ({ date, signature: availabilitySignature(data, date) }));
export const defaultAvailability = (): AvailabilityRule => ({
  kind: "available",
  from: null,
  to: null,
  reason: "",
  note: "",
});
export function availabilityWindow(rule?: AvailabilityRule): [number, number] {
  if (!rule || rule.kind === "available") return [0, 1440];
  if (rule.kind === "unavailable") return [0, 0];
  return [
    rule.kind === "until" ? 0 : timeMinutes(rule.from!)!,
    rule.kind === "from" ? 1440 : timeMinutes(rule.to!)!,
  ];
}
export function availabilityConflict(
  data: Data,
  date: string,
  time: string,
): AvailabilityDay | null {
  const rule = dayAvailability(data, date),
    minute = timeMinutes(time);
  if (!rule || minute === null) return null;
  const [from, to] = availabilityWindow(rule);
  return minute < from || minute >= to ? rule : null;
}
export function availabilityLabel(rule?: AvailabilityRule, short = false) {
  if (!rule || rule.kind === "available")
    return short ? "Dostępny" : "Cały dzień dostępny";
  if (rule.kind === "unavailable") return "Niedostępny";
  if (rule.kind === "until") return `Dostępny do ${rule.to}`;
  if (rule.kind === "from") return `Dostępny od ${rule.from}`;
  return `Dostępny ${rule.from}–${rule.to}`;
}
export function availabilityMessage(rule: AvailabilityRule) {
  return `${availabilityLabel(rule)}${rule.reason ? ` — ${availabilityReasons[rule.reason]}` : ""}${rule.note ? `. ${rule.note}` : ""}`;
}
export function validateAvailabilityRule(
  value: unknown,
): asserts value is AvailabilityRule {
  const r = value as AvailabilityRule;
  if (
    !r ||
    typeof r !== "object" ||
    !Object.hasOwn(availabilityKinds, r.kind) ||
    !Object.hasOwn(availabilityReasons, r.reason) ||
    typeof r.note !== "string" ||
    r.note.length > 500
  )
    throw new Error(
      "Sprawdź rodzaj dostępności, powód i notatkę (do 500 znaków).",
    );
  const needsFrom = r.kind === "from" || r.kind === "range",
    needsTo = r.kind === "until" || r.kind === "range";
  if (
    (needsFrom
      ? typeof r.from !== "string" || timeMinutes(r.from) === null
      : r.from !== null) ||
    (needsTo
      ? typeof r.to !== "string" || timeMinutes(r.to) === null
      : r.to !== null)
  )
    throw new Error("Podaj poprawne godziny dostępności w danym dniu.");
  if (r.kind !== "unavailable") {
    const [from, to] = availabilityWindow(r);
    if (from >= to)
      throw new Error(
        "Godzina od musi poprzedzać godzinę do. Dla braku dostępności wybierz cały dzień niedostępny.",
      );
  }
}
export function validateAvailability(data: Data) {
  if (data.availability === undefined) return;
  if (
    !Array.isArray(data.availability) ||
    new Set(data.availability.map((d) => d?.date)).size !==
      data.availability.length
  )
    throw new Error(
      "Nieprawidłowa lub powielona dostępność dni. Zachowano oryginalne dane.",
    );
  for (const d of data.availability) {
    validateAvailabilityRule(d);
    if (
      !isDate(d.date) ||
      !Number.isSafeInteger(d.revision) ||
      d.revision < 1 ||
      !Number.isSafeInteger(d.updatedAt) ||
      d.updatedAt < 0 ||
      d.updatedAt > 8640000000000000
    )
      throw new Error(
        "Nieprawidłowa data lub rewizja dostępności. Zachowano oryginalne dane.",
      );
  }
}
export function validateAvailabilityDates(dates: readonly string[]) {
  if (
    !Array.isArray(dates) ||
    !dates.length ||
    dates.length > 366 ||
    !dates.every(isDate) ||
    new Set(dates).size !== dates.length
  )
    throw new Error("Wybierz od 1 do 366 różnych, poprawnych dat.");
}
