import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useGarden } from "../state";
import {
  materialUnits,
  materialsTotalCents,
  moneyCents,
  type Material,
} from "../domain";
export function ActivitiesEditor({
  value,
  onChange,
}: {
  value: string[];
  onChange: (value: string[]) => void;
}) {
  return (
    <section
      className="job-activities-editor"
      aria-label="Czynności w ramach jednej wizyty"
    >
      <div className="materials-heading">
        <div>
          <h3>Czynności podczas wizyty</h3>
          <p className="muted">
            Jeden łączny czas pracy. Dodawanie czynności nie zatrzymuje stopera.
          </p>
        </div>
        <button
          className="button ghost"
          type="button"
          onClick={() => onChange([...value, ""])}
        >
          <Plus size={16} />
          Dodaj czynność
        </button>
      </div>
      <div className="job-activity-fields">
        {value.map((activity, index) => (
          <div className="job-activity-row" key={index}>
            <label className="field">
              Czynność {index + 1}
              <input
                required
                maxLength={160}
                value={activity}
                onChange={(event) =>
                  onChange(
                    value.map((item, itemIndex) =>
                      itemIndex === index ? event.target.value : item,
                    ),
                  )
                }
                placeholder="np. cięcie żywopłotu lub sprzątanie"
              />
            </label>
            <button
              className="icon-button"
              type="button"
              aria-label={`Usuń czynność ${index + 1}`}
              onClick={() =>
                onChange(value.filter((_, itemIndex) => itemIndex !== index))
              }
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
export function MaterialsEditor({
  value,
  onChange,
}: {
  value: Material[];
  onChange: (value: Material[]) => void;
}) {
  const { data } = useGarden();
  const [catalogQuery, setCatalogQuery] = useState("");
  const patchMaterial = <K extends keyof Material>(
    id: string,
    key: K,
    next: Material[K],
  ) =>
    onChange(
      value.map((item) => (item.id === id ? { ...item, [key]: next } : item)),
    );
  let materialPreview = "Sprawdź kwoty materiałów";
  try {
    materialPreview = moneyCents(materialsTotalCents({ materials: value }));
  } catch {
    /* incomplete draft */
  }
  return (
    <>
      <div className="materials-heading">
        <div>
          <h3>Materiały</h3>
          <p className="muted">Rozliczane osobno, poza kosztem pracy.</p>
        </div>
        <button
          className="button ghost"
          type="button"
          onClick={() =>
            onChange([
              ...value,
              { id: crypto.randomUUID(), name: "", quantity: 1, unitPrice: 0 },
            ])
          }
        >
          <Plus size={16} /> Dodaj
        </button>
      </div>
      <div className="form-grid catalog-job-picker">
        <label className="field">
          Szukaj materiału w katalogu
          <input
            type="search"
            value={catalogQuery}
            onChange={(e) => setCatalogQuery(e.target.value)}
          />
        </label>
        <label className="field">
          Dodaj z katalogu
          <select
            value=""
            onChange={(e) => {
              const item = data.materialCatalog.find(
                (m) => m.id === e.target.value,
              );
              if (item)
                onChange([
                  ...value,
                  {
                    id: crypto.randomUUID(),
                    name: item.name,
                    quantity: 1,
                    unit: item.unit,
                    purchaseUnitPrice: item.purchaseUnitPrice,
                    unitPrice: item.purchaseUnitPrice,
                    catalogId: item.id,
                  },
                ]);
            }}
          >
            <option value="">Wybierz materiał</option>
            {data.materialCatalog
              .filter((m) =>
                `${m.name} ${m.category}`
                  .toLocaleLowerCase("pl")
                  .includes(catalogQuery.toLocaleLowerCase("pl")),
              )
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.unit})
                </option>
              ))}
          </select>
        </label>
      </div>
      <div className="materials-list">
        {value.map((item, index) => (
          <div className="material-row material-row-extended" key={item.id}>
            <label className="field material-name">
              Materiał
              <input
                required
                aria-label={`Nazwa materiału ${index + 1}`}
                maxLength={150}
                placeholder="np. Nawóz"
                value={item.name}
                onChange={(e) => patchMaterial(item.id, "name", e.target.value)}
              />
            </label>
            <label className="field">
              Ilość
              <input
                required
                aria-label={`Ilość materiału ${index + 1}`}
                type="number"
                min="0.000000001"
                step="any"
                value={item.quantity}
                onChange={(e) =>
                  patchMaterial(item.id, "quantity", Number(e.target.value))
                }
              />
            </label>
            <label className="field">
              Jednostka
              <select
                aria-label={`Jednostka materiału ${index + 1}`}
                value={item.unit ?? ""}
                onChange={(e) =>
                  patchMaterial(
                    item.id,
                    "unit",
                    e.target.value
                      ? (e.target.value as Material["unit"])
                      : undefined,
                  )
                }
              >
                <option value="">jedn.</option>
                {materialUnits.map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </select>
            </label>
            <label className="field">
              Zakup (zł / jedn.)
              <input
                aria-label={`Cena zakupu materiału ${index + 1}`}
                type="number"
                min="0"
                step="0.01"
                value={item.purchaseUnitPrice ?? ""}
                onChange={(e) =>
                  patchMaterial(
                    item.id,
                    "purchaseUnitPrice",
                    e.target.value === "" ? undefined : Number(e.target.value),
                  )
                }
              />
            </label>
            <label className="field">
              Dla klienta (zł / jedn.)
              <input
                required
                aria-label={`Cena materiału ${index + 1}`}
                type="number"
                min="0"
                step="0.01"
                value={item.unitPrice}
                onChange={(e) =>
                  patchMaterial(item.id, "unitPrice", Number(e.target.value))
                }
              />
            </label>
            <button
              className="icon-button"
              type="button"
              aria-label={`Usuń materiał ${index + 1}`}
              onClick={() => onChange(value.filter((m) => m.id !== item.id))}
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
      <div className="materials-total">
        <span>Materiały razem</span>
        <strong>{materialPreview}</strong>
      </div>
    </>
  );
}
