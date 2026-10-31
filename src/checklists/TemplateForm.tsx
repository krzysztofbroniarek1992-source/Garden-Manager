import { useState } from 'react';
import Modal from '../components/Modal';
import { useGarden } from '../state';
import { checklistLimits, type WorkTemplate } from './model';
import './checklists.css';
export default function TemplateForm({
  initial,
  onClose,
}: {
  initial: WorkTemplate;
  onClose: () => void;
}) {
  const { saveWorkTemplate } = useGarden();
  const [draft, setDraft] = useState(initial),
    [error, setError] = useState('');
  const move = (index: number, direction: number) => {
    const items = [...draft.items];
    [items[index], items[index + direction]] = [
      items[index + direction],
      items[index],
    ];
    setDraft({ ...draft, items });
  };
  return (
    <Modal
      title={initial.revision ? 'Edytuj szablon prac' : 'Nowy szablon prac'}
      onClose={onClose}
      wide
    >
      <form
        className="checklist-form"
        onSubmit={(e) => {
          e.preventDefault();
          try {
            saveWorkTemplate(draft);
            onClose();
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        {error && (
          <p role="alert" className="gm-form-error">
            {error}
          </p>
        )}
        <div className="form-grid">
          <label className="field full-width">
            Nazwa szablonu
            <input
              required
              maxLength={150}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <label className="field full-width">
            Opis szablonu
            <textarea
              aria-label="Opis szablonu"
              maxLength={5000}
              rows={3}
              value={draft.description}
              onChange={(e) =>
                setDraft({ ...draft, description: e.target.value })
              }
            />
          </label>
          <label className="field full-width">
            Kategoria usługi
            <input
              required
              maxLength={100}
              value={draft.category}
              onChange={(e) => setDraft({ ...draft, category: e.target.value })}
            />
          </label>
        </div>
        <h3>Lista czynności</h3>
        <p className="muted">
          Kolejność zmienisz przyciskami strzałek. Zmiany szablonu nie zmienią
          istniejących checklist.
        </p>
        <ol className="template-edit-items">
          {draft.items.map((item, index) => (
            <li key={item.id}>
              <label className="field">
                Czynność {index + 1}
                <input
                  required
                  aria-label={`Czynność ${index + 1}`}
                  maxLength={150}
                  value={item.title}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      items: draft.items.map((i) =>
                        i.id === item.id ? { ...i, title: e.target.value } : i,
                      ),
                    })
                  }
                />
              </label>
              <div className="checklist-order-controls">
                <button
                  type="button"
                  className="button secondary"
                  disabled={!index}
                  aria-label={`Przesuń czynność ${index + 1} w górę`}
                  onClick={() => move(index, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="button secondary"
                  disabled={index === draft.items.length - 1}
                  aria-label={`Przesuń czynność ${index + 1} w dół`}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="button ghost"
                  disabled={draft.items.length === 1}
                  aria-label={`Usuń czynność szablonu ${index + 1}`}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      items: draft.items.filter((i) => i.id !== item.id),
                    })
                  }
                >
                  Usuń
                </button>
              </div>
            </li>
          ))}
        </ol>
        <button
          type="button"
          className="button secondary"
          disabled={draft.items.length >= checklistLimits.templateItems}
          onClick={() =>
            setDraft({
              ...draft,
              items: [...draft.items, { id: crypto.randomUUID(), title: '' }],
            })
          }
        >
          Dodaj czynność szablonu
        </button>
        <p className="gm-form-note">
          Maksymalnie {checklistLimits.templateItems} czynności. W zabiegach
          ochrony roślin zawsze stosuj aktualną etykietę konkretnego preparatu.
          Szablony nie określają dawek ani mieszanin.
        </p>
        <div className="gm-modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Anuluj
          </button>
          <button type="submit" className="button primary">
            Zapisz szablon
          </button>
        </div>
      </form>
    </Modal>
  );
}
