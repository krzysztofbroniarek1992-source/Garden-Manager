import {
  finishWork,
  pauseActiveTimer,
  resumeActiveTimer,
  startWork,
  stopActiveTimer,
  type Data,
} from "../domain";

export const timerEventId = (data: Data): string | null =>
  data.timer
    ? (data.jobs.find((j) => j.id === data.timer!.jobId)?.timeHistory?.at(-1)
        ?.id ?? null)
    : null;

export type TimerAction = "start" | "pause" | "resume" | "stop";
/** Bind a deliberate control to the timer the user saw; reuse the single timer engine. */
export function controlVisitTimer(
  data: Data,
  jobId: string,
  action: TimerAction,
  expected: Data["timer"],
  now: number,
  expectedEventId?: string | null,
): Data {
  if (
    (expectedEventId !== undefined && timerEventId(data) !== expectedEventId) ||
    JSON.stringify(data.timer) !== JSON.stringify(expected)
  )
    throw new Error(
      "Stan stopera zmienił się w innej karcie. Sprawdź aktualny pomiar i ponów działanie.",
    );
  if (!data.jobs.some((j) => j.id === jobId))
    throw new Error("Ta wizyta nie jest już dostępna.");
  if (action === "start") return startWork(data, jobId, now);
  if (!data.timer || data.timer.jobId !== jobId)
    throw new Error("Ten stoper nie należy już do wybranej wizyty.");
  if (action === "pause") return pauseActiveTimer(data, now);
  if (action === "resume") return resumeActiveTimer(data, now);
  if (action === "stop") return stopActiveTimer(data, now);
  throw new Error("Nieprawidłowa operacja stopera.");
}
export function finishFieldVisit(data: Data, jobId: string, now: number): Data {
  if (data.timer?.jobId === jobId)
    throw new Error(
      "Najpierw świadomie zakończ pomiar przyciskiem STOP. Zakończenie wizyty nie zatrzymuje stopera.",
    );
  return finishWork(data, jobId, now);
}
export function saveVisitActivities(
  data: Data,
  jobId: string,
  gardenId: string,
  activities: string[],
  expected: string[],
): Data {
  const job = data.jobs.find((j) => j.id === jobId);
  if (!job || job.gardenId !== gardenId)
    throw new Error(
      "Zlecenie zostało usunięte lub przeniesione. Otwórz aktualną wizytę.",
    );
  if (JSON.stringify(job.activities) !== JSON.stringify(expected))
    throw new Error(
      "Czynności zmieniły się w innej karcie. Zachowano Twój szkic. Otwórz aktualną listę przed zapisem.",
    );
  return {
    ...data,
    jobs: data.jobs.map((j) =>
      j.id === jobId
        ? { ...j, activities: activities.map((a) => a.trim()).filter(Boolean) }
        : j,
    ),
  };
}
