import { CheckCheck, CircleDashed, CircleDollarSign } from 'lucide-react';
import { settlementLabels } from '../domain';
import './payment-badge.css';

type PaymentStatus = 'unpaid' | 'partial' | 'paid';

export default function PaymentBadge({ status }: { status: PaymentStatus }) {
  const Icon = status === 'paid' ? CheckCheck : status === 'partial' ? CircleDollarSign : CircleDashed;
  return <span className={`payment-badge payment-${status}`} aria-label={`Status płatności: ${settlementLabels[status]}`}><Icon size={13}/>{settlementLabels[status]}</span>;
}
