import FieldVisit from "../field/FieldVisit";
import AvailabilityForm from "../availability/AvailabilityForm";
import { pageReturnLabel } from "../navigation/labels";
import ZoneDetails from "../zones/ZoneDetails";
import FinanceDetails from "../finance/FinanceDetails";
import PaymentDetails from "../finance/PaymentDetails";
import DeskDetails from "../desk/Details";
import { PhotoDetailsView } from "../photos/PhotoGallery";
import { ChecklistDetails } from "../checklists/ChecklistPanel";
import ReportPanel from "../reports/ReportPanel";
import TaskDetails from "./TaskDetails";
import ScheduleDetails from "./ScheduleDetails";
import { cardKey } from "../navigation/routes";
import Modal from "../components/Modal";
import GardenDetails from "./GardenDetails";
import ClientDetails from "./ClientDetails";
import JobDetails from "./JobDetails";
import { useGarden } from "../state";
import { CardNavigationContext } from "./card-navigation";
import { frameScope, useNavigation, ViewScope } from "../navigation/Navigation";

/** Reuses the PR #11 cards. Only the browser controller owns the stack. */
export default function RelatedCards() {
  const navigation = useNavigation();
  const { data } = useGarden();
  const { page, cards } = navigation.route;
  const label = (index: number) => {
    const parent = cards[index - 1];
    if (!parent) return pageReturnLabel(page);
    if(parent.kind==="field")return "Wróć do wizyty w terenie";
    if(parent.kind==="availability")return "Wróć do dostępności";
    if (parent.kind === "client")
      return `Wróć do klienta ${data.clients.find((c) => c.id === parent.id)?.name ?? ""}`;
    if (parent.kind === "garden")
      return `Wróć do ogrodu ${data.gardens.find((g) => g.id === parent.id)?.name ?? ""}`;
    if (parent.kind === "zone") return "Wróć do strefy";
    if (parent.kind === "finance") return "Wróć do historii rozliczeń";
    if (parent.kind === "payment") return "Wróć do płatności";
    if (parent.kind === "todo") return "Wróć do sprawy";
    if (parent.kind === "note") return "Wróć do notatki";
    if (parent.kind === "photo") return "Wróć do zdjęcia";
    if (parent.kind === "checklist") return "Wróć do checklisty";
    if (parent.kind === "report") return "Wróć do raportu";
    if (parent.kind === "task") return "Wróć do czynności";
    if (parent.kind === "schedule") return "Wróć do harmonogramu";
    return "Wróć do zlecenia";
  };
  return (
    <>
      {cards.map((card, index) => {
        const active = index === cards.length - 1 && !navigation.route.dialog;
        const context = {
          open: navigation.open,
          back: navigation.back,
          backLabel: label(index),
          section: "section" in card ? card.section : undefined,
          setSection: navigation.section,
          active,
          zoneId:
            card.kind === "zone"
              ? card.id
              : card.kind === "garden"
                ? card.zoneId
                : undefined,
        };
        const inline =
          card.kind === "client" && index === 0 && page === "clients";
        return (
          <ViewScope.Provider
            key={`${data.photoRestoreId ?? "local"}:${cardKey(card)}`}
            value={frameScope(page, card)}
          >
            <CardNavigationContext.Provider value={context}>
              {card.kind === "field" ? (<FieldVisit jobId={card.id} onClose={navigation.back}/>) : card.kind === "availability" ? (<AvailabilityForm dates={card.dates??[card.id]} onClose={navigation.back}/>) : card.kind === "zone" ? (
                <ZoneDetails
                  gardenId={card.gardenId}
                  zoneId={card.id}
                  onClose={navigation.back}
                />
              ) : card.kind === "finance" ? (
                <FinanceDetails
                  owner={card.owner}
                  id={card.id}
                  filter={card.filter}
                  onClose={navigation.back}
                />
              ) : card.kind === "payment" ? (
                <PaymentDetails id={card.id} onClose={navigation.back} />
              ) : card.kind === "note" || card.kind === "todo" ? (
                <DeskDetails
                  kind={card.kind}
                  id={card.id}
                  onClose={navigation.back}
                />
              ) : card.kind === "photo" ? (
                <PhotoDetailsView id={card.id} onClose={navigation.back} />
              ) : card.kind === "checklist" ? (
                <ChecklistDetails id={card.id} onClose={navigation.back} />
              ) : card.kind === "report" ? (
                <ReportPanel
                  jobId={card.id}
                  reportId={card.reportId}
                  onClose={navigation.back}
                />
              ) : card.kind === "garden" ? (
                <GardenDetails
                  gardenId={card.id}
                  onClose={navigation.back}
                  active={active}
                />
              ) : card.kind === "job" ? (
                <JobDetails
                  jobId={card.id}
                  initialBilling={
                    navigation.memory.get(
                      `${frameScope(page, card)}:billing-editor`,
                    ) === true
                  }
                  onClose={navigation.back}
                  active={active}
                />
              ) : card.kind === "task" ? (
                <TaskDetails
                  scheduleId={card.id}
                  originalDate={card.originalDate}
                  cycle={card.cycle}
                  onClose={navigation.back}
                />
              ) : card.kind === "schedule" ? (
                <ScheduleDetails
                  scheduleId={card.id}
                  onClose={navigation.back}
                />
              ) : inline ? (
                <div hidden={!active} inert={!active}>
                  <ClientDetails
                    clientId={card.id}
                    onBack={navigation.back}
                    backLabel={label(index)}
                  />
                </div>
              ) : (
                <Modal
                  title={`Karta klienta: ${data.clients.find((c) => c.id === card.id)?.name ?? "Klient"}`}
                  onClose={navigation.back}
                  fullScreen
                  active={active}
                >
                  <ClientDetails
                    clientId={card.id}
                    onBack={navigation.back}
                    backLabel={label(index)}
                  />
                </Modal>
              )}
            </CardNavigationContext.Provider>
          </ViewScope.Provider>
        );
      })}
    </>
  );
}
