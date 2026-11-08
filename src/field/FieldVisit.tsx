import { useRef, useState } from "react";
import {
  Camera,
  ListChecks,
  Package,
  Pause,
  Play,
  Square,
  StickyNote,
} from "lucide-react";
import Modal from "../components/Modal";
import { useGarden, useNow } from "../state";
import { duration, elapsedSeconds } from "../domain";
import { useNavigation } from "../navigation/Navigation";
import { useCardNavigation } from "../features/card-navigation";
import { requestLeave } from "../navigation/unsaved";
import { fieldSections, type FieldSection } from "../navigation/routes";
import { jobSource, occurrenceCard } from "../navigation/planning-links";
import { incompleteVisitChecklists } from "../checklists/model";
import ChecklistPanel, {
  ChecklistProgress,
} from "../checklists/ChecklistPanel";
import { ContextNotes } from "../desk/Notes";
import PhotoGallery from "../photos/PhotoGallery";
import { AvailabilityNotice } from "../availability/CalendarAvailability";
import { VisitActivitiesForm, VisitMaterialsForm } from "./VisitEditors";
import { timerEventId, type TimerAction } from "./commands";
import "./field.css";
const labels: Record<FieldSection, string> = {
  work: "Czynności",
  photos: "Zdjęcia",
  notes: "Notatki",
  checklists: "Checklisty",
  materials: "Materiały",
};

