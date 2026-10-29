import { useState, type FormEvent } from 'react';
import { CalendarDays, Clock3, CreditCard, MapPin, Pencil, Plus, ReceiptText, Trash2, Wallet, X } from 'lucide-react';
import Modal from '../components/Modal';
import PaymentBadge from '../components/PaymentBadge';
import { duration, elapsedSeconds, jobLaborCents, jobTotalCents, localDate, materialsTotalCents, moneyCents, paidCents, remainingCents, settlementStatus, toCents, type Payment } from '../domain';
import { useGarden, useNow } from '../state';
import './payments.css';

const methodLabels: Record<Payment['method'], string> = { cash: 'Gotówka', transfer: 'Przelew', blik: 'BLIK', other: 'Inne' };
const workLabels = { planned: 'Zaplanowane', 'in-progress': 'W trakcie', completed: 'Zakończone' };
const displayDate = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString('pl-PL');
const amountInput = (cents: number) => `${BigInt(cents) / 100n}.${String(BigInt(cents) % 100n).padStart(2, '0')}`;

type PaymentDraft = { payment: Payment; original: Payment | null; amount: string; existing: boolean };

export default function JobDetails({ jobId, onClose }: { jobId: string; onClose: () => void }) {
  const { data, savePayment, deletePayment } = useGarden();
  const now = useNow();
  const [draft, setDraft] = useState<PaymentDraft | null>(null);
  const [pending, setPending] = useState<Payment | null>(null);
  const [removing, setRemoving] = useState<Payment | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const job = data.jobs.find(item => item.id === jobId);
  if (!job) return <Modal title="Szczegóły zlecenia" onClose={onClose}><p className="muted">To zlecenie nie jest już dostępne. Zamknij panel i odśwież listę.</p></Modal>;
  const garden = data.gardens.find(item => item.id === job.gardenId);
  const client = data.clients.find(item => item.id === garden?.clientId);
  const payments = data.payments.filter(item => item.jobId === job.id).sort((a, b) => b.receivedDate.localeCompare(a.receivedDate) || a.id.localeCompare(b.id));
  const total = jobTotalCents(job, now, data.timer);
  const paid = paidCents(job.id, data.payments);
  const remaining = remainingCents(job, data.payments, now, data.timer);
  const maxAmount = remaining + (draft?.existing ? payments.find(item => item.id === draft.payment.id)?.amountCents ?? 0 : 0);

  function begin(payment?: Payment) {
    setError(''); setNotice(''); setPending(null); setRemoving(null);
    setDraft(payment ? { payment: { ...payment }, original: { ...payment }, amount: amountInput(payment.amountCents), existing: true } : {
      payment: { id: crypto.randomUUID(), jobId, amountCents: remaining, receivedDate: localDate(), method: 'transfer', note: '' },
      original: null, amount: amountInput(remaining), existing: false,
    });
  }

  function persist(payment: Payment) {
    try {
      savePayment(payment, draft?.original ?? null);
      setNotice(draft?.existing ? 'Zapis płatności został poprawiony.' : 'Płatność została zapisana.');
      setDraft(null); setPending(null); setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Nie udało się zapisać płatności.'); }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    try {
      const cents = toCents(draft.amount);
      if (!Number.isSafeInteger(cents) || cents <= 0) throw new Error('Kwota płatności musi wynosić co najmniej 0,01 zł.');
      if (cents > maxAmount) throw new Error(`Kwota przekracza należność. Możesz zapisać maksymalnie ${moneyCents(maxAmount)}.`);
      const payment = { ...draft.payment, amountCents: cents, note: draft.payment.note.trim() };
      setError('');
      if (draft.existing) setPending(payment);
      else persist(payment);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Sprawdź dane płatności.'); }
  }

  function remove() {
    if (!removing) return;
    try {
      deletePayment(removing.id, removing); setRemoving(null); setError(''); setNotice('Błędny wpis płatności został usunięty.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Nie udało się usunąć płatności.'); }
  }

  const closeForm = () => { setDraft(null); setPending(null); setError(''); };
  return <Modal title="Szczegóły zlecenia" onClose={onClose} wide><div className="payment-details">
    <div className="payment-job-heading"><div><h3>{job.title}</h3><p>{client?.name}</p></div><span className={`badge status-${job.status}`}>{workLabels[job.status]}</span></div>
    <div className="payment-job-meta"><span><MapPin size={14}/>{garden?.name}{garden?.address && ` · ${garden.address}`}</span><span><CalendarDays size={14}/>{displayDate(job.date)}, {job.time}</span><span><Clock3 size={14}/>{duration(elapsedSeconds(job, data.timer, now))}</span></div>
    {job.notes && <p className="payment-job-notes">{job.notes}</p>}
    <div className="payment-work-cost"><span>{job.billing === 'hourly' ? 'Praca · rozliczenie godzinowe' : 'Praca · ryczałt'}<strong>{moneyCents(jobLaborCents(job, now, data.timer))}</strong></span><span>Materiały, osobno<strong>{moneyCents(materialsTotalCents(job))}</strong></span></div>
    {job.materials.length > 0 && <div className="payment-material-list">{job.materials.map(material => <span key={material.id}>{material.name}<small>{material.quantity.toLocaleString('pl-PL')} × {moneyCents(toCents(material.unitPrice))}</small></span>)}</div>}
    <div className="payment-summary"><div><span>Wartość zlecenia</span><strong data-testid="payment-job-total">{moneyCents(total)}</strong></div><div><span>Zapłacono</span><strong data-testid="payment-job-paid">{moneyCents(paid)}</strong></div><div><span>Pozostało</span><strong data-testid="payment-job-remaining">{moneyCents(remaining)}</strong></div></div>
    <div className="payment-status-line"><PaymentBadge status={settlementStatus(job, data.payments, now, data.timer)}/><span>Status płatności jest niezależny od wykonania pracy.</span></div>
    {job.status !== 'completed' && <p className="payment-advance-note">Zlecenie nie jest jeszcze zakończone. Wpłaty zapisujemy jako otrzymane środki, bez doliczania ich do wartości wykonanych prac.{data.timer?.jobId === job.id && ' Wartość pracy rośnie podczas pomiaru czasu.'}</p>}
    <div className="payment-ledger-heading"><div><h3>Historia płatności</h3><p className="muted">Rzeczywiście otrzymane wpłaty · {payments.length} wpisów</p></div><button className="button primary" disabled={remaining <= 0 || !!draft || !!removing} onClick={() => begin()}><Plus size={16}/>Dodaj płatność</button></div>
    {notice && <p className="payment-notice" role="status">{notice}</p>}
    {error && <div className="gm-form-error" role="alert">{error}</div>}
    {remaining <= 0 && !draft && <p className="payment-zero-note">{paid > 0 ? 'Cała bieżąca należność została opłacona.' : 'To zlecenie nie ma obecnie kwoty do zapłaty.'}</p>}
    {draft && <section className="payment-form-panel" aria-label={draft.existing ? 'Edycja płatności' : 'Nowa płatność'}><div className="payment-form-heading"><h3>{draft.existing ? 'Edytuj płatność' : 'Nowa płatność'}</h3><button className="icon-button" aria-label="Anuluj formularz płatności" onClick={closeForm}><X size={18}/></button></div>{pending ? <div className="payment-confirm" role="group" aria-label="Potwierdzenie zmiany płatności"><strong>Potwierdź korektę wpisu</strong><p>Zmieniasz płatność z {moneyCents(draft.original?.amountCents ?? 0)} na <strong>{moneyCents(pending.amountCents)}</strong>, data {displayDate(pending.receivedDate)}, metoda: {methodLabels[pending.method]}.</p>{pending.note && <p>Notatka: {pending.note}</p>}<div className="payment-form-actions"><button className="button secondary" onClick={() => {setPending(null);setError('')}}>Wróć do edycji</button><button className="button primary" onClick={() => persist(pending)}>Potwierdź zmianę</button></div></div> : <form onSubmit={submit}><div className="form-grid"><label className="field">Kwota (zł)<input autoFocus required type="number" min="0.01" step="0.01" max={amountInput(maxAmount)} value={draft.amount} onChange={event => setDraft({ ...draft, amount: event.target.value })}/></label><label className="field">Data otrzymania<input required type="date" value={draft.payment.receivedDate} onChange={event => setDraft({ ...draft, payment: { ...draft.payment, receivedDate: event.target.value } })}/></label><label className="field">Metoda płatności<select value={draft.payment.method} onChange={event => setDraft({ ...draft, payment: { ...draft.payment, method: event.target.value as Payment['method'] } })}>{Object.entries(methodLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="field">Notatka (opcjonalnie)<input maxLength={1000} value={draft.payment.note} onChange={event => setDraft({ ...draft, payment: { ...draft.payment, note: event.target.value } })} placeholder="np. pierwsza część zapłaty"/></label></div><p className="gm-form-note">Maksymalna kwota tego wpisu: {moneyCents(maxAmount)}. Pozostałe wpłaty zostaną zachowane.</p><div className="payment-form-actions"><button type="button" className="button secondary" onClick={closeForm}>Anuluj</button><button type="submit" className="button primary">{draft.existing ? 'Sprawdź zmianę' : 'Zapisz płatność'}</button></div></form>}</section>}
    {removing && <div className="payment-confirm payment-delete-confirm" role="group" aria-label="Potwierdzenie usunięcia płatności"><strong>Usunąć błędną płatność?</strong><p>Usuniesz wpis {moneyCents(removing.amountCents)} z {displayDate(removing.receivedDate)}. Saldo zlecenia zostanie przeliczone. Tej operacji nie można cofnąć.</p><div className="payment-form-actions"><button className="button secondary" onClick={() => {setRemoving(null);setError('')}}>Anuluj</button><button className="button danger" onClick={remove}>Potwierdź usunięcie</button></div></div>}
    {payments.length > 0 ? <div className="payment-history"><table><caption className="payment-sr-only">Zarejestrowane płatności zlecenia {job.title}</caption><thead><tr><th>Data</th><th>Kwota</th><th>Metoda / notatka</th><th><span className="payment-sr-only">Operacje</span></th></tr></thead><tbody>{payments.map(payment => <tr key={payment.id}><td data-label="Data">{displayDate(payment.receivedDate)}</td><td data-label="Kwota"><strong>{moneyCents(payment.amountCents)}</strong></td><td data-label="Metoda / notatka"><span>{methodLabels[payment.method]}</span>{payment.note && <small>{payment.note}</small>}<small className="payment-entry-id">ID: {payment.id}</small></td><td className="payment-entry-actions"><button className="icon-button" disabled={!!draft || !!removing} aria-label={`Edytuj płatność ${moneyCents(payment.amountCents)} z ${displayDate(payment.receivedDate)}`} onClick={() => begin(payment)} title="Edytuj płatność"><Pencil size={16}/></button><button className="icon-button" disabled={!!draft || !!removing} aria-label={`Usuń płatność ${moneyCents(payment.amountCents)} z ${displayDate(payment.receivedDate)}`} onClick={() => {setRemoving(payment);setNotice('');setError('')}} title="Usuń płatność"><Trash2 size={16}/></button></td></tr>)}</tbody></table></div> : !draft && <div className="payment-empty"><ReceiptText size={28}/><p>Nie zarejestrowano jeszcze żadnej płatności.</p><span>Zakończenie pracy nie oznacza jej opłacenia.</span></div>}
    <div className="payment-ledger-footer"><Wallet size={15}/><span>Kwoty rozliczamy w groszach. Płatności częściowe sumują się tylko raz.</span><CreditCard size={15}/></div>
  </div></Modal>;
}
