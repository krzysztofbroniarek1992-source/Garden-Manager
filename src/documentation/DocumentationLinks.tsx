import { useNavigation } from "../navigation/Navigation";
import { useCardNavigation } from "../features/card-navigation";
import { useGarden } from "../state";
import type { GardenSection, JobSection } from "../navigation/routes";
import { documentationLinks, type DocumentationScope } from "./links";
import "./documentation.css";
export default function DocumentationLinks({
  scope,
  gardenSection = "notes",
  jobSection = "notes",
}: {
  scope: DocumentationScope;
  gardenSection?: GardenSection;
  jobSection?: JobSection;
}) {
  const { data } = useGarden(),
    navigation = useNavigation(),
    card = useCardNavigation();
  const links = documentationLinks(data, scope, gardenSection, jobSection);
  return (
    <nav
      className="related-card-links documentation-links"
      aria-label="Powiązania dokumentacji"
    >
      <button className="button secondary" onClick={navigation.back}>
        {card?.backLabel ?? "Wróć do poprzedniego widoku"}
      </button>
      {links.map((link) => (
        <button
          key={link.label}
          className="button secondary"
          onClick={() => navigation.open(link.card)}
        >
          {link.label}
        </button>
      ))}
      {!links.length && (
        <span className="muted">
          Brak aktywnych powiązań z klientem, ogrodem lub zleceniem.
        </span>
      )}
    </nav>
  );
}
