import { useRef, useState, type FormEvent } from "react";
import { useGarden } from "../state";
import { useNavigation, useViewState } from "../navigation/Navigation";
import { useUnsavedChanges } from "../navigation/unsaved";
import Modal from "../components/Modal";
import ExpenseForm, { newExpense } from "../expenses/ExpenseForm";
import { localDate, moneyCents, sumCents } from "../domain";
import type { Expense } from "../expenses/model";
import { otherCategory } from "../expenses/model";
import ShoppingForm from "./ShoppingForm";
import { newShoppingItem, quantityText, shoppingPriorities, shoppingStatuses, shoppingTotal, type ShoppingItem } from "./model";
import "./shopping.css";

export default function Shopping() {
  const api = useGarden(), { data } = api, navigation = useNavigation();
  const [archive, setArchive] = useViewState("shopping-archive", false);
  const [query, setQuery] = useViewState("shopping-query", "");
  const [status, setStatus] = useViewState("shopping-status", "");
  const [category, setCategory] = useViewState("shopping-category", "");
  const [priority, setPriority] = useViewState("shopping-priority", "");
  const [sort, setSort] = useViewState("shopping-sort", "priority");
  const [quick, setQuick] = useState(""), [editing, setEditing] = useState<ShoppingItem | null>(null);
  const [bulk, setBulk] = useState(false);
  const [expense, setExpense] = useState<{ item: ShoppingItem; draft: Expense } | null>(null);
  const [existingExpense, setExistingExpense] = useState<Expense | null>(null), [linking, setLinking] = useState<ShoppingItem | null>(null);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false), [limit, setLimit] = useState(50);
  const inFlight = useRef(false), quickGuard = useUnsavedChanges(!!quick.trim());
  const active = data.shoppingItems.filter(p => p.deletedAt === null), chosenStatus = archive ? "purchased" : status;
  const list = active.filter(p => (p.archivedAt !== null) === archive &&
    (!chosenStatus || p.status === chosenStatus) && (!category || p.category === category) &&
    (!priority || p.priority === priority) && p.name.toLocaleLowerCase("pl").includes(query.normalize("NFC").toLocaleLowerCase("pl")));
  const ranks = { urgent: 0, bargain: 1, normal: 2 };
  list.sort((a, b) => (sort === "name" ? a.name.localeCompare(b.name, "pl") :
    sort === "date" ? b.createdAt - a.createdAt : ranks[a.priority] - ranks[b.priority] || b.createdAt - a.createdAt) || a.id.localeCompare(b.id));
  const planned = active.filter(p => p.status !== "purchased" && p.archivedAt === null && p.plannedPrice !== null);
  let plannedText = "";
  try { plannedText = moneyCents(sumCents(planned.map(p => shoppingTotal(p.plannedPrice, p.quantityMilli)!))); }
  catch { plannedText = "Suma przekracza obsługiwany zakres — sprawdź ceny."; }
  async function perform(action: () => Promise<unknown>, message = "Zapisano zmianę.") {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try { await action(); setNotice(message); } catch (e) { setError((e as Error).message); }
    finally { inFlight.current = false; setBusy(false); }
  }
  function prepareExpense(p: ShoppingItem) {
    const total = shoppingTotal(p.actualPrice, p.quantityMilli);
    const categoryId = data.expenseCategories.find(c => !c.archived && c.name === p.category)?.id ??
      data.expenseCategories.find(c => !c.archived && c.id === otherCategory)?.id ?? data.expenseCategories.find(c => !c.archived)!.id;
    setExpense({ item: p, draft: { ...newExpense(), date: p.purchasedOn ?? localDate(), amountCents: total ?? 0,
      counterparty: p.vendor, description: p.name, categoryId, note: p.notes } });
  }
  return <section className="entities-page shopping-page">
    <div className="page-heading"><div><span className="eyebrow">BRONIAREK OGRODY</span><h1>Lista zakupów</h1>
      <p className="muted">Wyłącznie zakupy firmowe. Lista planów, bez stanów magazynowych i bez automatycznego tworzenia kosztów.</p></div>
      <div className="shopping-actions"><button className="button secondary" onClick={() => setBulk(true)}>Dodaj wiele produktów</button><button className="button primary" onClick={() => setEditing(newShoppingItem())}>Dodaj zakup</button></div>
    </div>
    <form ref={quickGuard.ref} className="shopping-quick" onSubmit={e => {
      e.preventDefault(); void perform(() => quickGuard.save(async () => {
        await api.addShoppingBatch([newShoppingItem(quick)]); setQuick("");
      }), "Dodano produkt do listy.");
    }}>
      <label className="field">Szybko dodaj produkt<input required maxLength={200} value={quick} onChange={e => setQuick(e.target.value)} placeholder="Nazwa produktu firmowego"/></label>
      <button className="button primary" disabled={busy}>Dodaj produkt</button>
    </form>
    <p className="shopping-summary" role="status">Planowane wydatki: <strong>{plannedText}</strong> · {planned.length} pozycji z ceną.
      {" "}Bez ceny: {active.filter(p => p.status !== "purchased" && p.archivedAt === null && p.plannedPrice === null).length}.
      {" "}Podsumowanie obejmuje Do kupienia i Zamówione, niezależnie od filtrów.
    </p>
    <nav className="shopping-actions" aria-label="Widoki zakupów">
      <button className={"button " + (!archive ? "primary" : "secondary")} onClick={() => { setArchive(false); setLimit(50); }}>Bieżąca lista</button>
      <button className={"button " + (archive ? "primary" : "secondary")} onClick={() => { setArchive(true); setLimit(50); }}>Archiwum kupionych</button>
    </nav>
    <div className="shopping-filters">
      <label className="field">Szukaj produktu<input type="search" value={query} onChange={e => setQuery(e.target.value)}/></label>
      <label className="field">Status zakupów<select value={chosenStatus} disabled={archive} onChange={e => setStatus(e.target.value)}><option value="">Wszystkie statusy</option>{Object.entries(shoppingStatuses).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label className="field">Kategoria filtra zakupów<select value={category} onChange={e => setCategory(e.target.value)}><option value="">Wszystkie kategorie</option>{[...new Set(active.map(p => p.category))].sort((a, b) => a.localeCompare(b, "pl")).map(c => <option key={c}>{c}</option>)}</select></label>
      <label className="field">Priorytet zakupów<select value={priority} onChange={e => setPriority(e.target.value)}><option value="">Wszystkie priorytety</option>{Object.entries(shoppingPriorities).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label className="field">Sortowanie zakupów<select value={sort} onChange={e => setSort(e.target.value)}><option value="priority">Priorytet</option><option value="date">Najnowsze</option><option value="name">Nazwa A–Z</option></select></label>
    </div>
    {error && <p role="alert" className="gm-form-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    <p className="muted">Pozycji: {list.length}. Zamówione pozostają na liście aż do odebrania.</p>
    {!list.length && <div className="card empty-state"><h2>Brak produktów w tym widoku</h2><p>Dodaj produkt lub zmień filtry.</p></div>}
    <div className="shopping-list">{list.slice(0, limit).map(p => {
      const linked = data.expenses.find(e => e.id === p.expenseId), job = data.jobs.find(j => j.id === p.jobId);
      const total = shoppingTotal(p.plannedPrice, p.quantityMilli), actual = shoppingTotal(p.actualPrice, p.quantityMilli);
      return <article className="tool-card shopping-item" key={p.id} aria-label={"Zakup: " + p.name}>
        <div className="shopping-item-head"><h2>{p.name}</h2><span className={"badge " + (p.priority === "urgent" ? "badge-orange" : "badge-green")}>{shoppingPriorities[p.priority]}</span></div>
        <p>{quantityText(p.quantityMilli)} {p.unit} · {p.category} · <strong>{shoppingStatuses[p.status]}</strong></p>
        <dl className="shopping-prices"><dt>Planowana</dt><dd>{p.plannedPrice ? moneyCents(p.plannedPrice.amountCents) + (p.plannedPrice.basis === "unit" ? " / " + p.unit : " za całość") + " · łącznie " + moneyCents(total!) : "Nie podano"}</dd>
          <dt>Faktyczna</dt><dd>{p.actualPrice ? moneyCents(p.actualPrice.amountCents) + (p.actualPrice.basis === "unit" ? " / " + p.unit : " za całość") + " · łącznie " + moneyCents(actual!) : "Nie podano"}</dd></dl>
        {p.vendor && <p>Sklep: {p.vendor}</p>}
        {p.url && <p className="shopping-url">Link: <span>{p.url}</span>{" "}<button className="text-button" onClick={() => {
          void perform(async () => { await navigator.clipboard.writeText(p.url); }, "Skopiowano link do produktu.");
        }}>Kopiuj link</button></p>}
        {p.notes && <p className="preserve-lines">{p.notes}</p>}
        {p.jobId && (job ? <button className="text-button" onClick={() => navigation.open({ kind: "job", id: job.id })}>Otwórz zlecenie: {job.title}</button> : <p>{p.jobTitle || "Zlecenie"} — zlecenie usunięte.</p>)}
        <p className="muted">Utworzono: {new Date(p.createdAt).toLocaleString("pl-PL")} · Zmieniono: {new Date(p.updatedAt).toLocaleString("pl-PL")}{p.purchasedOn && " · Zakup: " + p.purchasedOn}</p>
        {linked && <p className="shopping-linked">Powiązany wydatek: {moneyCents(linked.amountCents)} · {linked.date} · {linked.source === "csv" ? "CSV" : "Ręczny"}{linked.status === "excluded" ? " · wyłączony z kosztów" : ""}{" "}
          <button className="text-button" onClick={() => setExistingExpense(linked)}>Otwórz powiązany wydatek</button></p>}
        <div className="shopping-actions">
          <button className="button secondary" disabled={busy} onClick={() => setEditing(p)}>Edytuj zakup</button>
          {p.archivedAt === null && p.status === "needed" && <button className="button secondary" disabled={busy} onClick={() => { void perform(() => api.shoppingAction(p.id, p.revision, "ordered")); }}>Oznacz jako zamówione</button>}
          {p.archivedAt === null && p.status !== "purchased" && <button className="button primary" disabled={busy} onClick={() => { void perform(() => api.shoppingAction(p.id, p.revision, "purchased")); }}>{p.status === "ordered" ? "Odebrano — kupione" : "Oznacz jako kupione"}</button>}
          {p.status === "purchased" && <>
            <button className="button secondary" disabled={busy} onClick={() => { void perform(() => api.repeatShopping(p.id, p.revision, crypto.randomUUID()), "Nowa pozycja jest na bieżącej liście. Historia zakupu pozostała zachowana."); }}>Ponów zakup</button>
            <button className="button secondary" disabled={busy} onClick={() => { void perform(() => api.shoppingAction(p.id, p.revision, p.archivedAt !== null ? "restore" : "archive")); }}>{p.archivedAt !== null ? "Przywróć z archiwum" : "Archiwizuj zakup"}</button>
            {!p.expenseId && <><button className="button primary" disabled={busy} onClick={() => prepareExpense(p)}>Dodaj do wydatków firmowych</button><button className="button secondary" disabled={busy} onClick={() => setLinking(p)}>Powiąż istniejący wydatek</button></>}
          </>}
          <button className="button ghost" disabled={busy} onClick={() => {
            if (window.confirm("Usunąć „" + p.name + "” z listy zakupów?" + (p.expenseId ? " Powiązany wydatek pozostanie w rejestrze." : "")))
              void perform(() => api.shoppingAction(p.id, p.revision, "delete"));
          }}>Usuń zakup</button>
        </div>
      </article>;
    })}</div>
    {list.length > limit && <button className="button secondary" onClick={() => setLimit(n => n + 50)}>Pokaż kolejne produkty</button>}
    {editing && <ShoppingForm key={editing.id} initial={editing} onClose={() => setEditing(null)}/>}
    {bulk && <BulkShopping onClose={() => setBulk(false)}/>}
    {expense && <ExpenseForm initial={expense.draft} title="Dodaj zakup do wydatków firmowych"
      introduction="Sprawdź i potwierdź faktyczną łączną kwotę, datę oraz kategorię. Dopiero Zapisz wydatek utworzy jeden koszt i powiąże go z zakupem. Jeśli koszt jest już w CSV lub rejestrze, anuluj i użyj Powiąż istniejący wydatek."
      onClose={() => setExpense(null)} onSave={async value => { await api.createShoppingExpense(expense.item.id, expense.item.revision, value); }}/>}
    {existingExpense && <ExpenseForm initial={existingExpense} onClose={() => setExistingExpense(null)}/>}
    {linking && <LinkExpense item={linking} onClose={() => setLinking(null)}/>}
  </section>;
}
function BulkShopping({ onClose }: { onClose: () => void }) {
  const { addShoppingBatch } = useGarden(), [names, setNames] = useState(""), [error, setError] = useState("");
  const guard = useUnsavedChanges(!!names.trim()), busy = useRef(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); if (busy.current) return; busy.current = true;
    try { const rows = names.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      await guard.save(async () => { await addShoppingBatch(rows.map(newShoppingItem)); onClose(); });
    } catch (e) { setError((e as Error).message); } finally { busy.current = false; }
  }
  return <Modal title="Dodaj wiele produktów" onClose={onClose}><form ref={guard.ref} onSubmit={submit}>
    <p>Po jednej nazwie w wierszu, do 100 pozycji. Każdy wiersz to osobny produkt: domyślnie 1 szt., Do kupienia, bez ceny.</p>
    {error && <p role="alert" className="gm-form-error">{error}</p>}
    <label className="field">Nazwy produktów<textarea required maxLength={20100} rows={8} value={names} onChange={e => setNames(e.target.value)}/></label>
    <div className="gm-modal-actions"><button type="button" className="button secondary" onClick={() => guard.confirm(onClose)}>Anuluj</button><button className="button primary">Dodaj produkty</button></div>
  </form></Modal>;
}
function LinkExpense({ item, onClose }: { item: ShoppingItem; onClose: () => void }) {
  const { data, linkShoppingExpense } = useGarden(), [id, setId] = useState(""), [query, setQuery] = useState(""), [error, setError] = useState("");
  const guard = useUnsavedChanges(!!id), busy = useRef(false);
  const [originals] = useState(() => structuredClone(data.expenses.filter(e => e.direction === "outgoing")));
  const selected = originals.find(e => e.id === id);
  const rows = originals.filter(e => (e.counterparty + " " + e.description + " " + e.date).toLocaleLowerCase("pl").includes(query.toLocaleLowerCase("pl")));
  return <Modal title="Powiąż istniejący wydatek" onClose={onClose}><form ref={guard.ref} onSubmit={async e => {
    e.preventDefault(); if (busy.current || !selected) return; busy.current = true;
    try { await guard.save(async () => { await linkShoppingExpense(item.id, item.revision, selected.id, selected.revision); onClose(); }); }
    catch (e) { setError((e as Error).message); } finally { busy.current = false; }
  }}>
    <p>Wybierz istniejący koszt, także z CSV. Nie powstanie nowy wydatek. Jeden paragon może obejmować kilka pozycji zakupowych.</p>
    {error && <p role="alert" className="gm-form-error">{error}</p>}
    <label className="field">Szukaj istniejącego wydatku<input value={query} onChange={e => setQuery(e.target.value)}/></label>
    <label className="field">Istniejący wydatek<select required value={id} onChange={e => setId(e.target.value)}>
      <option value="">Wybierz wydatek</option>
      {selected && !rows.includes(selected) && <option value={selected.id}>{selected.counterparty} · {moneyCents(selected.amountCents)}</option>}
      {rows.slice(0, 100).map(e => <option key={e.id} value={e.id}>{e.date} · {moneyCents(e.amountCents)} · {e.counterparty || e.description} · {e.source === "csv" ? "CSV" : "Ręczny"}</option>)}
    </select></label>
    <p className="muted">Wyników: {rows.length}. Pierwsze 100 — zawęź wyszukiwanie. Po zmianach w innej karcie zamknij ten widok i sprawdź wydatek ponownie.</p>
    {selected && <p>Potwierdzasz: {moneyCents(selected.amountCents)} · {selected.date} · {data.expenseCategories.find(c => c.id === selected.categoryId)?.name} · {selected.status === "approved" ? "Zatwierdzony koszt" : "Wyłączony z kosztów"}.</p>}
    <div className="gm-modal-actions"><button type="button" className="button secondary" onClick={() => guard.confirm(onClose)}>Anuluj</button><button className="button primary" disabled={!selected}>Potwierdź powiązanie</button></div>
  </form></Modal>;
}
