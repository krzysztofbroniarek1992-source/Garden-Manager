import { useNavigation } from "../navigation/Navigation";
import {
  nextScheduleOccurrence,
  occurrenceDate,
} from "../navigation/planning-links";
import { localDate } from "../domain";
import { lazy, Suspense } from "react";
import { useGarden } from "../state";
import { scheduleDescription } from "./TaskForm";
const ChecklistPanel = lazy(() => import("../checklists/ChecklistPanel"));
export default function GardenSchedule({ gardenId }: { gardenId: string }) {
  const { data } = useGarden();
  const navigation = useNavigation();
  const schedules = data.taskSchedules.filter((s) => s.gardenId === gardenId);
  const openCalendar = (id: string) => {
    const o = nextScheduleOccurrence(data, id, localDate());
    if (!o) return;
    const date = occurrenceDate(data, id, o.originalDate);
    navigation.openCalendar(
      { date, anchor: date, view: "day", gardenId },
      { kind: "task", id, originalDate: o.originalDate },
    );
  };
  return (
    <>
      <h3>Harmonogram ogrodu</h3>
      <p className="muted">
        Otwórz serię lub jej termin w kalendarzu. Plan nie nalicza czasu ani
        należności.
      </p>
      {schedules.length ? (
        schedules.map((s) => (
          <article key={s.id} className="tool-card">
            <h4>
              <button
                className="job-title-button"
                onClick={() => navigation.open({ kind: "schedule", id: s.id })}
              >
                {s.title}
              </button>
            </h4>
            <p>
              {scheduleDescription(s)} · od {s.startDate}
              {s.endDate && ` do ${s.endDate}`}
            </p>
            {s.zoneName && <p>Strefa: {s.zoneName}</p>}
            {s.endedOn && <p>Seria zakończona: {s.endedOn}</p>}
            <div className="planning-actions">
              <button
                className="button secondary"
                aria-label={`Otwórz harmonogram ${s.title}`}
                onClick={() => navigation.open({ kind: "schedule", id: s.id })}
              >
                Otwórz harmonogram
              </button>
              <button
                className="button secondary"
                aria-label={`Kalendarz harmonogramu ${s.title}`}
                disabled={!nextScheduleOccurrence(data, s.id, localDate())}
                onClick={() => openCalendar(s.id)}
              >
                Pokaż termin w kalendarzu
              </button>
            </div>
          </article>
        ))
      ) : (
        <p>Brak harmonogramów przypisanych do tego ogrodu.</p>
      )}
      <Suspense fallback={<p role="status">Otwieranie planów…</p>}>
        <ChecklistPanel target={{ kind: "plan", gardenId, zoneId: null }} />
      </Suspense>
    </>
  );
}
