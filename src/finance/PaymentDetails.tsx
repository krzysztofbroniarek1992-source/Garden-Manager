import Modal from "../components/Modal";
import { useGarden } from "../state";
import { useNavigation } from "../navigation/Navigation";
import { useCardNavigation } from "../features/card-navigation";
import { moneyCents } from "../domain";
import { paymentContext } from "./model";
import { displayDate, methodLabels } from "./presentation";
import "./finance.css";
export default function PaymentDetails({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  const { data } = useGarden(),
    navigation = useNavigation(),
    card = useCardNavigation(),
    { payment, job, garden, client } = paymentContext(data, id);
  return (
    <Modal title="Szczegóły płatności" onClose={onClose} wide>
      <nav
        className="related-card-links documentation-links"
        aria-label="Powiązania płatności"
      >
        <button className="button secondary" onClick={onClose}>
          {card?.backLabel ?? "Wróć do poprzedniego widoku"}
        </button>
        {client && (
          <>
            <button
              className="button secondary"
              onClick={() => navigation.open({ kind: "client", id: client.id })}
            >
              Klient: {client.name}
            </button>
            <button
              className="button secondary"
              onClick={() =>
                navigation.open({
                  kind: "finance",
                  owner: "client",
                  id: client.id,
                  filter: "received",
                })
              }
            >
              Płatności klienta
            </button>
          </>
        )}
        {garden && (
          <button
            className="button secondary"
            onClick={() =>
              navigation.open({
                kind: "garden",
                id: garden.id,
                section: "billing",
              })
            }
          >
            Ogród: {garden.name}
          </button>
        )}
        {job && (
          <>
            <button
              className="button secondary"
              onClick={() =>
                navigation.open({ kind: "job", id: job.id, section: "billing" })
              }
            >
              Rozliczenie zlecenia {job.title}
            </button>
            <button
              className="button secondary"
              onClick={() =>
                navigation.open({
                  kind: "job",
                  id: job.id,
                  section: "payments",
                })
              }
            >
              Historia płatności zlecenia
            </button>
            <button
              className="button secondary"
              onClick={() => navigation.open({ kind: "report", id: job.id })}
            >
              Raporty zlecenia ({job.reports?.length ?? 0})
            </button>
          </>
        )}
      </nav>
      {!payment ? (
        <p role="status">
          Płatność została usunięta lub nie jest już dostępna w tym zestawie.
        </p>
      ) : (
        <>
          <dl className="finance-payment-values">
            <dt>Otrzymana kwota</dt>
            <dd data-testid="payment-detail-amount">
              {moneyCents(payment.amountCents)}
            </dd>
            <dt>Data otrzymania</dt>
            <dd>{displayDate(payment.receivedDate)}</dd>
            <dt>Metoda</dt>
            <dd>{methodLabels[payment.method]}</dd>
            <dt>Notatka</dt>
            <dd className="preserve-lines">
              {payment.note || "Brak notatki."}
            </dd>
          </dl>
          {!job && (
            <p role="status">
              Brak dostępnego zlecenia tej płatności. Nie przypisano jej do
              innego klienta ani ogrodu.
            </p>
          )}
          <p className="gm-form-note">
            To zapis faktycznie otrzymanej wpłaty. Otwarcie szczegółów nie
            zmienia rozliczenia ani historii płatności. Edycja pozostaje w
            dotychczasowej historii płatności zlecenia.
          </p>
        </>
      )}
    </Modal>
  );
}
