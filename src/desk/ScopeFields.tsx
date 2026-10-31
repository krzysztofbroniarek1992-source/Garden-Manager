import { useGarden } from '../state';
import type { DeskScope } from './model';
export default function ScopeFields({
  value,
  onChange,
}: {
  value: DeskScope;
  onChange: (scope: DeskScope) => void;
}) {
  const { data } = useGarden();
  const gardens = data.gardens.filter(
      (g) => !value.clientId || g.clientId === value.clientId,
    ),
    garden = data.gardens.find((g) => g.id === value.gardenId);
  return (
    <>
      <label className="field">
        Powiązany klient
        <select
          value={value.clientId ?? ''}
          onChange={(e) =>
            onChange({
              clientId: e.target.value || null,
              gardenId: null,
              zoneId: null,
              jobId: null,
            })
          }
        >
          <option value="">Ogólne — bez klienta</option>
          {data.clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Powiązany ogród
        <select
          value={value.gardenId ?? ''}
          onChange={(e) => {
            const g = data.gardens.find((g) => g.id === e.target.value);
            onChange({
              clientId: g?.clientId ?? value.clientId,
              gardenId: g?.id ?? null,
              zoneId: null,
              jobId: null,
            });
          }}
        >
          <option value="">Bez ogrodu</option>
          {gardens.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Powiązana strefa
        <select
          disabled={!garden}
          value={value.zoneId ?? ''}
          onChange={(e) =>
            onChange({ ...value, zoneId: e.target.value || null })
          }
        >
          <option value="">Bez strefy</option>
          {garden?.zones.map((z) => (
            <option key={z.id} value={z.id}>
              {z.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Powiązane zlecenie
        <select
          disabled={!garden}
          value={value.jobId ?? ''}
          onChange={(e) =>
            onChange({ ...value, jobId: e.target.value || null })
          }
        >
          <option value="">Bez zlecenia lub wizyty</option>
          {data.jobs
            .filter((j) => j.gardenId === garden?.id)
            .map((j) => (
              <option key={j.id} value={j.id}>
                {j.title} · {j.date}
              </option>
            ))}
        </select>
      </label>
    </>
  );
}
