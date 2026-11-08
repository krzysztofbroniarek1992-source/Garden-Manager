import type { Data, Job } from "../domain";
/** A read-only projection, never an implicit visit or timer creation. */
export function fieldJobs(data: Data, today: string, query = "") {
  const text = query.trim().toLocaleLowerCase("pl");
  const matches = data.jobs
    .filter((j) => {
      const garden = data.gardens.find((g) => g.id === j.gardenId);
      const client = data.clients.find((c) => c.id === garden?.clientId);
      return `${j.title} ${j.activities.join(" ")} ${garden?.name ?? ""} ${garden?.address ?? ""} ${client?.name ?? ""}`
        .toLocaleLowerCase("pl")
        .includes(text);
    })
    .sort((a, b) =>
      `${a.date}${a.time}${a.id}`.localeCompare(`${b.date}${b.time}${b.id}`),
    );
  const active = data.jobs.find((j) => j.id === data.timer?.jobId);
  const isActive = (j: Job) => j.id === active?.id;
  return {
    active,
    today: matches.filter(
      (j) => !isActive(j) && j.status !== "completed" && j.date === today,
    ),
    upcoming: matches.filter(
      (j) => !isActive(j) && j.status !== "completed" && j.date > today,
    ),
    other: matches.filter(
      (j) => !isActive(j) && (j.date < today || j.status === "completed"),
    ),
  };
}
