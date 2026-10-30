import { useState, type FormEvent } from 'react';
import { Check, RotateCcw, ShieldCheck } from 'lucide-react';
import { calculatedLaborCents, duration, elapsedSeconds, materialsTotalCents, moneyCents, paidCents, roundLaborTo50Cents, sumCents, toCents, type Job } from '../domain';
import { useGarden } from '../state';
import './billing.css';

type PriceSource = 'rounded' | 'manual' | 'fixed' | 'exact';
const inputAmount = (cents: number) => `${BigInt(cents) / 100n}.${String(BigInt(cents) % 100n).padStart(2, '0')}`;

/** The proposal is a snapshot. Opening or changing this form never changes a debt. */
export default function BillingEditor({ jobId, onDone, onCancel }: { jobId: string; onDone: () => void; onCancel: () => void }) {
  const { data, approveSettlement } = useGarden();
  const [original] = useState<Job | null>(() => {
    const job = data.jobs.find(item => item.id === jobId);
    return job ? structuredClone(job) : null;
  });
  const [calculated] = useState(() => original ? calculatedLaborCents(original) : 0);
  const [materials] = useState(() => original ? materialsTotalCents(original) : 0);
  const [suggested] = useState(() => original?.billing === 'hourly' ? roundLaborTo50Cents(calculated) : calculated);
  const [amount, setAmount] = useState(() => inputAmount(suggested));
  const [source, setSource] = useState<PriceSource>(original?.billing === 'fixed' ? 'fixed' : 'rounded');
  const [pending, setPending] = useState<{ cents: number; source: PriceSource } | null>(null);
  const [error, setError] = useState('');
  const paid = paidCents(jobId, data.payments);
  let preview: number | null = null;
  try {
    const labor = toCents(amount);
    if (labor >= 0) preview = sumCents([labor, materials]);
  } catch { /* The submit action reports invalid input without interrupting typing. */ }

  if (!original) return <p className="gm-form-error" role="alert">Nie znaleziono zlecenia. Zamknij szczegóły i odśwież listę.</p>;
  const correction = original.settlement !== null;
  const persist = (cents: number, chosenSource: PriceSource) => {
    try {
      approveSettlement(jobId, cents, chosenSource, original);
      onDone();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Nie udało się zatwierdzić ceny.'); }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    try {
      const cents = toCents(amount);
      if (!Number.isSafeInteger(cents) || cents < 0) throw new Error('Cena robocizny nie może być ujemna.');
      const total = sumCents([cents, materials]);
      if (total < paid) throw new Error(`Należność nie może być niższa od otrzymanych wpłat (${moneyCents(paid)}). Skoryguj cenę lub błędną płatność.`);
      setError('');
      if (correction) setPending({ cents, source });
      else persist(cents, source);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Sprawdź cenę robocizny.'); }
  };

  return <section className="billing-editor" aria-label={correction ? 'Korekta ceny robocizny' : 'Zatwierdzenie rozliczenia'}>
    <div className="billing-editor-heading"><div><span className="eyebrow">ROBOCIZNA I MATERIAŁY OSOBNO</span><h3>{correction ? 'Skoryguj cenę robocizny' : 'Zatwierdź rozliczenie wizyty'}</h3></div><ShieldCheck size={22}/></div>
    {error && <p className="gm-form-error" role="alert">{error}</p>}
    <dl className="billing-proposal-lines">
      <div><dt>Rzeczywisty czas pracy</dt><dd>{duration(elapsedSeconds(original))}</dd></div>
      <div><dt>Wyliczona robocizna{original.billing === 'fixed' ? ' · ryczałt' : ''}</dt><dd data-testid="proposal-calculated-labor">{moneyCents(calculated)}</dd></div>
      <div><dt>{original.billing === 'hourly' ? 'Propozycja po zaokrągleniu do 50 zł' : 'Ryczałt · bez zaokrąglania'}</dt><dd data-testid="proposal-rounded-labor">{moneyCents(suggested)}</dd></div>
      <div><dt>Materiały, bez zaokrąglania do 50 zł</dt><dd data-testid="proposal-materials">{moneyCents(materials)}</dd></div>
    </dl>
    {pending ? <div className="billing-price-confirm" role="group" aria-label="Potwierdzenie korekty ceny">
      <h4>Potwierdź zmianę zatwierdzonej ceny</h4>
      <p>Robocizna: <strong>{moneyCents(original.settlement!.finalLaborCents)}</strong> → <strong>{moneyCents(pending.cents)}</strong>. Materiały w nowym rozliczeniu: <strong>{moneyCents(materials)}</strong>.</p>
      <p>Nowa ostateczna należność: <strong>{moneyCents(sumCents([pending.cents, materials]))}</strong>. Zarejestrowane płatności pozostają zachowane.</p>
      <div className="billing-form-actions"><button className="button secondary" onClick={() => { setPending(null); setError(''); }}>Wróć do ceny</button><button className="button primary" onClick={() => persist(pending.cents, pending.source)}><Check size={16}/>Potwierdź korektę ceny</button></div>
    </div> : <form onSubmit={submit}>
      <label className="field">Ustalona cena robocizny (zł)<input autoFocus required type="number" min="0" step="0.01" value={amount} onChange={event => { setAmount(event.target.value); setSource('manual'); }}/></label>
      <div className="billing-price-options">{original.billing === 'hourly' && <button type="button" onClick={() => { setAmount(inputAmount(suggested)); setSource('rounded'); }}><RotateCcw size={13}/>Użyj propozycji do 50 zł</button>}<button type="button" onClick={() => { setAmount(inputAmount(calculated)); setSource(original.billing === 'fixed' ? 'fixed' : 'exact'); }}>Bez zaokrąglania</button></div>
      <div className="billing-final-preview"><span>Ostateczna należność z materiałami</span><strong data-testid="proposal-final-total">{preview === null ? 'Sprawdź kwotę' : moneyCents(preview)}</strong></div>
      <p className="billing-explanation">Zatwierdzasz cenę robocizny. Materiały doliczamy osobno. Dokładny czas i pierwotne wyliczenie pozostają zapisane. Zatwierdzona należność nie zmieni się samoczynnie po korekcie czasu lub danych zlecenia.</p>
      {paid > 0 && <p className="billing-paid-note">Otrzymane płatności: {moneyCents(paid)}. Nowa należność musi pokrywać te wpłaty.</p>}
      <div className="billing-form-actions"><button type="button" className="button secondary" onClick={onCancel}>Anuluj wycenę</button><button type="submit" className="button primary"><Check size={16}/>{correction ? 'Sprawdź korektę ceny' : 'Zatwierdź cenę robocizny'}</button></div>
    </form>}
  </section>;
}