export default function FieldVisit({
  jobId,
  onClose,
}: {
  jobId: string;
  onClose: () => void;
}) {
  const { data, controlVisitTimer, finishFieldVisit } = useGarden(),
    now = useNow(),
    navigation = useNavigation(),
    card = useCardNavigation();
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [pending, setPending] = useState(false);
  const inFlight = useRef(false),
    camera = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<null | "add" | "edit">(null),
    [materials, setMaterials] = useState(false);
  const section = (card?.section ?? "work") as FieldSection;
  const job = data.jobs.find((j) => j.id === jobId),
    garden = data.gardens.find((g) => g.id === job?.gardenId),
    client = data.clients.find((c) => c.id === garden?.clientId);
  const perform = async (action: () => Promise<unknown>, success: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(success);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };
  if (!job || !garden || !client)
    return (
      <Modal title="Wizyta w terenie" onClose={onClose} fullScreen>
        <p role="status">
          Ta wizyta nie jest już dostępna. Mogła zostać usunięta w innej karcie.
        </p>
        <button className="button secondary" onClick={onClose}>
          Wróć do wyboru wizyty
        </button>
      </Modal>
    );
  const own = data.timer?.jobId === job.id,
    other = !!data.timer && !own,
    source = jobSource(data, job.id);
  const incomplete = incompleteVisitChecklists(data, job.id),
    lists = data.checklists.filter(
      (c) => c.kind === "visit" && c.jobId === job.id,
    );
  const status =
    job.status === "completed"
      ? "Zakończone"
      : job.status === "in-progress"
        ? "W trakcie"
        : "Zaplanowane";
  const control = (action: TimerAction) => {
    if (inFlight.current) return;
    const expected = data.timer,
      eventId = timerEventId(data);
    if (
      action === "stop" &&
      !window.confirm(
        "Czy na pewno zakończyć pomiar czasu pracy? Zakończenie zlecenia i zatwierdzenie ceny to osobne operacje.",
      )
    )
      return;
    void perform(
      () => controlVisitTimer(job.id, action, expected, eventId),
      action === "stop"
        ? "Pomiar zatrzymany. Czas zapisano lokalnie."
        : action === "pause"
          ? "Pauza zapisana lokalnie."
          : action === "resume"
            ? "Wznowienie zapisane lokalnie."
            : "Pomiar rozpoczęty i zapisany lokalnie.",
    );
  };
  const select = (value: FieldSection) => navigation.section(value);
  return (
    <Modal title="Wizyta w terenie" onClose={onClose} fullScreen>
      <div className="field-mode field-visit">
        <header className="field-visit-heading">
          <p className="eyebrow">TRYB TERENOWY · {job.date}</p>
          <h1>{job.title}</h1>
          <p>
            <strong>{client.name}</strong> · {garden.name}
          </p>
          <p>{garden.address}</p>
          <span className={`badge status-${job.status}`}>{status}</span>
        </header>
        <section
          className={`field-timer ${own ? "field-timer-active" : ""}`}
          aria-label="Stoper wizyty"
        >
          <p className="field-timer-state" role="status">
            {own
              ? data.timer?.paused
                ? "PAUZA — przerwa bez naliczania"
                : "POMIAR TRWA"
              : job.status === "completed"
                ? "WIZYTA ZAKOŃCZONA"
                : "POMIAR ZATRZYMANY"}
          </p>
          <output
            className="field-time"
            aria-label="Rzeczywisty czas wizyty"
            aria-live="off"
            data-testid="field-time"
          >
            {duration(elapsedSeconds(job, data.timer, now))}
          </output>
          <div className="field-timer-buttons">
            {job.status !== "completed" &&
              (own ? (
                <>
                  <button
                    className="button primary"
                    disabled={pending}
                    onClick={() =>
                      control(data.timer?.paused ? "resume" : "pause")
                    }
                  >
                    {data.timer?.paused ? (
                      <Play size={24} />
                    ) : (
                      <Pause size={24} />
                    )}{" "}
                    {data.timer?.paused ? "WZNÓW" : "PAUZA"}
                  </button>
                  <button
                    className="button danger"
                    disabled={pending}
                    onClick={() => control("stop")}
                  >
                    <Square size={23} /> STOP
                  </button>
                </>
              ) : (
                <button
                  className="button primary"
                  disabled={pending || other}
                  onClick={() => control("start")}
                >
                  <Play size={24} /> START — Rozpocznij pomiar
                </button>
              ))}
          </div>
          {other && (
            <p className="report-info">
              Inna wizyta ma aktywny lub wstrzymany pomiar.
              <button
                className="button secondary"
                onClick={() =>
                  navigation.open({ kind: "field", id: data.timer!.jobId })
                }
              >
                Otwórz aktywną wizytę
              </button>
            </p>
          )}
          <p>
            Od wyjścia z samochodu do sprzątnięcia i spakowania sprzętu. Dojazd,
            powrót i pauzy poza pomiarem.
          </p>
          {pending && (
            <p role="status">
              Zapisywanie… Poczekaj na zatwierdzenie operacji.
            </p>
          )}
        </section>
        {error && (
          <p className="gm-form-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="field-saved" role="status">
            {notice}
          </p>
        )}
        <nav
          className="field-quick-actions"
          aria-label="Szybkie czynności wizyty"
        >
          <button
            className="button primary"
            onClick={() =>
              requestLeave(() => {
                select("photos");
                camera.current?.click();
              })
            }
          >
            <Camera size={22} />
            Zrób zdjęcie
          </button>
          <button className="button secondary" onClick={() => select("notes")}>
            <StickyNote size={22} />
            Notatki
          </button>
          <button
            className="button secondary"
            onClick={() => select("checklists")}
          >
            <ListChecks size={22} />
            Checklisty ·{" "}
            {incomplete.reduce(
              (n, c) =>
                n + c.items.filter((i) => i.status === "pending").length,
              0,
            )}{" "}
            do zrobienia
          </button>
          <button
            className="button secondary"
            onClick={() => select("materials")}
          >
            <Package size={22} />
            Materiały
          </button>
        </nav>
        <nav
          className="field-section-tabs"
          aria-label="Sekcje wizyty terenowej"
        >
          {fieldSections.map((s) => (
            <button
              key={s}
              className={`button ${section === s ? "primary" : "secondary"}`}
              aria-current={section === s ? "page" : undefined}
              onClick={() => select(s)}
            >
              {labels[s]}
            </button>
          ))}
        </nav>
        {section === "work" && (
          <section className="field-section" aria-label="Czynności wizyty">
            {editing ? (
              <VisitActivitiesForm
                job={job}
                adding={editing === "add"}
                onSaved={() =>
                  setNotice("Czynności zapisane na tym urządzeniu.")
                }
                onClose={() => {
                  setEditing(null);
                }}
              />
            ) : (
              <>
                <h2>Czynności podczas wizyty</h2>
                <ul className="field-activities">
                  {job.activities.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
                {!job.activities.length && (
                  <p className="muted">
                    Dodaj wykonane czynności do tej jednej wizyty.
                  </p>
                )}
                <div className="field-actions">
                  <button
                    className="button primary"
                    onClick={() => setEditing("add")}
                  >
                    Dodaj czynność
                  </button>
                  <button
                    className="button secondary"
                    onClick={() => setEditing("edit")}
                  >
                    Edytuj czynności
                  </button>
                </div>
              </>
            )}
            {job.notes && <p className="preserve-lines">{job.notes}</p>}
            {lists.map((c) => (
              <div className="field-checklist-progress" key={c.id}>
                <strong>{c.name}</strong>
                <ChecklistProgress checklist={c} />
              </div>
            ))}
          </section>
        )}
        <div
          hidden={section !== "photos"}
          inert={section !== "photos"}
          className="field-section"
        >
          <PhotoGallery
            scope={{ jobId: job.id }}
            title="Zdjęcia wizyty"
            cameraInputRef={camera}
          />
        </div>
        {section === "notes" && (
          <div className="field-section">
            <ContextNotes scope={{ jobId: job.id }} title="Notatki wizyty" />
          </div>
        )}
        {section === "checklists" && (
          <div className="field-section">
            <ChecklistPanel
              target={{
                kind: "visit",
                jobId: job.id,
                zoneId: job.visitDetails?.zoneId ?? null,
              }}
            />
          </div>
        )}
        {section === "materials" && (
          <section className="field-section" aria-label="Materiały wizyty">
            <h2>Zużyte materiały</h2>
            {job.materials.length > 0 && (
              <ul>
                {job.materials.map((m) => (
                  <li key={m.id}>
                    {m.name} ·{" "}
                    {m.quantity.toLocaleString("pl-PL", {
                      maximumFractionDigits: 8,
                    })}{" "}
                    {m.unit ?? "jedn."}
                  </li>
                ))}
              </ul>
            )}
            {materials ? (
              <VisitMaterialsForm
                job={job}
                onSaved={() =>
                  setNotice(
                    "Materiały zapisane na tym urządzeniu. Zatwierdzona należność pozostała zachowana.",
                  )
                }
                onClose={() => setMaterials(false)}
              />
            ) : (
              <button
                className="button primary"
                onClick={() => setMaterials(true)}
              >
                Dodaj materiały
              </button>
            )}
          </section>
        )}
        <section className="field-completion" aria-label="Zakończenie wizyty">
          <h2>Podsumowanie i zakończenie</h2>
          {!!incomplete.length && (
            <p className="checklist-finish-warning">
              Pozostały niewykonane punkty checklisty. Możesz świadomie
              zakończyć wizytę mimo niepełnej listy.
            </p>
          )}
          <button
            className="button secondary"
            onClick={() =>
              navigation.open({ kind: "job", id: job.id, section: "summary" })
            }
          >
            Podsumowanie wizyty
          </button>
          {job.status !== "completed" && (
            <button
              className="button primary"
              disabled={own || pending}
              onClick={() => {
                if (inFlight.current) return;
                if (
                  window.confirm(
                    "Zakończyć tę wizytę? Niewykonane punkty pozostaną zapisane. Cena i zabiegi cykliczne wymagają osobnego zatwierdzenia.",
                  )
                )
                  void perform(
                    () => finishFieldVisit(job.id),
                    "Wizytę zakończono lokalnie. Cena i wykonanie zabiegów nie zostały automatycznie zatwierdzone.",
                  );
              }}
            >
              Zakończ wizytę
            </button>
          )}
          {own && (
            <p className="gm-form-note">
              Najpierw zakończ pomiar przyciskiem STOP. Sam STOP nie kończy
              zlecenia.
            </p>
          )}
          {source && (
            <div className="field-care">
              <h3>Powiązana planowana czynność</h3>
              <button
                className="button secondary"
                onClick={() => navigation.open(occurrenceCard(source))}
              >
                {source.title} · {source.originalDate}
              </button>
              <p>
                Wykonanie zabiegu potwierdź osobno, podając faktyczną datę
                wykonania.
              </p>
            </div>
          )}
          {data.taskOccurrences
            .filter(
              (o) => o.completion?.jobId === job.id && o.id !== source?.id,
            )
            .map((o) => (
              <button
                key={o.id}
                className="button secondary"
                onClick={() => navigation.open(occurrenceCard(o))}
              >
                Zabieg: {o.title} · wykonano {o.completion!.performedOn}
              </button>
            ))}
          {job.status !== "completed" && (
            <AvailabilityNotice date={job.date} time={job.time} />
          )}
        </section>
        <nav className="field-related" aria-label="Powiązania wizyty terenowej">
          <button className="button secondary" onClick={onClose}>
            {card?.backLabel ?? "Wróć do wyboru wizyty"}
          </button>
          <button
            className="button secondary"
            onClick={() => navigation.open({ kind: "client", id: client.id })}
          >
            Klient: {client.name}
          </button>
          <button
            className="button secondary"
            onClick={() => navigation.open({ kind: "garden", id: garden.id })}
          >
            Ogród: {garden.name}
          </button>
          <button
            className="button secondary"
            onClick={() => navigation.open({ kind: "job", id: job.id })}
          >
            Pełna karta zlecenia
          </button>
        </nav>
        <p className="gm-form-note">
          Dane na tym urządzeniu · bez automatycznej synchronizacji.
        </p>
      </div>
    </Modal>
  );
}
