import { useNavigation, useViewState } from "../navigation/Navigation";
import { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  MapPin,
  ArrowUpRight,
} from "lucide-react";
import { useGarden, useNow } from "../state";
import { localDate, type Job } from "../domain";
import { addDays, addMonths, isDate, weekStart } from "../planning/dates";
import { taskOccurrencesBetween } from "../planning/occurrences";
import { taskStatusLabels, type TaskOccurrence } from "../planning/model";
import JobForm from "./JobForm";
import TaskForm, { newTaskSchedule } from "./TaskForm";
import PlanningReminders from "./PlanningReminders";
import ScheduleManager from "./ScheduleManager";
import { deskEventsBetween, deskKindLabels } from "../desk/events";
import {
  deadlineGroup,
  newNote,
  newTodo,
  type Note,
  type Todo,
} from "../desk/model";
import { NoteForm, TodoForm } from "../desk/Forms";
import DeskDetails from "../desk/Details";
import "./jobs.css";
import "./planning.css";

type View = "month" | "week" | "day";
const viewLabels = { month: "Miesiąc", week: "Tydzień", day: "Dzień" };
const periodLabels = { month: "miesiąc", week: "tydzień", day: "dzień" };
const weekDays = ["Pon", "Wt", "Śr", "Czw", "Pt", "Sob", "Ndz"];
const displayDate = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Date(`${date}T12:00:00`).toLocaleDateString("pl-PL", options);
interface Event {
  id: string;
  date: string;
  time: string;
  title: string;
  status: keyof typeof taskStatusLabels;
  gardenId: string | null;
  clientId: string | null;
  jobId: string | null;
  task: TaskOccurrence | null;
  kind: "job" | "work" | "reminder" | "todo";
  deskId: string | null;
}
const kindLabels = {
  job: "Zlecenie",
  work: "Praca ogrodnicza",
  ...deskKindLabels,
};
const statusLabel = (event: Event) =>
  event.deskId && event.status === "cancelled"
    ? "Anulowane"
    : taskStatusLabels[event.status];
