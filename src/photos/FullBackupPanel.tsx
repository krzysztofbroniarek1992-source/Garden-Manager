import { useState } from 'react';
import { useGarden } from '../state';
import { localDate, type Data } from '../domain';
import { usePhotos } from './state';
import type { PreparedBackup } from './backup';
import './photos.css';

type Preview = { kind: 'zip'; prepared: PreparedBackup; expected: string } | { kind: 'recovery'; id: string; data: Data; expected: string };
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function FullBackupPanel() {
  const photos = usePhotos(), { data } = useGarden();
  const [preview, setPreview] = useState<Preview | null>(null), [word, setWord] = useState(''), [agreed, setAgreed] = useState(false);
  const [notice, setNotice] = useState(''), [error, setError] = useState(''), [clearing, setClearing] = useState(false);
  const counts = preview?.kind === 'zip' ? preview.prepared.data : preview?.data;
  const action = async (fn: () => Promise<void>) => { setError(''); setNotice(''); try { await fn(); } catch (e) { setError((e as Error).message); } };
  const reset = () => { setWord(''); setAgreed(false); setPreview(null); };
  return <section className="photo-backup-panel" aria-label="Pełne kopie danych i zdjęć"><h3>Pełna kopia danych i zdjęć</h3>
    <p>Kopia ZIP zawiera cały zestaw danych, w tym notatki, przypomnienia, sprawy, szablony, checklisty, historię raportów, zdjęcia i miniatury. Przechowuj ją poza tą przeglądarką. Zwykły eksport JSON zawiera metadane zdjęć, bez ich plików.</p>
    {photos.error && <div className="photo-error" role="alert"><p>{photos.error}</p><button className="button secondary" disabled={photos.busy} onClick={() => { void photos.retry().catch(() => {}); }}>Ponów dostęp i porządkowanie zdjęć</button></div>}
    <button className="button secondary" disabled={photos.busy || !photos.ready} onClick={() => { void action(async () => { download(await photos.exportFull(), `garden-manager-pelna-kopia-${localDate()}.zip`); setNotice('Pełna kopia ZIP została przygotowana do pobrania.'); }); }}>Pobierz pełną kopię ZIP</button>
    <label className="field">Wczytaj pełną kopię ZIP<input type="file" accept=".zip,application/zip" disabled={photos.busy || !photos.ready} onChange={e => { const file = e.target.files?.[0]; reset(); e.target.value = ''; if (file) void action(async () => { const result = await photos.prepare(file); setPreview({ kind: 'zip', ...result }); }); }}/></label>
    <p className="gm-form-note">Limit kopii: 200 MB. Wczytanie jedynie sprawdza plik. Zastąpienie danych wymaga osobnego potwierdzenia. Przed odtwarzaniem zakończ pomiar wizyty przyciskiem STOP.</p>
    {photos.busy && <p role="status">{photos.progress}</p>}
    {preview && counts && <div className="photo-backup-preview" role="group" aria-label="Potwierdzenie odtworzenia pełnej kopii"><h4>{preview.kind === 'zip' ? 'Sprawdzona pełna kopia' : 'Zachowany punkt odzyskiwania'}</h4><dl><dt>Klienci / ogrody</dt><dd>{counts.clients.length} / {counts.gardens.length}</dd><dt>Zlecenia / płatności</dt><dd>{counts.jobs.length} / {counts.payments.length}</dd><dt>Harmonogramy / zdjęcia</dt><dd>{counts.taskSchedules.length} / {counts.photos.filter(p => p.deletedAt === null).length}</dd><dt>Notatki / przypomnienia / sprawy</dt><dd>{counts.notes.length} / {counts.notes.filter(n => n.reminder).length} / {counts.todos.length}</dd><dt>Szablony / checklisty</dt><dd>{counts.workTemplates.length} / {counts.checklists.length}</dd><dt>Raporty wizyt</dt><dd>{counts.jobs.reduce((sum,j)=>sum+(j.reports?.length??0),0)}</dd></dl>
      <p>Bieżący zestaw: {data.clients.length} klientów, {data.jobs.length} zleceń i {data.photos.filter(p => p.deletedAt === null).length} zdjęć, {data.notes.length} notatek i {data.todos.length} spraw.</p>
      <p>Odtworzenie zastąpi cały bieżący zestaw danych. Przed zmianą zachowamy lokalny punkt odzyskiwania obejmujący obecne dane i pliki zdjęć. Wizyta uruchomiona w kopii zostanie wstrzymana według czasu utworzenia kopii.</p>
      <label className="field"><span><input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)}/>Rozumiem, że bieżący zestaw zostanie zastąpiony.</span></label><label className="field">Wpisz ODTWÓRZ<input value={word} autoComplete="off" onChange={e => setWord(e.target.value)}/></label>
      <div className="photo-actions"><button className="button secondary" disabled={photos.busy} onClick={reset}>Anuluj odtwarzanie</button><button className="button danger" disabled={photos.busy || !agreed || word !== 'ODTWÓRZ'} onClick={() => { void action(async () => { const warning = preview.kind === 'zip' ? await photos.importFull(preview.prepared, preview.expected) : await photos.restoreRecovery(preview.id, preview.expected); reset(); setNotice(warning || 'Dane i zdjęcia zostały odtworzone. Poprzedni zestaw jest dostępny w punkcie odzyskiwania.'); }); }}>Odtwórz dane i zdjęcia</button></div>
    </div>}
    {photos.recovery && <div className="photo-recovery"><h4>Punkt odzyskiwania sprzed ostatniego odtworzenia</h4><p>{new Date(photos.recovery.createdAt).toLocaleString('pl-PL')} · {photos.recovery.data.photos.filter(p => p.deletedAt === null).length} zdjęć. Ten zapis chroni poprzedni zestaw danych.</p><div className="photo-actions">
      <button className="button secondary" disabled={photos.busy} onClick={() => { void action(async () => download(await photos.exportRecovery(), `garden-manager-punkt-odzyskiwania-${localDate()}.zip`)); }}>Pobierz punkt odzyskiwania ZIP</button>
      <button className="button secondary" disabled={photos.busy} onClick={() => { reset(); void action(async () => { const result = await photos.prepareRecovery(); setPreview({ kind: 'recovery', id: result.point.id, data: result.point.data, expected: result.expected }); }); }}>Przywróć poprzedni zestaw</button>
      <button className="button ghost" disabled={photos.busy} onClick={() => setClearing(true)}>Usuń punkt odzyskiwania</button>
    </div>{clearing && <div className="photo-backup-preview" role="group" aria-label="Potwierdzenie usunięcia punktu odzyskiwania"><p>Pobierz punkt jako ZIP, jeśli chcesz go zachować. Usunięcie zwolni pliki zdjęć używane wyłącznie przez poprzedni zestaw.</p><div className="photo-actions"><button className="button secondary" onClick={() => setClearing(false)}>Zachowaj punkt</button><button className="button danger" disabled={photos.busy} onClick={() => { const id = photos.recovery!.id; void action(async () => { await photos.clearRecovery(id); setClearing(false); setNotice('Punkt odzyskiwania został usunięty.'); }); }}>Potwierdź usunięcie punktu</button></div></div>}</div>}
    {error && error !== photos.error && <p role="alert" className="gm-form-error">{error}</p>}{notice && <p role="status" className="photo-notice">{notice}</p>}
  </section>;
}
