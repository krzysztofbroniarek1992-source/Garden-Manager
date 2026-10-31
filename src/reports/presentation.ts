import { duration, moneyCents } from '../domain';
import { itemStatusLabels } from '../checklists/model';
import type { ReportSnapshot } from './model';
export function reportDuration(seconds: number): string {
  const whole = Math.floor(seconds),
    fraction = String(seconds).includes('.')
      ? String(seconds).split('.')[1]
      : '';
  return duration(whole) + (fraction ? `,${fraction}` : '');
}
export function pauseDuration(ms: number): string {
  return (
    duration(Math.floor(ms / 1000)) +
    (ms % 1000 ? `,${String(ms % 1000).padStart(3, '0')}` : '')
  );
}
export function reportSections(
  s: ReportSnapshot,
): { title: string; lines: string[] }[] {
  const sections = [
    { title: 'Wykonane prace', lines: s.workDescription.split('\n') },
  ];
  if (s.time)
    sections.push({
      title: 'Czas pracy',
      lines: [
        `Rzeczywisty czas pracy: ${reportDuration(s.time.workSeconds)}`,
        ...(s.time.historySince === null
          ? ['Brak zapisanej historii wcześniejszych przerw i korekt.']
          : [
              `Udokumentowane przerwy: ${pauseDuration(s.time.recordedPauseMs)}`,
              `Historia przerw i korekt od: ${new Date(s.time.historySince).toLocaleString('pl-PL')}`,
            ]),
        ...s.time.corrections.map(
          (c) =>
            `Korekta ${new Date(c.at).toLocaleString('pl-PL')}: ${reportDuration(c.beforeSeconds)} → ${reportDuration(c.afterSeconds)}`,
        ),
      ],
    });
  if (s.materials)
    sections.push({
      title: 'Wykorzystane materiały',
      lines: s.materials.length
        ? s.materials.map(
            (m) =>
              `${m.name} — ${m.quantity.toLocaleString('pl-PL', { maximumFractionDigits: 20 })} ${m.unit}`,
          )
        : ['Nie wykazano materiałów.'],
    });
  if (s.checklists)
    for (const c of s.checklists) {
      const count = c.items.filter((i) => i.status !== 'not-applicable').length,
        done = c.items.filter((i) => i.status === 'done').length;
      sections.push({
        title: `Checklista: ${c.name}`,
        lines: [
          `Postęp: ${count ? `${((done / count) * 100).toLocaleString('pl-PL', { maximumFractionDigits: 0 })}%` : '—'} (${done}/${count}), nie dotyczy: ${c.items.length - count}`,
          ...c.items.map(
            (i) =>
              `${itemStatusLabels[i.status]}: ${i.title}${i.completedAt === null ? '' : ` · ${new Date(i.completedAt).toLocaleString('pl-PL')}`}`,
          ),
        ],
      });
    }
  if (s.remarks !== null && s.remarks.trim())
    sections.push({
      title: 'Uwagi i zalecenia dla klienta',
      lines: s.remarks.split('\n'),
    });
  if (s.finance)
    sections.push({
      title: 'Zatwierdzone rozliczenie',
      lines: [
        `Sposób rozliczenia: ${s.finance.billing === 'fixed' ? 'Ryczałt' : 'Godzinowe'}`,
        `Robocizna: ${moneyCents(s.finance.laborCents)}`,
        `Materiały osobno: ${moneyCents(s.finance.materialsCents)}`,
        `Należność razem: ${moneyCents(s.finance.totalCents)}`,
        `Otrzymane płatności: ${moneyCents(s.finance.paidCents)}`,
        `Pozostało do zapłaty: ${moneyCents(s.finance.remainingCents)}`,
      ],
    });
  return sections;
}
