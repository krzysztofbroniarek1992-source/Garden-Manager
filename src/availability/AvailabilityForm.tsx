import { useRef, useState, type FormEvent } from "react";
import Modal from "../components/Modal";
import { useGarden } from "../state";
import { useNavigation } from "../navigation/Navigation";
import { useCardNavigation } from "../features/card-navigation";
import { useUnsavedChanges } from "../navigation/unsaved";
import { occurrenceCard } from "../navigation/planning-links";
import {
  availabilityKinds,
  availabilityReasons,
  availabilityMessage,
  dayAvailability,
  defaultAvailability,
  expectedAvailability,
  validateAvailabilityRule,
  type AvailabilityKind,
  type AvailabilityRule,
} from "./model";
import { workConflicts } from "./queries";
import "./availability.css";
export default function AvailabilityForm({
  dates,
  onClose,
}: {
  dates: string[];
  onClose: () => void;
}) {
  const { data, changeAvailability } = useGarden(),
    navigation = useNavigation(),
    card = useCardNavigation();
  const [source] = useState(data),
    [initial] = useState<AvailabilityRule>(() => {
      const d =
        dates.length === 1 ? dayAvailability(data, dates[0]) : undefined;
      return d
        ? {
            kind: d.kind,
            from: d.from,
            to: d.to,
            reason: d.reason,
            note: d.note,
          }
        : {
            ...defaultAvailability(),
            kind: dates.length > 1 ? "unavailable" : "available",
          };
    });
  const [draft, setDraft] = useState(initial),
    [error, setError] = useState(""),
    [mode, setMode] = useState<"overwrite" | "remove" | null>(null),
    [saving, setSaving] = useState(false);
  const inFlight = useRef(false),
    guard = useUnsavedChanges(
      JSON.stringify(draft) !== JSON.stringify(initial) || mode !== null,
    );
  const existing = dates.filter((date) => dayAvailability(source, date));
  const expected = expectedAvailability(source, dates);
  const patch = <K extends keyof AvailabilityRule>(
    key: K,
    value: AvailabilityRule[K],
  ) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setMode(null);
  };
  const changeKind = (kind: AvailabilityKind) => {
    setDraft((d) => ({
      ...d,
      kind,
      from: kind === "from" || kind === "range" ? (d.from ?? "08:00") : null,
      to: kind === "until" || kind === "range" ? (d.to ?? "14:00") : null,
    }));
    setMode(null);
  };
  const perform = async (remove = false) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setError("");
    try {
      await guard.save(async () => {
        await changeAvailability(dates, remove ? null : draft, expected);
        onClose();
      });
    } catch (e) {
      setError(
        e instanceof Error && /quota|disk.*full/i.test(`${e.name} ${e.message}`)
          ? "Brak miejsca na zapis dostępności. Żaden wybrany dzień nie został zmieniony."
          : (e as Error).message,
      );
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      validateAvailabilityRule(draft);
      if (dates.length > 1 && existing.length) {
        setMode("overwrite");
        return;
      }
      await perform();
    } catch (e) {
      setError(
        e instanceof Error && /quota|disk.*full/i.test(`${e.name} ${e.message}`)
          ? "Brak miejsca na zapis dostępności. Żaden wybrany dzień nie został zmieniony."
          : (e as Error).message,
      );
    }
  };
  let conflicts: ReturnType<typeof workConflicts> = [];
  try {
    validateAvailabilityRule(draft);
    const selected = new Set(dates),
      preview = {
        ...data,
        availability: [
          ...(data.availability ?? []).filter((d) => !selected.has(d.date)),
          ...dates.map((date) => ({
            ...draft,
            date,
            revision: 1,
            updatedAt: Date.now(),
          })),
        ],
      };
    conflicts = workConflicts(preview, dates[0], dates.at(-1)).filter((c) =>
      selected.has(c.date),
    );
  } catch {
    /* Invalid hours are reported by the form, never interpreted as a work duration. */
  }
  return (
    <Modal
      title={dates.length === 1 ? "Dostępność dnia" : "Dostępność wielu dni"}
      onClose={onClose}
      wide
    >
      <form ref={guard.ref} onSubmit={submit} className="availability-form">
        <button
          className="button secondary"
          type="button"
          onClick={() => guard.confirm(onClose)}
        >
          {card?.backLabel ?? "Wróć do kalendarza"}
        </button>
        {dates.length === 1 ? (
          <label className="field">
            Data wybrana w kalendarzu
            <input type="date" readOnly value={dates[0]} />
          </label>
        ) : (
          <details>
            <summary>Zaznaczono {dates.length} dni</summary>
            <ul className="availability-date-list">
              {dates.map((date) => (
                <li key={date}>
                  {date}
                  {dayAvailability(source, date) &&
                    ` · obecnie: ${availabilityMessage(dayAvailability(source, date)!)}`}
                </li>
              ))}
            </ul>
          </details>
        )}
        <div className="form-grid">
          <label className="field full-width">
            Rodzaj dostępności
            <select
              value={draft.kind}
              onChange={(e) => changeKind(e.target.value as AvailabilityKind)}
            >
              {Object.entries(availabilityKinds).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {(draft.kind === "from" || draft.kind === "range") && (
            <label className="field">
              Godzina od
              <input
                required
                type="time"
                value={draft.from ?? ""}
                onChange={(e) => patch("from", e.target.value)}
              />
            </label>
          )}
          {(draft.kind === "until" || draft.kind === "range") && (
            <label className="field">
              Godzina do
              <input
                required
                type="time"
                value={draft.to ?? ""}
                onChange={(e) => patch("to", e.target.value)}
              />
            </label>
          )}
          <label className="field">
            Powód (opcjonalnie)
            <select
              value={draft.reason}
              onChange={(e) =>
                patch("reason", e.target.value as AvailabilityRule["reason"])
              }
            >
              {Object.entries(availabilityReasons).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="field full-width">
            Notatka dostępności
            <textarea
              maxLength={500}
              value={draft.note}
              onChange={(e) => patch("note", e.target.value)}
            />
          </label>
        </div>
        <p className="gm-form-note">
          Dostępność jest wspólna dla wszystkich ogrodów. Sprawdzamy godzinę
          rozpoczęcia, bez zakładania długości pracy. Początek przedziału jest
          dostępny, godzina końcowa już nie. Zapis nie tworzy ani nie przesuwa
          zleceń i zabiegów.
        </p>
        {!!conflicts.length && (
          <section
            className="availability-warning"
            aria-label="Kolizje po zmianie dostępności"
          >
            <h3>Kolizje po zmianie: {conflicts.length}</h3>
            <p>
              Prace pozostaną w swoich terminach. Możesz świadomie zachować
              kolizję albo później ręcznie zmienić termin.
            </p>
            {conflicts.slice(0, 30).map((c) => (
              <button
                type="button"
                className="button secondary"
                key={c.id}
                onClick={() =>
                  navigation.open(
                    c.task
                      ? occurrenceCard(c.task)
                      : { kind: "job", id: c.jobId! },
                  )
                }
              >
                {c.date} · {c.time} · {c.title}
              </button>
            ))}
            {conflicts.length > 30 && (
              <p>Więcej kolizji sprawdzisz w kalendarzu poszczególnych dni.</p>
            )}
          </section>
        )}
        {error && (
          <p className="gm-form-error" role="alert">
            {error}
          </p>
        )}
        {saving && <p role="status">Zapisywanie wszystkich wybranych dni…</p>}
        {mode && (
          <section
            className="availability-warning"
            role="group"
            aria-label={
              mode === "remove"
                ? "Potwierdzenie usunięcia dostępności"
                : "Potwierdzenie nadpisania dostępności"
            }
          >
            <h3>
              {mode === "remove"
                ? "Usunąć ustawienia dostępności?"
                : `Nadpisać indywidualne ustawienia ${existing.length === 1 ? "1 dnia" : `${existing.length} dni`}?`}
            </h3>
            <p>
              {mode === "remove"
                ? "Dni wrócą do domyślnej dostępności. Zlecenia, historia i terminy GM-005 pozostaną bez zmian."
                : `Jedna operacja ustawi ${availabilityMessage(draft)} dla wszystkich ${dates.length} zaznaczonych dat.`}
            </p>
            <div className="planning-actions">
              <button
                className="button secondary"
                type="button"
                onClick={() => setMode(null)}
              >
                Anuluj potwierdzenie
              </button>
              <button
                className="button danger"
                disabled={saving}
                type="button"
                onClick={() => perform(mode === "remove")}
              >
                {mode === "remove"
                  ? "Potwierdź usunięcie ograniczeń"
                  : "Potwierdź nadpisanie dni"}
              </button>
            </div>
          </section>
        )}
        <div className="gm-modal-actions">
          <button
            className="button secondary"
            type="button"
            onClick={() => guard.confirm(onClose)}
          >
            Anuluj
          </button>
          <button
            className="button secondary"
            disabled={!existing.length || saving}
            type="button"
            onClick={() => setMode("remove")}
          >
            {dates.length === 1
              ? "Usuń ograniczenie dostępności"
              : "Usuń ograniczenia zaznaczonych dni"}
          </button>
          <button
            className="button primary"
            disabled={saving || mode !== null}
            type="submit"
          >
            Zapisz dostępność
          </button>
        </div>
      </form>
    </Modal>
  );
}
