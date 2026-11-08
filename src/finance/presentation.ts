import type { Payment } from "../domain";
export const methodLabels: Record<Payment["method"], string> = {
  cash: "Gotówka",
  transfer: "Przelew",
  blik: "BLIK",
  other: "Inne",
};
export const displayDate = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString("pl-PL");
