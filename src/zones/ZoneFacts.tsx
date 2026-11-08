import type { GardenZone } from "../domain";
import { formatQuantity } from "../gardening";
/** The existing descriptions remain text. No plant or treatment records are inferred. */
export default function ZoneFacts({
  zone,
  showEmpty = false,
}: {
  zone: GardenZone;
  showEmpty?: boolean;
}) {
  return (
    <>
      <p>
        {zone.area !== null && `${formatQuantity(zone.area)} m²`}
        {zone.area !== null && zone.length !== null && " · "}
        {zone.length !== null && `${formatQuantity(zone.length)} m`}
      </p>
      <dl>
        {(
          [
            ["Rośliny", zone.plants],
            ["Szczególne wymagania", zone.requirements],
            ["Wykonane zabiegi", zone.treatments],
          ] as const
        ).map(
          ([label, value]) =>
            (value || showEmpty) && (
              <div key={label}>
                <dt>{label}</dt>
                <dd className="preserve-lines">{value || "Brak opisu."}</dd>
              </div>
            ),
        )}
      </dl>
    </>
  );
}
