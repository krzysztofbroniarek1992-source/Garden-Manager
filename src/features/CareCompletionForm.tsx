import { useState, useRef, type FormEvent } from "react";
import { useGarden } from "../state";
import { localDate } from "../domain";
import { useUnsavedChanges } from "../navigation/unsaved";
import type { TaskOccurrence, TaskSchedule } from "../planning/model";
import { isDate } from "../planning/dates";
import { nextCareDate } from "../planning/care";

export default function CareCompletionForm({
  occurrence,
  schedule,
  onClose,
}: {
  occurrence: TaskOccurrence;
  schedule: TaskSchedule;
  onClose: () => void;
}) {
  const { data, completeCareOccurrence } = useGarden();
  const [version] = useState({
    scheduleRevision: schedule.revision,
    occurrenceRevision: occurrence.revision,
  });
  const [date, setDate] = useState(""),
    [jobId, setJobId] = useState(occurrence.jobId ?? ""),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  const inFlight = useRef(false),
    guard = useUnsavedChanges(!!date || jobId !== (occurrence.jobId ?? ""));
  const next = isDate(date) ? nextCareDate(schedule, date) : null;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    try {
      await guard.save(async () => {
        await completeCareOccurrence(
          schedule.id,
          occurrence.originalDate,
          occurrence.careCycle!,
          date,
          jobId || null,
          version,
        );
        onClose();
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };
  return (
    <form
      ref={guard.ref}
      onSubmit={submit}
      className="planning-confirm"
      aria-label="Potwierdzenie wykonania zabiegu"
    >
      <h4>Potwierdź wykonanie konkretnego zabiegu</h4>
      <p>
        Podaj faktyczną datę pracy. Zapis nie tworzy zlecenia, nie uruchamia
        stopera i nie nalicza należności.
      </p>
      <label className="field">
        Faktyczna data wykonania
        <input
          required
          type="date"
          max={localDate()}
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </label>
      <label className="field">
        Istniejące zlecenie lub wizyta (opcjonalnie)
        <select
          disabled={!!occurrence.jobId}
          value={jobId}
          onChange={(e) => setJobId(e.target.value)}
        >
          <option value="">Bez powiązanej wizyty</option>
          {data.jobs
            .filter((j) => j.gardenId === occurrence.gardenId)
            .sort((a, b) => b.date.localeCompare(a.date))
            .map((j) => (
              <option key={j.id} value={j.id}>
                {j.date} · {j.title}
              </option>
            ))}
        </select>
      </label>
      {isDate(date) && (
        <p role="status">
          {next
            ? `Następny termin od faktycznego wykonania: ${next}`
            : "Po wykonaniu nie będzie kolejnego terminu w granicach serii."}
        </p>
      )}
      {error && (
        <p role="alert" className="gm-form-error">
          {error}
        </p>
      )}
      {saving && (
        <p role="status">Zapisywanie wykonania i następnego terminu…</p>
      )}
      <div className="planning-actions">
        <button
          type="button"
          className="button secondary"
          disabled={saving}
          onClick={() => guard.confirm(onClose)}
        >
          Anuluj potwierdzenie
        </button>
        <button className="button primary" type="submit" disabled={saving}>
          Zapisz wykonanie zabiegu
        </button>
      </div>
    </form>
  );
}
