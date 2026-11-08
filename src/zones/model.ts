import type { Data } from "../domain";
import { jobSource } from "../navigation/planning-links";
/** Resolve only declared, live foreign keys within the job's actual garden. */
export function jobZones(data: Data, jobId: string) {
  const job = data.jobs.find((j) => j.id === jobId),
    garden = data.gardens.find((g) => g.id === job?.gardenId);
  if (!job || !garden) return { garden, zones: [] };
  const source = jobSource(data, jobId),
    ids = new Set<string>();
  if (job.visitDetails?.zoneId) ids.add(job.visitDetails.zoneId);
  if (source?.gardenId === garden.id && source.zoneId) ids.add(source.zoneId);
  for (const c of data.checklists)
    if (
      c.kind === "visit" &&
      c.jobId === jobId &&
      c.gardenId === garden.id &&
      c.zoneId
    )
      ids.add(c.zoneId);
  return { garden, zones: garden.zones.filter((z) => ids.has(z.id)) };
}
export function zoneScope(data: Data, gardenId: string, zoneId: string) {
  const garden = data.gardens.find((g) => g.id === gardenId),
    zone = garden?.zones.find((z) => z.id === zoneId),
    client = data.clients.find((c) => c.id === garden?.clientId);
  return {
    garden,
    zone,
    client,
    schedules: zone
      ? data.taskSchedules.filter(
          (s) => s.gardenId === gardenId && s.zoneId === zoneId,
        )
      : [],
    jobs: zone
      ? data.jobs.filter(
          (j) =>
            j.gardenId === gardenId &&
            jobZones(data, j.id).zones.some((z) => z.id === zoneId),
        )
      : [],
  };
}
