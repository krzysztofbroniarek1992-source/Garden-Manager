import { useId, useRef, useState, type FormEvent } from "react";
import Modal from "../components/Modal";
import { useGarden } from "../state";
import { useUnsavedChanges } from "../navigation/unsaved";
import { localDate, moneyCents } from "../domain";
import { parseMoney } from "../expenses/csv";
import { priceText, productUrl, quantityMilli, quantityText, shoppingPriorities, shoppingStatuses, shoppingTotal, type ShoppingItem, type ShoppingPrice } from "./model";

function editor(item: ShoppingItem) {
  return { ...structuredClone(item), quantity: quantityText(item.quantityMilli),
    plannedAmount: item.plannedPrice === null ? "" : priceText(item.plannedPrice.amountCents),
    plannedBasis: item.plannedPrice?.basis ?? "unit" as ShoppingPrice["basis"],
    actualAmount: item.actualPrice === null ? "" : priceText(item.actualPrice.amountCents),
    actualBasis: item.actualPrice?.basis ?? "unit" as ShoppingPrice["basis"],
  };
}
function optionalPrice(text: string, basis: ShoppingPrice["basis"]): ShoppingPrice | null {
  if (!text.trim()) return null;
  const amountCents = parseMoney(text, text.includes(",") ? "," : ".");
  if (amountCents < 0) throw Error("Cena zakupu nie może być ujemna.");
  return { amountCents, basis };
}
export default function ShoppingForm({ initial, onClose }: { initial: ShoppingItem; onClose: () => void }) {
  const { data, saveShoppingItem } = useGarden();
  const [original] = useState(() => editor(initial));
  const [existing] = useState(() => data.shoppingItems.some(p => p.id === initial.id));
  const [draft, setDraft] = useState(() => editor(initial));
  const [error, setError] = useState("");
  const guard = useUnsavedChanges(JSON.stringify(draft) !== JSON.stringify(original));
  const busy = useRef(false), listId = useId();
  const patch = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) => setDraft(d => ({ ...d, [key]: value }));
  let total: number | null = null;
  try { total = shoppingTotal(optionalPrice(draft.plannedAmount, draft.plannedBasis), quantityMilli(draft.quantity)); } catch { /* Submit shows an actionable error and keeps the raw inputs. */ }
  async function submit(e: FormEvent) {
    e.preventDefault(); e.stopPropagation();
    if (busy.current) return; busy.current = true;
    try {
      if (!productUrl(draft.url.trim())) throw Error("Link musi być pełnym adresem http lub https, bez loginu i hasła.");
      const value: ShoppingItem = {
        ...initial, name: draft.name, unit: draft.unit, category: draft.category, status: draft.status,
        priority: draft.priority, vendor: draft.vendor, url: draft.url, notes: draft.notes, jobId: draft.jobId,
        quantityMilli: quantityMilli(draft.quantity),
        plannedPrice: optionalPrice(draft.plannedAmount, draft.plannedBasis),
        actualPrice: optionalPrice(draft.actualAmount, draft.actualBasis),
        purchasedOn: draft.status === "purchased" ? draft.purchasedOn ?? localDate() : null,
      };
      await guard.save(async () => {
        await saveShoppingItem(value, existing ? original.revision : null);
        onClose();
      });
    } catch (e) { setError((e as Error).message); } finally { busy.current = false; }
  }
  return <Modal title={existing ? "Edytuj zakup" : "Nowy zakup firmowy"} onClose={onClose}>
    <form ref={guard.ref} onSubmit={submit}>
      <p className="gm-form-note">Wyłącznie zakupy BRONIAREK OGRODY. Zapis pozycji ani status Kupione nie tworzą wydatku.</p>
      {error && <p role="alert" className="gm-form-error">{error}</p>}
      <div className="form-grid">
        <label className="field full-width">Nazwa produktu<input required maxLength={200} value={draft.name} onChange={e => patch("name", e.target.value)}/></label>
        <label className="field">Ilość<input required inputMode="decimal" maxLength={14} value={draft.quantity} onChange={e => patch("quantity", e.target.value)}/></label>
        <label className="field">Jednostka<input required maxLength={40} value={draft.unit} list={listId + "-units"} onChange={e => patch("unit", e.target.value)}/></label>
        <datalist id={listId + "-units"}>{["szt.", "opak.", "kg", "l", "m", "m²", "m³"].map(u => <option key={u}>{u}</option>)}</datalist>
        <label className="field">Kategoria zakupów<input required maxLength={100} value={draft.category} list={listId + "-categories"} onChange={e => patch("category", e.target.value)}/></label>
        <datalist id={listId + "-categories"}>{[...new Set(["Inne", ...data.expenseCategories.map(c => c.name), ...data.shoppingItems.map(p => p.category)])].map(c => <option key={c}>{c}</option>)}</datalist>
        <label className="field">Priorytet<select value={draft.priority} onChange={e => patch("priority", e.target.value as ShoppingItem["priority"])}>{Object.entries(shoppingPriorities).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="field">Status zakupu<select value={draft.status} disabled={!!original.expenseId} onChange={e => setDraft(d => ({ ...d, status: e.target.value as ShoppingItem["status"], purchasedOn: e.target.value === "purchased" ? d.purchasedOn ?? localDate() : null }))}>{Object.entries(shoppingStatuses).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        {draft.status === "purchased" && <label className="field">Data zakupu<input required type="date" value={draft.purchasedOn ?? ""} onChange={e => patch("purchasedOn", e.target.value)}/></label>}
        <fieldset className="shopping-price"><legend>Planowana cena</legend>
          <label className="field">Planowana cena (zł)<input inputMode="decimal" maxLength={24} value={draft.plannedAmount} onChange={e => patch("plannedAmount", e.target.value)}/></label>
          <label className="field">Sposób podania planowanej ceny<select value={draft.plannedBasis} onChange={e => patch("plannedBasis", e.target.value as ShoppingPrice["basis"])}><option value="unit">Cena jednostkowa</option><option value="total">Cena łączna całej pozycji</option></select></label>
        </fieldset>
        <fieldset className="shopping-price"><legend>Faktyczna cena zakupu</legend>
          <label className="field">Faktyczna cena zakupu (zł)<input inputMode="decimal" maxLength={24} value={draft.actualAmount} onChange={e => patch("actualAmount", e.target.value)}/></label>
          <label className="field">Sposób podania faktycznej ceny<select value={draft.actualBasis} onChange={e => patch("actualBasis", e.target.value as ShoppingPrice["basis"])}><option value="unit">Cena jednostkowa</option><option value="total">Cena łączna całej pozycji</option></select></label>
        </fieldset>
        <label className="field full-width">Sklep lub sprzedawca<input maxLength={300} value={draft.vendor} onChange={e => patch("vendor", e.target.value)}/></label>
        <label className="field full-width">Link do produktu<input type="url" maxLength={2048} placeholder="https://…" value={draft.url} onChange={e => patch("url", e.target.value)}/></label>
        <label className="field full-width">Powiązane zlecenie<select value={draft.jobId ?? ""} onChange={e => patch("jobId", e.target.value || null)}>
          <option value="">Bez powiązania</option>
          {draft.jobId && !data.jobs.some(j => j.id === draft.jobId) && <option value={draft.jobId}>{draft.jobTitle || "Zlecenie"} (usunięte)</option>}
          {data.jobs.map(j => <option key={j.id} value={j.id}>{j.title} · {j.date}</option>)}
        </select></label>
        <label className="field full-width">Notatki<textarea aria-label="Notatki" maxLength={3000} value={draft.notes} onChange={e => patch("notes", e.target.value)}/></label>
      </div>
      <p>Planowana wartość pozycji: {total === null ? "bez poprawnie podanej ceny" : moneyCents(total)}.</p>
      {original.expenseId && <p className="gm-form-note">Zmiany pozycji nie zmieniają powiązanego wydatku. Kolejny zakup dodaj przyciskiem Ponów zakup.</p>}
      <div className="gm-modal-actions"><button type="button" className="button secondary" onClick={() => guard.confirm(onClose)}>Anuluj</button><button className="button primary" type="submit">Zapisz zakup</button></div>
    </form>
  </Modal>;
}
