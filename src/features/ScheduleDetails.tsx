import Modal from "../components/Modal";
import { localDate } from "../domain";
import { useGarden } from "../state";
import { useNavigation, useViewState } from "../navigation/Navigation";
import { useCardNavigation } from "./card-navigation";
import { occurrenceDate, scheduleWindow } from "../navigation/planning-links";
import { isDate } from "../planning/dates";
import { taskStatus, taskStatusLabels } from "../planning/model";
import ScheduleManager from "./ScheduleManager";

export default function ScheduleDetails({
  scheduleId,
  onClose,
}: {
  scheduleId: string;
  onClose: () => void;
}) {
  const { data } = useGarden(),
    navigation = useNavigation(),
    card = useCardNavigation();
  const schedule = data.taskSchedules.find((s) => s.id === scheduleId),
    today = localDate();
  const [from, setFrom] = useViewState("schedule-from", () =>
    schedule?.recurrence.frequency === "once" || schedule?.endedOn
      ? schedule.startDate
      : schedule?.startDate && schedule.startDate > today
        ? schedule.startDate
        : today,
  );
  const [limit, setLimit] = useViewState("schedule-jobs-limit", 20);
  if (!schedule)
    return (
      <Modal title="Harmonogram" onClose={onClose}>
        <p>Harmonogram nie jest już dostępny.</p>
      </Modal>
    );
  const garden = data.gardens.find((g) => g.id === schedule.gardenId);
  const client = data.clients.find(
    (c) => c.id === (garden?.clientId ?? schedule.clientId),
  );
  const occurrences = isDate(from)
    ? scheduleWindow(data, scheduleId, from)
    : [];
  const linked = data.taskOccurrences
    .filter((o) => o.scheduleId === scheduleId && o.jobId)
    .flatMap((o) => {
      const j = data.jobs.find((j) => j.id === o.jobId);
      return j ? [{ job: j, occurrence: o }] : [];
    })
    .sort((a, b) => b.job.date.localeCompare(a.job.date));
  return (
    <Modal title={`Harmonogram: ${schedule.title}`} onClose={onClose} wide>
      <nav className="related-card-links" aria-label="Powiązania harmonogramu">
        <button className="button secondary" onClick={onClose}>
          {card?.backLabel ?? "Wróć do kalendarza"}
        </button>
        {client && (
          <button
            className="button secondary"
            onClick={() => navigation.open({ kind: "client", id: client.id })}
          >
            Klient: {client.name}
          </button>
        )}
        {garden && (
          <button
            className="button secondary"
            onClick={() =>
              navigation.open({
                kind: "garden",
                id: garden.id,
                section: "plans",
              })
            }
          >
            Ogród: {garden.name}
          </button>
        )}
        {garden?.zones.some((z) => z.id === schedule.zoneId) && (
          <button
            className="button secondary"
            onClick={() =>
              navigation.open({
                kind: "garden",
                id: garden.id,
                section: "zones",
                zoneId: schedule.zoneId!,
              })
            }
          >
            Strefa: {garden.zones.find((z) => z.id === schedule.zoneId)?.name}
          </button>
        )}
      </nav>
      <ScheduleManager scheduleId={scheduleId} />
      {schedule.notes && <p className="preserve-lines">{schedule.notes}</p>}
      <section aria-label="Terminy harmonogramu">
        <h3>Terminy harmonogramu</h3>
        <label className="field">
          Terminy od
          <input
            type="date"
            value={from}
            onChange={(e) => {
              if (isDate(e.target.value)) setFrom(e.target.value);
            }}
          />
        </label>
        <p className="muted">
          Do 24 terminów w najbliższych 12 miesiącach od wybranej daty. Zmień
          datę, aby zobaczyć inny okres. Podgląd nie zapisuje wystąpień.
        </p>
        {occurrences.map((o) => {
          const date = occurrenceDate(data, scheduleId, o.originalDate);
            const job=data.jobs.find(j=>j.id===o.jobId);
          return (
            <article key={o.id} className="tool-card">
              <strong>
                {date} · {job?.time??o.time}
              </strong>{" "}
              <span className={`badge status-${taskStatus(data, o)}`}>
                {taskStatusLabels[taskStatus(data, o)]}
              </span>
              {date !== o.originalDate && (
                <p>Termin pierwotny: {o.originalDate}</p>
              )}
              <div className="planning-actions">
                <button
                  className="button secondary"
                  aria-label={`Szczegóły terminu ${o.originalDate}`}
                  onClick={() =>
                    navigation.open({
                      kind: "task",
                      id: scheduleId,
                      originalDate: o.originalDate,
                    })
                  }
                >
                  Szczegóły terminu
                </button>
                <button
                  className="button secondary"
                  aria-label={`Kalendarz terminu ${o.originalDate}`}
                  onClick={() =>
                    navigation.openCalendar(
                      {
                        date,
                        anchor: date,
                        view: "day",
                        ...(garden ? { gardenId: garden.id } : {}),
                      },
                      {
                        kind: "task",
                        id: scheduleId,
                        originalDate: o.originalDate,
                      },
                    )
                  }
                >
                  Pokaż w kalendarzu
                </button>
                {o.jobId && (
                  <button
                    className="button secondary"
                    onClick={() =>
                      navigation.open({ kind: "job", id: o.jobId! })
                    }
                  >
                    Otwórz powiązane zlecenie
                  </button>
                )}
              </div>
            </article>
          );
        })}
        {!occurrences.length && <p>Brak terminów w wybranym okresie.</p>}
      </section>
      <section aria-label="Zlecenia harmonogramu">
        <h3>Powiązane zlecenia i historia</h3>
        {linked.slice(0, limit).map(({ job, occurrence }) => (
          <article className="tool-card" key={job.id}>
            <h4>{job.title}</h4>
            <p>
              {job.date} · termin pierwotny {occurrence.originalDate}
            </p>
            <div className="planning-actions">
              <button
                className="button secondary"
                aria-label={`Zlecenie harmonogramu ${job.title}`}
                onClick={() => navigation.open({ kind: "job", id: job.id })}
              >
                Otwórz zlecenie
              </button>
              <button
                className="button secondary"
                onClick={() =>
                  navigation.open({
                    kind: "task",
                    id: scheduleId,
                    originalDate: occurrence.originalDate,
                  })
                }
              >
                Otwórz źródłowy termin
              </button>
            </div>
          </article>
        ))}
        {!linked.length && <p>Brak rzeczywistych zleceń tego harmonogramu.</p>}
        {linked.length > limit && (
          <button
            className="button secondary"
            onClick={() => setLimit((n) => n + 20)}
          >
            Pokaż kolejne zlecenia harmonogramu
          </button>
        )}
      </section>
    </Modal>
  );
}
