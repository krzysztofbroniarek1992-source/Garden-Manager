import { useUnsavedChanges } from '../navigation/unsaved';
import { useState, type FormEvent } from 'react';
import { Check, Clock3 } from 'lucide-react';
import { duration } from '../domain';
import { useGarden } from '../state';
import './billing.css';

/** A whole-visit correction, never a separate timer for an individual activity. */
export default function TimeCorrection({ jobId, onDone, onCancel }: { jobId: string; onDone: () => void; onCancel: () => void }) {
  const { data, correctJobTime } = useGarden();
  const [original] = useState(() => data.jobs.find(job => job.id === jobId));
  const initialSeconds = original?.seconds ?? 0;
  const [hours, setHours] = useState(String(Math.floor(initialSeconds / 3600)));
  const [minutes, setMinutes] = useState(String(Math.floor(initialSeconds % 3600 / 60)));
  const [seconds, setSeconds] = useState(String(Math.floor(initialSeconds % 60)));
  const [pending, setPending] = useState<number | null>(null);
  const [error, setError] = useState('');
  const guard = useUnsavedChanges<HTMLElement>(hours !== String(Math.floor(initialSeconds/3600)) || minutes !== String(Math.floor(initialSeconds%3600/60)) || seconds !== String(Math.floor(initialSeconds%60)) || pending !== null);
  if (!original) return <p className="gm-form-error" role="alert">Nie znaleziono zlecenia.</p>;
  const save = () => {
    if (pending === null) return;
    try { guard.save(() => {correctJobTime(jobId, pending, initialSeconds);onDone();}); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Nie udało się poprawić czasu pracy.'); }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    try {
      if (![hours, minutes, seconds].every(value => /^\d+$/.test(value))) throw new Error('Podaj całkowite godziny, minuty i sekundy.');
      if (Number(minutes) > 59 || Number(seconds) > 59) throw new Error('Minuty i sekundy muszą mieścić się w zakresie 0–59.');
      const corrected = Number(BigInt(hours) * 3600n + BigInt(minutes) * 60n + BigInt(seconds));
      if (!Number.isSafeInteger(corrected) || corrected < 0) throw new Error('Podaj poprawny czas pracy.');
      setError(''); setPending(corrected);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Sprawdź czas pracy.'); }
  };
  return <section ref={guard.ref} className="time-correction" aria-label="Ręczna korekta czasu pracy">
    <div className="billing-editor-heading"><div><span className="eyebrow">DOKŁADNY CZAS CAŁEJ WIZYTY</span><h3>Popraw czas pracy</h3></div><Clock3 size={22}/></div>
    {error && <p className="gm-form-error" role="alert">{error}</p>}
    {pending !== null ? <div className="billing-price-confirm" role="group" aria-label="Potwierdzenie korekty czasu"><h4>Potwierdź ręczną korektę czasu</h4><p>Zmieniasz łączny czas wizyty z <strong>{duration(initialSeconds)}</strong> na <strong>{duration(pending)}</strong>. Czas nie jest zaokrąglany.</p>{original.settlement && <p>Zatwierdzona należność pozostanie bez zmian. Aby ją zmienić, osobno zatwierdź korektę ceny.</p>}<div className="billing-form-actions"><button className="button secondary" onClick={() => setPending(null)}>Wróć do czasu</button><button className="button primary" onClick={save}><Check size={16}/>Potwierdź korektę czasu</button></div></div> : <form onSubmit={submit}><div className="time-correction-fields"><label className="field">Godziny<input autoFocus required type="number" min="0" step="1" value={hours} onChange={event => setHours(event.target.value)}/></label><label className="field">Minuty<input required type="number" min="0" max="59" step="1" value={minutes} onChange={event => setMinutes(event.target.value)}/></label><label className="field">Sekundy<input required type="number" min="0" max="59" step="1" value={seconds} onChange={event => setSeconds(event.target.value)}/></label></div><p className="billing-explanation">Wpisz rzeczywisty czas od wyjścia z samochodu do całkowitego spakowania sprzętu. Pomiń dojazd, powrót i przerwy niewliczane do pracy.{original.settlement && ' Ta korekta nie zmieni zatwierdzonej ceny.'}</p><div className="billing-form-actions"><button type="button" className="button secondary" onClick={() => guard.confirm(onCancel)}>Anuluj korektę czasu</button><button type="submit" className="button primary"><Check size={16}/>Zapisz korektę czasu</button></div></form>}
  </section>;
}
