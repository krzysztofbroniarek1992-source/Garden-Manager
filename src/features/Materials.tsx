import { useState, type FormEvent } from 'react';
import { useGarden } from '../state';
import { materialUnits, money, type CatalogMaterial } from '../domain';
import { formatQuantity } from '../gardening';
import Modal from '../components/Modal';
import './entities.css';
import './gardening.css';

export default function Materials() {
  const { data } = useGarden();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<CatalogMaterial | null>(null);
  const matches = data.materialCatalog.filter(item => `${item.name} ${item.category} ${item.notes}`.toLocaleLowerCase('pl').includes(query.toLocaleLowerCase('pl')));
  return <section className="entities-page"><div className="page-heading"><div><span className="eyebrow">BAZA DO TWOICH KOSZTORYSÓW</span><h1>Katalog materiałów</h1><p className="muted">Ceny zakupu za jednostkę. Cenę dla klienta ustalisz osobno w kalkulatorze.</p></div><button className="button primary" onClick={() => setEditing({ id: crypto.randomUUID(), name: '', category: '', unit: 'l', purchaseUnitPrice: 0, packageName: '', packageQuantity: null, notes: '' })}>Dodaj materiał</button></div>
    <div className="entities-toolbar"><label className="field catalog-search">Szukaj materiałów<input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Nazwa, kategoria lub notatka"/></label><span className="muted">{matches.length} materiałów</span></div>
    {!matches.length && <div className="card empty-state"><h3>{query ? 'Brak wyników wyszukiwania' : 'Twój katalog jest pusty'}</h3><p className="muted">Zapisz materiały, których używasz, aby wybierać je przy kolejnych wycenach.</p></div>}
    <div className="entity-grid">{matches.map(item => <article className="tool-card" key={item.id}><h3>{item.name}</h3><p>{item.category}</p><strong>{money(item.purchaseUnitPrice)} / {item.unit}</strong>{(item.packageName || item.packageQuantity !== null) && <p>{item.packageName || 'Opakowanie'}{item.packageQuantity !== null && `: ${formatQuantity(item.packageQuantity)} ${item.unit}`}</p>}{item.notes && <p className="preserve-lines">{item.notes}</p>}<button className="button secondary" aria-label={`Edytuj materiał ${item.name}`} onClick={() => setEditing(item)}>Edytuj materiał</button></article>)}</div>
    {editing && <MaterialForm initial={editing} onClose={() => setEditing(null)}/>}
  </section>;
}
function MaterialForm({ initial, onClose }: { initial: CatalogMaterial; onClose: () => void }) {
  const { saveCatalogMaterial } = useGarden();
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState('');
  const patch = <K extends keyof CatalogMaterial>(key: K, value: CatalogMaterial[K]) => setDraft(current => ({ ...current, [key]: value }));
  function submit(event: FormEvent) {
    event.preventDefault();
    try { saveCatalogMaterial(draft); onClose(); } catch (e) { setError((e as Error).message); }
  }
  return <Modal title={initial.name ? 'Edytuj materiał' : 'Nowy materiał'} onClose={onClose}><form onSubmit={submit}>{error && <p role="alert" className="gm-form-error">{error}</p>}<div className="form-grid">
    <label className="field full-width">Nazwa materiału<input required maxLength={150} value={draft.name} onChange={e => patch('name', e.target.value)}/></label>
    <label className="field">Kategoria<input required maxLength={100} list="material-categories" value={draft.category} onChange={e => patch('category', e.target.value)}/><datalist id="material-categories">{['Podłoża', 'Kruszywa', 'Nawozy', 'Środki ochrony roślin', 'Rośliny', 'Inne'].map(c => <option key={c} value={c}/>)}</datalist></label>
    <label className="field">Jednostka miary<select value={draft.unit} onChange={e => patch('unit', e.target.value as CatalogMaterial['unit'])}>{materialUnits.map(unit => <option key={unit}>{unit}</option>)}</select></label>
    <label className="field full-width">Domyślna cena zakupu (zł / {draft.unit})<input required type="number" min="0" step="0.01" value={draft.purchaseUnitPrice} onChange={e => patch('purchaseUnitPrice', Number(e.target.value))}/></label>
    <label className="field">Opakowanie (opcjonalnie)<input maxLength={100} placeholder="np. worek" value={draft.packageName} onChange={e => patch('packageName', e.target.value)}/></label>
    <label className="field">Ilość w opakowaniu ({draft.unit})<input type="number" min="0.000000001" step="any" value={draft.packageQuantity ?? ''} onChange={e => patch('packageQuantity', e.target.value === '' ? null : Number(e.target.value))}/></label>
    <label className="field full-width">Notatki<textarea maxLength={5000} value={draft.notes} onChange={e => patch('notes', e.target.value)}/></label>
  </div><p className="gm-form-note">Cena dotyczy jednej jednostki miary, a ilość w opakowaniu służy do planowania zakupów. Zmiany katalogu nie zmieniają pozycji zapisanych w zleceniach.</p><div className="gm-modal-actions"><button type="button" className="button secondary" onClick={onClose}>Anuluj</button><button type="submit" className="button primary">Zapisz materiał</button></div></form></Modal>;
}
