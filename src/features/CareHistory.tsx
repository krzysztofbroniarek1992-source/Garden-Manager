import { useGarden } from "../state";
import { useNavigation, useViewState } from "../navigation/Navigation";
import { occurrenceCard } from "../navigation/planning-links";
import { taskStatus, taskStatusLabels } from "../planning/model";

/** One history projection of stored occurrences, shared by the series and its care card. */
export default function CareHistory({ scheduleId }: { scheduleId: string }) {
  const { data } = useGarden(),
    navigation = useNavigation();
  const [limit, setLimit] = useViewState("care-history-limit", 20);
  const rows = data.taskOccurrences
    .filter((o) => o.scheduleId === scheduleId)
    .sort((a, b) => (b.careCycle ?? 0) - (a.careCycle ?? 0));
  const pending = rows.find((o) => o.status === "planned");
  return (
    <section aria-label="Historia zabiegów" className="care-history">
      <h3>Historia zabiegów</h3>
      <p>
        {pending
          ? `Najbliższy niewykonany zabieg: ${pending.date}`
          : "Brak kolejnego oczekującego terminu."}
      </p>
      {rows.slice(0, limit).map((o) => (
        <article key={o.id} className="tool-card">
          <h4>{o.title}</h4>
          <span className={`badge status-${taskStatus(data, o)}`}>
            {taskStatusLabels[taskStatus(data, o)]}
          </span>
          <p>
            Planowany: {o.date}
            {o.date !== o.originalDate && ` · pierwotny: ${o.originalDate}`}
          </p>
          {o.completion ? (
            <>
              <p>
                <strong>Faktycznie wykonano: {o.completion.performedOn}</strong>
              </p>
              <p className="muted">
                Potwierdzenie zapisano:{" "}
                {new Date(o.completion.recordedAt).toLocaleString("pl-PL")} · co{" "}
                {o.completion.interval}{" "}
                {
                  { days: "dni", weeks: "tyg.", months: "mies." }[
                    o.completion.frequency
                  ]
                }{" "}
                od wykonania
              </p>
              {o.completion.material && (
                <p>Preparat / materiał: {o.completion.material}</p>
              )}
            </>
          ) : (
            o.status === "cancelled" && (
              <p>
                {o.closedReason === "skipped"
                  ? "Świadomie pominięto — bez wykonania."
                  : o.closedReason === "ended"
                    ? "Seria zakończona — bez wykonania."
                    : "Termin wyłączony przez granice sezonu lub serii — bez wykonania."}
              </p>
            )
          )}
          {o.zoneName && <p>Strefa: {o.zoneName}</p>}
          <div className="planning-actions">
            <button
              className="button secondary"
              onClick={() => navigation.open(occurrenceCard(o))}
            >
              Otwórz zabieg {o.originalDate}
            </button>
            {(o.completion?.jobId ?? o.jobId) && (
              <button
                className="button secondary"
                onClick={() =>
                  navigation.open({
                    kind: "job",
                    id: (o.completion?.jobId ?? o.jobId)!,
                  })
                }
              >
                Powiązane zlecenie:{" "}
                {data.jobs.find(
                  (j) => j.id === (o.completion?.jobId ?? o.jobId),
                )?.title ??
                  o.completion?.jobTitle ??
                  "Niedostępne zlecenie"}
              </button>
            )}
          </div>
        </article>
      ))}
      {rows.length > limit && (
        <button
          className="button secondary"
          onClick={() => setLimit((n) => n + 20)}
        >
          Pokaż starsze zabiegi
        </button>
      )}
    </section>
  );
}
