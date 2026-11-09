import { useUnsavedChanges } from '../navigation/unsaved';
import { useRef, useState, type FormEvent } from 'react';
import type { Garden } from '../domain';
import { useGarden } from '../state';
import Modal from '../components/Modal';
export default function GardenForm({ initial, isNew, onClose, onSaved }: { initial: Garden; isNew: boolean; onClose: () => void; onSaved?: (saved: Garden) => void }) {
  const { data, saveGarden } = useGarden();
  const [original] = useState(initial);
  const [wasNew] = useState(isNew);
  const [editing, setEditing] = useState(initial);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const guard = useUnsavedChanges(JSON.stringify(editing) !== JSON.stringify(original));
  async function submit(event: FormEvent) {
    event.preventDefault(); event.stopPropagation();
    if (!editing || inFlight.current) return;
    inFlight.current = true;
    try {
      if (!editing.name.trim()) throw new Error('Podaj nazwę ogrodu.');
      if (!editing.address.trim()) throw new Error('Podaj adres ogrodu.');
      if (!editing.clientId) throw new Error('Najpierw dodaj klienta w zakładce „Klienci”.');
      const saved = { ...editing, name: editing.name.trim(), address: editing.address.trim(), notes: editing.notes.trim() };
      await guard.save(async () => { await saveGarden(saved, wasNew ? null : original); onSaved?.(saved); onClose(); });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Nie udało się zapisać ogrodu.'); } finally { inFlight.current = false; }
  }

 return <Modal title={wasNew ? 'Nowy ogród' : 'Edytuj ogród'} onClose={() => onClose()}>
      <form ref={guard.ref} onSubmit={submit}>
        {error && <p className="gm-form-error" role="alert">{error}</p>}
        {!data.clients.length && <p className="gm-form-error" role="alert">Najpierw dodaj klienta w zakładce „Klienci”. Każdy ogród musi mieć właściciela.</p>}
        <div className="form-grid">
          <label className="field full-width">Nazwa ogrodu *<input required maxLength={150} value={editing.name} onChange={event => setEditing({ ...editing, name: event.target.value })} placeholder="np. Ogród przy domu" /></label>
          <label className="field full-width">Klient *<select required value={editing.clientId} onChange={event => setEditing({ ...editing, clientId: event.target.value })}><option value="" disabled>Wybierz klienta</option>{data.clients.map(client => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
          <label className="field full-width">Adres *<input required maxLength={300} autoComplete="street-address" value={editing.address} onChange={event => setEditing({ ...editing, address: event.target.value })} placeholder="Ulica, numer, miejscowość" /></label>
          <label className="field">Powierzchnia (m²)<input required type="number" min="0" max="100000000" step="0.1" value={editing.area} onChange={event => setEditing({ ...editing, area: Number(event.target.value) })} /></label>
          <label className="field full-width">Notatki<textarea maxLength={3000} value={editing.notes} onChange={event => setEditing({ ...editing, notes: event.target.value })} placeholder="Dostęp do ogrodu, kod do furtki, rodzaj roślin…" /></label>
        </div>
        <p className="gm-form-note">* Pole wymagane. Jeden klient może mieć przypisanych wiele ogrodów.</p>
        <div className="gm-modal-actions"><button type="button" className="button secondary" onClick={() => guard.confirm(onClose)}>Anuluj</button><button className="button primary" type="submit" disabled={!data.clients.length}>{wasNew ? 'Dodaj ogród' : 'Zapisz zmiany'}</button></div>
      </form>
    </Modal>;
}
