import { useNavigation, useViewState } from "../navigation/Navigation";
import { Pencil, Trash2 } from "lucide-react";
import { moneyCents, type Job, type Payment } from "../domain";
import { displayDate, methodLabels } from "./presentation";
import "../features/payments.css";
export default function PaymentHistory({
  job,
  payments,
  disabled = false,
  onEdit,
  onDelete,
}: {
  job: Job;
  payments: Payment[];
  disabled?: boolean;
  onEdit?: (p: Payment) => void;
  onDelete?: (p: Payment) => void;
}) {
  const navigation = useNavigation(),
    [limit, setLimit] = useViewState(`payment-limit:${job.id}`, 50);
  return (
    <>
      <div className="payment-history">
        <table>
          <caption className="payment-sr-only">
            Zarejestrowane płatności zlecenia {job.title}
          </caption>
          <thead>
            <tr>
              <th>Data</th>
              <th>Kwota</th>
              <th>Metoda / notatka</th>
              <th>
                <span className="payment-sr-only">Operacje</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {payments.slice(0, limit).map((payment) => (
              <tr key={payment.id} data-payment-id={payment.id}>
                <td data-label="Data">{displayDate(payment.receivedDate)}</td>
                <td data-label="Kwota">
                  <button
                    className="client-job-title"
                    aria-label={`Szczegóły płatności ${moneyCents(payment.amountCents)} z ${displayDate(payment.receivedDate)}`}
                    onClick={() =>
                      navigation.open({ kind: "payment", id: payment.id })
                    }
                  >
                    <strong>{moneyCents(payment.amountCents)}</strong>
                  </button>
                </td>
                <td data-label="Metoda / notatka">
                  <span>{methodLabels[payment.method]}</span>
                  {payment.note && <small>{payment.note}</small>}
                  <small className="payment-entry-id">ID: {payment.id}</small>
                </td>
                <td className="payment-entry-actions">
                  {onEdit && (
                    <button
                      className="icon-button"
                      disabled={disabled}
                      aria-label={`Edytuj płatność ${moneyCents(payment.amountCents)} z ${displayDate(payment.receivedDate)}`}
                      onClick={() => onEdit?.(payment)}
                      title="Edytuj płatność"
                    >
                      <Pencil size={16} />
                    </button>
                  )}
                  {onDelete && (
                    <button
                      className="icon-button"
                      disabled={disabled}
                      aria-label={`Usuń płatność ${moneyCents(payment.amountCents)} z ${displayDate(payment.receivedDate)}`}
                      onClick={() => onDelete?.(payment)}
                      title="Usuń płatność"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {limit < payments.length && (
        <button
          className="button secondary"
          onClick={() => setLimit((n) => n + 50)}
        >
          Pokaż kolejne płatności ({payments.length - limit})
        </button>
      )}
    </>
  );
}