const eventTime = (event: Event) => event.time || "Bez godziny";
export default function Calendar({ onOpenJobs }: { onOpenJobs?: () => void }) {
  const { data, saveJob } = useGarden();
  const now = new Date(useNow());
  const today = localDate(now);
  const navigation = useNavigation();
  const setSelectedJob = (id: string | null) => {
    if (id) navigation.open({ kind: "job", id });
  };
  const [newJob, setNewJob] = useState<Job | null>(null);
  const [newTask, setNewTask] = useState<ReturnType<
    typeof newTaskSchedule
  > | null>(null);
  const [selectedDesk, setSelectedDesk] = useState<{
    kind: "note" | "todo";
    id: string;
  } | null>(null);
  const [noteDraft, setNoteDraft] = useState<Note | null>(null);
  const [todoDraft, setTodoDraft] = useState<Todo | null>(null);
  const state = navigation.route.calendar ?? {
    date: today,
    anchor: today,
    view: "month" as View,
  };
  useEffect(() => {
    if (!navigation.route.calendar && !navigation.invalid)
      navigation.setCalendar({ date: today, anchor: today, view: "month" });
  }, [navigation, today]);
  const { view, anchor, date: selected } = state;
  const [lastEvent, setLastEvent] = useViewState("calendar-event", "");
  const update = (patch: Partial<typeof state>) =>
    navigation.setCalendar({ ...state, ...patch });
  const cells = useMemo(() => {
    try {
      if (view === "day") return [anchor];
      if (view === "week")
        return Array.from({ length: 7 }, (_, i) =>
          addDays(weekStart(anchor), i),
        );
      const first = `${anchor.slice(0, 7)}-01`;
      const next = addMonths(first, 1);
      const last = next ? addDays(next, -1) : "9999-12-31";
      const start = weekStart(first);
      const count =
        Math.ceil(
          (Number(last.slice(8)) +
            (Date.parse(`${first}T00:00:00Z`) -
              Date.parse(`${start}T00:00:00Z`)) /
              86_400_000) /
            7,
        ) * 7;
      return Array.from({ length: count }, (_, i) => {
        try {
          return addDays(start, i);
        } catch {
          return "";
        }
      }).filter(Boolean);
    } catch {
      return [anchor];
    }
  }, [anchor, view]);
  const events = useMemo<Event[]>(() => {
    const from = cells[0] < selected ? cells[0] : selected;
    const to = cells.at(-1)! > selected ? cells.at(-1)! : selected;
    const tasks: Event[] = taskOccurrencesBetween(data, from, to)
      .filter((item) => !item.jobId)
      .map((item) => ({
        id: `work:${item.id}`,
        date: item.date,
        time: item.time,
        title: item.title,
        status: item.status,
        gardenId: item.gardenId,
        clientId: item.clientId,
        jobId: null,
        task: item,
        kind: "work",
        deskId: null,
      }));
    const jobs: Event[] = data.jobs
      .filter((job) => job.date >= from && job.date <= to)
      .map((job) => ({
        id: `job:${job.id}`,
        date: job.date,
        time: job.time,
        title: job.title,
        status: job.status,
        gardenId: job.gardenId,
        clientId:
          data.gardens.find((g) => g.id === job.gardenId)?.clientId ?? null,
        jobId: job.id,
        task: null,
        kind: "job",
        deskId: null,
      }));
    const desk: Event[] = deskEventsBetween(data, from, to).map((item) => ({
      ...item,
      time: item.time ?? "",
      deskId: item.recordId,
      jobId: null,
      task: null,
    }));
    return [...tasks, ...jobs, ...desk]
      .filter(
        (e) =>
          (!state.gardenId || e.gardenId === state.gardenId) &&
          (!state.kind || state.kind === "all" || e.kind === state.kind) &&
          (!state.status ||
            state.status === "all" ||
            e.status === state.status),
      )
      .sort((a, b) =>
        `${a.date}${a.time}${a.id}`.localeCompare(`${b.date}${b.time}${b.id}`),
      );
  }, [cells, selected, data, state.gardenId, state.kind, state.status]);
  const agenda = events.filter((event) => event.date === selected);
  const open = (event: Event) => {
    setLastEvent(event.id);
    if (event.deskId)
      setSelectedDesk({
        kind: event.kind === "reminder" ? "note" : "todo",
        id: event.deskId,
      });
    else if (event.task)
      navigation.open({
        kind: "task",
        id: event.task.scheduleId,
        originalDate: event.task.originalDate,
      });
    else setSelectedJob(event.jobId);
  };
  const overdue = (event: Event) =>
    (event.deskId
      ? deadlineGroup(event.date, event.time || null, now) === "overdue"
      : event.date < today) &&
    event.status !== "completed" &&
    event.status !== "cancelled";
  const selectDay = (date: string) =>
    update({ date, ...(view === "day" ? { anchor: date } : {}) });
  const changePeriod = (offset: number) => {
    let date: string | null;
    try {
      date =
        view === "month"
          ? addMonths(anchor, offset)
          : addDays(anchor, offset * (view === "week" ? 7 : 1));
    } catch {
      return;
    }
    if (date) update({ anchor: date, date });
  };
  const title =
    view === "month"
      ? displayDate(anchor, { month: "long", year: "numeric" })
      : view === "week"
        ? `${displayDate(cells[0], { day: "numeric", month: "short" })} – ${displayDate(cells.at(-1)!, { day: "numeric", month: "short", year: "numeric" })}`
        : displayDate(anchor, {
            day: "numeric",
            month: "long",
            year: "numeric",
          });
  return (
    <>
      {navigation.route.returnLabel && (
        <button className="button secondary" onClick={navigation.back}>
          {navigation.route.returnLabel}
        </button>
      )}
      <div className="page-heading">
        <div>
          <p className="eyebrow">PRACE, PRZYPOMNIENIA I SPRAWY</p>
          <h1>Kalendarz prac</h1>
          <p className="muted">
            Planuj wizyty, stałą opiekę nad ogrodami i codzienne sprawy.
          </p>
        </div>
        <button
          className="button secondary"
          onClick={() => update({ anchor: today, date: today })}
        >
          Dzisiaj
        </button>
      </div>
      <div className="calendar-view-toolbar">
        <div
          className="calendar-view-switch"
          role="group"
          aria-label="Widok kalendarza"
        >
          {Object.entries(viewLabels).map(([value, label]) => (
            <button
              key={value}
              className="button secondary"
              aria-pressed={view === value}
              onClick={() => update({ view: value as View, anchor: selected })}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="field">
          Przejdź do dnia
          <input
            type="date"
            value={selected}
            onChange={(e) => {
              if (isDate(e.target.value))
                update({ anchor: e.target.value, date: e.target.value });
            }}
          />
        </label>
      </div>
      <div className="calendar-filters">
        <label className="field">
          Ogród w kalendarzu
          <select
            value={state.gardenId ?? ""}
            onChange={(e) => update({ gardenId: e.target.value || undefined })}
          >
            <option value="">Wszystkie ogrody</option>
            {data.gardens.map((g) => (
              <option value={g.id} key={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Rodzaj wydarzeń
          <select
            value={state.kind ?? "all"}
            onChange={(e) =>
              update({ kind: e.target.value as typeof state.kind })
            }
          >
            <option value="all">Wszystkie wydarzenia</option>
            {Object.entries(kindLabels).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Status wydarzeń
          <select
            value={state.status ?? "all"}
            onChange={(e) =>
              update({ status: e.target.value as typeof state.status })
            }
          >
            <option value="all">Wszystkie statusy</option>
            {Object.entries(taskStatusLabels).map(([k, v]) => (
              <option value={k} key={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        {state.gardenId &&
          !data.gardens.some((g) => g.id === state.gardenId) && (
            <p role="status">
              Ogród z filtra nie jest już dostępny. Wybierz wszystkie ogrody.
            </p>
          )}
      </div>
      <div className="calendar-layout planning-calendar-layout">
        <section
          className={`card calendar-card calendar-${view}`}
          aria-label={`Widok: ${viewLabels[view]}`}
        >
          <div className="calendar-heading">
            <h2>{title}</h2>
            <div>
              <button
                className="icon-button"
                aria-label={`Poprzedni ${periodLabels[view]}`}
                onClick={() => changePeriod(-1)}
              >
                <ChevronLeft size={20} />
              </button>
              <button
                className="icon-button"
                aria-label={`Następny ${periodLabels[view]}`}
                onClick={() => changePeriod(1)}
              >
                <ChevronRight size={20} />
              </button>
            </div>
          </div>
          {view === "month" && (
            <div className="calendar-grid calendar-weekdays">
              {weekDays.map((day) => (
                <span key={day}>{day}</span>
              ))}
            </div>
          )}
          <div className={`planning-calendar-grid planning-grid-${view}`}>
            {cells.map((date) => {
              const dayEvents = events.filter((event) => event.date === date);
              return (
                <div
                  key={date}
                  className={`calendar-day ${date.slice(0, 7) !== anchor.slice(0, 7) && view === "month" ? "outside" : ""} ${selected === date ? "selected" : ""} ${date === today ? "today" : ""}`}
                  onClick={() => selectDay(date)}
                >
                  <button
                    className="calendar-day-select"
                    type="button"
                    onClick={() => selectDay(date)}
                    aria-pressed={selected === date}
                    aria-label={`Wybierz dzień ${date}`}
                  >
                    <span className="day-number">
                      {view === "month"
                        ? Number(date.slice(8))
                        : displayDate(date, {
                            weekday: "short",
                            day: "numeric",
                            month: "short",
                          })}
                    </span>
                  </button>
                  {dayEvents
                    .slice(0, view === "month" ? 3 : undefined)
                    .map((event) => (
                      <button
                        key={event.id}
                        className={`calendar-event calendar-kind-${event.kind} calendar-event-${event.status} ${lastEvent === event.id ? "calendar-event-selected" : ""} ${overdue(event) ? "calendar-event-overdue" : ""}`}
                        aria-label={`${eventTime(event)} ${event.title}, ${kindLabels[event.kind]}, ${statusLabel(event)}${overdue(event) ? ", termin zaległy" : ""}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          open(event);
                        }}
                      >
                        <span>
                          {eventTime(event)} · {kindLabels[event.kind]}
                        </span>
                        <strong>{event.title}</strong>
                        <small>
                          {statusLabel(event)}
                          {overdue(event) && " · Zaległe"}
                        </small>
                      </button>
                    ))}
                  {view === "month" && dayEvents.length > 3 && (
                    <button
                      className="calendar-more-events"
                      onClick={(e) => {
                        e.stopPropagation();
                        update({ date, anchor: date, view: "day" });
                      }}
                    >
                      + {dayEvents.length - 3} kolejne
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <div className="calendar-legend">
            {Object.entries(taskStatusLabels).map(([status, label]) => (
              <span key={status}>
                <i className={`dot-${status}`} /> {label}
              </span>
            ))}
            <span>Obramowanie pomarańczowe: zaległe</span>
          </div>
        </section>
        <section className="card calendar-agenda">
          <div className="card-header">
            <div>
              <p className="eyebrow">PLAN DNIA</p>
              <h2>
                {displayDate(selected, { day: "numeric", month: "long" })}
              </h2>
              <p className="muted">
                {displayDate(selected, { weekday: "long" })}
              </p>
            </div>
            <CalendarDays size={22} />
          </div>
          {agenda.map((event) => {
            const garden = data.gardens.find((g) => g.id === event.gardenId);
            return (
              <div
                className={`agenda-entry ${overdue(event) ? "agenda-overdue" : ""}`}
                key={event.id}
              >
                <span className="agenda-time">{eventTime(event)}</span>
                <div>
                  <span className={`badge status-${event.status}`}>
                    {statusLabel(event)}
                  </span>
                  <h3>
                    <button
                      className="job-title-button"
                      onClick={() => open(event)}
                    >
                      {event.title}
                    </button>
                  </h3>
                  <p>
                    {data.clients.find((c) => c.id === event.clientId)?.name ??
                      "Bez klienta"}{" "}
                    · {kindLabels[event.kind]}
                  </p>
                  {garden && (
                    <p className="muted">
                      <MapPin size={13} />
                      {garden.name}
                      {event.task?.zoneName && ` · ${event.task.zoneName}`}
                    </p>
                  )}
                  {overdue(event) && (
                    <p className="overdue-label">
                      Termin zaległy — wymaga uwagi
                    </p>
                  )}
                </div>
              </div>
            );
          })}
          {!agenda.length && (
            <div className="empty-state">
              <CalendarDays size={32} />
              <h3>Wolny dzień</h3>
              <p className="muted">Na ten dzień nie ma zaplanowanych prac.</p>
            </div>
          )}
          <button
            className="button primary agenda-button"
            onClick={() => setNewTask(newTaskSchedule(selected))}
          >
            + Nowe zadanie na ten dzień
          </button>
          <button
            className="button secondary agenda-button"
            disabled={!data.gardens.length}
            onClick={() =>
              setNewJob({
                id: crypto.randomUUID(),
                gardenId:
                  data.gardens.find((g) => g.id === state.gardenId)?.id ??
                  data.gardens[0].id,
                title: "",
                date: selected,
                time: "08:00",
                status: "planned",
                billing: "hourly",
                rate: data.settings.hourlyRate,
                fixedPrice: 0,
                seconds: 0,
                materials: [],
                notes: "",
                activities: [],
                settlement: null,
              })
            }
          >
            + Nowe zlecenie na ten dzień
          </button>
          {!data.gardens.length && (
            <p>Przed dodaniem zlecenia dodaj klienta i ogród.</p>
          )}
          {onOpenJobs && (
            <button
              className="button secondary agenda-button"
              onClick={onOpenJobs}
            >
              Przejdź do zleceń
              <ArrowUpRight size={17} />
            </button>
          )}
          <button
            className="button secondary agenda-button"
            onClick={() => setNoteDraft(newNote(data, {}, selected))}
          >
            + Przypomnienie na ten dzień
          </button>
          <button
            className="button secondary agenda-button"
            onClick={() => setTodoDraft(newTodo(data, {}, selected))}
          >
            + Sprawa na ten dzień
          </button>
          <p className="muted">
            Przypomnienia i sprawy nie naliczają czasu ani należności.
          </p>
        </section>
      </div>
      <PlanningReminders />
      <ScheduleManager />
      {newJob && (
        <JobForm
          job={newJob}
          onClose={() => setNewJob(null)}
          onSave={(job) => {
            saveJob(job);
            setNewJob(null);
            setSelectedJob(job.id);
          }}
        />
      )}
      {newTask && (
        <TaskForm initial={newTask} onClose={() => setNewTask(null)} />
      )}
      {selectedDesk && (
        <DeskDetails {...selectedDesk} onClose={() => setSelectedDesk(null)} />
      )}
      {noteDraft && (
        <NoteForm initial={noteDraft} onClose={() => setNoteDraft(null)} />
      )}
      {todoDraft && (
        <TodoForm initial={todoDraft} onClose={() => setTodoDraft(null)} />
      )}
    </>
  );
}
