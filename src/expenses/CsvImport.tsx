import { useMemo, useRef, useState, type FormEvent } from "react";
import Modal from "../components/Modal";
import { useGarden } from "../state";
import { useUnsavedChanges } from "../navigation/unsaved";
import { isAndroid, pickBackup } from "../platform/files";
import { moneyCents } from "../domain";
import {
  decodeCsv,
  detectDelimiter,
  digest,
  mappedRows,
  parseCsv,
  remapColumns,
} from "./csv";
import {
  defaultOptions,
  reviewRows,
  rulesKey,
  suggest,
  type CsvMapping,
  type CsvOptions,
  type ExpenseProfile,
  type ImportLine,
} from "./model";
const columnLabels: Record<keyof CsvMapping, string> = {
  date: "Data",
  amount: "Kwota ze znakiem",
  debit: "Obciążenie",
  credit: "Wpływ",
  counterparty: "Kontrahent",
  description: "Opis",
  transactionId: "ID operacji bankowej",
  currency: "Waluta",
};
const stateLabels = {
  new: "Nowa",
  duplicate: "Duplikat",
  ambiguous: "Podobna operacja — sprawdź",
  conflict: "Konflikt ID bankowego",
  error: "Błędna",
};
export default function CsvImport({ onClose }: { onClose: () => void }) {
  const { data, snapshot, saveExpenseProfile, importExpenses } = useGarden();
  const [profile, setProfile] = useState<ExpenseProfile | null>(null),
    [name, setName] = useState(""),
    [options, setOptions] = useState(defaultOptions),
    [file, setFile] = useState<File | null>(null),
    [text, setText] = useState(""),
    [fileHash, setFileHash] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [shown, setShown] = useState(50),
    [preview, setPreview] = useState<{
      id: string;
      rows: ImportLine[];
      statementKey: string;
      profile: ExpenseProfile;
      rulesKey: string;
    } | null>(null);
  const flight = useRef(false);
  const guard = useUnsavedChanges(!!file || !!name);
  const parsed = useMemo(() => {
    try {
      return {
        records: text ? parseCsv(text, options.delimiter) : [],
        error: "",
      };
    } catch (e) {
      return { records: [], error: (e as Error).message };
    }
  }, [text, options.delimiter]);
  const headers = parsed.records[options.headerRow]?.cells ?? [];
  const patch = (value: Partial<CsvOptions>) => {
    setOptions((o) => ({ ...o, ...value }));
    setPreview(null);
  };
  function selectProfile(id: string) {
    const p = data.expenseProfiles.find((p) => p.id === id) ?? null;
    setProfile(p);
    setName(p?.name ?? "");
    setOptions(p ? structuredClone(p.options) : defaultOptions());
    setPreview(null);
    setText("");
    setFile(null);
    setFileHash("");
  }
  async function load(selected: File | null, encoding?: string) {
    if (!selected) return;
    setBusy(true);
    setError("");
    setPreview(null);
    setFile(selected);
    try {
      const decoded = await decodeCsv(
        selected,
        encoding ?? profile?.options.encoding ?? "auto",
      );
      const base = selected === file ? options : (profile?.options ?? options);
      const delimiter =
        selected === file
          ? options.delimiter
          : (profile?.options.delimiter ?? detectDelimiter(decoded.text));
      let next = { ...base, delimiter, encoding: decoded.encoding };
      const records = parseCsv(decoded.text, delimiter);
      if (profile && selected !== file)
        next = {
          ...next,
          mapping: remapColumns(
            profile.headers,
            records[next.headerRow]?.cells ?? [],
            profile.options.mapping,
          ),
        };
      setFile(selected);
      setText(decoded.text);
      setFileHash(decoded.hash);
      setOptions(next);
    } catch (e) {
      setText("");
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function run(action: () => Promise<void>) {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }
  async function review(e: FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    await run(async () => {
      if (!file || !name.trim())
        throw new Error("Wybierz CSV i nazwij profil rachunku.");
      const mapped = await mappedRows(parsed.records, options);
      if (!mapped.rows.length)
        throw new Error("Plik nie zawiera operacji po nagłówku.");
      const next: ExpenseProfile = {
        ...(profile ?? {
          id: crypto.randomUUID(),
          revision: 1,
          createdAt: 0,
          updatedAt: 0,
          archived: false,
        }),
        name: name.trim(),
        options,
        headers: mapped.headers,
      };
      if (
        !profile ||
        JSON.stringify([next.name, next.options, next.headers]) !==
          JSON.stringify([profile.name, profile.options, profile.headers])
      )
        await saveExpenseProfile(next, profile);
      const current = await snapshot();
      const saved = current.expenseProfiles.find((p) => p.id === next.id)!;
      if (
        !saved ||
        saved.archived ||
        JSON.stringify([saved.name, saved.options, saved.headers]) !==
          JSON.stringify([next.name, next.options, next.headers])
      )
        throw new Error(
          "Profil zmienił się w innej karcie. Wybierz go ponownie i sprawdź mapowanie.",
        );
      setProfile(saved);
      setPreview({
        id: crypto.randomUUID(),
        profile: saved,
        rows: reviewRows(current, saved.id, mapped.statementKey, mapped.rows),
        statementKey: mapped.statementKey,
        rulesKey: rulesKey(current),
      });
    });
  }
  async function commit() {
    await run(async () => {
      if (!preview || !file) return;
      if (preview.rows.some((r) => r.state === "conflict"))
        throw new Error("Wyjaśnij konflikty ID bankowych przed importem.");
      if (
        !window.confirm(
          "Zapisać wskazane operacje i ślad importu? Wpływy nie zostaną dodane do płatności zleceń.",
        )
      )
        return;
      const request = {
        ...preview,
        fileHash,
        filename: file.name.slice(0, 200),
      };
      const requestKey = await digest(JSON.stringify(request));
      await guard.save(async () => {
        await importExpenses({ ...request, requestKey });
        onClose();
      });
    });
  }
  function rowPatch(index: number, patch: Partial<ImportLine>) {
    setPreview((p) =>
      p
        ? {
            ...p,
            rows: p.rows.map((r, i) => (i === index ? { ...r, ...patch } : r)),
          }
        : p,
    );
  }
  const counts = preview
    ? {
        new: preview.rows.filter(
          (r) => r.state === "new" || r.state === "ambiguous",
        ).length,
        approved: preview.rows.filter(
          (r) =>
            r.selected && r.status === "approved" && r.state !== "duplicate",
        ).length,
        excluded: preview.rows.filter(
          (r) =>
            r.selected && r.status === "excluded" && r.state !== "duplicate",
        ).length,
        duplicates: preview.rows.filter((r) => r.state === "duplicate").length,
        errors: preview.rows.filter(
          (r) => r.state === "error" || r.state === "conflict",
        ).length,
        skipped: preview.rows.filter(
          (r) =>
            !r.selected &&
            !["error", "conflict", "duplicate"].includes(r.state),
        ).length,
      }
    : null;
  return (
    <Modal title="Import wyciągu CSV" onClose={onClose} wide>
      <form ref={guard.ref} onSubmit={review} className="expense-import">
        {error && (
          <p role="alert" className="gm-form-error">
            {error}
          </p>
        )}
        {busy && <p role="status">Odczyt lub zapis w toku…</p>}
        {!preview ? (
          <>
            <p className="gm-form-note">
              Używaj jednego profilu dla tego samego rachunku w kolejnych
              miesiącach. Nowy profil oznacza inne źródło operacji. Wyłącznie
              PLN · do 5 MB i 2000 operacji. Profil zapiszesz przy przejściu do
              podglądu.
            </p>
            <div className="form-grid">
              <label className="field">
                Profil rachunku
                <select
                  value={profile?.id ?? ""}
                  onChange={(e) => selectProfile(e.target.value)}
                  disabled={busy}
                >
                  <option value="">Nowy profil</option>
                  {data.expenseProfiles
                    .filter((p) => !p.archived)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="field">
                Nazwa profilu rachunku
                <input
                  required
                  maxLength={100}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={busy}
                  placeholder="np. Konto firmowe PLN"
                />
              </label>
              <div className="field full-width">
                Plik CSV
                {isAndroid() ? (
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const file = await pickBackup(undefined, "csv");
                        await load(file);
                      })
                    }
                  >
                    Wybierz CSV z urządzenia
                  </button>
                ) : (
                  <input
                    aria-label="Plik CSV"
                    type="file"
                    accept=".csv,.txt,text/csv,text/plain"
                    disabled={busy}
                    onChange={(e) => void load(e.target.files?.[0] ?? null)}
                  />
                )}
                <span>{file?.name}</span>
              </div>
              {file && (
                <>
                  <label className="field">
                    Kodowanie
                    <select
                      value={options.encoding}
                      disabled={busy}
                      onChange={(e) => void load(file, e.target.value)}
                    >
                      {[
                        ["utf-8", "UTF-8"],
                        ["windows-1250", "Windows-1250"],
                        ["iso-8859-2", "ISO-8859-2"],
                        ["utf-16le", "UTF-16 LE"],
                      ].map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    Separator
                    <select
                      value={options.delimiter}
                      onChange={(e) => patch({ delimiter: e.target.value })}
                    >
                      {[
                        [";", "Średnik"],
                        [",", "Przecinek"],
                        ["\t", "Tabulator"],
                        ["|", "Pionowa kreska"],
                      ].map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    Wiersz nagłówka (od 1)
                    <input
                      type="number"
                      min={1}
                      max={51}
                      value={options.headerRow + 1}
                      onChange={(e) =>
                        patch({ headerRow: Number(e.target.value) - 1 })
                      }
                    />
                  </label>
                  <label className="field">
                    Format daty
                    <select
                      value={options.dateFormat}
                      onChange={(e) =>
                        patch({
                          dateFormat: e.target
                            .value as CsvOptions["dateFormat"],
                        })
                      }
                    >
                      <option value="auto">RRRR-MM-DD lub DD.MM.RRRR</option>
                      <option value="dmy">Dzień, miesiąc, rok</option>
                      <option value="ymd">Rok, miesiąc, dzień</option>
                      <option value="mdy">Miesiąc, dzień, rok</option>
                    </select>
                  </label>
                  <label className="field">
                    Separator dziesiętny
                    <select
                      value={options.decimal}
                      onChange={(e) =>
                        patch({ decimal: e.target.value as "," | "." })
                      }
                    >
                      <option value=",">Przecinek (123,45)</option>
                      <option value=".">Kropka (123.45)</option>
                    </select>
                  </label>
                  <label className="field">
                    Układ kwot
                    <select
                      value={options.mode}
                      onChange={(e) =>
                        patch({
                          mode: e.target.value as CsvOptions["mode"],
                          mapping: {
                            ...options.mapping,
                            amount: -1,
                            debit: -1,
                            credit: -1,
                          },
                        })
                      }
                    >
                      <option value="signed">Jedna kwota ze znakiem</option>
                      <option value="split">Osobno obciążenie i wpływ</option>
                    </select>
                  </label>
                  {options.mode === "signed" && (
                    <label className="field full-width">
                      <span>
                        <input
                          type="checkbox"
                          checked={options.positiveIsExpense}
                          onChange={(e) =>
                            patch({ positiveIsExpense: e.target.checked })
                          }
                        />{" "}
                        Dodatnia kwota oznacza wydatek (odwrócony znak wyciągu)
                      </span>
                    </label>
                  )}
                </>
              )}
            </div>
            {parsed.error && <p role="alert">{parsed.error}</p>}
            {file && (
              <>
                <h3>Przypisz kolumny</h3>
                <div className="form-grid">
                  {(Object.keys(columnLabels) as (keyof CsvMapping)[])
                    .filter((k) =>
                      options.mode === "signed"
                        ? !["debit", "credit"].includes(k)
                        : k !== "amount",
                    )
                    .map((k) => (
                      <label className="field" key={k}>
                        {columnLabels[k]}
                        <select
                          value={options.mapping[k]}
                          onChange={(e) =>
                            patch({
                              mapping: {
                                ...options.mapping,
                                [k]: Number(e.target.value),
                              },
                            })
                          }
                        >
                          <option value={-1}>— brak —</option>
                          {headers.map((h, i) => (
                            <option key={i} value={i}>
                              {i + 1}. {h || "(pusta nazwa)"}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                </div>
                <details open>
                  <summary>Pierwsze 3 wiersze — sprawdź odczyt</summary>
                  <div className="expense-scroll">
                    <table>
                      <thead>
                        <tr>
                          {headers.map((h, i) => (
                            <th key={i}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {parsed.records
                          .slice(options.headerRow + 1, options.headerRow + 4)
                          .map((r, i) => (
                            <tr key={i}>
                              {r.cells.map((c, i) => (
                                <td key={i}>{c}</td>
                              ))}
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </>
            )}
            <div className="gm-modal-actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => guard.confirm(onClose)}
              >
                Anuluj
              </button>
              <button
                type="submit"
                className="button primary"
                disabled={busy || !file || !text || !!parsed.error}
              >
                Zapisz profil i sprawdź operacje
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="gm-form-note">
              Podgląd nie zapisuje wydatków. Domyślnie operacje są wyłączone z
              kosztów. Sprawdź każdą decyzję; wpływy bankowe zawsze pozostają
              poza kosztami i płatnościami.
            </p>
            <p role="status" className="expense-counts">
              Nowe: {counts!.new} · Koszty: {counts!.approved} · Wyłączone:{" "}
              {counts!.excluded} · Duplikaty: {counts!.duplicates} · Pominięte:{" "}
              {counts!.skipped} · Błędy: {counts!.errors}
            </p>
            <button
              type="button"
              className="button secondary"
              onClick={() =>
                setPreview((p) =>
                  p
                    ? {
                        ...p,
                        rows: p.rows.map((r) =>
                          r.row &&
                          r.state === "new" &&
                          r.row.signedCents < 0 &&
                          !suggest(data, r.row).exclusion
                            ? { ...r, selected: true, status: "approved" }
                            : r,
                        ),
                      }
                    : p,
                )
              }
            >
              Zatwierdź nowe obciążenia bez ostrzeżeń
            </button>
            <div className="expense-preview">
              {preview.rows.slice(0, shown).map((r, index) => (
                <article className="expense-preview-row" key={r.line}>
                  <div className="expense-row">
                    <label>
                      <input
                        aria-label={`Importuj wiersz ${r.line}`}
                        type="checkbox"
                        disabled={
                          ["error", "duplicate", "conflict"].includes(
                            r.state,
                          ) ||
                          (r.state === "ambiguous" && !r.separate)
                        }
                        checked={r.selected}
                        onChange={(e) =>
                          rowPatch(index, { selected: e.target.checked })
                        }
                      />{" "}
                      Wiersz {r.line}: {stateLabels[r.state]}
                    </label>
                    <strong>
                      {r.row ? moneyCents(r.row.signedCents) : "—"}
                    </strong>
                  </div>
                  {r.row ? (
                    <>
                      <p>
                        {r.row.date} · {r.row.counterparty} ·{" "}
                        {r.row.description}
                      </p>
                      <p className="muted">{r.reason}</p>
                      {r.state === "ambiguous" && (
                        <label>
                          <input
                            type="checkbox"
                            checked={r.separate}
                            onChange={(e) =>
                              rowPatch(index, {
                                separate: e.target.checked,
                                selected: e.target.checked,
                              })
                            }
                          />{" "}
                          Potwierdzam: osobna rzeczywista operacja, a nie
                          duplikat z innego wyciągu
                        </label>
                      )}
                      {!["duplicate", "conflict"].includes(r.state) && (
                        <div className="form-grid">
                          <label className="field">
                            Kategoria wiersza {r.line}
                            <select
                              value={r.categoryId}
                              onChange={(e) =>
                                rowPatch(index, { categoryId: e.target.value })
                              }
                            >
                              {data.expenseCategories
                                .filter((c) => !c.archived)
                                .map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.name}
                                  </option>
                                ))}
                            </select>
                          </label>
                          <label className="field">
                            Decyzja wiersza {r.line}
                            <select
                              disabled={r.row.signedCents > 0}
                              value={r.status}
                              onChange={(e) =>
                                rowPatch(index, {
                                  status: e.target
                                    .value as ImportLine["status"],
                                })
                              }
                            >
                              <option value="excluded">Wyłącz z kosztów</option>
                              <option value="approved">
                                Zatwierdź koszt firmy
                              </option>
                            </select>
                          </label>
                          <label className="field full-width">
                            Uzasadnienie wiersza {r.line}
                            <input
                              maxLength={3000}
                              value={r.reason}
                              onChange={(e) =>
                                rowPatch(index, { reason: e.target.value })
                              }
                            />
                          </label>
                        </div>
                      )}
                    </>
                  ) : (
                    <p role="alert">{r.error}</p>
                  )}
                </article>
              ))}
            </div>
            {shown < preview.rows.length && (
              <button
                type="button"
                className="button secondary"
                onClick={() => setShown((n) => n + 50)}
              >
                Pokaż kolejne 50 operacji
              </button>
            )}
            <div className="gm-modal-actions">
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => setPreview(null)}
              >
                Wróć do mapowania
              </button>
              <button
                type="button"
                className="button primary"
                disabled={
                  busy || preview.rows.some((r) => r.state === "conflict")
                }
                onClick={() => void commit()}
              >
                Zapisz import ({counts!.approved + counts!.excluded} operacji)
              </button>
            </div>
          </>
        )}
      </form>
    </Modal>
  );
}
