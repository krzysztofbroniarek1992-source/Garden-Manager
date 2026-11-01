import { ContextNotes } from '../desk/Notes';
import PhotoGallery from '../photos/PhotoGallery';
import {
  lazy,
  Suspense,
  useId,
  useMemo,
  useState,
  type FormEvent,
} from 'react';
import { useGarden, useNow } from '../state';
import { localDate, moneyCents, type GardenZone, type Job } from '../domain';
import { formatQuantity } from '../gardening';
import Modal from '../components/Modal';
import GardenForm from './GardenForm';
import { CalculatorPanel } from './Calculators';
import JobDetails from './JobDetails';
import JobForm from './JobForm';
import JobDeleteDialog from './JobDeleteDialog';
import GroupedJobHistory from './GroupedJobHistory';
import GardenSchedule from './GardenSchedule';
import { gardenSummary } from './job-history';
import { useCardNavigation } from './card-navigation';
import './gardening.css';
import './garden-details.css';

const ChecklistPanel = lazy(() => import('../checklists/ChecklistPanel'));
const sections = {
  overview: 'Przegląd',
  zones: 'Strefy i rośliny',
  jobs: 'Zlecenia i historia prac',
  plans: 'Harmonogram i plany czynności',
  billing: 'Rozliczenia',
  gallery: 'Galeria',
  notes: 'Notatki i dokumentacja',
} as const;
type Section = keyof typeof sections;
export default function GardenDetails({
  gardenId,
  onClose,
  active = true,
}: {
  gardenId: string;
  onClose: () => void;
  active?: boolean;
}) {
  const { data, deleteZone, saveJob } = useGarden();
  const navigation = useCardNavigation(),
    now = useNow(),
    id = useId();
  const garden = data.gardens.find((item) => item.id === gardenId);
  const [section, setSection] = useState<Section>('overview');
  const [visited, setVisited] = useState(() => new Set<Section>(['overview']));
  const [status, setStatus] = useState<Job['status'] | ''>('');
  const [editing, setEditing] = useState(false);
  const [zone, setZone] = useState<GardenZone | null>(null);
  const [removing, setRemoving] = useState<GardenZone | null>(null);
  const [selectedJob, setSelectedJob] = useState('');
  const [jobDraft, setJobDraft] = useState<Job | null>(null),
    [deleting, setDeleting] = useState('');
  const [deskZone, setDeskZone] = useState<GardenZone | null>(null);
  const [checklistZone, setChecklistZone] = useState<GardenZone | null>(null);
  const [photoZone, setPhotoZone] = useState<GardenZone | null>(null);
  const [error, setError] = useState('');
  const [calculating, setCalculating] = useState<string | null>(null);
  const jobs = useMemo(
    () => data.jobs.filter((j) => j.gardenId === gardenId),
    [data.jobs, gardenId],
  );
  const filtered = useMemo(
    () => jobs.filter((j) => !status || j.status === status),
    [jobs, status],
  );
  const timing = jobs.some((j) => j.id === data.timer?.jobId) ? now : 0;
  const summary = useMemo(
    () => gardenSummary(data, gardenId, timing),
    [data, gardenId, timing],
  );
  if (!garden)
    return (
      <Modal title="Karta ogrodu" onClose={onClose} fullScreen active={active}>
        <p>Ogród nie jest już dostępny.</p>
      </Modal>
    );
  const client = data.clients.find((c) => c.id === garden.clientId);
  const select = (next: Section) => {
    setSection(next);
    setVisited((previous) => new Set([...previous, next]));
  };
  const openJob = (jobId: string, initialBilling = false) =>
    navigation
      ? navigation.open({ kind: 'job', id: jobId, initialBilling })
      : setSelectedJob(jobId);
  const addJob = () =>
    setJobDraft({
      id: crypto.randomUUID(),
      gardenId,
      title: '',
      date: localDate(),
      time: '08:00',
      status: 'planned',
      billing: 'hourly',
      rate: data.settings.hourlyRate,
      fixedPrice: 0,
      seconds: 0,
      materials: [],
      notes: '',
      activities: [],
      settlement: null,
    });
  return (
    <Modal
      title={`Karta ogrodu: ${garden.name}`}
      onClose={onClose}
      fullScreen
      active={active}
    >
      <div className="garden-workspace">
        <div className="garden-workspace-header">
          <div>
            <button className="client-back" onClick={onClose}>
              ← {navigation?.backLabel ?? 'Wróć do listy ogrodów'}
            </button>
            <p>
              {client && (
                <button
                  className="text-button"
                  onClick={() =>
                    navigation?.open({ kind: 'client', id: client.id })
                  }
                >
                  Klient: {client.name}
                </button>
              )}
            </p>
            <p>
              {garden.address || 'Brak adresu'} ·{' '}
              <strong>{formatQuantity(garden.area)} m²</strong>
            </p>
          </div>
          <button className="button secondary" onClick={() => setEditing(true)}>
            Edytuj dane ogrodu
          </button>
        </div>
        <nav
          className="garden-sections"
          role="tablist"
          aria-label="Sekcje karty ogrodu"
        >
          {(Object.entries(sections) as [Section, string][]).map(
            ([key, label], index, all) => (
              <button
                id={`${id}-tab-${key}`}
                key={key}
                role="tab"
                aria-selected={section === key}
                aria-controls={`${id}-panel-${key}`}
                tabIndex={section === key ? 0 : -1}
                onClick={() => select(key)}
                onKeyDown={(event) => {
                  let target: number | undefined;
                  if (event.key === 'ArrowRight')
                    target = (index + 1) % all.length;
                  if (event.key === 'ArrowLeft')
                    target = (index + all.length - 1) % all.length;
                  if (event.key === 'Home') target = 0;
                  if (event.key === 'End') target = all.length - 1;
                  if (target !== undefined) {
                    event.preventDefault();
                    select(all[target][0]);
                    document
                      .getElementById(`${id}-tab-${all[target][0]}`)
                      ?.focus();
                  }
                }}
              >
                {label}
              </button>
            ),
          )}
        </nav>
        {(Object.keys(sections) as Section[])
          .filter((key) => visited.has(key))
          .map((key) => (
            <section
              className="garden-tab-panel"
              key={key}
              id={`${id}-panel-${key}`}
              role="tabpanel"
              aria-labelledby={`${id}-tab-${key}`}
              hidden={section !== key}
            >
              {key === 'overview' && (
                <>
                  <h3>Przegląd ogrodu</h3>
                  <p className="preserve-lines">
                    {garden.notes || 'Brak dodatkowych notatek o ogrodzie.'}
                  </p>
                  <div className="garden-overview-grid">
                    <article>
                      <span>Strefy ogrodu</span>
                      <strong>{garden.zones.length}</strong>
                    </article>
                    <article>
                      <span>Wszystkie zlecenia</span>
                      <strong>{jobs.length}</strong>
                    </article>
                    <article>
                      <span>Wykonane prace</span>
                      <strong>{summary.completedCount}</strong>
                    </article>
                  </div>
                  <div className="tool-actions">
                    <button className="button primary" onClick={addJob}>
                      Dodaj zlecenie
                    </button>
                    <button
                      className="button secondary"
                      onClick={() => select('zones')}
                    >
                      Zobacz strefy i rośliny
                    </button>
                    <button
                      className="button secondary"
                      onClick={() => select('jobs')}
                    >
                      Zobacz historię zleceń
                    </button>
                  </div>
                </>
              )}
              {key === 'zones' && (
                <>
                  {zone ? (
                    <ZoneForm
                      key={zone.id}
                      gardenId={gardenId}
                      initial={zone}
                      onClose={() => setZone(null)}
                    />
                  ) : (
                    <>
                      <div className="tool-heading">
                        <h3>Strefy ogrodu ({garden.zones.length})</h3>
                        <button
                          className="button primary"
                          onClick={() =>
                            setZone({
                              id: crypto.randomUUID(),
                              name: '',
                              type: 'trawnik',
                              area: null,
                              length: null,
                              plants: '',
                              requirements: '',
                              treatments: '',
                            })
                          }
                        >
                          Dodaj strefę
                        </button>
                      </div>
                      <button
                        className="button secondary"
                        onClick={() => setCalculating('')}
                      >
                        Oblicz dla całego ogrodu
                      </button>
                      {error && (
                        <p role="alert" className="gm-form-error">
                          {error}
                        </p>
                      )}
                      {removing && (
                        <div
                          className="tool-confirm"
                          role="group"
                          aria-label="Potwierdzenie usunięcia strefy"
                        >
                          <strong>Usunąć strefę „{removing.name}”?</strong>
                          <p>
                            Zapisane zlecenia, materiały i historia prac
                            pozostaną zachowane.
                          </p>
                          <div className="tool-actions">
                            <button
                              className="button secondary"
                              onClick={() => setRemoving(null)}
                            >
                              Anuluj usunięcie
                            </button>
                            <button
                              className="button danger"
                              onClick={() => {
                                try {
                                  deleteZone(gardenId, removing.id);
                                  setRemoving(null);
                                  setError('');
                                } catch (cause) {
                                  setError((cause as Error).message);
                                }
                              }}
                            >
                              Potwierdź usunięcie strefy
                            </button>
                          </div>
                        </div>
                      )}
                      {!garden.zones.length && (
                        <p className="muted">
                          Dodaj trawnik, rabatę, żywopłot lub inną strefę, aby
                          zapisać jej wymiary i wymagania.
                        </p>
                      )}
                      <div className="zone-list">
                        {garden.zones.map((item) => (
                          <article
                            className="tool-card zone-card"
                            key={item.id}
                          >
                            <h4>
                              {item.name} <small>{item.type}</small>
                            </h4>
                            <p>
                              {item.area !== null &&
                                `${formatQuantity(item.area)} m²`}
                              {item.area !== null &&
                                item.length !== null &&
                                ' · '}
                              {item.length !== null &&
                                `${formatQuantity(item.length)} m`}
                            </p>
                            <dl>
                              {(
                                [
                                  ['Rośliny', item.plants],
                                  ['Szczególne wymagania', item.requirements],
                                  ['Wykonane zabiegi', item.treatments],
                                ] as const
                              ).map(
                                ([label, value]) =>
                                  value && (
                                    <div key={label}>
                                      <dt>{label}</dt>
                                      <dd className="preserve-lines">
                                        {value}
                                      </dd>
                                    </div>
                                  ),
                              )}
                            </dl>
                            <div className="tool-actions">
                              <button
                                className="button secondary"
                                aria-label={`Checklisty strefy ${item.name}`}
                                onClick={() => setChecklistZone(item)}
                              >
                                Checklisty strefy
                              </button>
                              <button
                                className="button secondary"
                                aria-label={`Notatki strefy ${item.name}`}
                                onClick={() => setDeskZone(item)}
                              >
                                Notatki strefy
                              </button>
                              <button
                                className="button secondary"
                                aria-label={`Zdjęcia strefy ${item.name}`}
                                onClick={() => setPhotoZone(item)}
                              >
                                Zdjęcia strefy
                              </button>
                              <button
                                className="button primary"
                                aria-label={`Oblicz dla strefy ${item.name}`}
                                onClick={() => setCalculating(item.id)}
                              >
                                Oblicz materiały
                              </button>
                              <button
                                className="button secondary"
                                aria-label={`Edytuj strefę ${item.name}`}
                                onClick={() => setZone(item)}
                              >
                                Edytuj strefę
                              </button>
                              <button
                                className="button ghost"
                                aria-label={`Usuń strefę ${item.name}`}
                                onClick={() => {
                                  setRemoving(item);
                                  setError('');
                                }}
                              >
                                Usuń strefę
                              </button>
                            </div>
                          </article>
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}
              {key === 'jobs' && (
                <>
                  <div className="garden-job-tools">
                    <h3>Zlecenia i historia prac ({jobs.length})</h3>
                    <button className="button primary" onClick={addJob}>
                      Dodaj zlecenie
                    </button>
                    <label className="field">
                      Status zlecenia
                      <select
                        aria-label="Filtr statusu zleceń ogrodu"
                        value={status}
                        onChange={(e) =>
                          setStatus(e.target.value as typeof status)
                        }
                      >
                        <option value="">Wszystkie statusy</option>
                        <option value="planned">Zaplanowane</option>
                        <option value="in-progress">W trakcie</option>
                        <option value="completed">Zakończone</option>
                      </select>
                    </label>
                  </div>
                  <GroupedJobHistory
                    jobs={filtered}
                    onOpen={openJob}
                    onEdit={setJobDraft}
                    onDelete={setDeleting}
                  />
                </>
              )}
              {key === 'plans' && <GardenSchedule gardenId={gardenId} />}
              {key === 'billing' && (
                <>
                  <h3>Rozliczenia ogrodu</h3>
                  <div className="garden-balances">
                    <article>
                      <span>Wartość wykonanych prac · zatwierdzone</span>
                      <strong>{moneyCents(summary.completedValueCents)}</strong>
                    </article>
                    <article>
                      <span>Otrzymane płatności · także zaliczki</span>
                      <strong>{moneyCents(summary.receivedCents)}</strong>
                    </article>
                    <article>
                      <span>Pozostało do zapłaty · zatwierdzone</span>
                      <strong>{moneyCents(summary.outstandingCents)}</strong>
                    </article>
                  </div>
                  <p className="gm-form-note">
                    Kwoty pochodzą z dotychczasowych rozliczeń i wpłat. Wybierz
                    „Wizyta i rozliczenie”, aby otworzyć ich szczegóły.
                  </p>
                  <GroupedJobHistory jobs={jobs} onOpen={openJob} />
                </>
              )}
              {key === 'gallery' && (
                <PhotoGallery
                  key={gardenId}
                  scope={{ gardenId }}
                  title="Galeria i historia ogrodu"
                />
              )}
              {key === 'notes' && (
                <ContextNotes scope={{ gardenId }} title="Notatki ogrodu" />
              )}
            </section>
          ))}
      </div>
      {editing && (
        <GardenForm
          initial={garden}
          isNew={false}
          onClose={() => setEditing(false)}
        />
      )}
      {selectedJob && (
        <JobDetails jobId={selectedJob} onClose={() => setSelectedJob('')} />
      )}
      {jobDraft && (
        <JobForm
          key={jobDraft.id}
          job={jobDraft}
          clientId={garden.clientId}
          onClose={() => setJobDraft(null)}
          onSave={(draft, expected) => {
            saveJob(draft, expected);
            setJobDraft(null);
            select('jobs');
            openJob(draft.id);
          }}
        />
      )}
      {deleting && (
        <JobDeleteDialog jobId={deleting} onClose={() => setDeleting('')} />
      )}
      {calculating !== null && (
        <Modal
          title="Kalkulator ogrodu"
          onClose={() => setCalculating(null)}
          wide
        >
          <button
            className="button secondary"
            onClick={() => setCalculating(null)}
          >
            Wróć do karty ogrodu
          </button>
          <CalculatorPanel
            initialGardenId={gardenId}
            initialZoneId={calculating}
          />
        </Modal>
      )}
      {checklistZone && (
        <Modal
          title={`Plany strefy: ${checklistZone.name}`}
          onClose={() => setChecklistZone(null)}
          wide
        >
          <Suspense fallback={<p role="status">Otwieranie checklist…</p>}>
            <ChecklistPanel
              target={{ kind: 'plan', gardenId, zoneId: checklistZone.id }}
            />
          </Suspense>
        </Modal>
      )}
      {deskZone && (
        <Modal
          title={`Notatki strefy: ${deskZone.name}`}
          onClose={() => setDeskZone(null)}
          wide
        >
          <ContextNotes
            scope={{ gardenId, zoneId: deskZone.id }}
            title="Notatki strefy"
          />
        </Modal>
      )}
      {photoZone && (
        <Modal
          title={`Zdjęcia strefy: ${photoZone.name}`}
          onClose={() => setPhotoZone(null)}
          wide
        >
          <PhotoGallery
            key={photoZone.id}
            scope={{ gardenId, zoneId: photoZone.id }}
            title="Galeria strefy"
          />
        </Modal>
      )}
    </Modal>
  );
}

function ZoneForm({
  gardenId,
  initial,
  onClose,
}: {
  gardenId: string;
  initial: GardenZone;
  onClose: () => void;
}) {
  const { saveZone } = useGarden();
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState('');
  const patch = <K extends keyof GardenZone>(key: K, value: GardenZone[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  function submit(event: FormEvent) {
    event.preventDefault();
    try {
      saveZone(gardenId, draft);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <form onSubmit={submit} className="zone-form">
      <h3>{initial.name ? 'Edycja strefy' : 'Nowa strefa'}</h3>
      {error && (
        <p role="alert" className="gm-form-error">
          {error}
        </p>
      )}
      <div className="form-grid">
        <label className="field">
          Nazwa strefy
          <input
            required
            maxLength={150}
            value={draft.name}
            onChange={(e) => patch('name', e.target.value)}
          />
        </label>
        <label className="field">
          Rodzaj strefy
          <input
            required
            list="zone-types"
            maxLength={100}
            value={draft.type}
            onChange={(e) => patch('type', e.target.value)}
          />
          <datalist id="zone-types">
            {['trawnik', 'rabata', 'żywopłot', 'drzewa', 'nawierzchnia'].map(
              (type) => (
                <option key={type} value={type} />
              ),
            )}
          </datalist>
        </label>
        <label className="field">
          Powierzchnia strefy (m²)
          <input
            type="number"
            min="0"
            step="any"
            value={draft.area ?? ''}
            onChange={(e) =>
              patch(
                'area',
                e.target.value === '' ? null : Number(e.target.value),
              )
            }
          />
        </label>
        <label className="field">
          Długość strefy (m)
          <input
            type="number"
            min="0"
            step="any"
            value={draft.length ?? ''}
            onChange={(e) =>
              patch(
                'length',
                e.target.value === '' ? null : Number(e.target.value),
              )
            }
          />
        </label>
        <label className="field full-width">
          Rośliny
          <textarea
            maxLength={5000}
            value={draft.plants}
            onChange={(e) => patch('plants', e.target.value)}
          />
        </label>
        <label className="field full-width">
          Szczególne wymagania
          <textarea
            maxLength={5000}
            value={draft.requirements}
            onChange={(e) => patch('requirements', e.target.value)}
          />
        </label>
        <label className="field full-width">
          Wykonane zabiegi
          <textarea
            maxLength={10000}
            placeholder="Data i opis zabiegu"
            value={draft.treatments}
            onChange={(e) => patch('treatments', e.target.value)}
          />
        </label>
      </div>
      <div className="gm-modal-actions">
        <button className="button secondary" type="button" onClick={onClose}>
          Anuluj edycję strefy
        </button>
        <button className="button primary" type="submit">
          Zapisz strefę
        </button>
      </div>
    </form>
  );
}
