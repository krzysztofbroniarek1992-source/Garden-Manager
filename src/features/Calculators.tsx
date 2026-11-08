import { useNavigation, useViewState } from '../navigation/Navigation';
import { useUnsavedChanges } from '../navigation/unsaved';
import { useGarden } from '../state';
import { materialUnits, moneyCents, type MaterialUnit } from '../domain';
import { area, convertQuantity, dose, formatQuantity, hedge, materialCostCents, packageCount, volume } from '../gardening';
import './gardening.css';

type Mode = 'area' | 'volume' | 'dose' | 'hedge' | 'materials';
const modes: Record<Mode, string> = { area: 'Powierzchnia', volume: 'Objętość warstwy', dose: 'Nawożenie i środki', hedge: 'Żywopłoty', materials: 'Materiały i koszt' };
const numberOf = (value: string) => {
  if (!value.trim()) throw new Error('Uzupełnij wymiary i wartości potrzebne do obliczenia.');
  const number = Number(value.replace(',', '.'));
  if (!Number.isFinite(number) || number < 0) throw new Error('Podaj nieujemne liczby.');
  return number;
};
export default function Calculators() {
  return <section className="calculators-page"><div className="page-heading"><div><span className="eyebrow">WYMIARY, ILOŚCI, KOSZTY</span><h1>Kalkulatory ogrodnicze</h1><p className="muted">Oblicz materiał i dodaj go do wybranego zlecenia.</p></div></div><div className="card calculator-page-card"><CalculatorPanel/></div></section>;
}
export function CalculatorPanel({ initialGardenId = '', initialZoneId = '', jobId = '' }: { initialGardenId?: string; initialZoneId?: string; jobId?: string }) {
  const { data, addJobMaterial } = useGarden();
  const navigation = useNavigation();
  const guard = useUnsavedChanges<HTMLDivElement>(false);
  const initialGarden = data.gardens.find(g => g.id === initialGardenId);
  const initialZone = initialGarden?.zones.find(z => z.id === initialZoneId);
  const [gardenId, setGardenId] = useViewState(`calculator:${initialGardenId}:${initialZoneId}:${jobId}:gardenId`, initialGardenId);
  const [zoneId, setZoneId] = useViewState(`calculator:${initialGardenId}:${initialZoneId}:${jobId}:zoneId`, initialZoneId);
  const [selectedJob, setSelectedJob] = useViewState(`calculator:${initialGardenId}:${initialZoneId}:${jobId}:selectedJob`, jobId);
  const [mode, setMode] = useViewState<Mode>(`calculator:${initialGardenId}:${initialZoneId}:${jobId}:mode`, initialZone && initialZone.length !== null && initialZone.area === null ? 'hedge' : initialGarden ? 'volume' : 'area');
  const [shape, setShape] = useViewState<'rectangle' | 'circle' | 'triangle' | 'manual'>(`calculator:${initialGardenId}:${initialZoneId}:${jobId}:shape`, 'manual');
  const [squareMetres, setSquareMetres] = useViewState(`calculator:${initialGardenId}:${initialZoneId}:${jobId}:squareMetres`, String(initialZone ? initialZone.area ?? '' : initialGarden?.area ?? ''));
  const [length, setLength] = useViewState(`calculator:${initialGardenId}:${initialZoneId}:${jobId}:length`, String(initialZone?.length ?? ''));
  const [a, setA] = useViewState(`calculator:${initialGardenId}:${initialZoneId}:${jobId}:a`, '');
  const [b, setB] = useViewState(`calculator:${initialGardenId}:${initialZoneId}:${jobId}:b`, '');
  const [thickness, setThickness] = useViewState(`calculator:${initialGardenId}:${initialZoneId}:${jobId}:thickness`, '');
  const [height, setHeight] = useViewState(`calculator:${initialGardenId}:${initialZoneId}:${jobId}:height`, '');
  const [width, setWidth] = useViewState(`calculator:${initialGardenId}:${initialZoneId}:${jobId}:width`, '');
  const [doseAmount, setDoseAmount] = useViewState(`calculator:${initialGardenId}:${initialZoneId}:${jobId}:doseAmount`, '');
  const [doseUnit, setDoseUnit] = useViewState<MaterialUnit>(`calculator:${initialGardenId}:${initialZoneId}:${jobId}:doseUnit`, 'g');
  const [per, setPer] = useViewState<1 | 100>(`calculator:${initialGardenId}:${initialZoneId}:${jobId}:per`, 1);
  const [hedgeQuantity, setHedgeQuantity] = useViewState<'volume' | 'length'>(`calculator:${initialGardenId}:${initialZoneId}:${jobId}:hedgeQuantity`, 'volume');
  const [manualQuantity, setManualQuantity] = useViewState(`calculator:${initialGardenId}:${initialZoneId}:${jobId}:manualQuantity`, '');
  const [manualUnit, setManualUnit] = useViewState<MaterialUnit>(`calculator:${initialGardenId}:${initialZoneId}:${jobId}:manualUnit`, 'szt.');
  const [catalogId, setCatalogId] = useViewState(`calculator:${initialGardenId}:${initialZoneId}:${jobId}:catalogId`, '');
  const [search, setSearch] = useViewState(`calculator:${initialGardenId}:${initialZoneId}:${jobId}:search`, '');
  const [purchasePrice, setPurchasePrice] = useViewState(`calculator:${initialGardenId}:${initialZoneId}:${jobId}:purchasePrice`, '0');
  const [clientPrice, setClientPrice] = useViewState(`calculator:${initialGardenId}:${initialZoneId}:${jobId}:clientPrice`, '0');
  const [notice, setNotice] = useViewState(`calculator:${initialGardenId}:${initialZoneId}:${jobId}:notice`, '');
  const [error, setError] = useViewState(`calculator:${initialGardenId}:${initialZoneId}:${jobId}:error`, '');
  const garden = data.gardens.find(g => g.id === gardenId);
  const zone = garden?.zones.find(z => z.id === zoneId);
  const material = data.materialCatalog.find(m => m.id === catalogId);
  const matchingMaterials = data.materialCatalog.filter(m => m.id === catalogId || `${m.name} ${m.category}`.toLocaleLowerCase('pl').includes(search.toLocaleLowerCase('pl')));
  const jobs = data.jobs.filter(j => j.gardenId === gardenId);
  const targetJob = jobs.find(j => j.id === selectedJob);
  function selectZone(id: string, nextGarden = garden) {
    setZoneId(id); setNotice('');
    const next = nextGarden?.zones.find(z => z.id === id);
    setSquareMetres(String(next ? next.area ?? '' : nextGarden?.area ?? ''));
    setLength(String(next?.length ?? ''));
    setShape('manual');
    if (next) setMode(next.area === null && next.length !== null ? 'hedge' : 'volume');
  }
  let calculation: { quantity: number; unit: MaterialUnit; primary: string; secondary: string; purchase: number; charge: number; packages: number | null } | null = null;
  let calculationError = '';
  try {
    let raw: number, unit: MaterialUnit;
    let secondary = '';
    if (mode === 'area') { raw = area(shape, numberOf(shape === 'manual' ? squareMetres : a), shape === 'rectangle' || shape === 'triangle' ? numberOf(b) : 0); unit = 'm²'; }
    else if (mode === 'volume') { raw = volume(numberOf(squareMetres), numberOf(thickness)); unit = 'm³'; secondary = `${formatQuantity(convertQuantity(raw, 'm³', 'l'))} l`; }
    else if (mode === 'dose') { raw = dose(numberOf(squareMetres), numberOf(doseAmount), per); unit = doseUnit; if (unit === 'g' || unit === 'ml') secondary = `${formatQuantity(convertQuantity(raw, unit, unit === 'g' ? 'kg' : 'l'))} ${unit === 'g' ? 'kg' : 'l'}`; }
    else if (mode === 'hedge') { const cubicMetres = hedge(numberOf(length), numberOf(height), numberOf(width)); raw = hedgeQuantity === 'length' ? numberOf(length) : cubicMetres; unit = hedgeQuantity === 'length' ? 'm' : 'm³'; secondary = `Szacowana objętość bryły: ${formatQuantity(cubicMetres)} m³`; }
    else { raw = numberOf(manualQuantity); unit = material?.unit ?? manualUnit; }
    const primary = `${formatQuantity(raw)} ${unit}`;
    const quantity = material ? convertQuantity(raw, unit, material.unit) : raw;
    calculation = { quantity, unit: material?.unit ?? unit, primary, secondary, purchase: materialCostCents(quantity, numberOf(purchasePrice)), charge: materialCostCents(quantity, numberOf(clientPrice)), packages: material?.packageQuantity ? packageCount(quantity, material.packageQuantity) : null };
  } catch (e) { calculationError = (e as Error).message; }
  async function add() {
    if (!calculation || !material || !targetJob || calculation.quantity <= 0) return;
    try {
      await guard.save(async()=>{await addJobMaterial(targetJob.id, gardenId, { id: crypto.randomUUID(), name: material.name, quantity: calculation.quantity, unit: calculation.unit, unitPrice: numberOf(clientPrice), purchaseUnitPrice: numberOf(purchasePrice), catalogId: material.id, ...(zone ? { zoneId: zone.id, zoneName: zone.name } : {}) });});
      setNotice(`Dodano materiał do zlecenia „${targetJob.title}”.${targetJob.settlement ? ' Zatwierdzona należność pozostała bez zmian. Uwzględnij materiał przez „Skoryguj cenę” w zleceniu.' : ''}`);
      setError('');
    } catch (e) { setError((e as Error).message); }
  }
  return <div className="calculator-panel" ref={guard.ref}>
    <nav className="related-card-links" aria-label="Powiązania kalkulatora">{garden && <button className="button secondary" onClick={()=>navigation.open({kind:"garden",id:garden.id})}>Ogród: {garden.name}</button>}{garden && zone && <button className="button secondary" onClick={()=>navigation.open({kind:"zone",id:zone.id,gardenId:garden.id})}>Strefa: {zone.name}</button>}{targetJob && <button className="button secondary" onClick={()=>navigation.open({kind:"job",id:targetJob.id,section:"billing"})}>Zlecenie: {targetJob.title}</button>}<button className="button secondary" onClick={()=>navigation.go("materials")}>Otwórz katalog materiałów</button></nav>
    <div className="form-grid"><label className="field">Ogród do obliczeń<select disabled={!!jobId} value={gardenId} onChange={e => { setGardenId(e.target.value); setSelectedJob(''); selectZone('', data.gardens.find(g => g.id === e.target.value)); }}><option value="">Bez ogrodu — samo obliczenie</option>{data.gardens.map(g => <option value={g.id} key={g.id}>{g.name} — {data.clients.find(c => c.id === g.clientId)?.name}</option>)}</select></label>
      <label className="field">Strefa ogrodu<select disabled={!garden} value={zoneId} onChange={e => selectZone(e.target.value)}><option value="">Cały ogród / własne wymiary</option>{garden?.zones.map(z => <option value={z.id} key={z.id}>{z.name}</option>)}</select></label>
      <label className="field full-width">Kalkulator<select value={mode} onChange={e => { setMode(e.target.value as Mode); setNotice(''); }}>{Object.entries(modes).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
    </div>
    {mode === 'dose' && <p className="label-notice">Środki ochrony roślin: dawkę przepisz z aktualnej etykiety konkretnego preparatu. Kalkulator wyłącznie przelicza wpisaną dawkę; nie proponuje dawek ani mieszanin.</p>}
    <div className="form-grid calculator-inputs">
      {mode === 'area' && <><label className="field full-width">Kształt<select value={shape} onChange={e => setShape(e.target.value as typeof shape)}><option value="manual">Własna powierzchnia</option><option value="rectangle">Prostokąt</option><option value="circle">Koło</option><option value="triangle">Trójkąt</option></select></label>{shape !== 'manual' && <NumberField label={shape === 'circle' ? 'Promień (m)' : shape === 'triangle' ? 'Podstawa (m)' : 'Długość (m)'} value={a} onChange={setA}/ >}{(shape === 'rectangle' || shape === 'triangle') && <NumberField label={shape === 'triangle' ? 'Wysokość trójkąta (m)' : 'Szerokość (m)'} value={b} onChange={setB}/>}</>}
      {((mode === 'area' && shape === 'manual') || mode === 'volume' || mode === 'dose') && <NumberField label="Powierzchnia do obliczeń (m²)" value={squareMetres} onChange={setSquareMetres}/>}
      {mode === 'volume' && <NumberField label="Grubość warstwy (cm)" value={thickness} onChange={setThickness}/>}
      {mode === 'dose' && <><NumberField label="Dawka z etykiety" value={doseAmount} onChange={setDoseAmount}/><label className="field">Jednostka dawki<select value={doseUnit} onChange={e => setDoseUnit(e.target.value as MaterialUnit)}>{['g', 'kg', 'ml', 'l'].map(u => <option key={u}>{u}</option>)}</select></label><label className="field">Dawka na<select value={per} onChange={e => setPer(Number(e.target.value) as 1 | 100)}><option value="1">1 m²</option><option value="100">100 m²</option></select></label></>}
      {mode === 'hedge' && <><NumberField label="Długość żywopłotu (m)" value={length} onChange={setLength}/><NumberField label="Wysokość żywopłotu (m)" value={height} onChange={setHeight}/><NumberField label="Szerokość żywopłotu (m)" value={width} onChange={setWidth}/><label className="field">Ilość do kosztorysu<select value={hedgeQuantity} onChange={e => setHedgeQuantity(e.target.value as typeof hedgeQuantity)}><option value="volume">Objętość bryły (m³)</option><option value="length">Długość (m)</option></select></label></>}
      {mode === 'materials' && <><NumberField label="Ilość materiału" value={manualQuantity} onChange={setManualQuantity}/><label className="field">Jednostka ilości<select disabled={!!material} value={material?.unit ?? manualUnit} onChange={e => setManualUnit(e.target.value as MaterialUnit)}>{materialUnits.map(u => <option key={u}>{u}</option>)}</select></label></>}
    </div>
    <div className="tool-heading"><h3>Materiał i koszt</h3></div><div className="form-grid">
      <label className="field">Szukaj w katalogu<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Nazwa lub kategoria"/></label>
      <label className="field">Materiał z katalogu<select value={catalogId} onChange={e => { setCatalogId(e.target.value); const next = data.materialCatalog.find(m => m.id === e.target.value); if (next) { setPurchasePrice(String(next.purchaseUnitPrice)); setClientPrice(String(next.purchaseUnitPrice)); } setNotice(''); }}><option value="">Wybierz materiał</option>{matchingMaterials.map(m => <option value={m.id} key={m.id}>{m.name} ({m.unit})</option>)}</select></label>
      <NumberField label={`Cena zakupu (zł / ${material?.unit ?? 'jedn. wyniku'})`} value={purchasePrice} onChange={setPurchasePrice} step="0.01"/>
      <NumberField label={`Cena dla klienta (zł / ${material?.unit ?? 'jedn. wyniku'})`} value={clientPrice} onChange={setClientPrice} step="0.01"/>
    </div><p className="gm-form-note">Cena dla klienta początkowo odpowiada cenie zakupu z katalogu. Możesz ją zmienić. Marża nie jest doliczana automatycznie.</p>
    <div className="calculator-result" aria-live="polite" data-testid="calculator-result">{calculation ? <><span>Wynik obliczenia</span><strong>{calculation.primary}</strong>{calculation.secondary && <span>{calculation.secondary}</span>}{material && <span>Ilość materiału: {formatQuantity(calculation.quantity)} {calculation.unit}</span>}{calculation.packages !== null && <span>Do zakupu: {calculation.packages} opak. ({material?.packageName || 'opakowanie'} po {formatQuantity(material!.packageQuantity!)} {material?.unit}). Koszt dotyczy obliczonego zużycia.</span>}<div className="calculator-costs"><span>Koszt zakupu: <b>{moneyCents(calculation.purchase)}</b></span><span>Kwota dla klienta: <b>{moneyCents(calculation.charge)}</b></span></div></> : <span>{calculationError}</span>}</div>
    {mode === 'area' && calculation && <button className="button secondary" onClick={() => { setSquareMetres(String(calculation!.quantity)); setMode('volume'); }}>Użyj powierzchni do obliczenia warstwy</button>}
    <div className="tool-heading"><h3>Dodaj do zlecenia</h3></div><label className="field">Zlecenie docelowe<select disabled={!!jobId || !garden} value={selectedJob} onChange={e => { setSelectedJob(e.target.value); setNotice(''); }}><option value="">Wybierz zlecenie tego ogrodu</option>{jobs.map(j => <option value={j.id} key={j.id}>{j.title} · {j.date}{j.settlement ? ' · cena zatwierdzona' : ''}</option>)}</select></label>
    {targetJob?.settlement && <p className="label-notice">Zlecenie ma zatwierdzoną należność. Dodany materiał zapisze się osobno na liście; zmianę należności zatwierdzisz przez „Skoryguj cenę”. Płatności pozostaną zachowane.</p>}
    {!material && <p className="gm-form-note">Aby zapisać wynik, wybierz materiał z katalogu. Katalog uzupełnisz w zakładce „Materiały”.</p>}
    <div className="tool-actions"><button className="button primary" disabled={!calculation || calculation.quantity <= 0 || !material || !targetJob} onClick={add}>Dodaj materiał do zlecenia</button></div>
    {notice && <p role="status" className="calculator-notice">{notice}</p>}{error && <p role="alert" className="gm-form-error">{error}</p>}
  </div>;
}
function NumberField({ label, value, onChange, step = 'any' }: { label: string; value: string; onChange: (value: string) => void; step?: string }) {
  return <label className="field">{label}<input type="number" min="0" step={step} value={value} onChange={e => onChange(e.target.value)}/></label>;
}
