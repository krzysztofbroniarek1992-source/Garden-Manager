import { useEffect, useMemo, useState } from 'react';
import Modal from '../components/Modal';
import { useGarden } from '../state';
import { LocalRepository } from '../data/repository';
import { usePhotos } from '../photos/state';
import { PhotoImage } from '../photos/PhotoGallery';
import { photoCategories } from '../photos/model';
import {
  defaultReportOptions,
  eligibleReportPhoto,
  type ReportOptions,
  type VisitReport,
} from './model';
import { reportSections } from './presentation';
import { ReportService, type PreparedReport } from './service';
import './reports.css';
const filename = (record: VisitReport) =>
  `${record.number.replaceAll('/', '-')}-v${record.version}.pdf`;
function download(bytes: Uint8Array, name: string) {
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], {
      type: 'application/pdf',
    }),
    url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function PublicReportPreview({ report }: { report: VisitReport }) {
  const { data } = useGarden(),
    s = report.snapshot,
    photo = (id: string) =>
      data.photos.find((p) => p.id === id && p.deletedAt === null);
  return (
    <article className="report-paper" aria-label="Treść raportu dla klienta">
      <header>
        <div>
          <h3>BRONIAREK OGRODY</h3>
          <p>RAPORT WYKONANYCH PRAC</p>
        </div>
        {s.logo && photo(s.logo.photoId) && (
          <div className="report-logo">
            <PhotoImage
              photo={{
                ...photo(s.logo.photoId)!,
                description: 'Logo BRONIAREK OGRODY',
                filename: 'Logo',
              }}
              thumbnail
            />
          </div>
        )}
      </header>
      <p className="report-number">
        <strong>
          {report.number} · wersja {report.version}
        </strong>
        <span>
          Wygenerowano: {new Date(report.generatedAt).toLocaleString('pl-PL')}
        </span>
      </p>
      <dl className="report-client">
        <dt>Data wykonania prac</dt>
        <dd>{s.visitDate}</dd>
        <dt>Klient</dt>
        <dd>{s.clientName}</dd>
        <dt>Ogród</dt>
        <dd>{s.gardenName}</dd>
        {s.address && (
          <>
            <dt>Adres</dt>
            <dd>{s.address}</dd>
          </>
        )}
        {s.zoneName && (
          <>
            <dt>Strefa</dt>
            <dd>{s.zoneName}</dd>
          </>
        )}
      </dl>
      {reportSections(s).map((block, i) => (
        <section key={i}>
          <h4>{block.title}</h4>
          {block.lines.map((line, n) => (
            <p key={n}>{line || '\u00a0'}</p>
          ))}
        </section>
      ))}
      {s.photos.length > 0 && (
        <section>
          <h4>Dokumentacja fotograficzna</h4>
          <div className="report-photo-grid">
            {s.photos.map((p) => (
              <figure key={p.photoId}>
                {photo(p.photoId) ? (
                  <PhotoImage
                    photo={{
                      ...photo(p.photoId)!,
                      description: `${p.category === 'before' ? 'PRZED PRACĄ' : 'PO PRACY'} · ${p.date}`,
                      filename: 'Dokumentacja wizyty',
                    }}
                    thumbnail
                  />
                ) : (
                  <p>Zdjęcie jest niedostępne.</p>
                )}
                <figcaption>
                  {p.category === 'before' ? 'PRZED PRACĄ' : 'PO PRACY'} ·{' '}
                  {p.date}
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}
    </article>
  );
}
export default function ReportPanel({
  jobId,
  onClose,
}: {
  jobId: string;
  onClose: () => void;
}) {
  const { data, saveVisitReport } = useGarden(),
    photos = usePhotos(),
    job = data.jobs.find((j) => j.id === jobId);
  const [options, setOptions] = useState<ReportOptions>(defaultReportOptions),
    [prepared, setPrepared] = useState<PreparedReport | null>(null),
    [historical, setHistorical] = useState<VisitReport | null>(null),
    [historyBytes, setHistoryBytes] = useState<Uint8Array | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [showPdf, setShowPdf] = useState(false);
  const service = useMemo(
    () =>
      new ReportService(
        {
          snapshot: () => new LocalRepository(localStorage).load(),
          saveVisitReport,
        },
        photos.assets,
      ),
    [saveVisitReport, photos.assets],
  );
  const bytes = historical ? historyBytes : prepared?.bytes,
    record = historical ?? prepared?.record;
  const url = useMemo(
    () =>
      bytes
        ? URL.createObjectURL(
            new Blob([bytes.slice().buffer as ArrayBuffer], {
              type: 'application/pdf',
            }),
          )
        : '',
    [bytes],
  );
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  if (!job)
    return (
      <Modal title="Raport wizyty" onClose={onClose}>
        <p>Wizyta nie jest już dostępna.</p>
      </Modal>
    );
  const images = data.photos.filter((p) => eligibleReportPhoto(data, job, p)),
    eligible = images.filter(
      (p) => p.category === 'before' || p.category === 'after',
    );
  const patch = (next: Partial<ReportOptions>) => {
    setOptions({ ...options, ...next });
    setPrepared(null);
    setHistorical(null);
    setHistoryBytes(null);
    setNotice('');
    setShowPdf(false);
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Raport PDF dla klienta" onClose={onClose} wide>
      <div className="report-builder">
        <h3>{job.title}</h3>
        <p className="gm-form-note">
          Raport korzysta z zapisanego opisu wykonanych prac i danych wizyty.
          Podgląd pozwala sprawdzić treść przed zapisaniem raportu i pobraniem
          PDF.
        </p>
        <fieldset disabled={busy} className="report-options">
          <legend>Co umieścić w raporcie</legend>
          {(
            [
              ['showTime', 'Pokaż czas pracy'],
              ['showFinance', 'Pokaż ceny i należności'],
              ['showMaterials', 'Pokaż materiały i ilości'],
              ['showChecklists', 'Pokaż checklisty i statusy'],
              ['showPhotos', 'Dołącz wybrane zdjęcia PRZED/PO'],
              ['showRemarks', 'Dołącz uwagi i zalecenia dla klienta'],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={options[key]}
                onChange={(e) => patch({ [key]: e.target.checked })}
              />
              {label}
            </label>
          ))}
        </fieldset>
        <p className="report-privacy-note">
          Notatki wewnętrzne, uwagi z checklist, dane kontaktowe, koszty zakupu
          i marża nie są dołączane. Finanse i uwagi dla klienta wymagają
          zaznaczenia.
        </p>
        {options.showPhotos && (
          <fieldset className="report-photo-picker" disabled={busy}>
            <legend>Wybierz zdjęcia wizyty lub ogrodu (maksymalnie 6)</legend>
            {eligible.map((p) => (
              <label key={p.id}>
                <input
                  type="checkbox"
                  aria-label={`Dołącz zdjęcie ${p.filename}`}
                  checked={options.photoIds.includes(p.id)}
                  onChange={(e) =>
                    patch({
                      photoIds: e.target.checked
                        ? [...options.photoIds, p.id]
                        : options.photoIds.filter((id) => id !== p.id),
                    })
                  }
                />
                <span>
                  {photoCategories[p.category]} ·{' '}
                  {p.capturedDate ??
                    new Date(p.addedAt).toLocaleDateString('pl-PL')}
                </span>
                <PhotoImage photo={p} thumbnail />
              </label>
            ))}
            {!eligible.length && (
              <p>
                Dodaj zdjęcia do galerii wizyty lub ogrodu i oznacz je PRZED
                PRACĄ albo PO PRACY.
              </p>
            )}
          </fieldset>
        )}
        <details className="report-logo-settings">
          <summary>Opcjonalne logo firmy</summary>
          <label className="field">
            Logo z galerii wizyty lub ogrodu
            <select
              aria-label="Logo z galerii wizyty lub ogrodu"
              value={options.logoPhotoId ?? ''}
              disabled={busy}
              onChange={(e) => patch({ logoPhotoId: e.target.value || null })}
            >
              <option value="">Bez logo</option>
              {images.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.filename}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Dodaj logo do galerii wizyty
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={busy || photos.busy || !photos.ready}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file)
                  void run(async () => {
                    await photos.add([{ blob: file, name: file.name }], {
                      clientId: null,
                      gardenId: job.gardenId,
                      zoneId: null,
                      jobId: job.id,
                      category: 'other',
                      description: '',
                      capturedDate: null,
                    });
                    setNotice(
                      'Logo zapisano w galerii w kategorii INNE. Wybierz je z listy logo.',
                    );
                  });
              }}
            />
          </label>
        </details>
        {error && (
          <p className="gm-form-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="report-notice" role="status">
            {notice}
          </p>
        )}
        <div className="report-actions">
          <button
            className="button primary"
            disabled={busy || job.status !== 'completed'}
            onClick={() =>
              void run(async () => {
                const result = await service.prepare(jobId, options);
                setPrepared(result);
                setHistorical(null);
                setHistoryBytes(null);
                setShowPdf(false);
              })
            }
          >
            Przygotuj podgląd raportu
          </button>
        </div>
        {busy && <p role="status">Przygotowywanie raportu…</p>}
        {record && bytes && (
          <section className="report-preview" aria-label="Podgląd raportu">
            <p className="report-preview-state">
              {historical
                ? 'Zapisana historyczna wersja raportu.'
                : prepared?.reused
                  ? 'Wybrane dane odpowiadają ostatniej zapisanej wersji.'
                  : 'Podgląd — raport nie jest jeszcze zapisany w historii.'}
            </p>
            <PublicReportPreview report={record} />
            <div className="report-actions">
              <button
                className="button secondary"
                onClick={() => setShowPdf((v) => !v)}
              >
                {showPdf ? 'Ukryj plik PDF' : 'Pokaż plik PDF'}
              </button>
              <button
                className="button primary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    if (!historical && prepared)
                      await service.save(jobId, prepared);
                    download(bytes, filename(record));
                    setNotice(
                      'Raport zapisany w historii i przygotowany do pobrania.',
                    );
                  })
                }
              >
                {historical
                  ? 'Pobierz tę wersję PDF'
                  : 'Zapisz raport i pobierz PDF'}
              </button>
            </div>
            {showPdf && (
              <iframe
                title="Podgląd pliku PDF"
                className="report-pdf-frame"
                src={url}
              />
            )}
          </section>
        )}
        <section
          className="report-history"
          aria-label="Historia raportów wizyty"
        >
          <h3>Historia raportów</h3>
          {(job.reports ?? [])
            .slice()
            .reverse()
            .map((r) => (
              <article className="report-history-row" key={r.id}>
                <div>
                  <strong>
                    {r.number} · wersja {r.version}
                  </strong>
                  <p>{new Date(r.generatedAt).toLocaleString('pl-PL')}</p>
                  <small>
                    {r.snapshot.photos.length} zdjęć ·{' '}
                    {r.snapshot.finance ? 'z rozliczeniem' : 'bez finansów'}
                  </small>
                </div>
                <div className="report-actions">
                  <button
                    className="button secondary"
                    disabled={busy}
                    aria-label={`Podgląd wersji ${r.version}`}
                    onClick={() =>
                      void run(async () => {
                        setHistoryBytes(await service.regenerate(r));
                        setHistorical(r);
                        setPrepared(null);
                        setShowPdf(false);
                      })
                    }
                  >
                    Podgląd
                  </button>
                  <button
                    className="button secondary"
                    disabled={busy}
                    aria-label={`Pobierz ponownie wersję ${r.version}`}
                    onClick={() =>
                      void run(async () => {
                        download(await service.regenerate(r), filename(r));
                        setNotice(
                          'Pobrano zapisaną wersję. Dane wizyty i historia pozostają zachowane.',
                        );
                      })
                    }
                  >
                    Pobierz ponownie
                  </button>
                </div>
              </article>
            ))}
          {!job.reports?.length && (
            <p className="muted">Nie zapisano jeszcze raportu tej wizyty.</p>
          )}
        </section>
      </div>
    </Modal>
  );
}
