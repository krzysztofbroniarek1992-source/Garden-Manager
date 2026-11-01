import { useState } from 'react';
import Modal from '../components/Modal';
import { useGarden } from '../state';
import { jobDeletionReview } from './job-history';

export default function JobDeleteDialog({
  jobId,
  onClose,
  onDeleted = onClose,
}: {
  jobId: string;
  onClose: () => void;
  onDeleted?: () => void;
}) {
  const { data, deleteJob } = useGarden();
  const [initial] = useState(() => jobDeletionReview(data, jobId));
  const current = jobDeletionReview(data, jobId);
  const [agreed, setAgreed] = useState(false),
    [error, setError] = useState('');
  const changed = initial.signature !== current.signature;
  return (
    <Modal title="Usunąć zlecenie?" onClose={onClose}>
      <h3>{current.job?.title ?? initial.job?.title ?? 'Zlecenie'}</h3>
      {current.reasons.length > 0 ? (
        <div role="status" className="gm-form-note">
          <p>
            Usunięcie jest zablokowane, aby zachować historię i powiązane dane.
          </p>
          <ul>
            {current.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      ) : (
        <>
          <p>
            Usunięcie trwale skasuje kartę zlecenia wraz z zakresem prac,
            materiałami, notatką z formularza, podsumowaniem wizyty, czasem i
            historią przerw. Tej czynności nie można cofnąć.
          </p>
          <p>
            Zdjęcia: {current.photos} · notatki: {current.notes} · checklisty:{' '}
            {current.checklists}. Dokumentacja zostanie zachowana przy ogrodzie
            i w dotychczasowych modułach, z historyczną nazwą wizyty. Powiązanie
            ze zleceniem zostanie odłączone.
          </p>
          <label className="job-delete-consent">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
            />
            Rozumiem skutki i chcę trwale usunąć zlecenie.
          </label>
        </>
      )}
      {changed && (
        <p role="alert" className="gm-form-error">
          Zlecenie lub jego dokumentacja zmieniły się. Zamknij potwierdzenie i
          sprawdź je ponownie.
        </p>
      )}
      {error && (
        <p role="alert" className="gm-form-error">
          {error}
        </p>
      )}
      <div className="gm-modal-actions">
        <button className="button secondary" onClick={onClose}>
          Anuluj
        </button>
        <button
          className="button danger"
          disabled={!agreed || !!current.reasons.length || changed}
          onClick={() => {
            try {
              deleteJob(jobId, initial.signature);
              onDeleted();
            } catch (cause) {
              setError((cause as Error).message);
            }
          }}
        >
          Usuń zlecenie
        </button>
      </div>
    </Modal>
  );
}
