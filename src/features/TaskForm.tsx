import { AvailabilityNotice } from "../availability/CalendarAvailability";
import { activeCareDate } from "../planning/care";
import { scheduleDates, validateRule } from "../planning/dates";
import { useUnsavedChanges } from "../navigation/unsaved";
import { useState, type FormEvent } from "react";
import Modal from "../components/Modal";
import { useGarden } from "../state";
import type { Frequency, TaskSchedule } from "../planning/model";
import "./planning.css";

export const months = [
  "Styczeń",
  "Luty",
  "Marzec",
  "Kwiecień",
  "Maj",
  "Czerwiec",
  "Lipiec",
  "Sierpień",
  "Wrzesień",
  "Październik",
  "Listopad",
  "Grudzień",
];
export const frequencies: Record<Frequency, string> = {
  once: "Jednorazowo",
  days: "Codziennie / co kilka dni",
  weeks: "Co tydzień / kilka tygodni",
  months: "Co miesiąc / kilka miesięcy",
  years: "Co rok / kilka lat",
};
export function newTaskSchedule(date: string): TaskSchedule {
  return {
    id: crypto.randomUUID(),
    title: "",
    notes: "",
    startDate: date,
    endDate: null,
    time: "08:00",
    clientId: null,
    gardenId: null,
    zoneId: null,
    zoneName: null,
    recurrence: {
      frequency: "once",
      interval: 1,
      months: months.map((_, i) => i + 1),
    },
    endedOn: null,
    revision: 0,
    updatedAt: 0,
  };
}
export function scheduleDescription(schedule: TaskSchedule): string {
  if (schedule.recurrence.frequency === "once") return "Jednorazowo";
  const unit = { days: "dni", weeks: "tyg.", months: "mies.", years: "lat" }[
    schedule.recurrence.frequency
  ];
  return `${schedule.care ? "Od wykonania · " : ""}Co ${schedule.recurrence.interval} ${unit}${schedule.recurrence.months.length < 12 ? ` · ${schedule.recurrence.months.map((m) => months[m - 1].slice(0, 3).toLocaleLowerCase("pl")).join(", ")}` : ""}`;
}
export default function TaskForm({
  initial,
  onClose,
  onDone = onClose,
}: {
  initial: TaskSchedule;
  onClose: () => void;
  onDone?: () => void;
}) {
  const { data, saveTaskSchedule } = useGarden();
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState("");
  const guard = useUnsavedChanges(
    JSON.stringify(draft) !== JSON.stringify(initial),
  );
  const patch = <K extends keyof TaskSchedule>(
    key: K,
    value: TaskSchedule[K],
  ) => setDraft((current) => ({ ...current, [key]: value }));
  const gardens = data.gardens.filter(
    (g) => !draft.clientId || g.clientId === draft.clientId,
  );
  const garden = data.gardens.find((g) => g.id === draft.gardenId);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await guard.save(async () => {
        await saveTaskSchedule(draft);
        onDone();
      });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  let firstDate:string|null=null;
  if(!initial.revision)try{validateRule(draft);firstDate=draft.care?activeCareDate(draft,draft.startDate):scheduleDates(draft,draft.startDate,"9999-12-31").next().value??null;}catch{/* Draft dates are validated on submit. */}
  return (
    <Modal
      title={initial.revision ? "Edytuj harmonogram" : "Nowe zadanie"}
      onClose={onClose}
      wide
    >
      <form ref={guard.ref} onSubmit={submit}>
        {firstDate&&<AvailabilityNotice date={firstDate} time={draft.time}/>}
        {error && (
          <p role="alert" className="gm-form-error">
            {error}
          </p>
        )}
        <p className="gm-form-note">
          Planowanie nie uruchamia stopera i nie tworzy należności. Pracę
          rozpoczniesz z konkretnego terminu.
        </p>
        {initial.revision > 0 && !initial.care && (
          <p className="planning-note">
            Zmiana reguły dotyczy terminów bez zapisanych wyjątków. Przesunięte
            i pominięte terminy oraz istniejące zlecenia zostaną zachowane.
          </p>
        )}
        {initial.endedOn && (
          <p className="planning-note">
            Seria zakończona: {initial.endedOn}. Edycja opisu nie wznawia serii.
          </p>
        )}
        {!initial.revision && (
          <label className="field">
            Sposób planowania
            <select
              aria-label="Sposób planowania"
              value={draft.care ? "care" : "fixed"}
              onChange={(e) =>
                setDraft((current) => {
                  const { care: _care, ...fixed } = current;
                  return e.target.value === "care"
                    ? {
                        ...current,
                        care: { season: null, material: "", notes: "" },
                        recurrence: {
                          frequency: "days",
                          interval: 30,
                          months: months.map((_, i) => i + 1),
                        },
                      }
                    : fixed;
                })
              }
            >
              <option value="fixed">
                Dotychczasowy harmonogram od daty rozpoczęcia
              </option>
              <option value="care">
                Zabieg — kolejny termin od faktycznego wykonania
              </option>
            </select>
          </label>
        )}
        {draft.care && (
          <p className="planning-note">
            W serii czeka jeden zabieg. Kolejny termin powstaje po podaniu
            faktycznej daty wykonania. Przełożenie terminu nie rozpoczyna nowego
            cyklu. Zmiana częstotliwości obowiązuje od następnego wykonania;
            bieżący termin i historia pozostają zachowane.
          </p>
        )}
        <div className="form-grid planning-form-grid">
          <label className="field full-width">
            Nazwa zadania
            <input
              required
              maxLength={150}
              value={draft.title}
              onChange={(e) => patch("title", e.target.value)}
              placeholder="np. Koszenie trawnika"
            />
          </label>
          <label className="field">
            {draft.care ? "Klient (wymagany)" : "Klient (opcjonalnie)"}
            <select
              required={!!draft.care}
              value={draft.clientId ?? ""}
              onChange={(e) =>
                setDraft((current) => ({
                  ...current,
                  clientId: e.target.value || null,
                  gardenId: null,
                  zoneId: null,
                  zoneName: null,
                }))
              }
            >
              <option value="">Bez przypisania do klienta</option>
              {data.clients.map((c) => (
                <option value={c.id} key={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            {draft.care ? "Ogród (wymagany)" : "Ogród (opcjonalnie)"}
            <select
              required={!!draft.care}
              value={draft.gardenId ?? ""}
              onChange={(e) => {
                const g = data.gardens.find((g) => g.id === e.target.value);
                setDraft((current) => ({
                  ...current,
                  gardenId: g?.id ?? null,
                  clientId: g?.clientId ?? current.clientId,
                  zoneId: null,
                  zoneName: null,
                }));
              }}
            >
              <option value="">Bez przypisania do ogrodu</option>
              {gardens.map((g) => (
                <option value={g.id} key={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field full-width">
            Strefa (opcjonalnie)
            <select
              disabled={!garden}
              value={draft.zoneId ?? ""}
              onChange={(e) => patch("zoneId", e.target.value || null)}
            >
              <option value="">Cały ogród / bez strefy</option>
              {draft.zoneId &&
                !garden?.zones.some((z) => z.id === draft.zoneId) && (
                  <option value={draft.zoneId}>
                    {draft.zoneName || "Usunięta strefa"}
                  </option>
                )}
              {garden?.zones.map((z) => (
                <option value={z.id} key={z.id}>
                  {z.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field full-width">
            Szablon checklisty (opcjonalnie)
            <select
              aria-label="Szablon checklisty (opcjonalnie)"
              value={draft.checklistTemplateId ?? ""}
              onChange={(e) =>
                patch("checklistTemplateId", e.target.value || null)
              }
            >
              <option value="">Bez szablonu checklisty</option>
              {data.workTemplates
                .filter(
                  (t) =>
                    t.archivedAt === null || t.id === draft.checklistTemplateId,
                )
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.archivedAt !== null ? " (archiwum)" : ""}
                  </option>
                ))}
            </select>
            <small className="gm-form-note">
              Lista powstanie dopiero po zastosowaniu przy rzeczywistej wizycie.
            </small>
          </label>
          <label className="field">
            Data rozpoczęcia
            <input
              required
              type="date"
              disabled={!!initial.revision && !!draft.care}
              value={draft.startDate}
              onChange={(e) => patch("startDate", e.target.value)}
            />
          </label>
          <label className="field">
            Godzina zadania
            <input
              required
              type="time"
              value={draft.time}
              onChange={(e) => patch("time", e.target.value)}
            />
          </label>
          <label className="field">
            Powtarzanie
            <select
              value={draft.recurrence.frequency}
              onChange={(e) =>
                patch("recurrence", {
                  ...draft.recurrence,
                  frequency: e.target.value as Frequency,
                })
              }
            >
              {Object.entries(frequencies)
                .filter(
                  ([value]) =>
                    !draft.care || ["days", "weeks", "months"].includes(value),
                )
                .map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
            </select>
          </label>
          {draft.recurrence.frequency !== "once" && (
            <label className="field">
              Powtarzaj co (
              {
                {
                  days: "dni",
                  weeks: "tygodni",
                  months: "miesięcy",
                  years: "lat",
                }[draft.recurrence.frequency]
              }
              )
              <input
                required
                type="number"
                min="1"
                max="1000"
                step="1"
                value={draft.recurrence.interval}
                onChange={(e) =>
                  patch("recurrence", {
                    ...draft.recurrence,
                    interval: Number(e.target.value),
                  })
                }
              />
            </label>
          )}
          <label className="field">
            Data zakończenia (opcjonalnie)
            <input
              type="date"
              min={draft.startDate}
              value={draft.endDate ?? ""}
              onChange={(e) => patch("endDate", e.target.value || null)}
            />
          </label>
          <label className="field full-width">
            Opis i wymagania
            <textarea
              maxLength={5000}
              value={draft.notes}
              onChange={(e) => patch("notes", e.target.value)}
            />
          </label>
        </div>
        {!draft.care && draft.recurrence.frequency !== "once" && (
          <fieldset className="season-months">
            <legend>Miesiące realizacji</legend>
            <div>
              {months.map((month, i) => (
                <label key={month}>
                  <input
                    type="checkbox"
                    checked={draft.recurrence.months.includes(i + 1)}
                    onChange={(e) =>
                      patch("recurrence", {
                        ...draft.recurrence,
                        months: e.target.checked
                          ? [...draft.recurrence.months, i + 1].sort(
                              (a, b) => a - b,
                            )
                          : draft.recurrence.months.filter((m) => m !== i + 1),
                      })
                    }
                  />
                  {month}
                </label>
              ))}
            </div>
            <p className="gm-form-note">
              Terminy liczymy od daty rozpoczęcia i pokazujemy tylko w
              zaznaczonych miesiącach. Dla prac dwa razy w roku wybierz
              powtarzanie co 1 miesiąc i zaznacz dwa miesiące.
            </p>
          </fieldset>
        )}
        {draft.care && (
          <>
            <label className="desk-checkbox">
              <input
                type="checkbox"
                checked={!!draft.care.season}
                onChange={(e) =>
                  patch("care", {
                    ...draft.care!,
                    season: e.target.checked
                      ? { from: "04-01", to: "09-30" }
                      : null,
                  })
                }
              />
              Ogranicz do sezonu
            </label>
            {draft.care.season && (
              <fieldset className="season-months">
                <legend>Coroczny okres zabiegów</legend>
                <div className="form-grid">
                  {(["from", "to"] as const).map((bound) => (
                    <div key={bound}>
                      <span>
                        {bound === "from" ? "Początek sezonu" : "Koniec sezonu"}
                      </span>
                      <div className="planning-actions">
                        <label className="field">
                          {bound === "from"
                            ? "Dzień początku sezonu"
                            : "Dzień końca sezonu"}
                          <input
                            required
                            type="number"
                            min="1"
                            max="31"
                            value={Number(draft.care!.season![bound].slice(3))}
                            onChange={(e) =>
                              patch("care", {
                                ...draft.care!,
                                season: {
                                  ...draft.care!.season!,
                                  [bound]:
                                    draft.care!.season![bound].slice(0, 3) +
                                    String(Number(e.target.value)).padStart(
                                      2,
                                      "0",
                                    ),
                                },
                              })
                            }
                          />
                        </label>
                        <label className="field">
                          {bound === "from"
                            ? "Miesiąc początku sezonu"
                            : "Miesiąc końca sezonu"}
                          <select
                            value={Number(
                              draft.care!.season![bound].slice(0, 2),
                            )}
                            onChange={(e) =>
                              patch("care", {
                                ...draft.care!,
                                season: {
                                  ...draft.care!.season!,
                                  [bound]:
                                    String(e.target.value).padStart(2, "0") +
                                    draft.care!.season![bound].slice(2),
                                },
                              })
                            }
                          >
                            {months.map((m, i) => (
                              <option key={m} value={i + 1}>
                                {m}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="gm-form-note">
                  Granice sezonu są włącznie. Termin poza sezonem wznowimy w
                  pierwszym aktywnym dniu. Okres może przechodzić przez koniec
                  roku. Niewykonany zabieg pozostaje pojedynczą zaległością,
                  również po zakończeniu sezonu.
                </p>
              </fieldset>
            )}
            <label className="field">
              Preparat lub materiał (opcjonalnie)
              <input
                maxLength={1000}
                value={draft.care.material}
                onChange={(e) =>
                  patch("care", { ...draft.care!, material: e.target.value })
                }
              />
            </label>
            <p className="gm-form-note">
              Dawkę środka ochrony roślin przepisz z aktualnej etykiety
              konkretnego preparatu. Aplikacja nie dobiera dawek ani mieszanin.
            </p>
            <label className="field">
              Dodatkowe uwagi
              <textarea
                maxLength={5000}
                value={draft.care.notes ?? ""}
                onChange={(e) =>
                  patch("care", { ...draft.care!, notes: e.target.value })
                }
              />
            </label>
          </>
        )}
        <div className="gm-modal-actions">
          <button
            className="button secondary"
            type="button"
            onClick={() => guard.confirm(onClose)}
          >
            Anuluj
          </button>
          <button className="button primary" type="submit">
            Zapisz harmonogram
          </button>
        </div>
      </form>
    </Modal>
  );
}
