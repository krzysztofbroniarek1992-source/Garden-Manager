import { lazy, Suspense } from 'react';
import { useGarden } from '../state';
import { scheduleDescription } from './TaskForm';
const ChecklistPanel = lazy(() => import('../checklists/ChecklistPanel'));
export default function GardenSchedule({ gardenId }: { gardenId: string }) {
  const { data } = useGarden();
  const schedules = data.taskSchedules.filter((s) => s.gardenId === gardenId);
  return (
    <>
      <h3>Harmonogram ogrodu</h3>
      <p className="muted">
        Reguły z istniejącego kalendarza. Terminy i wyjątki edytujesz w
        dotychczasowym kalendarzu; plan nie nalicza czasu ani należności.
      </p>
      {schedules.length ? (
        schedules.map((s) => (
          <article key={s.id} className="tool-card">
            <h4>{s.title}</h4>
            <p>
              {scheduleDescription(s)} · od {s.startDate}
              {s.endDate && ` do ${s.endDate}`}
            </p>
            {s.zoneName && <p>Strefa: {s.zoneName}</p>}
            {s.endedOn && <p>Seria zakończona: {s.endedOn}</p>}
          </article>
        ))
      ) : (
        <p>Brak harmonogramów przypisanych do tego ogrodu.</p>
      )}
      <Suspense fallback={<p role="status">Otwieranie planów…</p>}>
        <ChecklistPanel target={{ kind: 'plan', gardenId, zoneId: null }} />
      </Suspense>
    </>
  );
}
