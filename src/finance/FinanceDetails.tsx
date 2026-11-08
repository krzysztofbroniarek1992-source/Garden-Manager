import { requestLeave } from "../navigation/unsaved";
import { useContext, useEffect, useMemo } from "react";
import Modal from "../components/Modal";
import Metric from "./Metric";
import { useGarden, useNow } from "../state";
import {
  useNavigation,
  useViewState,
  ViewScope,
} from "../navigation/Navigation";
import { useCardNavigation } from "../features/card-navigation";
import { financeFilters, type FinanceFilter } from "../navigation/routes";
import { moneyCents, settlementLabels } from "../domain";
import { CheckCheck, Wallet } from "lucide-react";
import GroupedJobHistory from "../features/GroupedJobHistory";
import {
  financeScope,
  filterFinanceJobs,
  financeFilterLabels,
  type FinanceOwner,
} from "./model";
import "./finance.css";
export default function FinanceDetails({
  owner,
  id,
  filter = "all",
  onClose,
}: {
  owner: FinanceOwner;
  id: string;
  filter?: FinanceFilter;
  onClose: () => void;
}) {
  const { data } = useGarden(),
    now = useNow(),
    navigation = useNavigation(),
    card = useCardNavigation();
  const scope = useMemo(
    () => financeScope(data, owner, id, now),
    [data, owner, id, now],
  );
  const [from, setFrom] = useViewState("finance-from", ""),
    [to, setTo] = useViewState("finance-to", ""),
    [gardenId, setGardenId] = useViewState("finance-garden", ""),
    [status, setStatus] = useViewState("finance-status", ""),
    [search, setSearch] = useViewState("finance-search", "");
  const viewScope = useContext(ViewScope);
  useEffect(() => {
    if (!card?.active) return;
    // An ancestor card can remain mounted while a summary resets its search.
    // Reconcile presentation memory when it becomes active, never business data.
    for (const [key, set] of [
      ["from", setFrom],
      ["to", setTo],
      ["garden", setGardenId],
      ["status", setStatus],
      ["search", setSearch],
    ] as const) {
      const value = navigation.memory.get(`${viewScope}:finance-${key}`);
      if (typeof value === "string") set(value);
    }
  }, [card?.active, viewScope]);
  const query = { from, to, gardenId, status, search },
    jobs = filterFinanceJobs(data, scope.jobs, filter, query, now);
  const select = (next: FinanceFilter) =>
    navigation.open({ kind: "finance", owner, id, filter: next });
  const clear = () => {
    setFrom("");
    setTo("");
    setGardenId("");
    setStatus("");
    setSearch("");
  };
  return (
    <Modal
      title={
        scope.exists
          ? `Rozliczenia ${owner === "client" ? "klienta" : "ogrodu"}: ${owner === "client" ? scope.client?.name : scope.garden?.name}`
          : "Historia rozliczeń"
      }
      onClose={onClose}
      fullScreen
    >
      {!scope.exists ? (
        <p role="status">
          Klient lub ogród nie jest już dostępny. Wróć do poprzedniego widoku.
        </p>
      ) : (
        <>
          <nav
            className="related-card-links documentation-links"
            aria-label="Powiązania rozliczeń"
          >
            <button className="button secondary" onClick={onClose}>
              {card?.backLabel ?? "Wróć do poprzedniego widoku"}
            </button>
            {scope.client && (
              <button
                className="button secondary"
                onClick={() =>
                  navigation.open({ kind: "client", id: scope.client!.id })
                }
              >
                Klient: {scope.client.name}
              </button>
            )}
            {scope.garden && (
              <button
                className="button secondary"
                onClick={() =>
                  navigation.open({ kind: "garden", id, section: "billing" })
                }
              >
                Ogród: {scope.garden.name}
              </button>
            )}
          </nav>
          <div
            className="client-metrics finance-metrics"
            aria-label="Podsumowanie rozliczeń"
          >
            <Metric
              label="WARTOŚĆ WYKONANYCH PRAC"
              value={moneyCents(scope.summary.completedValueCents)}
              note="Zakończone · zatwierdzone należności"
              icon={<CheckCheck size={20} />}
              testId="finance-value"
              onOpen={() =>
                requestLeave(() => {
                  clear();
                  select("completed");
                })
              }
            />
            <Metric
              label="OTRZYMANE PŁATNOŚCI"
              value={moneyCents(scope.summary.receivedCents)}
              note="Faktyczne wpłaty, również zaliczki"
              icon={<Wallet size={20} />}
              testId="finance-received"
              onOpen={() =>
                requestLeave(() => {
                  clear();
                  select("received");
                })
              }
            />
            <Metric
              label="POZOSTAŁO DO ZAPŁATY"
              value={moneyCents(scope.summary.outstandingCents)}
              note="Zatwierdzone należności za zakończone prace"
              icon={<Wallet size={20} />}
              testId="finance-outstanding"
              debt
              onOpen={() =>
                requestLeave(() => {
                  clear();
                  select("outstanding");
                })
              }
            />
          </div>
          <p className="gm-form-note">
            Podsumowanie obejmuje{" "}
            {owner === "client"
              ? "wszystkie ogrody klienta"
              : "wyłącznie ten ogród"}
            , niezależnie od filtrów. Wartość wykonanych prac nie oznacza kwoty
            pozostałej do zapłaty. Kwoty przed zatwierdzeniem są orientacyjne.
            Grupowanie i filtry dat dotyczą dnia pracy; każda wpłata zachowuje
            własną datę otrzymania.
          </p>
          <section
            aria-label="Historia rozliczeń"
            className="card finance-history"
          >
            <h3>Historia rozliczeń i płatności</h3>
            <div className="client-job-filters">
              <label className="field">
                Zakres rozliczeń
                <select
                  aria-label="Zakres rozliczeń"
                  value={filter}
                  onChange={(e) => select(e.target.value as FinanceFilter)}
                >
                  {financeFilters.map((f) => (
                    <option key={f} value={f}>
                      {financeFilterLabels[f]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Szukaj pracy
                <input
                  aria-label="Szukaj pracy w rozliczeniach"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <label className="field">
                Data prac od
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </label>
              <label className="field">
                Data prac do
                <input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </label>
              {owner === "client" && (
                <label className="field">
                  Ogród rozliczeń
                  <select
                    aria-label="Ogród rozliczeń"
                    value={gardenId}
                    onChange={(e) => setGardenId(e.target.value)}
                  >
                    <option value="">Wszystkie ogrody klienta</option>
                    {scope.gardens.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="field">
                Status płatności
                <select
                  aria-label="Status płatności w rozliczeniach"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="">Wszystkie statusy</option>
                  {Object.entries(settlementLabels).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="client-filter-summary">
              <span>
                {jobs.length} z {scope.jobs.length} zleceń ·{" "}
                {financeFilterLabels[filter]}
              </span>
              <button className="button secondary" onClick={clear}>
                Wyczyść filtry historii
              </button>
            </div>
            {from && to && from > to && (
              <p role="alert">
                Data „od” nie może być późniejsza niż data „do”.
              </p>
            )}
            <GroupedJobHistory
              jobs={jobs}
              onOpen={(jobId, billing) =>
                navigation.open({
                  kind: "job",
                  id: jobId,
                  section: billing ? "billing" : "work",
                })
              }
              showGarden={owner === "client"}
              financial
              historyKey="finance-history"
            />
          </section>
        </>
      )}
    </Modal>
  );
}
