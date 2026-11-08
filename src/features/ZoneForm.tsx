import { useState, type FormEvent } from "react";
import { useUnsavedChanges } from "../navigation/unsaved";
import { useGarden } from "../state";
import type { GardenZone } from "../domain";
import "./gardening.css";

export default function ZoneForm({
  gardenId,
  initial,
  onClose,
}: {
  gardenId: string;
  initial: GardenZone;
  onClose: () => void;
}) {
  const { saveZone } = useGarden();
  const [draft, setDraft] = useState(initial);
  const guard = useUnsavedChanges(
    JSON.stringify(draft) !== JSON.stringify(initial),
  );
  const [error, setError] = useState("");
  const patch = <K extends keyof GardenZone>(key: K, value: GardenZone[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await guard.save(async () => {
        await saveZone(gardenId, draft);
        onClose();
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <form ref={guard.ref} onSubmit={submit} className="zone-form">
      <h3>{initial.name ? "Edycja strefy" : "Nowa strefa"}</h3>
      {error && (
        <p role="alert" className="gm-form-error">
          {error}
        </p>
      )}
      <div className="form-grid">
        <label className="field">
          Nazwa strefy
          <input
            required
            maxLength={150}
            value={draft.name}
            onChange={(e) => patch("name", e.target.value)}
          />
        </label>
        <label className="field">
          Rodzaj strefy
          <input
            required
            list="zone-types"
            maxLength={100}
            value={draft.type}
            onChange={(e) => patch("type", e.target.value)}
          />
          <datalist id="zone-types">
            {["trawnik", "rabata", "żywopłot", "drzewa", "nawierzchnia"].map(
              (type) => (
                <option key={type} value={type} />
              ),
            )}
          </datalist>
        </label>
        <label className="field">
          Powierzchnia strefy (m²)
          <input
            type="number"
            min="0"
            step="any"
            value={draft.area ?? ""}
            onChange={(e) =>
              patch(
                "area",
                e.target.value === "" ? null : Number(e.target.value),
              )
            }
          />
        </label>
        <label className="field">
          Długość strefy (m)
          <input
            type="number"
            min="0"
            step="any"
            value={draft.length ?? ""}
            onChange={(e) =>
              patch(
                "length",
                e.target.value === "" ? null : Number(e.target.value),
              )
            }
          />
        </label>
        <label className="field full-width">
          Rośliny
          <textarea
            maxLength={5000}
            value={draft.plants}
            onChange={(e) => patch("plants", e.target.value)}
          />
        </label>
        <label className="field full-width">
          Szczególne wymagania
          <textarea
            maxLength={5000}
            value={draft.requirements}
            onChange={(e) => patch("requirements", e.target.value)}
          />
        </label>
        <label className="field full-width">
          Wykonane zabiegi
          <textarea
            maxLength={10000}
            placeholder="Data i opis zabiegu"
            value={draft.treatments}
            onChange={(e) => patch("treatments", e.target.value)}
          />
        </label>
      </div>
      <div className="gm-modal-actions">
        <button
          className="button secondary"
          type="button"
          onClick={() => guard.confirm(onClose)}
        >
          Anuluj edycję strefy
        </button>
        <button className="button primary" type="submit">
          Zapisz strefę
        </button>
      </div>
    </form>
  );
}
