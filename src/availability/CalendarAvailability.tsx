import { useMemo } from "react";
import { useGarden } from "../state";
import { useNavigation } from "../navigation/Navigation";
import { occurrenceCard } from "../navigation/planning-links";
import { localDate } from "../domain";
import {
  availabilityConflict,
  availabilityReasons,
  availabilityLabel,
  availabilityMessage,
  dayAvailability,
} from "./model";
import { nextAvailableDays, workConflicts } from "./queries";
import "./availability.css";
export function AvailabilityNotice({
  date,
  time,
}: {
  date: string;
  time: string;
}) {
  const { data } = useGarden(),
    navigation = useNavigation(),
    rule = availabilityConflict(data, date, time);
  if (!rule) return null;
  return (
    <div className="availability-warning" role="alert">
      <strong>
        Uwaga! Termin koliduje z dostępnością: {availabilityMessage(rule)}
      </strong>
      <p>
        Termin i historia pozostają bez zmian. Możesz ręcznie przełożyć pracę.
      </p>
      <button
        type="button"
        className="button secondary"
        onClick={() =>
          navigation.openCalendar({ date, anchor: date, view: "day" })
        }
      >
        Sprawdź dzień w kalendarzu
      </button>
    </div>
  );
}
export function AvailabilityStrip({ date }: { date: string }) {
  const { data } = useGarden(),
    rule = dayAvailability(data, date),
    tone =
      !rule || rule.kind === "available"
        ? "available"
        : rule.kind === "unavailable"
          ? "unavailable"
          : "partial";
  return (
    <span
      className={`availability-strip availability-${tone}`}
      title={
        rule
          ? availabilityMessage(rule)
          : "Cały dzień dostępny — bez ograniczeń"
      }
    >
      {availabilityLabel(rule, true)}
      {rule?.reason && <span> · {availabilityReasons[rule.reason]}</span>}
    </span>
  );
}
export function DayAvailability({ date }: { date: string }) {
  const { data } = useGarden(),
    navigation = useNavigation(),
    rule = dayAvailability(data, date);
  const conflicts = useMemo(() => workConflicts(data, date), [data, date]);
  return (
    <section
      className="day-availability"
      aria-label="Dostępność wybranego dnia"
    >
      <AvailabilityStrip date={date} />
      {rule?.note && <p className="preserve-lines">{rule.note}</p>}
      <button
        className="button secondary"
        onClick={() => navigation.open({ kind: "availability", id: date })}
      >
        Ustaw dostępność
      </button>
      {!!conflicts.length && (
        <div className="availability-warning">
          <h3>Kolizje dostępności: {conflicts.length}</h3>
          <p>
            Cały grafik, niezależnie od filtra ogrodu. Żadna praca nie została
            przesunięta.
          </p>
          {conflicts.slice(0, 20).map((c) => (
            <button
              key={c.id}
              className="button secondary"
              onClick={() =>
                navigation.open(
                  c.task
                    ? occurrenceCard(c.task)
                    : { kind: "job", id: c.jobId! },
                )
              }
            >
              {c.time} · {c.title}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
export function NearestAvailability({
  start,
  now,
  onSelect,
}: {
  start: string;
  now: Date;
  onSelect: (date: string) => void;
}) {
  const { data } = useGarden(),
    minute = `${localDate(now)}:${now.getHours()}:${now.getMinutes()}`;
  const rows = useMemo(
    () => nextAvailableDays(data, start, now),
    [data, start, minute],
  );
  return (
    <section
      className="card nearest-availability"
      aria-label="Najbliższe dostępne terminy"
    >
      <h2>Najbliższe dostępne terminy</h2>
      <p className="gm-form-note">
        Do 7 dni z deklarowaną dostępnością w ciągu 60 dni od wybranej daty,
        najwcześniej od dziś. To nie gwarancja wolnego terminu pomiędzy
        zleceniami. Lista obejmuje wszystkie ogrody.
      </p>
      <div>
        {rows.map((row) => (
          <button
            className="availability-nearest-row"
            key={row.date}
            onClick={() => onSelect(row.date)}
          >
            <strong>
              {row.date} · {availabilityLabel(row.rule)}
            </strong>
            <span>
              Zlecenia: {row.jobs} · planowane czynności: {row.tasks}
            </span>
          </button>
        ))}
      </div>
      {!rows.length && (
        <p>
          Brak dostępnych dni w tym okresie. Sprawdź dalsze daty w kalendarzu.
        </p>
      )}
    </section>
  );
}
