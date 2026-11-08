import { useGarden } from "../state";
import { useNavigation } from "../navigation/Navigation";
import { jobZones } from "./model";
export default function ZoneLinks({ jobId }: { jobId: string }) {
  const { data } = useGarden(),
    navigation = useNavigation(),
    { garden, zones } = jobZones(data, jobId);
  if (!garden || !zones.length) return null;
  return (
    <nav
      className="related-card-links documentation-links"
      aria-label="Strefy zlecenia"
    >
      {zones.map((zone) => (
        <button
          key={zone.id}
          className="button secondary"
          onClick={() =>
            navigation.open({
              kind: "zone",
              gardenId: garden.id,
              id: zone.id,
              section: "overview",
            })
          }
        >
          Strefa: {zone.name}
        </button>
      ))}
    </nav>
  );
}
