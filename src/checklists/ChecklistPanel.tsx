import { useUnsavedChanges } from '../navigation/unsaved';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import Modal from '../components/Modal';
import { useGarden } from '../state';
import { PhotoImage } from '../photos/PhotoGallery';
import {
  checklistLimits,
  checklistProgress,
  itemStatusLabels,
  type Checklist,
  type ChecklistTarget,
} from './model';
import './checklists.css';

/** Persist each edit, retaining a failed draft for an explicit retry. */
function AutoField({
  label,
  value,
  onSave,
  multiline = false,
  maxLength,
  trim = false,
}: {
  label: string;
  value: string;
  onSave: (value: string) => boolean;
  multiline?: boolean;
  maxLength: number;
  trim?: boolean;
}) {
  const [draft, setDraft] = useState(value),
    [failed, setFailed] = useState(false);
  const guard = useUnsavedChanges<HTMLLabelElement>(failed);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current && !failed) setDraft(value);
  }, [value, failed]);
  const save = (next: string) => {
    const success = onSave(next);
    setFailed(!success);
    return success;
  };
  const props = {
    'aria-label': label,
    maxLength,
    value: draft,
    onFocus: () => {
      focused.current = true;
    },
    onBlur: () => {
      focused.current = false;
      if (draft !== value && save(draft)) setDraft(trim ? draft.trim() : draft);
    },
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setDraft(e.target.value);
      save(e.target.value);
    },
    'aria-invalid': failed,
  };
  return (
    <label ref={guard.ref} className="field">
      {label}
      {multiline ? <textarea {...props} rows={2} /> : <input {...props} />}{' '}
      {failed && (
        <span className="checklist-unsaved">
          Zmiana niezapisana.{' '}
          <button
            className="text-button"
            type="button"
            onClick={() => save(draft)}
          >
            Ponów zapis
          </button>
        </span>
      )}
    </label>
  );
}
export function ChecklistProgress({ checklist }: { checklist: Checklist }) {
  const progress = checklistProgress(checklist.items),
    percent =
      progress.percent === null
        ? '—'
        : `${progress.percent.toLocaleString('pl-PL', { maximumFractionDigits: 0 })}%`;
  return (
    <div className="checklist-progress">
      <div>
        <strong>{percent}</strong>
        <span>
          {progress.done} / {progress.total} wykonanych
          {progress.excluded > 0 && ` · ${progress.excluded} nie dotyczy`}
        </span>
      </div>
      {progress.percent !== null && (
        <progress
          max={100}
          value={progress.percent}
          aria-label={`Postęp checklisty ${checklist.name}`}
        />
      )}{' '}
      {!checklist.items.length && (
        <small>Lista nie zawiera jeszcze czynności.</small>
      )}
      {!!checklist.items.length && progress.total === 0 && (
        <small>Wszystkie czynności oznaczono jako „Nie dotyczy”.</small>
      )}
    </div>
  );
}
export function ChecklistCaption({ checklist: c }: { checklist: Checklist }) {
  return (
    <p className="checklist-caption">
      {c.kind === 'plan' ? 'Plan ogrodu' : 'Checklista wizyty'} · {c.gardenName}
      {c.zoneName && ` · ${c.zoneName}`}
      {c.jobTitle && ` · ${c.jobTitle}`}
      {!c.gardenId && ' · historyczny ogród'}
      {c.kind === 'visit' && !c.jobId && ' · historyczna wizyta'}
    </p>
  );
}
export function ChecklistEditor({
  id,
  onDeleted,
}: {
  id: string;
  onDeleted?: () => void;
}) {
  const {
    data,
    editChecklist,
    addChecklistItem,
    editChecklistItem,
    moveChecklistItem,
    removeChecklistItem,
    deleteChecklist,
  } = useGarden();
  const c = data.checklists.find((c) => c.id === id);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [title, setTitle] = useState(''),
    [removing, setRemoving] = useState(''),
    [deleting, setDeleting] = useState(false);
  const itemGuard = useUnsavedChanges(title.trim().length > 0);
  if (!c) return <p>Checklista została usunięta. Otwórz aktualny wpis.</p>;
  const perform = (fn: () => void) => {
    try {
      fn();
      setError('');
      setNotice('Zmiany zapisane na tym urządzeniu.');
      return true;
    } catch (e) {
      setError((e as Error).message);
      setNotice('');
      return false;
    }
  };
  const photos = data.photos.filter(
    (p) =>
      p.deletedAt === null &&
      (!c.gardenId ||
        p.gardenId === c.gardenId ||
        c.items.some((i) => i.photoId === p.id)),
  );
  return (
    <div className="checklist-editor">
      <ChecklistCaption checklist={c} />
      <ChecklistProgress checklist={c} />
      {c.templateName && (
        <p className="gm-form-note">
          Niezależna kopia szablonu „{c.templateName}”, wersja{' '}
          {c.templateRevision}. Zmiany szablonu nie zmieniają tej listy.
        </p>
      )}
      {c.sourcePlanId && (
        <p className="gm-form-note">
          Skopiowano z planu ogrodu; postęp planu i wizyty zapisuje się osobno.
        </p>
      )}
      {error && (
        <p role="alert" className="gm-form-error">
          {error}
        </p>
      )}
      <p className="checklist-save-status" role="status">
        {notice || 'Zmiany zapisują się automatycznie.'}
      </p>
      <details className="checklist-metadata">
        <summary>Nazwa i opis checklisty</summary>
        <div className="form-grid">
          <AutoField
            label="Nazwa checklisty"
            value={c.name}
            maxLength={150}
            trim
            onSave={(name) =>
              perform(() => editChecklist(c.id, c.revision, { name }))
            }
          />
          <AutoField
            label="Kategoria checklisty"
            value={c.category}
            maxLength={100}
            trim
            onSave={(category) =>
              perform(() => editChecklist(c.id, c.revision, { category }))
            }
          />
          <AutoField
            label="Opis checklisty"
            value={c.description}
            multiline
            maxLength={5000}
            onSave={(description) =>
              perform(() => editChecklist(c.id, c.revision, { description }))
            }
          />
        </div>
      </details>
      <ol className="checklist-items">
        {c.items.map((item, index) => {
          const photo = data.photos.find(
            (p) => p.id === item.photoId && p.deletedAt === null,
          );
          return (
            <li
              className={`checklist-item checklist-item-${item.status}`}
              key={item.id}
              data-item-id={item.id}
            >
              <div className="checklist-item-top">
                <label className="checklist-check">
                  <input
                    type="checkbox"
                    checked={item.status === 'done'}
                    disabled={item.status === 'not-applicable'}
                    aria-label={`Wykonano: ${item.title}`}
                    onChange={(e) =>
                      perform(() =>
                        editChecklistItem(c.id, c.revision, item.id, {
                          status: e.target.checked ? 'done' : 'pending',
                        }),
                      )
                    }
                  />
                  <span>
                    {index + 1}. {item.title}
                  </span>
                </label>
                <label className="field checklist-item-status">
                  Status czynności
                  <select
                    aria-label={`Status: ${item.title}`}
                    value={item.status}
                    onChange={(e) =>
                      perform(() =>
                        editChecklistItem(c.id, c.revision, item.id, {
                          status: e.target.value as typeof item.status,
                        }),
                      )
                    }
                  >
                    {Object.entries(itemStatusLabels).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {item.completedAt !== null && (
                <p className="checklist-completed-at">
                  Wykonano: {new Date(item.completedAt).toLocaleString('pl-PL')}
                </p>
              )}
              <AutoField
                label={`Uwagi: ${item.title}`}
                value={item.note}
                multiline
                maxLength={2000}
                onSave={(note) =>
                  perform(() =>
                    editChecklistItem(c.id, c.revision, item.id, { note }),
                  )
                }
              />
              <details className="checklist-item-options">
                <summary>Edytuj czynność, kolejność i zdjęcie</summary>
                <AutoField
                  label={`Nazwa czynności ${index + 1}`}
                  value={item.title}
                  maxLength={150}
                  trim
                  onSave={(title) =>
                    perform(() =>
                      editChecklistItem(c.id, c.revision, item.id, { title }),
                    )
                  }
                />
                <label className="field">
                  Zdjęcie czynności
                  <select
                    aria-label={`Zdjęcie: ${item.title}`}
                    value={item.photoId ?? ''}
                    onChange={(e) =>
                      perform(() =>
                        editChecklistItem(c.id, c.revision, item.id, {
                          photoId: e.target.value || null,
                        }),
                      )
                    }
                  >
                    <option value="">Bez zdjęcia</option>
                    {photos.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.filename} · {p.description.slice(0, 40)}
                      </option>
                    ))}
                  </select>
                </label>
                {photo && (
                  <div className="checklist-photo">
                    <PhotoImage photo={photo} thumbnail />
                  </div>
                )}
                {!photo && item.photoName && (
                  <p className="gm-form-note">
                    Historyczne zdjęcie „{item.photoName}” zostało odłączone lub
                    usunięte.
                  </p>
                )}
                <div className="checklist-order-controls">
                  <button
                    className="button secondary"
                    disabled={!index}
                    aria-label={`Przesuń ${item.title} w górę`}
                    onClick={() =>
                      perform(() =>
                        moveChecklistItem(c.id, c.revision, item.id, -1),
                      )
                    }
                  >
                    ↑
                  </button>
                  <button
                    className="button secondary"
                    disabled={index === c.items.length - 1}
                    aria-label={`Przesuń ${item.title} w dół`}
                    onClick={() =>
                      perform(() =>
                        moveChecklistItem(c.id, c.revision, item.id, 1),
                      )
                    }
                  >
                    ↓
                  </button>
                  <button
                    className="button ghost"
                    onClick={() => setRemoving(item.id)}
                  >
                    Usuń czynność
                  </button>
                </div>
                {removing === item.id && (
                  <div
                    className="checklist-confirm"
                    role="group"
                    aria-label="Potwierdzenie usunięcia czynności"
                  >
                    <p>
                      Usunąć „{item.title}” wraz z uwagą? Zdjęcie pozostanie w
                      galerii.
                    </p>
                    <button
                      className="button secondary"
                      onClick={() => setRemoving('')}
                    >
                      Zachowaj czynność
                    </button>
                    <button
                      className="button danger"
                      onClick={() => {
                        if (
                          perform(() =>
                            removeChecklistItem(c.id, c.revision, item.id),
                          )
                        )
                          setRemoving('');
                      }}
                    >
                      Potwierdź usunięcie czynności
                    </button>
                  </div>
                )}
              </details>
            </li>
          );
        })}
      </ol>
      <form
        ref={itemGuard.ref}
        className="checklist-add-item"
        onSubmit={(e) => {
          e.preventDefault();
          if (perform(() => addChecklistItem(c.id, c.revision, title)))
            setTitle('');
        }}
      >
        <label className="field">
          Nowa czynność
          <input
            required
            maxLength={150}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <button
          className="button secondary"
          disabled={c.items.length >= checklistLimits.items}
          type="submit"
        >
          Dodaj czynność do checklisty
        </button>
      </form>
      <p className="gm-form-note">
        Odhaczanie nie zmienia stopera ani rozliczeń. W zabiegach ochrony roślin
        dawkę i warunki przepisz z aktualnej etykiety konkretnego preparatu.
      </p>
      <button className="button ghost" onClick={() => setDeleting(true)}>
        Usuń checklistę
      </button>
      {deleting && (
        <div
          className="checklist-confirm"
          role="group"
          aria-label="Potwierdzenie usunięcia checklisty"
        >
          <p>
            Usunąć checklistę „{c.name}” i jej zapisany postęp? Zlecenie,
            szablon i zdjęcia pozostaną zachowane.
          </p>
          <button
            className="button secondary"
            onClick={() => setDeleting(false)}
          >
            Zachowaj checklistę
          </button>
          <button
            className="button danger"
            onClick={() => {
              if (perform(() => deleteChecklist(c.id, c.revision)))
                onDeleted?.();
            }}
          >
            Potwierdź usunięcie checklisty
          </button>
        </div>
      )}
    </div>
  );
}
export function ChecklistDetails({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  const { data } = useGarden();
  return (
    <Modal
      title={`Checklista: ${data.checklists.find((c) => c.id === id)?.name ?? 'historia'}`}
      onClose={onClose}
      wide
    >
      <ChecklistEditor id={id} onDeleted={onClose} />
    </Modal>
  );
}
export default function ChecklistPanel({
  target,
  onOpenGallery,
}: {
  target: ChecklistTarget;
  onOpenGallery?: () => void;
}) {
  const { data, applyWorkTemplate, applyGardenPlan, createBlankChecklist } =
    useGarden();
  const [selected, setSelected] = useState(''),
    [templateId, setTemplateId] = useState(''),
    [planId, setPlanId] = useState(''),
    [blank, setBlank] = useState(false),
    [name, setName] = useState(''),
    [error, setError] = useState('');
  const matches = data.checklists.filter((c) =>
    target.kind === 'visit'
      ? c.kind === 'visit' && c.jobId === target.jobId
      : c.kind === 'plan' &&
        c.gardenId === target.gardenId &&
        c.zoneId === target.zoneId,
  );
  const templates = data.workTemplates.filter((t) => t.archivedAt === null);
  const job =
    target.kind === 'visit'
      ? data.jobs.find((j) => j.id === target.jobId)
      : undefined;
  const plans = data.checklists.filter(
    (c) => c.kind === 'plan' && c.gardenId === job?.gardenId,
  );
  const occurrence = job?.taskOccurrenceId
    ? data.taskOccurrences.find((o) => o.id === job.taskOccurrenceId)
    : undefined;
  const suggestion = data.workTemplates.find(
    (t) =>
      t.id ===
        data.taskSchedules.find((s) => s.id === occurrence?.scheduleId)
          ?.checklistTemplateId && t.archivedAt === null,
  );
  const blankGuard = useUnsavedChanges(blank && name.trim().length > 0);
  const perform = (fn: () => string) => {
    try {
      setSelected(fn());
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const title =
    target.kind === 'visit'
      ? 'Checklisty wizyty'
      : target.zoneId
        ? 'Plany czynności strefy'
        : 'Plany czynności ogrodu';
  return (
    <section className="checklist-panel" aria-label={title}>
      <div className="checklist-section-heading">
        <h3>{title}</h3>
        {onOpenGallery && (
          <button className="button secondary" onClick={onOpenGallery}>
            Przejdź do galerii zlecenia
          </button>
        )}
      </div>
      <p className="muted">
        {target.kind === 'visit'
          ? 'Niezależne listy i postęp tej wizyty.'
          : 'Plan czynności nie tworzy zlecenia ani należności. Możesz skopiować go do checklisty wizyty.'}
      </p>
      {error && (
        <p role="alert" className="gm-form-error">
          {error}
        </p>
      )}
      {suggestion && (
        <button
          className="button secondary"
          onClick={() =>
            perform(() => applyWorkTemplate(suggestion.id, target))
          }
        >
          Zastosuj szablon harmonogramu: {suggestion.name}
        </button>
      )}
      <div className="checklist-assign">
        <label className="field">
          Szablon do zastosowania
          <select
            aria-label="Szablon do zastosowania"
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
          >
            <option value="">Wybierz aktywny szablon</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="button secondary"
          disabled={!templateId}
          onClick={() => perform(() => applyWorkTemplate(templateId, target))}
        >
          Zastosuj szablon
        </button>
        <button className="button secondary" onClick={() => setBlank(true)}>
          Checklista od zera
        </button>
      </div>
      {target.kind === 'visit' && plans.length > 0 && (
        <div className="checklist-assign">
          <label className="field">
            Plan ogrodu do zastosowania
            <select
              aria-label="Plan ogrodu do zastosowania"
              value={planId}
              onChange={(e) => setPlanId(e.target.value)}
            >
              <option value="">Wybierz plan ogrodu lub strefy</option>
              {plans.map((p) => (
                <option value={p.id} key={p.id}>
                  {p.name}
                  {p.zoneName && ` · ${p.zoneName}`}
                </option>
              ))}
            </select>
          </label>
          <button
            className="button secondary"
            disabled={!planId}
            onClick={() => perform(() => applyGardenPlan(planId, target.jobId))}
          >
            Skopiuj plan do wizyty
          </button>
        </div>
      )}
      <div className="checklist-card-grid">
        {matches.map((c) => (
          <article className="checklist-summary card" key={c.id}>
            <button
              className="checklist-title"
              onClick={() => setSelected(c.id)}
            >
              {c.name}
            </button>
            <ChecklistCaption checklist={c} />
            <ChecklistProgress checklist={c} />
          </article>
        ))}
      </div>
      {!matches.length && <p className="muted">Brak przypisanych checklist.</p>}
      {selected && (
        <ChecklistDetails id={selected} onClose={() => setSelected('')} />
      )}
      {blank && (
        <Modal
          title={
            target.kind === 'visit'
              ? 'Nowa checklista wizyty'
              : 'Nowy plan czynności'
          }
          onClose={() => setBlank(false)}
        >
          <form
            ref={blankGuard.ref}
            className="checklist-form"
            onSubmit={(e) => {
              e.preventDefault();
              try {
                const id = createBlankChecklist(target, name);
                setBlank(false);
                setName('');
                setSelected(id);
                setError('');
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <label className="field">
              Nazwa nowej checklisty
              <input
                required
                maxLength={150}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            {error && (
              <p role="alert" className="gm-form-error">
                {error}
              </p>
            )}
            <div className="gm-modal-actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => blankGuard.confirm(() => setBlank(false))}
              >
                Anuluj
              </button>
              <button className="button primary" type="submit">
                Utwórz checklistę
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
