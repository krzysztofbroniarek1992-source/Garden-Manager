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
    if (!parent)
      return page === "clients"
        ? "Wróć do klientów"
        : page === "gardens"
          ? "Wróć do listy ogrodów"
          : page === "calendar"
            ? "Wróć do kalendarza"
            : page === "dashboard"
              ? "Wróć do pulpitu"
              : page === "history"
                ? "Wróć do historii prac"
                : "Wróć do zleceń";
    if (parent.kind === "client")
      return `Wróć do klienta ${data.clients.find((c) => c.id === parent.id)?.name ?? ""}`;
    if (parent.kind === "garden")
      return `Wróć do ogrodu ${data.gardens.find((g) => g.id === parent.id)?.name ?? ""}`;
    return "Wróć do zlecenia";
  };
  return (
    <>
      {cards.map((card, index) => {
        const active = index === cards.length - 1;
        const context = {
          open: navigation.open,
          back: navigation.back,
          backLabel: label(index),
          section: "section" in card ? card.section : undefined,
          setSection: navigation.section,
          active,
        };
        const inline =
          card.kind === "client" && index === 0 && page === "clients";
        return (
          <ViewScope.Provider
            key={`${data.photoRestoreId ?? "local"}:${card.kind}:${card.id}`}
            value={frameScope(page, card)}
          >
            <CardNavigationContext.Provider value={context}>
              {card.kind === "garden" ? (
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
