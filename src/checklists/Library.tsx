import { useState } from 'react';
import Modal from '../components/Modal';
import { useGarden } from '../state';
import {
  newWorkTemplate,
  type ChecklistTarget,
  type WorkTemplate,
} from './model';
import TemplateForm from './TemplateForm';
import {
  ChecklistCaption,
  ChecklistDetails,
  ChecklistProgress,
} from './ChecklistPanel';
import './checklists.css';
function AssignmentForm({
  template,
  onClose,
  onApplied,
}: {
  template: WorkTemplate;
  onClose: () => void;
  onApplied: (id: string) => void;
}) {
  const { data, applyWorkTemplate } = useGarden();
  const [kind, setKind] = useState<'plan' | 'visit'>('plan'),
    [gardenId, setGardenId] = useState(data.gardens[0]?.id ?? ''),
    [zoneId, setZoneId] = useState(''),
    [jobId, setJobId] = useState(''),
    [error, setError] = useState('');
  const garden = data.gardens.find((g) => g.id === gardenId),
    jobs = data.jobs.filter((j) => j.gardenId === gardenId);
  return (
    <Modal title="Zastosuj szablon prac" onClose={onClose}>
      <form
        className="checklist-form"
        onSubmit={(e) => {
          e.preventDefault();
          try {
            const target: ChecklistTarget =
              kind === 'plan'
                ? { kind, gardenId, zoneId: zoneId || null }
                : { kind, jobId, zoneId: zoneId || null };
            onApplied(applyWorkTemplate(template.id, target));
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <h3>{template.name}</h3>
        <label className="field">
          Rodzaj checklisty
          <select
            aria-label="Rodzaj checklisty"
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
          >
            <option value="plan">Plan ogrodu lub strefy</option>
            <option value="visit">Checklista istniejącej wizyty</option>
          </select>
        </label>
        <label className="field">
          Ogród checklisty
          <select
            required
            aria-label="Ogród checklisty"
            value={gardenId}
            onChange={(e) => {
              setGardenId(e.target.value);
              setJobId('');
              setZoneId('');
            }}
          >
            <option value="">Wybierz ogród</option>
            {data.gardens.map((g) => (
              <option value={g.id} key={g.id}>
                {data.clients.find((c) => c.id === g.clientId)?.name} · {g.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Strefa checklisty
          <select
            aria-label="Strefa checklisty"
            value={zoneId}
            onChange={(e) => setZoneId(e.target.value)}
          >
            <option value="">Cały ogród</option>
            {garden?.zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </select>
        </label>
        {kind === 'visit' && (
          <label className="field">
            Zlecenie lub wizyta
            <select
              required
              aria-label="Zlecenie lub wizyta"
              value={jobId}
              onChange={(e) => setJobId(e.target.value)}
            >
              <option value="">Wybierz istniejącą wizytę</option>
              {jobs.map((j) => (
                <option value={j.id} key={j.id}>
                  {j.date} · {j.title}
                </option>
              ))}
            </select>
          </label>
        )}
        <p className="gm-form-note">
          Powstanie niezależna kopia listy. Samo przypisanie nie tworzy zlecenia
          i nie zmienia stopera.
        </p>
        {!data.gardens.length && (
          <p>Przed przypisaniem dodaj klienta i ogród.</p>
        )}
        {error && (
          <p role="alert" className="gm-form-error">
            {error}
          </p>
        )}
        <div className="gm-modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Anuluj
          </button>
          <button
            className="button primary"
            type="submit"
            disabled={!gardenId || (kind === 'visit' && !jobId)}
          >
            Przypisz niezależną checklistę
          </button>
        </div>
      </form>
    </Modal>
  );
}
export default function TemplateLibrary() {
  const { data, copyWorkTemplate, archiveWorkTemplate, deleteWorkTemplate } =
    useGarden();
  const [tab, setTab] = useState<'templates' | 'checklists'>('templates'),
    [query, setQuery] = useState(''),
    [category, setCategory] = useState(''),
    [status, setStatus] = useState('active'),
    [kind, setKind] = useState(''),
    [garden, setGarden] = useState('');
  const [draft, setDraft] = useState<WorkTemplate | null>(null),
    [applying, setApplying] = useState<WorkTemplate | null>(null),
    [removing, setRemoving] = useState<WorkTemplate | null>(null),
    [selected, setSelected] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const categories = [
    ...new Set(data.workTemplates.map((t) => t.category)),
  ].sort((a, b) => a.localeCompare(b, 'pl'));
  const templates = data.workTemplates
    .filter(
      (t) =>
        `${t.name} ${t.description} ${t.items.map((i) => i.title).join(' ')}`
          .toLocaleLowerCase('pl')
          .includes(query.toLocaleLowerCase('pl')) &&
        (!category || t.category === category) &&
        (status === 'all' ||
          (status === 'active'
            ? t.archivedAt === null
            : t.archivedAt !== null)),
    )
    .sort((a, b) => a.name.localeCompare(b.name, 'pl'));
  const checklists = data.checklists
    .filter(
      (c) =>
        `${c.name} ${c.description} ${c.jobTitle ?? ''} ${c.zoneName ?? ''}`
          .toLocaleLowerCase('pl')
          .includes(query.toLocaleLowerCase('pl')) &&
        (!kind || c.kind === kind) &&
        (!garden ||
          (garden === 'detached'
            ? c.gardenId === null
            : c.gardenId === garden)),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const perform = (fn: () => void) => {
    try {
      fn();
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <section className="work-library">
      <div className="page-heading">
        <div>
          <p className="eyebrow">POWTARZALNY PORZĄDEK PRACY</p>
          <h1>Szablony prac</h1>
          <p className="muted">
            Zapisuj swoje standardy i stosuj niezależne listy u klientów.
          </p>
        </div>
        <button
          className="button primary"
          onClick={() => setDraft(newWorkTemplate())}
        >
          Dodaj szablon
        </button>
      </div>
      <div
        className="checklist-tabs"
        role="group"
        aria-label="Biblioteka szablonów i checklist"
      >
        <button
          className="button secondary"
          aria-pressed={tab === 'templates'}
          onClick={() => {
            setTab('templates');
            setQuery('');
          }}
        >
          Szablony
        </button>
        <button
          className="button secondary"
          aria-pressed={tab === 'checklists'}
          onClick={() => {
            setTab('checklists');
            setQuery('');
          }}
        >
          Checklisty i plany
        </button>
      </div>
      {error && (
        <p className="gm-form-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="checklist-save-status" role="status">
          {notice}
        </p>
      )}
      <div className="work-library-filters">
        <label className="field">
          {tab === 'templates' ? 'Szukaj szablonów' : 'Szukaj checklist'}
          <input
            type="search"
            aria-label={
              tab === 'templates' ? 'Szukaj szablonów' : 'Szukaj checklist'
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Nazwa, opis lub czynność"
          />
        </label>
        {tab === 'templates' ? (
          <>
            <label className="field">
              Kategoria usługi
              <select
                aria-label="Filtr kategorii usługi"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="">Wszystkie kategorie</option>
                {categories.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className="field">
              Status szablonu
              <select
                aria-label="Status szablonu"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="active">Aktywne</option>
                <option value="archived">Archiwum</option>
                <option value="all">Wszystkie</option>
              </select>
            </label>
          </>
        ) : (
          <>
            <label className="field">
              Rodzaj listy
              <select
                aria-label="Rodzaj listy"
                value={kind}
                onChange={(e) => setKind(e.target.value)}
              >
                <option value="">Wszystkie</option>
                <option value="plan">Plany ogrodów i stref</option>
                <option value="visit">Checklisty wizyt</option>
              </select>
            </label>
            <label className="field">
              Ogród listy
              <select
                aria-label="Ogród listy"
                value={garden}
                onChange={(e) => setGarden(e.target.value)}
              >
                <option value="">Wszystkie ogrody</option>
                <option value="detached">Historyczny ogród</option>
                {data.gardens.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </div>
      {tab === 'templates' ? (
        <div className="work-template-grid">
          {templates.map((t) => (
            <article className="card work-template-card" key={t.id}>
              <div className="checklist-section-heading">
                <h2>{t.name}</h2>
                <span className="badge">
                  {t.archivedAt === null ? t.category : 'Archiwum'}
                </span>
              </div>
              {t.description && (
                <p className="muted preserve-lines">{t.description}</p>
              )}
              <details>
                <summary>Pokaż czynności ({t.items.length})</summary>
                <ol>
                  {t.items.map((i) => (
                    <li key={i.id}>{i.title}</li>
                  ))}
                </ol>
              </details>
              <div className="work-template-actions">
                {t.archivedAt === null && (
                  <button
                    className="button primary"
                    onClick={() => setApplying(t)}
                  >
                    Zastosuj
                  </button>
                )}
                <button
                  className="button secondary"
                  onClick={() => setDraft(t)}
                >
                  Edytuj
                </button>
                <button
                  className="button secondary"
                  onClick={() =>
                    perform(() => {
                      copyWorkTemplate(t.id, t.revision);
                      setNotice(
                        `Utworzono niezależny szablon „${t.name.slice(0, 140)} — kopia”.`,
                      );
                    })
                  }
                >
                  Kopiuj
                </button>
                <button
                  className="button secondary"
                  onClick={() =>
                    perform(() =>
                      archiveWorkTemplate(
                        t.id,
                        t.revision,
                        t.archivedAt === null,
                      ),
                    )
                  }
                >
                  {t.archivedAt === null ? 'Archiwizuj' : 'Przywróć'}
                </button>
                <button className="button ghost" onClick={() => setRemoving(t)}>
                  Usuń szablon
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="work-template-grid">
          {checklists.map((c) => (
            <article className="card checklist-summary" key={c.id}>
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
      )}
      {tab === 'templates' && !templates.length && (
        <p className="card checklist-empty">
          Brak szablonów dla wybranych filtrów.
        </p>
      )}
      {tab === 'checklists' && !checklists.length && (
        <p className="card checklist-empty">
          Brak checklist. Dodaj je w karcie wizyty, ogrodu lub strefy, albo
          zastosuj szablon z biblioteki.
        </p>
      )}
      {draft && <TemplateForm initial={draft} onClose={() => setDraft(null)} />}
      {applying && (
        <AssignmentForm
          template={applying}
          onClose={() => setApplying(null)}
          onApplied={(id) => {
            setApplying(null);
            setSelected(id);
          }}
        />
      )}
      {selected && (
        <ChecklistDetails id={selected} onClose={() => setSelected('')} />
      )}
      {removing && (
        <Modal title="Usunąć szablon prac?" onClose={() => setRemoving(null)}>
          <p>
            Usunąć „{removing.name}”? Istniejące checklisty i postęp wizyt
            pozostaną zachowane. Harmonogramy utracą powiązanie z tym szablonem.
          </p>
          {error && (
            <p role="alert" className="gm-form-error">
              {error}
            </p>
          )}
          <div className="gm-modal-actions">
            <button
              className="button secondary"
              onClick={() => setRemoving(null)}
            >
              Zachowaj szablon
            </button>
            <button
              className="button danger"
              onClick={() =>
                perform(() => {
                  deleteWorkTemplate(removing.id, removing.revision);
                  setRemoving(null);
                })
              }
            >
              Potwierdź usunięcie szablonu
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
