import { useEffect, useState } from 'react';
import { useGarden } from '../state';
import Modal from '../components/Modal';
import GardenDetails from './GardenDetails';
import ClientDetails from './ClientDetails';
import JobDetails from './JobDetails';
import { CardNavigationContext, type RelatedCard } from './card-navigation';

/** A small view stack only for client ↔ garden ↔ visit cards. Hidden cards keep
 * their selected section, filters, expanded months and scroll position. */
export default function RelatedCards({
  initial,
  onClose,
  originClientId,
  originJobId,
}: {
  initial: RelatedCard;
  onClose: () => void;
  originClientId?: string;
  originJobId?: string;
}) {
  const { data } = useGarden();
  const [stack, setStack] = useState<RelatedCard[]>([initial]);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    return () => {
      requestAnimationFrame(() => {
        if (opener?.isConnected) opener.focus({ preventScroll: true });
      });
    };
  }, []);
  const back = () => {
    if (stack.length === 1) onClose();
    else setStack((s) => s.slice(0, -1));
  };
  const open = (card: RelatedCard) => {
    if (
      (card.kind === 'client' && card.id === originClientId) ||
      (card.kind === 'job' && card.id === originJobId)
    ) {
      onClose();
      return;
    }
    setStack((s) => {
      const index = s.findIndex(
        (c) => c.kind === card.kind && c.id === card.id,
      );
      return index < 0 ? [...s, card] : s.slice(0, index + 1);
    });
  };
  const label = (card: RelatedCard) =>
    card.kind === 'garden'
      ? `Wróć do ogrodu ${data.gardens.find((g) => g.id === card.id)?.name ?? ''}`
      : card.kind === 'client'
        ? `Wróć do klienta ${data.clients.find((c) => c.id === card.id)?.name ?? ''}`
        : 'Wróć do zlecenia';
  return (
    <>
      {stack.map((card, index) => {
        const active = index === stack.length - 1;
        const backLabel =
          index > 0
            ? label(stack[index - 1])
            : originClientId
              ? `Wróć do klienta ${data.clients.find((c) => c.id === originClientId)?.name ?? ''}`
              : originJobId
                ? 'Wróć do zlecenia'
                : 'Wróć do listy ogrodów';
        return (
          <CardNavigationContext.Provider
            key={`${card.kind}:${card.id}`}
            value={{ open, back, backLabel }}
          >
            {card.kind === 'garden' ? (
              <GardenDetails
                gardenId={card.id}
                onClose={back}
                active={active}
              />
            ) : card.kind === 'job' ? (
              <JobDetails
                jobId={card.id}
                initialBilling={card.initialBilling}
                onClose={back}
                active={active}
              />
            ) : (
              <Modal
                title={`Karta klienta: ${data.clients.find((c) => c.id === card.id)?.name ?? 'Klient'}`}
                onClose={back}
                fullScreen
                active={active}
              >
                <ClientDetails
                  clientId={card.id}
                  onBack={back}
                  backLabel={backLabel}
                />
              </Modal>
            )}
          </CardNavigationContext.Provider>
        );
      })}
    </>
  );
}
