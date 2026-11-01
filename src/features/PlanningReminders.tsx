import { useNavigation, useViewState } from "../navigation/Navigation";
import { useMemo, useState } from "react";
import { useGarden, useNow } from "../state";
import { localDate } from "../domain";
import { addDays } from "../planning/dates";
import { taskOccurrencesBetween } from "../planning/occurrences";
import {
  taskStatus,
  taskStatusLabels,
  type TaskOccurrence,
} from "../planning/model";
import "./planning.css";

export default function PlanningReminders() {
  const { data } = useGarden();
  const today = localDate(new Date(useNow()));
  const navigation = useNavigation();
  const setJobId = (id: string) => navigation.open({ kind: "job", id });
  const [expanded, setExpanded] = useViewState(
    "planning-expanded",
    () => new Set<string>(),
  );
  const lists = useMemo(() => {
    return [
      ["Zaległe, niewykonane", "0000-01-01", addDays(today, -1)],
      ["Nadchodzące — najbliższe 12 miesięcy", today, addDays(today, 365)],
    ].map(([title, from, to]) => {
      const tasks = taskOccurrencesBetween(data, from, to, true, 21).map(
        (item) => {
          const job = data.jobs.find((job) => job.id === item.jobId);
          return {
            id: item.id,
            title: job?.title ?? item.title,
            date: job?.date ?? item.date,
            time: job?.time ?? item.time,
            status: taskStatus(data, item),
            task: item,
            jobId: null as string | null,
          };
        },
      );
      const jobs = data.jobs
        .filter(
          (job) =>
            !job.taskOccurrenceId &&
            job.status !== "completed" &&
            job.date >= from &&
            job.date <= to,
        )
        .map((job) => ({
          id: job.id,
          title: job.title,
          date: job.date,
          time: job.time,
          status: job.status,
          task: null as TaskOccurrence | null,
          jobId: job.id as string | null,
        }));
      return {
        title,
        rows: [...tasks, ...jobs].sort((a, b) =>
          `${a.date}${a.time}${a.id}`.localeCompare(
            `${b.date}${b.time}${b.id}`,
          ),
        ),
      };
    });
  }, [data, today]);
  return (
    <section
      className="planning-reminders"
      aria-label="Przypomnienia o pracach"
    >
      <div className="planning-section-heading">
        <h2>Przypomnienia o pracach</h2>
        <p className="muted">Terminy wymagające uwagi · lista w aplikacji</p>
      </div>
      <div className="planning-reminder-grid">
        {lists.map((list, index) => (
          <article
            className={`card planning-reminder-card ${index === 0 ? "overdue-reminders" : ""}`}
            key={list.title}
          >
            <h3>{list.title}</h3>
            {!list.rows.length && (
              <p className="muted">
                {index === 0
                  ? "Brak zaległych prac."
                  : "Brak nadchodzących prac w tym okresie."}
              </p>
            )}
            <div>
              {list.rows
                .slice(0, expanded.has(list.title) ? 20 : 5)
                .map((row) => (
                  <button
                    className="planning-reminder-row"
                    key={row.id}
                    onClick={() =>
                      row.task
                        ? navigation.open({
                            kind: "task",
                            id: row.task.scheduleId,
                            originalDate: row.task.originalDate,
                          })
                        : setJobId(row.jobId!)
                    }
                  >
                    <span>
                      <strong>{row.title}</strong>
                      <small>
                        {row.date} · {row.time} ·{" "}
                        {row.task ? "Zadanie" : "Zlecenie"}
                      </small>
                    </span>
                    <span className={`badge status-${row.status}`}>
                      {taskStatusLabels[row.status]}
                    </span>
                  </button>
                ))}
            </div>
            {list.rows.length > 5 && (
              <button
                className="button secondary"
                aria-label={`${expanded.has(list.title) ? "Zwiń" : "Pokaż więcej"}: ${list.title}`}
                onClick={() =>
                  setExpanded((current) => {
                    const next = new Set(current);
                    if (next.has(list.title)) next.delete(list.title);
                    else next.add(list.title);
                    return next;
                  })
                }
              >
                {expanded.has(list.title)
                  ? "Zwiń listę"
                  : "Pokaż więcej terminów"}
              </button>
            )}
            {expanded.has(list.title) && list.rows.length > 20 && (
              <p className="gm-form-note">
                Pokazujemy pierwszych 20 terminów. Kolejne pojawią się po
                obsłużeniu wcześniejszych; pełny plan znajdziesz w kalendarzu.
              </p>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
