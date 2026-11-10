import { useState } from "react";
import { useGarden, useNow } from "../state";
import { useViewState } from "../navigation/Navigation";
import { localDate, moneyCents } from "../domain";
import ExpenseForm, { newExpense } from "./ExpenseForm";
import CsvImport from "./CsvImport";
import ExpenseSettings from "./Settings";
import { companySummary } from "./finance";
import type { Expense } from "./model";
import "./expenses.css";
export default function Expenses() {
  const { data } = useGarden();
  const [tab, setTab] = useViewState("expenses-tab", "register");
  const [query, setQuery] = useViewState("expenses-query", ""),
    [from, setFrom] = useViewState("expenses-from", ""),
    [to, setTo] = useViewState("expenses-to", ""),
    [category, setCategory] = useViewState("expenses-category", ""),
    [status, setStatus] = useViewState("expenses-status", ""),
    [source, setSource] = useViewState("expenses-source", "");
  const [editing, setEditing] = useState<Expense | null>(null),
    [csv, setCsv] = useState(false),
    [limit, setLimit] = useState(50);
  const matches = data.expenses
    .filter(
      (e) =>
        (!from || e.date >= from) &&
        (!to || e.date <= to) &&
        (!category || e.categoryId === category) &&
        (!status || e.status === status) &&
        (!source || e.source === source) &&
        `${e.counterparty} ${e.description} ${e.note}`
          .toLocaleLowerCase("pl")
          .includes(query.toLocaleLowerCase("pl")),
    )
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        b.createdAt - a.createdAt ||
        a.id.localeCompare(b.id),
    );
  return (
    <section className="entities-page expenses-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">KOSZTY I PRZEPŁYWY PIENIĘŻNE</span>
          <h1>Wydatki firmowe</h1>
          <p className="muted">
            Pomocniczy rejestr kosztów firmy. Dane lokalne, dostępne bez
            internetu. To nie jest księgowość podatkowa.
          </p>
        </div>
        <div className="expense-actions">
          <button className="button secondary" onClick={() => setCsv(true)}>
            Importuj CSV
          </button>
          <button
            className="button primary"
            onClick={() => setEditing(newExpense())}
          >
            Dodaj wydatek
          </button>
        </div>
      </div>
      <nav className="expense-tabs" aria-label="Widoki wydatków">
        {[
          ["register", "Rejestr wydatków"],
          ["summary", "Finanse firmy"],
          ["imports", "Historia importów"],
          ["settings", "Kategorie i reguły"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={`button ${tab === id ? "primary" : "secondary"}`}
            aria-current={tab === id ? "page" : undefined}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      {tab === "register" ? (
        <>
          <div className="expense-filters">
            <label className="field">
              Szukaj wydatków
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Kontrahent, opis, notatka"
              />
            </label>
            <label className="field">
              Od dnia
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label className="field">
              Do dnia
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
            <label className="field">
              Kategoria filtra
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="">Wszystkie</option>
                {data.expenseCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Status filtra
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="">Wszystkie</option>
                <option value="approved">Zatwierdzone</option>
                <option value="excluded">Wyłączone</option>
              </select>
            </label>
            <label className="field">
              Źródło filtra
              <select
                value={source}
                onChange={(e) => setSource(e.target.value)}
              >
                <option value="">Wszystkie</option>
                <option value="manual">Ręczne</option>
                <option value="csv">CSV</option>
              </select>
            </label>
          </div>
          <p className="muted">
            Wyników: {matches.length}. Wyłączenie z kosztów zachowuje ślad i
            historię operacji.
          </p>
          {!matches.length && (
            <div className="card empty-state">
              <h2>
                {data.expenses.length
                  ? "Brak pasujących wydatków"
                  : "Rejestr wydatków jest pusty"}
              </h2>
              <p>
                Dodaj rzeczywisty zakup ręcznie lub wczytaj wyciąg CSV i
                zweryfikuj operacje.
              </p>
            </div>
          )}
          <div className="expense-ledger">
            {matches.slice(0, limit).map((e) => (
              <article className="tool-card" key={e.id}>
                <div className="expense-row">
                  <strong>
                    {moneyCents(e.amountCents)}
                    {e.direction === "incoming" ? " · wpływ" : ""}
                  </strong>
                  <span>{e.date}</span>
                </div>
                <h3>{e.counterparty || "Bez kontrahenta"}</h3>
                <p className="preserve-lines">{e.description || "Bez opisu"}</p>
                <p>
                  {
                    data.expenseCategories.find((c) => c.id === e.categoryId)
                      ?.name
                  }{" "}
                  ·{" "}
                  <strong>
                    {e.status === "approved"
                      ? "Zatwierdzony koszt"
                      : "Wyłączony z kosztów"}
                  </strong>{" "}
                  · {e.source === "manual" ? "Ręcznie" : "CSV"}
                </p>
                {e.note && <p className="preserve-lines">{e.note}</p>}
                <button
                  className="button secondary"
                  aria-label={`Edytuj wydatek ${e.counterparty || e.date}`}
                  onClick={() => setEditing(e)}
                >
                  Szczegóły / edytuj
                </button>
              </article>
            ))}
          </div>
          {limit < matches.length && (
            <button
              className="button secondary"
              onClick={() => setLimit((n) => n + 50)}
            >
              Pokaż kolejne 50
            </button>
          )}
        </>
      ) : tab === "summary" ? (
        <CompanyFinance />
      ) : tab === "settings" ? (
        <ExpenseSettings />
      ) : (
        <section>
          <h2>Historia importów CSV</h2>
          {!data.expenseImports.length && (
            <p className="card empty-state">
              Nie wykonano jeszcze importu. Podgląd pliku nie tworzy wpisów w
              rejestrze.
            </p>
          )}
          {data.expenseImports
            .slice()
            .reverse()
            .map((i) => (
              <details className="card expense-audit" key={i.id}>
                <summary>
                  {i.filename} · {i.profileName} ·{" "}
                  {new Date(i.createdAt).toLocaleString("pl-PL")}
                </summary>
                <p>
                  Koszty: {i.approved} · Wyłączone: {i.excluded} · Duplikaty:{" "}
                  {i.duplicates} · Pominięte: {i.skipped} · Błędy: {i.errors}
                </p>
                <p className="muted">
                  Podsumowanie dotyczy chwili importu. Aktualny status
                  znajdziesz w rejestrze.
                </p>
                <div className="expense-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Wiersz</th>
                        <th>Data</th>
                        <th>Kwota</th>
                        <th>Operacja i decyzja</th>
                      </tr>
                    </thead>
                    <tbody>
                      {i.rows.map((r) => (
                        <tr key={r.line}>
                          <td>{r.line}</td>
                          <td>{r.date ?? "—"}</td>
                          <td>
                            {r.signedCents === null
                              ? "—"
                              : moneyCents(r.signedCents)}
                          </td>
                          <td>
                            {r.counterparty} · {r.description}
                            <p>
                              {
                                {
                                  approved: "Koszt",
                                  excluded: "Wyłączona",
                                  duplicate: "Duplikat",
                                  skipped: "Pominięta",
                                  error: "Błąd",
                                }[r.decision]
                              }{" "}
                              · {r.reason}
                            </p>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            ))}
        </section>
      )}
      {editing && (
        <ExpenseForm initial={editing} onClose={() => setEditing(null)} />
      )}{" "}
      {csv && <CsvImport onClose={() => setCsv(false)} />}
    </section>
  );
}
function CompanyFinance() {
  const { data } = useGarden();
  const now = useNow();
  const [period, setPeriod] = useViewState(
      "expense-summary-period",
      localDate().slice(0, 7),
    ),
    [mode, setMode] = useViewState("expense-summary-mode", "month");
  const [error, setError] = useState("");
  const prefix = mode === "year" ? period.slice(0, 4) : period;
  let summary;
  try {
    summary = companySummary(data, prefix, now);
  } catch (e) {
    return <p role="alert">{(e as Error).message}</p>;
  }
  const trends = Array.from({ length: 12 }, (_, i) => {
    const month = `${period.slice(0, 4)}-${String(i + 1).padStart(2, "0")}`;
    try {
      return { month, ...companySummary(data, month, now) };
    } catch {
      return { month, received: 0, costs: 0, cash: 0 };
    }
  });
  return (
    <section>
      <h2>Finanse firmy</h2>
      <div className="expense-filters">
        <label className="field">
          Okres podsumowania
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="month">Miesiąc</option>
            <option value="year">Rok</option>
          </select>
        </label>
        <label className="field">
          Miesiąc / rok
          <input
            type="month"
            required
            value={period}
            onChange={(e) => {
              if (/^\d{4}-\d{2}$/.test(e.target.value)) {
                setPeriod(e.target.value);
                setError("");
              } else setError("Wybierz miesiąc.");
            }}
          />
        </label>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="expense-metrics">
        {[
          ["Wartość zleceń w okresie", summary.value],
          ["W tym zatwierdzone rozliczenia", summary.approvedValue],
          ["Pozostałe należności zatwierdzonych zleceń", summary.outstanding],
          ["Faktycznie otrzymane płatności", summary.received],
          ["Zatwierdzone wydatki firmy", summary.costs],
          ["Wynik gotówkowy", summary.cash],
        ].map(([label, value]) => (
          <article className="card" key={label}>
            <h3>{label}</h3>
            <strong>{moneyCents(value as number)}</strong>
          </article>
        ))}
      </div>
      <p className="gm-form-note">
        Wartość i należności według daty zlecenia; należności uwzględniają
        wszystkie jego płatności. Niezatwierdzone wyceny mogą się zmieniać,
        także ze stoperem. Wpłaty według daty otrzymania, wydatki według daty
        operacji. Wynik gotówkowy = otrzymane płatności minus zatwierdzone
        wydatki. Wpływy z CSV nie są przychodem. Materiały doliczane klientom
        nie są ponownie liczone jako zakup. To nie jest dochód podatkowy.
      </p>
      <h3>Koszty według kategorii</h3>
      {summary.categories.length ? (
        <ul className="expense-settings-list card">
          {summary.categories.map((c) => (
            <li key={c.id}>
              <span>{c.name}</span>
              <strong>{moneyCents(c.total)}</strong>
            </li>
          ))}
        </ul>
      ) : (
        <p>Brak zatwierdzonych kosztów w tym okresie.</p>
      )}
      <h3>Przepływy miesięczne — {period.slice(0, 4)}</h3>
      <div className="expense-scroll">
        <table>
          <thead>
            <tr>
              <th>Miesiąc</th>
              <th>Otrzymane płatności</th>
              <th>Wydatki</th>
              <th>Wynik gotówkowy</th>
            </tr>
          </thead>
          <tbody>
            {trends.map((t) => (
              <tr key={t.month}>
                <td>{t.month}</td>
                <td>{moneyCents(t.received)}</td>
                <td>{moneyCents(t.costs)}</td>
                <td>{moneyCents(t.cash)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
