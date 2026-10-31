import { useState, type FormEvent } from 'react';
import type { Client } from '../domain';
import { useGarden } from '../state';
import Modal from '../components/Modal';
export default function ClientForm({ initial, isNew, onClose }: { initial: Client; isNew: boolean; onClose: () => void }) {
  const { saveClient } = useGarden();
  const [editing, setEditing] = useState(initial);
  const [error, setError] = useState('');
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    try {
      if (!editing.name.trim()) throw new Error('Podaj imię i nazwisko lub nazwę firmy.');
      saveClient({ ...editing, name: editing.name.trim(), phone: editing.phone.trim(), email: editing.email.trim(), notes: editing.notes.trim() });
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Nie udało się zapisać klienta.'); }
  }

 return <Modal title={isNew ? 'Nowy klient' : 'Edytuj klienta'} onClose={() => onClose()}>
      <form onSubmit={submit}>
        {error && <p className="gm-form-error" role="alert">{error}</p>}
        <div className="form-grid">
          <label className="field full-width">Imię i nazwisko / nazwa firmy *<input required maxLength={150} name="name" autoComplete="name" value={editing.name} onChange={event => setEditing({ ...editing, name: event.target.value })} placeholder="np. Anna Kowalska" /></label>
          <label className="field">Telefon<input type="tel" name="phone" autoComplete="tel" maxLength={40} value={editing.phone} onChange={event => setEditing({ ...editing, phone: event.target.value })} placeholder="np. 600 100 200" /></label>
          <label className="field">Adres e-mail<input type="email" name="email" autoComplete="email" maxLength={254} value={editing.email} onChange={event => setEditing({ ...editing, email: event.target.value })} placeholder="anna@example.com" /></label>
          <label className="field full-width">Notatki<textarea maxLength={3000} value={editing.notes} onChange={event => setEditing({ ...editing, notes: event.target.value })} placeholder="Preferowany kontakt, wskazówki, ważne informacje…" /></label>
        </div>
        <p className="gm-form-note">* Pole wymagane. Ogrody przypiszesz w zakładce „Obiekty”.</p>
        <div className="gm-modal-actions"><button type="button" className="button secondary" onClick={() => onClose()}>Anuluj</button><button className="button primary" type="submit">{isNew ? 'Dodaj klienta' : 'Zapisz zmiany'}</button></div>
      </form>
    </Modal>;
}
