import { useRef, useState, type FormEvent } from "react";
import Modal from "../components/Modal";
import { useGarden } from "../state";
import { useUnsavedChanges } from "../navigation/unsaved";
import { otherCategory, type ExpenseCategory, type ExpenseRule } from "./model";
type Item = ExpenseCategory | ExpenseRule;
export default function ExpenseSettings() {
  const { data } = useGarden();
  const [edit, setEdit] = useState<{
    kind: "category" | "rule";
    value: Item;
  } | null>(null);
  const stamp = () => ({
    id: crypto.randomUUID(),
    revision: 1,
    createdAt: 0,
    updatedAt: 0,
  });
  return (
    <div className="expense-settings">
      <section className="card">
        <div className="expense-row">
          <h2>Kategorie kosztów</h2>
          <button
            className="button secondary"
            onClick={() =>
              setEdit({
                kind: "category",
                value: { ...stamp(), name: "", archived: false },
              })
            }
          >
            Dodaj kategorię
          </button>
        </div>
        <ul className="expense-settings-list">
          {data.expenseCategories.map((c) => (
            <li key={c.id}>
              <span>
                {c.name}
                {c.archived ? " · archiwalna" : ""}
              </span>
              <button
                className="button secondary"
                aria-label={`Edytuj kategorię ${c.name}`}
                onClick={() => setEdit({ kind: "category", value: c })}
              >
                Edytuj
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section className="card">
        <div className="expense-row">
          <h2>Reguły podpowiedzi</h2>
          <button
            className="button secondary"
            onClick={() =>
              setEdit({
                kind: "rule",
                value: {
                  ...stamp(),
                  name: "",
                  field: "any",
                  pattern: "",
                  categoryId: otherCategory,
                  action: "category",
                  enabled: true,
                  priority: 100,
                },
              })
            }
          >
            Dodaj regułę
          </button>
        </div>
        <p className="muted">
          Zwykły fragment tekstu, bez rozróżniania wielkości liter. Pierwsza
          aktywna reguła według kolejności wygrywa. Podpowiedzi wymagają
          weryfikacji przed importem.
        </p>
        <ul className="expense-settings-list">
          {[...data.expenseRules]
            .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
            .map((r) => (
              <li key={r.id}>
                <span>
                  <strong>{r.name}</strong> · „{r.pattern}” ·{" "}
                  {r.action === "exclude"
                    ? "wyłączenie"
                    : data.expenseCategories.find((c) => c.id === r.categoryId)
                        ?.name}{" "}
                  · kolejność {r.priority}
                  {!r.enabled ? " · wyłączona" : ""}
                </span>
                <button
                  className="button secondary"
                  aria-label={`Edytuj regułę ${r.name}`}
                  onClick={() => setEdit({ kind: "rule", value: r })}
                >
                  Edytuj
                </button>
              </li>
            ))}
        </ul>
      </section>
      {edit && (
        <SettingForm
          kind={edit.kind}
          initial={edit.value}
          onClose={() => setEdit(null)}
        />
      )}
    </div>
  );
}
function SettingForm({
  kind,
  initial,
  onClose,
}: {
  kind: "category" | "rule";
  initial: Item;
  onClose: () => void;
}) {
  const { data, saveExpenseCategory, saveExpenseRule } = useGarden();
  const [draft, setDraft] = useState(initial),
    [error, setError] = useState("");
  const busy = useRef(false);
  const guard = useUnsavedChanges(
    JSON.stringify(initial) !== JSON.stringify(draft),
  );
  const patch = (value: Partial<Item>) => setDraft((d) => ({ ...d, ...value }));
  const rule = draft as ExpenseRule;
  async function submit(e: FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy.current) return;
    busy.current = true;
    try {
      await guard.save(async () => {
        if (kind === "category")
          await saveExpenseCategory(
            draft as ExpenseCategory,
            data.expenseCategories.some((c) => c.id === initial.id)
              ? (initial as ExpenseCategory)
              : null,
          );
        else
          await saveExpenseRule(
            rule,
            data.expenseRules.some((r) => r.id === initial.id)
              ? (initial as ExpenseRule)
              : null,
          );
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
      title={kind === "category" ? "Kategoria kosztów" : "Reguła podpowiedzi"}
      onClose={onClose}
    >
      <form ref={guard.ref} onSubmit={submit}>
        {error && (
          <p role="alert" className="gm-form-error">
            {error}
          </p>
        )}
        <div className="form-grid">
          <label className="field full-width">
            Nazwa
            <input
              required
              maxLength={100}
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
            />
          </label>
          {kind === "category" ? (
            <label className="field">
              <span>
                <input
                  type="checkbox"
                  checked={(draft as ExpenseCategory).archived}
                  onChange={(e) => patch({ archived: e.target.checked })}
                />{" "}
                Kategoria archiwalna
              </span>
            </label>
          ) : (
            <>
              <label className="field">
                Szukany fragment
                <input
                  required
                  minLength={2}
                  maxLength={200}
                  value={rule.pattern}
                  onChange={(e) => patch({ pattern: e.target.value })}
                />
              </label>
              <label className="field">
                Pole
                <select
                  value={rule.field}
                  onChange={(e) =>
                    patch({ field: e.target.value as ExpenseRule["field"] })
                  }
                >
                  <option value="any">Kontrahent i opis</option>
                  <option value="counterparty">Kontrahent</option>
                  <option value="description">Opis</option>
                </select>
              </label>
              <label className="field">
                Propozycja
                <select
                  value={rule.action}
                  onChange={(e) =>
                    patch({ action: e.target.value as ExpenseRule["action"] })
                  }
                >
                  <option value="category">Kategoria</option>
                  <option value="exclude">Wyłącz z kosztów</option>
                </select>
              </label>
              <label className="field">
                Kategoria
                <select
                  value={rule.categoryId}
                  onChange={(e) => patch({ categoryId: e.target.value })}
                >
                  {data.expenseCategories
                    .filter((c) => !c.archived || c.id === rule.categoryId)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="field">
                Kolejność (mniejsza najpierw)
                <input
                  type="number"
                  min={0}
                  max={9999}
                  required
                  value={rule.priority}
                  onChange={(e) => patch({ priority: Number(e.target.value) })}
                />
              </label>
              <label className="field">
                <span>
                  <input
                    type="checkbox"
                    checked={rule.enabled}
                    onChange={(e) => patch({ enabled: e.target.checked })}
                  />{" "}
                  Reguła aktywna
                </span>
              </label>
            </>
          )}
        </div>
        <div className="gm-modal-actions">
          <button
            className="button secondary"
            type="button"
            onClick={() => guard.confirm(onClose)}
          >
            Anuluj
          </button>
          <button className="button primary">Zapisz ustawienie</button>
        </div>
      </form>
    </Modal>
  );
}
