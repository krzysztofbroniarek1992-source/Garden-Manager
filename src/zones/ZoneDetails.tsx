import { useEffect, useState } from "react";
import Modal from "../components/Modal";
import { useGarden } from "../state";
import { useNavigation, useViewState } from "../navigation/Navigation";
import { useCardNavigation } from "../features/card-navigation";
import { zoneSections, type ZoneSection } from "../navigation/routes";
import type { GardenZone, Job } from "../domain";
import GardenSchedule from "../features/GardenSchedule";
import GroupedJobHistory from "../features/GroupedJobHistory";
import ZoneForm from "../features/ZoneForm";
import PhotoGallery from "../photos/PhotoGallery";
import { ContextNotes } from "../desk/Notes";
import ZoneFacts from "./ZoneFacts";
import { zoneScope } from "./model";
import "../features/gardening.css";
import "./zones.css";
const sections: Record<ZoneSection, string> = {
  overview: "Przegląd i rośliny",
  plans: "Czynności i harmonogramy",
  history: "Zlecenia i historia",
  gallery: "Galeria",
  notes: "Notatki",
};
export default function ZoneDetails({
  gardenId,
  zoneId,
  onClose,
}: {
  gardenId: string;
  zoneId: string;
  onClose: () => void;
}) {
  const { data } = useGarden(),
    navigation = useNavigation(),
    card = useCardNavigation(),
    { garden, zone, client, schedules, jobs } = zoneScope(
      data,
      gardenId,
      zoneId,
    );
  const section = (card?.section ?? "overview") as ZoneSection;
  const [visited, setVisited] = useViewState(
    "zone-sections",
    () => new Set<ZoneSection>(["overview", section]),
  );
  const [status, setStatus] = useViewState<Job["status"] | "">(
    "zone-job-status",
    "",
  );
  const [editing, setEditing] = useState<GardenZone | null>(null);
  useEffect(() => {
    setVisited((previous) =>
      previous.has(section) ? previous : new Set([...previous, section]),
    );
  }, [section]);
  const filtered = jobs.filter((j) => !status || j.status === status);
  return (
    <>
      <Modal
        title={zone ? `Strefa: ${zone.name}` : "Szczegóły strefy"}
        onClose={onClose}
        fullScreen
      >
        <nav
          className="related-card-links documentation-links"
          aria-label="Powiązania strefy"
        >
          <button className="button secondary" onClick={onClose}>
            {card?.backLabel ?? "Wróć do poprzedniego widoku"}
          </button>
          {garden && (
            <button
              className="button secondary"
              onClick={() =>
                navigation.open({
                  kind: "garden",
                  id: gardenId,
                  section: "zones",
                  zoneId,
                })
              }
            >
              Ogród: {garden.name}
            </button>
          )}
          {client && (
            <button
              className="button secondary"
              onClick={() => navigation.open({ kind: "client", id: client.id })}
            >
              Klient: {client.name}
            </button>
          )}
        </nav>
        {!garden || !zone ? (
          <p role="status">
            Ogród lub strefa nie są już dostępne. Pozostałe dane i historia
            pozostają zachowane.
          </p>
        ) : (
          <div data-zone-id={zone.id} className="zone-detail-content">
            <div className="tool-heading">
              <div>
                <h3>{zone.name}</h3>
                <p>{zone.type}</p>
              </div>
              <button
                className="button secondary"
                onClick={() => setEditing(zone)}
              >
                Edytuj strefę
              </button>
            </div>
            <p className="gm-form-note">
              Przeglądaj rośliny, wymagania pielęgnacyjne oraz prace w tej
              strefie.
            </p>
            <nav
              className="zone-detail-tabs"
              role="tablist"
              aria-label="Sekcje strefy"
            >
              {zoneSections.map((key) => (
                <button
                  key={key}
                  className={`button ${section === key ? "primary" : "secondary"}`}
                  role="tab"
                  aria-selected={section === key}
                  onClick={() => navigation.section(key)}
                >
                  {sections[key]}
                  {key === "plans"
                    ? ` (${schedules.length})`
                    : key === "history"
                      ? ` (${jobs.length})`
                      : ""}
                </button>
              ))}
            </nav>
            {zoneSections
              .filter((key) => visited.has(key) || key === section)
              .map((key) => (
                <section
                  key={key}
                  role="tabpanel"
                  aria-label={sections[key]}
                  hidden={key !== section}
                  inert={key !== section}
                  className="zone-detail-section"
                >
                  {key === "overview" && <ZoneFacts zone={zone} showEmpty />}
                  {key === "plans" && (
                    <GardenSchedule gardenId={gardenId} zoneId={zoneId} />
                  )}
                  {key === "history" && (
                    <>
                      <label className="field">
                        Status zleceń strefy
                        <select
                          aria-label="Status zleceń strefy"
                          value={status}
                          onChange={(e) =>
                            setStatus(e.target.value as Job["status"] | "")
                          }
                        >
                          <option value="">Wszystkie statusy</option>
                          <option value="planned">Zaplanowane</option>
                          <option value="in-progress">W trakcie</option>
                          <option value="completed">Zakończone</option>
                        </select>
                      </label>
                      <p className="gm-form-note">
                        Historia obejmuje prace przypisane do tej strefy.
                      </p>
                      <GroupedJobHistory
                        historyKey="zone-work"
                        jobs={filtered}
                        onOpen={(id, billing) =>
                          navigation.open({
                            kind: "job",
                            id,
                            section: billing ? "billing" : "work",
                          })
                        }
                      />
                    </>
                  )}
                  {key === "gallery" && (
                    <PhotoGallery
                      scope={{ gardenId, zoneId }}
                      title="Galeria strefy"
                    />
                  )}
                  {key === "notes" && (
                    <ContextNotes
                      scope={{ gardenId, zoneId }}
                      title="Notatki strefy"
                    />
                  )}
                </section>
              ))}
          </div>
        )}
      </Modal>
      {editing && (
        <Modal title="Edycja strefy" onClose={() => setEditing(null)} wide>
          {(!garden || !zone) && (
            <p role="alert">
              Strefa została usunięta lub ogród nie jest już dostępny. Szkic
              pozostaje widoczny; zapis jest zablokowany.
            </p>
          )}
          <fieldset className="zone-edit-boundary" disabled={!garden || !zone}>
            <ZoneForm
              gardenId={gardenId}
              initial={editing}
              onClose={() => setEditing(null)}
            />
          </fieldset>
        </Modal>
      )}
    </>
  );
}
