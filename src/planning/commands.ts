import { activeCareDate, careDateAllowed, nextCareDate } from "./care";
import { localDate, startWork, type Data, type Job } from "../domain";
import { isDate, validateRule } from "./dates";
import { virtualOccurrence, resolveOccurrence } from "./occurrences";
import type { OccurrenceVersion, TaskOccurrence, TaskSchedule } from "./model";

const put = <T extends { id: string }>(items: T[], item: T): T[] =>
  items.some((value) => value.id === item.id)
    ? items.map((value) => (value.id === item.id ? item : value))
    : [...items, item];
const conflict = () =>
  new Error(
    "Plan zmienił się w innej karcie. Zamknij szczegóły i otwórz je ponownie.",
  );
function currentOccurrence(
  data: Data,
  scheduleId: string,
  originalDate: string,
  expected?: OccurrenceVersion,
  cycle?: number,
): TaskOccurrence {
  const occurrence = resolveOccurrence(data, scheduleId, originalDate, cycle);
  const schedule = data.taskSchedules.find((item) => item.id === scheduleId)!;
  if (
    expected &&
    (schedule.revision !== expected.scheduleRevision ||
      occurrence.revision !== expected.occurrenceRevision)
  )
    throw conflict();
  return occurrence;
}
function requirePending(occurrence: TaskOccurrence) {
  if (occurrence.status === "completed")
    throw new Error("Ten zabieg został już wykonany.");
  if (occurrence.jobId && occurrence.careCycle === undefined)
    throw new Error(
      "To zadanie ma już rzeczywiste zlecenie. Termin i przebieg pracy zmień w karcie zlecenia.",
    );
  if (occurrence.status === "cancelled")
    throw new Error("Ten termin został pominięty.");
}
export function saveTaskSchedule(
  data: Data,
  draft: TaskSchedule,
  now: number,
): Data {
  const existing = data.taskSchedules.find((item) => item.id === draft.id);
  if (
    (existing && draft.revision !== existing.revision) ||
    (!existing && draft.revision !== 0)
  )
    throw conflict();
  if (existing && !!existing.care !== !!draft.care)
    throw new Error(
      "Tryb wybiera się przy tworzeniu serii. Zakończ tę serię i utwórz nową, aby zachować historię.",
    );
  validateRule(draft);
  if (!draft.title.trim()) throw new Error("Podaj nazwę zadania.");
  const garden = data.gardens.find((item) => item.id === draft.gardenId);
  if (
    draft.gardenId &&
    (!garden || (draft.clientId && garden.clientId !== draft.clientId))
  )
    throw new Error("Wybierz ogród tego klienta.");
  const zone = garden?.zones.find((item) => item.id === draft.zoneId);
  if (
    draft.zoneId &&
    !zone &&
    !(existing?.zoneId === draft.zoneId && existing.gardenId === draft.gardenId)
  )
    throw new Error("Wybierz strefę wybranego ogrodu.");
  if (
    existing?.care &&
    data.taskOccurrences.some(
      (o) => o.scheduleId === draft.id && o.status === "planned" && o.jobId,
    ) &&
    (existing.gardenId !== draft.gardenId || existing.zoneId !== draft.zoneId)
  )
    throw new Error(
      "Najpierw obsłuż zabieg powiązany z wizytą; jego ogrodu ani strefy nie można teraz zmienić.",
    );
  const next = {
    ...draft,
    ...(draft.care
      ? { care: { ...draft.care, material: draft.care.material.trim() } }
      : {}),
    title: draft.title.trim(),
    notes: draft.notes.trim(),
    clientId: garden?.clientId ?? draft.clientId,
    zoneName: zone?.name ?? (draft.zoneId ? draft.zoneName : null),
    endedOn: existing?.endedOn ?? null,
    revision: (existing?.revision ?? 0) + 1,
    updatedAt: now,
  };
  if (next.care) {
    let occurrences = data.taskOccurrences.map((o) => {
      if (o.scheduleId !== next.id || o.status !== "planned") return o;
      const date = activeCareDate(next, o.date);
      return {
        ...o,
        title: next.title,
        notes: next.notes,
        clientId: next.clientId,
        gardenId: next.gardenId,
        zoneId: next.zoneId,
        zoneName: next.zoneName,
        ...(date
          ? { date, time: next.time }
          : { status: "cancelled" as const, closedReason: "limit" as const }),
        revision: o.revision + 1,
        updatedAt: now,
      };
    });
    if (!existing) {
      const first = activeCareDate(next, next.startDate);
      if (!first)
        throw new Error(
          "Brak terminu w aktywnym sezonie przed końcem serii. Sprawdź daty.",
        );
      occurrences = [
        ...occurrences,
        { ...virtualOccurrence(next, first, 1), revision: 1, updatedAt: now },
      ];
    }
    return {
      ...data,
      taskSchedules: put(data.taskSchedules, next),
      taskOccurrences: occurrences,
    };
  }
  return {
    ...data,
    taskSchedules: put(data.taskSchedules, next),
    taskOccurrences: data.taskOccurrences.map((item) =>
      item.scheduleId === next.id && !item.jobId && item.status === "planned"
        ? {
            ...item,
            title: next.title,
            notes: next.notes,
            clientId: next.clientId,
            gardenId: next.gardenId,
            zoneId: next.zoneId,
            zoneName: next.zoneName,
            status:
              next.endDate && item.date > next.endDate
                ? "cancelled"
                : item.status,
            revision: item.revision + 1,
            updatedAt: now,
          }
        : item,
    ),
  };
}
export function moveTaskOccurrence(
  data: Data,
  scheduleId: string,
  originalDate: string,
  date: string,
  time: string,
  now: number,
  expected?: OccurrenceVersion,
  cycle?: number,
): Data {
  const occurrence = currentOccurrence(
    data,
    scheduleId,
    originalDate,
    expected,
    cycle,
  );
  requirePending(occurrence);
  const schedule = data.taskSchedules.find((item) => item.id === scheduleId)!;
  if (!isDate(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
    throw new Error("Podaj poprawny termin.");
  if (
    schedule.care &&
    (!careDateAllowed(schedule, date) || schedule.endedOn !== null)
  )
    throw new Error("Wybierz termin w aktywnym sezonie niezakończonej serii.");
  if (
    (schedule.endedOn && date > schedule.endedOn) ||
    (schedule.endDate && date > schedule.endDate)
  )
    throw new Error(
      "Termin wypada po zakończeniu serii. Najpierw zmień datę końca harmonogramu.",
    );
  return {
    ...data,
    taskOccurrences: put(data.taskOccurrences, {
      ...occurrence,
      date,
      time,
      revision: occurrence.revision + 1,
      updatedAt: now,
    }),
  };
}
export function skipTaskOccurrence(
  data: Data,
  scheduleId: string,
  originalDate: string,
  now: number,
  expected?: OccurrenceVersion,
  cycle?: number,
): Data {
  const occurrence = currentOccurrence(
    data,
    scheduleId,
    originalDate,
    expected,
    cycle,
  );
  requirePending(occurrence);
  const next = {
    ...data,
    taskOccurrences: put(data.taskOccurrences, {
      ...occurrence,
      status: "cancelled" as const,
      ...(occurrence.careCycle !== undefined
        ? { closedReason: "skipped" as const }
        : {}),
      revision: occurrence.revision + 1,
      updatedAt: now,
    }),
  };
  return occurrence.careCycle !== undefined
    ? appendNextCare(
        next,
        data.taskSchedules.find((s) => s.id === scheduleId)!,
        occurrence.date,
        now,
      )
    : next;
}
export function endTaskSchedule(
  data: Data,
  scheduleId: string,
  lastDate: string,
  now: number,
  revision?: number,
): Data {
  const schedule = data.taskSchedules.find((item) => item.id === scheduleId);
  if (!schedule) throw new Error("Nie znaleziono harmonogramu.");
  if (revision !== undefined && revision !== schedule.revision)
    throw conflict();
  if (!isDate(lastDate))
    throw new Error("Podaj poprawną datę zakończenia serii.");
  return {
    ...data,
    taskSchedules: put(data.taskSchedules, {
      ...schedule,
      endedOn: lastDate,
      revision: schedule.revision + 1,
      updatedAt: now,
    }),
    taskOccurrences: data.taskOccurrences.map((item) =>
      item.scheduleId === scheduleId &&
      (schedule.care
        ? item.status === "planned"
        : !item.jobId && item.date > lastDate)
        ? {
            ...item,
            status: "cancelled",
            ...(schedule.care ? { closedReason: "ended" as const } : {}),
            revision: item.revision + 1,
            updatedAt: now,
          }
        : item,
    ),
  };
}
/** One transaction creates a real visit and starts its timer, only on explicit user action. */
export function beginTaskOccurrence(
  data: Data,
  scheduleId: string,
  originalDate: string,
  now: number,
  gardenId?: string,
  expected?: OccurrenceVersion,
  cycle?: number,
): { data: Data; jobId: string } {
  const current = resolveOccurrence(data, scheduleId, originalDate, cycle);
  // Repeated taps and another tab always open the same visit, without restarting it.
  if (current.jobId) return { data, jobId: current.jobId };
  const occurrence = currentOccurrence(
    data,
    scheduleId,
    originalDate,
    expected,
    cycle,
  );
  requirePending(occurrence);
  const target = data.gardens.find(
    (garden) => garden.id === (occurrence.gardenId ?? gardenId),
  );
  if (
    !target ||
    (occurrence.clientId && target.clientId !== occurrence.clientId)
  )
    throw new Error("Przed rozpoczęciem wybierz ogród właściwego klienta.");
  const jobId = `job:${occurrence.id}`;
  if (data.jobs.some((job) => job.id === jobId))
    throw new Error(
      "Istnieje już zlecenie o tym identyfikatorze. Zachowano jego dane.",
    );
  const job: Job = {
    id: jobId,
    taskOccurrenceId: occurrence.id,
    gardenId: target.id,
    title: occurrence.title,
    date: occurrence.date,
    time: occurrence.time,
    notes: [
      occurrence.notes,
      occurrence.zoneName ? `Strefa: ${occurrence.zoneName}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    status: "planned",
    billing: "hourly",
    rate: data.settings.hourlyRate,
    fixedPrice: 0,
    seconds: 0,
    materials: [],
    activities: [occurrence.title],
    settlement: null,
  };
  const next = {
    ...data,
    jobs: [...data.jobs, job],
    taskOccurrences: put(data.taskOccurrences, {
      ...occurrence,
      jobId,
      revision: occurrence.revision + 1,
      updatedAt: now,
    }),
  };
  return { data: startWork(next, jobId, now), jobId };
}

/** Same schedule/occurrence collections and transaction as the existing planner. No work or money is created here. */
function appendNextCare(
  data: Data,
  schedule: TaskSchedule,
  base: string,
  now: number,
): Data {
  const date = nextCareDate(schedule, base);
  if (!date) return data;
  if (
    data.taskOccurrences.some(
      (o) =>
        o.scheduleId === schedule.id &&
        o.careCycle !== undefined &&
        o.status === "planned",
    )
  )
    throw new Error("Seria ma już oczekujący zabieg.");
  const cycle =
    data.taskOccurrences.reduce(
      (highest, o) =>
        o.scheduleId === schedule.id
          ? Math.max(highest, o.careCycle ?? 0)
          : highest,
      0,
    ) + 1;
  return {
    ...data,
    taskOccurrences: [
      ...data.taskOccurrences,
      {
        ...virtualOccurrence(schedule, date, cycle),
        revision: 1,
        updatedAt: now,
      },
    ],
  };
}
export function completeCareOccurrence(
  data: Data,
  id: string,
  originalDate: string,
  cycle: number,
  performedOn: string,
  jobId: string | null,
  now: number,
  expected?: OccurrenceVersion,
): Data {
  const current = resolveOccurrence(data, id, originalDate, cycle),
    schedule = data.taskSchedules.find((s) => s.id === id)!;
  if (!schedule.care || current.careCycle === undefined)
    throw new Error(
      "To nie jest harmonogram zabiegów od faktycznego wykonania.",
    );
  const targetId = jobId || current.jobId;
  if (current.completion) {
    if (
      current.completion.performedOn === performedOn &&
      current.completion.jobId === targetId
    )
      return data;
    throw conflict();
  }
  const o = currentOccurrence(data, id, originalDate, expected, cycle);
  requirePending(o);
  if (schedule.endedOn !== null) throw new Error("Seria jest zakończona.");
  if (!isDate(performedOn) || performedOn > localDate(new Date(now)))
    throw new Error(
      "Podaj faktyczną datę wykonania, nie późniejszą niż dzisiaj.",
    );
  const job = data.jobs.find((j) => j.id === targetId);
  if (
    (targetId && (!job || job.gardenId !== o.gardenId)) ||
    (o.jobId && targetId !== o.jobId)
  )
    throw new Error("Wybierz istniejącą wizytę tego ogrodu.");
  const completed: TaskOccurrence = {
    ...o,
    status: "completed",
    completion: {
      performedOn,
      recordedAt: now,
      jobId: targetId,
      jobTitle: job?.title ?? null,
      frequency: schedule.recurrence.frequency as "days" | "weeks" | "months",
      interval: schedule.recurrence.interval,
      material: schedule.care.material,
    },
    revision: o.revision + 1,
    updatedAt: now,
  };
  return appendNextCare(
    { ...data, taskOccurrences: put(data.taskOccurrences, completed) },
    schedule,
    performedOn,
    now,
  );
}
