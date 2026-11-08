import { useNavigation } from "../navigation/Navigation";
import {
  nextScheduleOccurrence,
  occurrenceCard,
  occurrenceDate,
} from "../navigation/planning-links";
import { localDate } from "../domain";
import { lazy, Suspense } from "react";
import { useGarden } from "../state";
import { scheduleDescription } from "./TaskForm";
const ChecklistPanel = lazy(() => import("../checklists/ChecklistPanel"));
export default function GardenSchedule({
  gardenId,
  zoneId,
}: {
  gardenId: string;
  zoneId?: string;
}) {
  const { data } = useGarden();
  const navigation = useNavigation();
  const schedules = data.taskSchedules.filter(
    (s) => s.gardenId === gardenId && (!zoneId || s.zoneId === zoneId),
  );
  const openCalendar = (id: string) => {
    const o = nextScheduleOccurrence(data, id, localDate());
    if (!o) return;
    const date = occurrenceDate(data, id, o.originalDate, o.careCycle);
    navigation.openCalendar(
      { date, anchor: date, view: "day", gardenId },
      occurrenceCard(o),
    );
  };
  return (
    <>
      <h3>{zoneId ? "Harmonogram strefy" : "Harmonogram ogrodu"}</h3>
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
            {s.zoneName && (
              <p>
                {data.gardens
                  .find((g) => g.id === gardenId)
                  ?.zones.some((z) => z.id === s.zoneId) ? (
                  <button
                    className="text-button"
                    onClick={() =>
                      navigation.open({
                        kind: "zone",
                        gardenId,
                        id: s.zoneId!,
                        section: "overview",
                      })
                    }
                  >
                    Strefa:{" "}
                    {
                      data.gardens
                        .find((g) => g.id === gardenId)
                        ?.zones.find((z) => z.id === s.zoneId)?.name
                    }
                  </button>
                ) : (
                  <>Historyczna strefa: {s.zoneName}</>
                )}
              </p>
            )}
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
        <p>
          {zoneId
            ? "Brak harmonogramów przypisanych do tej strefy."
            : "Brak harmonogramów przypisanych do tego ogrodu."}
        </p>
      )}
      <Suspense fallback={<p role="status">Otwieranie planów…</p>}>
        <ChecklistPanel
          target={{ kind: "plan", gardenId, zoneId: zoneId ?? null }}
        />
      </Suspense>
    </>
  );
}
