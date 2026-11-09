import { useState } from "react";
import { Play, Plus } from "lucide-react";
import { localDate, type Job } from "../domain";
import { useGarden, useNow } from "../state";
import { useNavigation, useViewState } from "../navigation/Navigation";
import JobForm from "../features/JobForm";
import { fieldJobs } from "./model";
import "./field.css";

export default function FieldMode() {
  const { data, saveJob } = useGarden(),
    now = useNow(),
    navigation = useNavigation();
  const [query, setQuery] = useViewState("field-search", "");
  const [draft, setDraft] = useState<Job | null>(null);
  const rows = fieldJobs(data, localDate(new Date(now)), query);
  const row = (job: Job) => {
    const garden = data.gardens.find((g) => g.id === job.gardenId),
      client = data.clients.find((c) => c.id === garden?.clientId);
    return (
      <button
        className="field-job-row"
        key={job.id}
        onClick={() => navigation.open({ kind: "field", id: job.id })}
      >
        <strong>{job.title}</strong>
        <span>
          {client?.name} · {garden?.name}
        </span>
        <span>
          {job.date} · {job.time}
          {job.status === "completed" ? " · Zakończone" : ""}
        </span>
      </button>
    );
  };
  const create = () => {
    setDraft({
      id: crypto.randomUUID(),
      gardenId: data.gardens[0]?.id ?? "",
      title: "",
      date: localDate(new Date(now)),
      time: "08:00",
      status: "planned",
      billing: "hourly",
      rate: data.settings.hourlyRate,
      fixedPrice: 0,
      seconds: 0,
      materials: [],
      notes: "",
      activities: [],
      settlement: null,
    });
  };
  return (
    <section className="field-mode" aria-label="Tryb terenowy">
      <div className="page-heading">
        <div>
          <p className="eyebrow">WIZYTA POD RĘKĄ</p>
          <h1>Tryb terenowy</h1>
          <p className="muted">
            Wybierz wizytę. Samo otwarcie nie rozpoczyna pomiaru.
          </p>
        </div>
        <button
          className="button primary"
          onClick={create}
        >
          <Plus size={20} />
          Utwórz zlecenie
        </button>
      </div>
      {rows.active && (
        <section className="field-active" aria-label="Aktywna wizyta">
          <h2>
            <Play size={20} />
            {data.timer?.paused ? "Wizyta na pauzie" : "Pomiar trwa"}
          </h2>
          {row(rows.active)}
        </section>
      )}
      <label className="field">
        Znajdź zlecenie
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Praca, klient, ogród lub adres"
        />
      </label>
      <section aria-label="Zlecenia na dzisiaj">
        <h2>Na dzisiaj</h2>
        {rows.today.map(row)}
        {!rows.today.length && (
          <p className="muted">Brak pasujących zleceń na dziś.</p>
        )}
      </section>
      <section aria-label="Najbliższe zlecenia">
        <h2>Najbliższe zaplanowane</h2>
        {rows.upcoming.slice(0, query ? 100 : 7).map(row)}
        {!rows.upcoming.length && (
          <p className="muted">Brak kolejnych zaplanowanych zleceń.</p>
        )}
      </section>
      {rows.other.length > 0 && (
        <details open={!!query}>
          <summary>Inne zlecenia i historia ({rows.other.length})</summary>
          {rows.other.slice(0, 100).map(row)}
        </details>
      )}
      {!data.jobs.length && (
        <div className="card field-empty">
          <h2>Rozpocznij od zlecenia</h2>
          <p>
            Dodaj wizytę, gdy przyjedziesz na nieplanowaną pracę. Nie utworzono
            żadnych pustych wpisów.
          </p>
        </div>
      )}
      {!data.gardens.length && (
        <p className="report-info">
          Klienta i ogród możesz dodać także w formularzu zlecenia.
          <button
            className="button secondary"
            onClick={() => navigation.go("clients")}
          >
            Otwórz klientów
          </button>
        </p>
      )}
      <p className="gm-form-note">
        Dane zapisujesz lokalnie na tym urządzeniu. Nie są synchronizowane z
        drugim urządzeniem.
      </p>
      {draft && (
        <JobForm
          job={draft}
          onClose={() => setDraft(null)}
          onSave={async (job, expected, permit) => {
            await saveJob(job, expected, permit);
            setDraft(null);
            navigation.open({ kind: "field", id: job.id });
          }}
        />
      )}
    </section>
  );
}
