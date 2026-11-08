import type { Data } from "../domain";
import type { Card, GardenSection, JobSection } from "../navigation/routes";
export interface DocumentationScope {
  clientId?: string | null;
  gardenId?: string | null;
  zoneId?: string | null;
  jobId?: string | null;
}
/** Only IDs and live foreign keys establish links. Historical names never do. */
export function documentationLinks(
  data: Data,
  scope: DocumentationScope,
  gardenSection: GardenSection = "notes",
  jobSection: JobSection = "notes",
): { label: string; card: Card }[] {
  const job = data.jobs.find((j) => j.id === scope.jobId);
  const garden = data.gardens.find(
    (g) => g.id === (scope.gardenId || job?.gardenId),
  );
  const client = data.clients.find(
    (c) => c.id === (scope.clientId || garden?.clientId),
  );
  const zone = garden?.zones.find((z) => z.id === scope.zoneId);
  const links: { label: string; card: Card }[] = [];
  if (client)
    links.push({
      label: `Klient: ${client.name}`,
      card: { kind: "client", id: client.id },
    });
  if (garden)
    links.push({
      label: `Ogród: ${garden.name}`,
      card: { kind: "garden", id: garden.id, section: gardenSection },
    });
  if (garden && zone)
    links.push({
      label: `Strefa: ${zone.name}`,
      card: {
        kind: "garden",
        id: garden.id,
        section: "zones",
        zoneId: zone.id,
      },
    });
  if (job)
    links.push({
      label: `Zlecenie: ${job.title}`,
      card: { kind: "job", id: job.id, section: jobSection },
    });
  return links;
}
