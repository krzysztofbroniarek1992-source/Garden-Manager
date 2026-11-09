import { useRef, useState } from "react";
import { ActivitiesEditor, MaterialsEditor } from "../features/VisitFields";
import { useUnsavedChanges } from "../navigation/unsaved";
import { useGarden } from "../state";
import type { Job, Material } from "../domain";

export function VisitActivitiesForm({
  job,
  adding,
  onClose,
  onSaved,
}: {
  job: Job;
  adding: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { saveVisitActivities } = useGarden();
  const [original] = useState(job.activities);
  const [value, setValue] = useState(() =>
    adding ? [...job.activities, ""] : job.activities,
  );
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const guard = useUnsavedChanges(
    JSON.stringify(value) !== JSON.stringify(original),
  );
  return (
    <form
      ref={guard.ref}
      onSubmit={async (e) => {
        e.preventDefault();
        if (inFlight.current) return;
        inFlight.current = true;
        try {
          await guard.save(() =>
            saveVisitActivities(job.id, job.gardenId, value, original),
          );
          onSaved();
          onClose();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          inFlight.current = false;
        }
      }}
    >
      <ActivitiesEditor value={value} onChange={setValue} />
      {error && (
        <p role="alert" className="gm-form-error">
          {error}
        </p>
      )}
      <div className="field-actions">
        <button
          className="button secondary"
          type="button"
          onClick={() => guard.confirm(onClose)}
        >
          Anuluj
        </button>
        <button className="button primary" type="submit">
          Zapisz czynności
        </button>
      </div>
    </form>
  );
}
export function VisitMaterialsForm({
  job,
  onClose,
  onSaved,
}: {
  job: Job;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { addJobMaterial } = useGarden();
  const [value, setValue] = useState<Material[]>(() => [
    { id: crypto.randomUUID(), name: "", quantity: 1, unitPrice: 0 },
  ]);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const guard = useUnsavedChanges(true);
  return (
    <form
      ref={guard.ref}
      onSubmit={async (e) => {
        e.preventDefault();
        if (inFlight.current) return;
        inFlight.current = true;
        try {
          if (!value.length)
            throw new Error("Dodaj co najmniej jeden materiał.");
          await guard.save(() => addJobMaterial(job.id, job.gardenId, value));
          onSaved();
          onClose();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          inFlight.current = false;
        }
      }}
    >
      {job.settlement && (
        <p className="job-frozen-price-note">
          Dodane materiały nie zmienią zatwierdzonej należności. Uwzględnisz je
          przez świadomą korektę rozliczenia.
        </p>
      )}
      <MaterialsEditor
        value={value}
        onChange={(next) =>
          setValue(
            next.length === 2 &&
              value.length === 1 &&
              !value[0].name &&
              next[1].catalogId
              ? next.slice(1)
              : next,
          )
        }
      />
      {error && (
        <p role="alert" className="gm-form-error">
          {error}
        </p>
      )}
      <div className="field-actions">
        <button
          className="button secondary"
          type="button"
          onClick={() => guard.confirm(onClose)}
        >
          Anuluj
        </button>
        <button className="button primary" type="submit">
          Zapisz materiały
        </button>
      </div>
    </form>
  );
}
