import { isAndroid } from '../platform/files';
import { selectPhotos, cameraCoordinator, selectionPhotoId, type MediaSelection } from '../platform/camera';
import { pendingWrite } from "../data/pending";
import DocumentationLinks from "../documentation/DocumentationLinks";
import { useNavigation, useViewState } from "../navigation/Navigation";
import { useUnsavedChanges } from '../navigation/unsaved';
import { NoteForm } from '../desk/Forms';
import { newNote, type Note } from '../desk/model';
import { useEffect, useId, useRef, useState, type FormEvent, type RefObject } from 'react';
import Modal from '../components/Modal';
import { useGarden } from '../state';
import { usePhotos } from './state';
import { matchesPhotoScope, photoCategories, photoDate, resolvePhotoScope, type PhotoDetails, type PhotoMetadata, type PhotoScope } from './model';
import PhotoScopeFields from './PhotoScopeFields';
import './photos.css';

function useAssetUrl(assetId: string, kind: 'image' | 'thumbnail') {
  const { assets } = usePhotos();
  const [url, setUrl] = useState(''), [error, setError] = useState('');
  useEffect(() => {
    let disposed = false, objectUrl = '';
    setUrl(''); setError('');
    assets.get(assetId).then(asset => {
      if (!asset) throw new Error('Brak pliku na tym urządzeniu. Przywróć pełną kopię ZIP.');
      if (!disposed) { objectUrl = URL.createObjectURL(asset[kind]); setUrl(objectUrl); }
    }).catch(e => { if (!disposed) setError((e as Error).message); });
    return () => { disposed = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [assets, assetId, kind]);
  return { url, error };
}
export function PhotoImage({ photo, thumbnail = false }: { photo: PhotoMetadata; thumbnail?: boolean }) {
  const { url, error } = useAssetUrl(photo.assetId, thumbnail ? 'thumbnail' : 'image');
  if (error) return <span className="photo-missing">{error}</span>;
  return url ? <img src={url} alt={photo.description || photo.filename} loading={thumbnail ? 'lazy' : 'eager'} decoding="async"/> : <span className="photo-loading">Wczytywanie zdjęcia…</span>;
}
export default function PhotoGallery({ scope, title = 'Dokumentacja fotograficzna', cameraInputRef, initialSelection, uploadOnly = false, onFinish }: { initialSelection?: MediaSelection; uploadOnly?: boolean; onFinish?: () => void; scope: Partial<PhotoScope>; title?: string; cameraInputRef?: RefObject<HTMLInputElement | null> }) {
  const { data } = useGarden();
  const photos = usePhotos();
  const navigation=useNavigation(), memoryKey=`gallery:${JSON.stringify(scope)}`;
  const [noteDraft, setNoteDraft] = useState<Note | null>(null);
  const [uploading, setUploading] = useState(!!initialSelection), [files, setFiles] = useState<File[]>(initialSelection?.files ?? []);
  const [details, setDetails] = useState<PhotoDetails>(() => ({ ...(uploadOnly ? { clientId: scope.clientId ?? null, gardenId: scope.gardenId ?? null, zoneId: scope.zoneId ?? null, jobId: scope.jobId ?? null } : resolvePhotoScope(data, { clientId: scope.clientId ?? null, gardenId: scope.gardenId ?? null, zoneId: scope.zoneId ?? null, jobId: scope.jobId ?? null })), category: initialSelection?.operation.category ?? 'other', description: '', capturedDate: null }));
  const [category, setCategory] = useViewState(`${memoryKey}:category`,''), [from, setFrom] = useViewState(`${memoryKey}:from`,''), [to, setTo] = useViewState(`${memoryKey}:to`,''), [zone, setZone] = useViewState(`${memoryKey}:zone`,''), [order, setOrder] = useViewState(`${memoryKey}:order`,'newest');
  const [limit, setLimit] = useViewState(`${memoryKey}:limit`,24), [notice, setNotice] = useState(''), [localError, setLocalError] = useState('');
  const [editing, setEditing] = useState<PhotoMetadata | null>(null), [removing, setRemoving] = useState<PhotoMetadata | null>(null);
  const [beforeId, setBeforeId] = useViewState(`${memoryKey}:beforeId`,''), [afterId, setAfterId] = useViewState(`${memoryKey}:afterId`,''), [comparing, setComparing] = useState(false);
  const uploadGuard = useUnsavedChanges(uploading && (files.length > 0 || details.description !== ''));
  const inputId = useId();
  const selectionLock = useRef(false);
  const nativeSelection = useRef<MediaSelection | null>(initialSelection ?? null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const releaseSelection = async () => { if (nativeSelection.current) { await cameraCoordinator.finish(nativeSelection.current.operation.id); nativeSelection.current = null; } };
  const abandon = () => { void releaseSelection().then(() => { setUploading(false); setFiles([]); onFinish?.(); }).catch(error => setLocalError((error as Error).message)); };
  const [selecting, setSelecting] = useState(false);
  const chooseNative = (source: 'camera' | 'gallery', during = false) => {
    if (selectionLock.current) return;
    selectionLock.current = true; setSelecting(true);
    setLocalError('');
    void pendingWrite(async () => {
      if (nativeSelection.current) throw new Error('Najpierw zapisz lub anuluj wybrane zdjęcia.');
      const selected = await selectPhotos(source, resolvePhotoScope(data, details), during ? 'during' : details.category);
      if (!selected) return;
      if (!mounted.current) { cameraCoordinator.returnToRecovery(selected); return; }
      nativeSelection.current = selected;
      setFiles(selected.files);
      if (during) setDetails(current => ({ ...current, category: 'during' }));
      setUploading(true);
    }).catch(error => setLocalError((error as Error).message)).finally(() => { selectionLock.current = false; setSelecting(false); });
  };

  const all = data.photos.filter(p => matchesPhotoScope(p, scope));
  const zones = data.gardens.filter(g => (!scope.clientId || g.clientId === scope.clientId) && (!scope.gardenId || g.id === scope.gardenId)).flatMap(g => g.zones);
  const matches = all.filter(p => (!category || p.category === category) && (!from || photoDate(p) >= from) && (!to || photoDate(p) <= to) && (!zone || (zone === 'none' ? p.zoneId === null : p.zoneId === zone)))
    .sort((a,b) => (order === 'newest' ? -1 : 1) * (`${photoDate(a)}:${a.addedAt}:${a.id}`.localeCompare(`${photoDate(b)}:${b.addedAt}:${b.id}`)));
  const before = all.find(p => p.id === beforeId && p.category === 'before'), after = all.find(p => p.id === afterId && p.category === 'after');
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setLocalError(''); setNotice('');
    try { await uploadGuard.save(()=>pendingWrite(()=>photos.add(files.map((file, index) => ({ blob: file, name: file.name, ...(nativeSelection.current ? { id: selectionPhotoId(nativeSelection.current.operation.id, index) } : {}) })), details))); await releaseSelection(); setFiles([]); setUploading(false); setNotice('Zdjęcia zapisane na tym urządzeniu.'); onFinish?.(); }
    catch (e) { setLocalError((e as Error).message); }
  };
  return <section className="photo-gallery" aria-label={title}>
    {!uploadOnly && cameraInputRef && <input ref={cameraInputRef} disabled={selecting} type="file" hidden aria-label="Zrób zdjęcie aparatem" accept="image/jpeg,image/png,image/webp" capture="environment" onClick={e=>{if(isAndroid()){e.preventDefault();chooseNative('camera',true);}}} onChange={e=>{const selected=Array.from(e.target.files??[]);if(selected.length){setFiles(selected);setDetails(current=>({...current,category:'during'}));setUploading(true);}e.target.value='';}}/>}
    {!uploadOnly && <div className="photo-section-heading"><div><h3>{title}</h3><p className="muted">{all.length} zdjęć · historia według daty wykonania lub dodania</p></div><button className="button secondary" disabled={photos.busy || !photos.ready} onClick={() => uploadGuard.confirm(() => { if (uploading) abandon(); else setUploading(true); })}>Dodaj zdjęcia</button></div>}
    {photos.error && <div className="photo-error" role="alert"><p>{photos.error}</p><button className="button secondary" disabled={photos.busy} onClick={() => { void photos.retry().catch(() => {}); }}>Ponów dostęp i porządkowanie zdjęć</button></div>}
    {photos.busy && <p role="status">{photos.progress}</p>}{notice && <p role="status" className="photo-notice">{notice}</p>}
    {selecting && <p role="status">Oczekiwanie na aparat lub wybór zdjęć…</p>}
    {!uploading && localError && <p className="gm-form-error" role="alert">{localError}</p>}
    {uploading && <form ref={uploadGuard.ref} className="photo-upload" onSubmit={submit}><h4>Nowe zdjęcia</h4><p className="gm-form-note">JPEG, PNG lub WebP, do 25 MB na plik i 20 zdjęć jednocześnie. Duże zdjęcia zmniejszamy; w pełnej kopii będą zapisane ich przygotowane wersje.</p>
      {!uploadOnly && <div className="photo-pickers"><label className="field">Zdjęcia z urządzenia<input id={inputId} disabled={selecting} type="file" accept="image/jpeg,image/png,image/webp" multiple onClick={e=>{if(isAndroid()){e.preventDefault();chooseNative('gallery');}}} onChange={e => setFiles(Array.from(e.target.files ?? []))}/></label><label className="field">Aparat telefonu<input disabled={selecting} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onClick={e=>{if(isAndroid()){e.preventDefault();chooseNative('camera');}}} onChange={e => setFiles(Array.from(e.target.files ?? []))}/></label></div>}
      <p className="muted">{files.length ? `Wybrano ${files.length} zdjęć: ${files.map(f => f.name).join(', ')}` : 'Wybierz pliki lub użyj aparatu, jeśli przeglądarka go udostępnia.'}</p>
      <div className="form-grid"><PhotoFields value={details} onChange={setDetails}/><PhotoScopeFields value={details} onChange={setDetails}/></div>
      {localError && localError !== photos.error && <p className="gm-form-error" role="alert">{localError}</p>}<div className="photo-actions"><button className="button secondary" type="button" disabled={photos.busy} onClick={() => uploadGuard.confirm(abandon)}>Anuluj dodawanie</button><button className="button primary" type="submit" disabled={photos.busy || !files.length}>Zapisz zdjęcia</button></div>
    </form>}
    {!uploadOnly && <><div className="photo-filters"><label className="field">Kategoria zdjęć<select aria-label="Filtr kategorii zdjęć" value={category} onChange={e => { setCategory(e.target.value); setLimit(24); }}><option value="">Wszystkie kategorie</option>{Object.entries(photoCategories).map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select></label><label className="field">Zdjęcia od<input type="date" value={from} onChange={e => setFrom(e.target.value)}/></label><label className="field">Zdjęcia do<input type="date" value={to} onChange={e => setTo(e.target.value)}/></label><label className="field">Strefa<select aria-label="Filtr strefy zdjęć" value={zone} onChange={e => setZone(e.target.value)}><option value="">Wszystkie strefy</option><option value="none">Bez aktywnej strefy</option>{zones.map(z => <option value={z.id} key={z.id}>{z.name}</option>)}</select></label><label className="field">Chronologia<select aria-label="Kolejność zdjęć" value={order} onChange={e => setOrder(e.target.value)}><option value="newest">Od najnowszych</option><option value="oldest">Od najstarszych</option></select></label></div>
    {from && to && from > to && <p role="alert" className="gm-form-error">Data „od” nie może być późniejsza niż data „do”.</p>}
    <div className="photo-comparison-bar"><span>Porównanie PRZED i PO: wybierz po jednym zdjęciu każdej kategorii.</span><button className="button secondary" disabled={!before || !after} onClick={() => setComparing(true)}>Porównaj PRZED i PO</button>{(beforeId || afterId) && <button className="button ghost" onClick={() => { setBeforeId(''); setAfterId(''); }}>Wyczyść porównanie</button>}</div>
    {!matches.length && <p className="photo-empty muted">Brak zdjęć dla wybranych filtrów. Dodaj dokumentację przed pracą lub po jej wykonaniu.</p>}
    <div className="photo-grid">{matches.slice(0, limit).map(p => <article className="photo-card" key={p.id}>
      <button className="photo-thumbnail" aria-label={`Powiększ zdjęcie ${p.filename}`} onClick={() => navigation.open({kind:"photo",id:p.id})}><PhotoImage photo={p} thumbnail/></button>
      <div className="photo-card-content"><span className={`photo-category photo-category-${p.category}`}>{photoCategories[p.category]}</span><time dateTime={photoDate(p)}>{photoDate(p)}{!p.capturedDate && ' · data dodania'}</time><strong className="photo-filename">{p.filename}</strong>{p.description && <p className="preserve-lines">{p.description}</p>}<small>{p.gardenName ?? 'Dokumentacja klienta'}{p.zoneName && ` · ${p.zoneName}`}{p.jobTitle && ` · ${p.jobTitle}`}</small>
        <div className="photo-actions"><button className="button secondary" aria-label={`Notatka do zdjęcia ${p.filename}`} onClick={() => setNoteDraft(newNote(data, { clientId: p.clientId, gardenId: p.gardenId, zoneId: p.zoneId, jobId: p.jobId }, undefined, p.id))}>Notatka do zdjęcia</button><button className="button secondary" disabled={photos.busy} aria-label={`Edytuj zdjęcie ${p.filename}`} onClick={() => setEditing(p)}>Edytuj</button><button className="button ghost" disabled={photos.busy} aria-label={`Usuń zdjęcie ${p.filename}`} onClick={() => setRemoving(p)}>Usuń</button></div>
        {(p.category === 'before' || p.category === 'after') && <button className="button secondary photo-select-comparison" aria-pressed={p.category === 'before' ? beforeId === p.id : afterId === p.id} onClick={() => p.category === 'before' ? setBeforeId(p.id) : setAfterId(p.id)}>{p.category === 'before' ? 'Wybierz PRZED' : 'Wybierz PO'}</button>}
      </div></article>)}</div>
    {matches.length > limit && <button className="button secondary" onClick={() => setLimit(v => v + 24)}>Wczytaj kolejne zdjęcia</button>}
    </>}
    {noteDraft && <NoteForm initial={noteDraft} onClose={() => setNoteDraft(null)}/>}
    {editing && <PhotoEditor photo={editing} onClose={() => setEditing(null)}/>}
    {removing && <Modal title="Usunąć zdjęcie?" onClose={() => setRemoving(null)}><p>Zdjęcie <strong>{removing.filename}</strong> i miniatura zostaną usunięte z bieżącego zestawu. Zachowane kopie ZIP i punkt odzyskiwania pozostaną bez zmian.</p>{data.jobs.some(j=>j.reports?.some(r=>r.snapshot.photos.some(p=>p.photoId===removing.id)||r.snapshot.logo?.photoId===removing.id))&&<p className="report-info">To zdjęcie lub logo jest używane w zapisanej wersji raportu. Po usunięciu pliku ponowne wygenerowanie tej wersji będzie wymagało odtworzenia zdjęcia z pełnej kopii ZIP. Wcześniej pobrane PDF-y pozostaną dostępne na urządzeniu.</p>}<div className="gm-modal-actions"><button className="button secondary" disabled={photos.busy} onClick={() => setRemoving(null)}>Anuluj</button><button className="button danger" disabled={photos.busy} onClick={() => { void photos.remove(removing).then(() => { setRemoving(null); setNotice('Zdjęcie usunięte.'); }).catch(() => setRemoving(null)); }}>Potwierdź usunięcie zdjęcia</button></div></Modal>}
    {comparing && before && after && <Modal title="Porównanie PRZED i PO" onClose={() => setComparing(false)} wide><div className="photo-compare">{[before,after].map(p => <figure key={p.id}><figcaption><strong>{photoCategories[p.category]}</strong><span>{photoDate(p)}</span></figcaption><PhotoImage photo={p}/><p className="preserve-lines">{p.description}</p></figure>)}</div></Modal>}
  </section>;
}
function PhotoFields({ value, onChange }: { value: PhotoDetails; onChange: (details: PhotoDetails) => void }) {
  return <><label className="field">Kategoria zdjęcia<select value={value.category} onChange={e => onChange({ ...value, category: e.target.value as PhotoDetails['category'] })}>{Object.entries(photoCategories).map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select></label><label className="field">Data wykonania (opcjonalnie)<input type="date" value={value.capturedDate ?? ''} onChange={e => onChange({ ...value, capturedDate: e.target.value || null })}/></label><label className="field full-width">Opis zdjęcia<textarea aria-label="Opis zdjęcia" maxLength={5000} value={value.description} onChange={e => onChange({ ...value, description: e.target.value })}/></label></>;
}
function PhotoEditor({ photo, onClose }: { photo: PhotoMetadata; onClose: () => void }) {
  const photos = usePhotos(); const [details, setDetails] = useState<PhotoDetails>(photo), [error, setError] = useState('');
  const guard = useUnsavedChanges(JSON.stringify(details) !== JSON.stringify(photo));
  return <Modal title="Edytuj zdjęcie" onClose={onClose} wide><form ref={guard.ref} onSubmit={e => { e.preventDefault(); void guard.save(async () => { await photos.edit(photo, details); onClose(); }).catch(e => setError((e as Error).message)); }}><div className="form-grid"><PhotoFields value={details} onChange={setDetails}/><PhotoScopeFields value={details} onChange={setDetails}/></div><p className="gm-form-note">Data dodania: {new Date(photo.addedAt).toLocaleString('pl-PL')}. Zmiana powiązań przeniesie zdjęcie do odpowiedniej galerii.</p>{error && <p role="alert" className="gm-form-error">{error}</p>}<div className="gm-modal-actions"><button type="button" className="button secondary" onClick={() => guard.confirm(onClose)}>Anuluj</button><button type="submit" className="button primary" disabled={photos.busy}>Zapisz opis i powiązania</button></div></form></Modal>;
}

export function PhotoDetailsView({id,onClose}:{id:string;onClose:()=>void}) {
  const {data}=useGarden(), navigation=useNavigation();
  const photo=data.photos.find(p=>p.id===id && p.deletedAt===null);
  return <Modal title="Podgląd zdjęcia" onClose={onClose} wide>
    {photo ? <>
      <DocumentationLinks scope={photo} gardenSection="gallery" jobSection="photos"/>
      <div className="photo-enlarged"><PhotoImage photo={photo}/></div>
      <p>{photoCategories[photo.category]} · {photoDate(photo)}</p><p className="preserve-lines">{photo.description}</p>
      {data.notes.filter(n=>n.photoId===photo.id).map(n=><button key={n.id} className="button secondary" onClick={()=>navigation.open({kind:'note',id:n.id})}>Notatka: {n.title}</button>)}
    </> : <p role="status">Zdjęcie zostało usunięte lub nie jest już dostępne w tym zestawie.</p>}
  </Modal>;
}
