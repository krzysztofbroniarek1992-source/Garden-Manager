import type { Page } from "./routes";
const labels: Record<Page, string> = {
  field: "Wróć do trybu terenowego",
  dashboard: "Wróć do pulpitu",
  clients: "Wróć do klientów",
  gardens: "Wróć do listy ogrodów",
  jobs: "Wróć do zleceń",
  history: "Wróć do historii prac",
  calendar: "Wróć do kalendarza",
  materials: "Wróć do materiałów",
  calculators: "Wróć do kalkulatorów",
  notes: "Wróć do notatek",
  todos: "Wróć do listy spraw",
  expenses: "Wróć do wydatków firmowych",
  templates: "Wróć do listy checklist",
};
export const pageReturnLabel = (page: Page) => labels[page];
