import { useRef, useState, type FormEvent } from "react";
import Modal from "../components/Modal";
import { useGarden } from "../state";
import { useUnsavedChanges } from "../navigation/unsaved";
import { localDate, moneyCents } from "../domain";
import { parseMoney } from "./csv";
import { otherCategory, type Expense } from "./model";
const amountText = (cents: number) =>
  cents
    ? `${BigInt(cents) / 100n},${String(BigInt(cents) % 100n).padStart(2, "0")}`
    : "";
export const newExpense = (): Expense => ({
  id: crypto.randomUUID(),
  revision: 1,
  createdAt: 0,
  updatedAt: 0,
  date: localDate(),
  amountCents: 0,
  direction: "outgoing",
  counterparty: "",
  description: "",
  categoryId: otherCategory,
  source: "manual",
  origin: null,
  status: "approved",
  note: "",
  history: [],
});
export default function ExpenseForm({
  initial,
  onClose,
}: {
  initial: Expense;
  onClose: () => void;
}) {
  const { data, saveExpense } = useGarden();
  const [original] = useState(
    () => data.expenses.find((e) => e.id === initial.id) ?? null,
  );
  const [draft, setDraft] = useState(initial),
    [amount, setAmount] = useState(amountText(initial.amountCents)),
    [error, setError] = useState("");
  const busy = useRef(false);
  const guard = useUnsavedChanges(
    JSON.stringify(draft) !== JSON.stringify(initial) ||
      amount !== amountText(initial.amountCents),
  );
  const patch = <K extends keyof Expense>(key: K, value: Expense[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));
  async function submit(e: FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy.current) return;
    busy.current = true;
    try {
      const amountCents = parseMoney(amount, amount.includes(",") ? "," : ".");
      if (amountCents <= 0) throw new Error("Podaj dodatnią kwotę wydatku.");
      await guard.save(async () => {
        await saveExpense({ ...draft, amountCents }, original);
        onClose();
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      busy.current = false;
    }
  }
  return (
    <Modal
      title={original ? "Edytuj wydatek" : "Nowy wydatek"}
      onClose={onClose}
    >
      <form ref={guard.ref} onSubmit={submit}>
        {error && (
          <p role="alert" className="gm-form-error">
            {error}
          </p>
        )}
        <div className="form-grid">
          <label className="field">
            Data wydatku
            <input
              required
              type="date"
              value={draft.date}
              onChange={(e) => patch("date", e.target.value)}
            />
          </label>
          <label className="field">
            Kwota (zł)
            <input
              required
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              maxLength={24}
            />
          </label>
          <label className="field full-width">
            Kontrahent
            <input
              maxLength={300}
              value={draft.counterparty}
              onChange={(e) => patch("counterparty", e.target.value)}
            />
          </label>
          <label className="field full-width">
            Opis wydatku
            <textarea
              maxLength={2000}
              value={draft.description}
              onChange={(e) => patch("description", e.target.value)}
            />
          </label>
          <label className="field">
            Kategoria
            <select
              value={draft.categoryId}
              onChange={(e) => patch("categoryId", e.target.value)}
            >
              {data.expenseCategories
                .filter((c) => !c.archived || c.id === draft.categoryId)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.archived ? " (archiwalna)" : ""}
                  </option>
                ))}
            </select>
          </label>
          <label className="field">
            Status wydatku
            <select
              value={draft.status}
              disabled={draft.direction === "incoming"}
              onChange={(e) =>
                patch("status", e.target.value as Expense["status"])
              }
            >
              <option value="approved">Zatwierdzony koszt</option>
              <option value="excluded">Wyłączony z kosztów</option>
            </select>
          </label>
          <label className="field full-width">
            Notatka / powód decyzji
            <textarea
              maxLength={3000}
              value={draft.note}
              onChange={(e) => patch("note", e.target.value)}
            />
          </label>
        </div>
        {draft.origin && (
          <p className="gm-form-note">
            Źródło: CSV ·{" "}
            {
              data.expenseProfiles.find((p) => p.id === draft.origin?.profileId)
                ?.name
            }{" "}
            · wiersz {draft.origin.line}
            {draft.origin.transactionId &&
              ` · ID ${draft.origin.transactionId}`}
            . Edycja nie zmienia tożsamości operacji bankowej. Wpływy pozostają
            poza kosztami i płatnościami zleceń.
          </p>
        )}
        {original && (
          <details>
            <summary>Historia zmian ({draft.history.length})</summary>
            <ul>
              {draft.history
                .slice()
                .reverse()
                .map((h, i) => (
                  <li key={i}>
                    {new Date(h.at).toLocaleString("pl-PL")} ·{" "}
                    {h.status === "approved" ? "Koszt" : "Wyłączony"} ·{" "}
                    {moneyCents(h.amountCents)} · {h.reason}
                  </li>
                ))}
            </ul>
          </details>
        )}
        <p className="gm-form-note">
          Rejestr pomocniczy firmy — nie jest księgowością podatkową. Wyłącz
          prywatne zakupy, wypłaty gotówki, przelewy własne i spłaty kredytów.
          Historia pozostaje zachowana.
        </p>
        <div className="gm-modal-actions">
          <button
            type="button"
            className="button secondary"
            onClick={() => guard.confirm(onClose)}
          >
            Anuluj
          </button>
          <button className="button primary" type="submit">
            Zapisz wydatek
          </button>
        </div>
      </form>
    </Modal>
  );
}
