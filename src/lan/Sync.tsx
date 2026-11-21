import { useEffect, useRef, useState, type FormEvent } from "react";
import { pendingWrite } from "../data/pending";
import { useUnsavedChanges } from "../navigation/unsaved";
import { lanPort, type LanView, type LanCommand, type LanSize, type LanKind } from "./port";
import "./lan.css";

export default function Sync(){
  const port=useRef(lanPort()).current;
  const [view,setView]=useState<LanView|null>(null),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const [name,setName]=useState(""),[originalName,setOriginalName]=useState("");
  const [address,setAddress]=useState(""),[host,setHost]=useState(""),[tcpPort,setTcpPort]=useState(""),[peer,setPeer]=useState("");
  const [invitation,setInvitation]=useState(""),[bytes,setBytes]=useState<LanSize>(1024),[kind,setKind]=useState<LanKind>("json");
  const [busy,setBusy]=useState(false),[confirmed,setConfirmed]=useState(false);
  const mounted=useRef(true),nameDirty=useRef(false),operation=useRef(false);
  nameDirty.current=name!==originalName;
  const guard=useUnsavedChanges(name!==originalName);
  function apply(v:LanView){
    if(!mounted.current)return;
    setView(v);
    if(v.device&&!nameDirty.current){setName(v.device.name);setOriginalName(v.device.name);}
    setAddress(a=>v.interfaces.some(i=>i.address===a)?a:v.interfaces[0]?.address||"");
    if(v.scannedInvitation){setInvitation(v.scannedInvitation);setNotice("Odczytano zaproszenie. Rozpocznij sesję na telefonie, następnie połącz i porównaj kody.");}
  }
  useEffect(()=>{
    if(!port)return;let disposed=false,polling=false;mounted.current=true;
    const poll=async()=>{if(disposed||polling)return;polling=true;try{const v=await port.command({action:"status"});if(!disposed)apply(v);}catch(e){if(!disposed)setError((e as Error).message);}finally{polling=false;}};
    void poll();const timer=setInterval(()=>{void poll();},1500);
    return()=>{disposed=true;mounted.current=false;clearInterval(timer);void port.command({action:"stop"}).catch(()=>{});};
  },[port]);
  useEffect(()=>setConfirmed(false),[view?.pending?.code,view?.pending?.fingerprint]);
  async function run(command:LanCommand){
    if(!port||operation.current)return;
    operation.current=true;setBusy(true);setError("");setNotice("");
    try{
      const next=await port.command(command);apply(next);
      if(command.action==="rename"){setName(next.device!.name);setOriginalName(next.device!.name);}
      if(command.action==="pair")setInvitation("");
    }catch(e){if(mounted.current)setError((e as Error).message);}
    finally{operation.current=false;if(mounted.current)setBusy(false);}
  }
  async function rename(e:FormEvent){
    e.preventDefault();if(!port||operation.current)return;operation.current=true;setBusy(true);setError("");
    try{await guard.save(()=>pendingWrite(async()=>{const v=await port.command({action:"rename",name});apply(v);setName(v.device!.name);setOriginalName(v.device!.name);}));}
    catch(e){if(mounted.current)setError((e as Error).message);}
    finally{operation.current=false;if(mounted.current)setBusy(false);}
  }
  return <section className="entities-page lan-page">
    <div className="page-heading"><div><span className="eyebrow">GM-011A · TEST KOMUNIKACJI</span><h1>Synchronizacja</h1>
      <p>Ten etap sprawdza wyłącznie bezpieczne połączenie LAN i dane syntetyczne. Synchronizacja danych firmowych nie jest jeszcze dostępna.</p></div></div>
    {!port?<div className="card"><h2>Wymagana aplikacja natywna</h2><p>Komunikacja lokalna wymaga obsługiwanej aplikacji Windows lub Android. Wersja web/PWA nadal działa offline; dane firmowe pozostają na tym urządzeniu.</p></div>:<>
      {error&&<p role="alert" className="gm-form-error">{error}</p>}{notice&&<p role="status">{notice}</p>}
      {!view?<p role="status">{error?"Tryb komunikacji jest niedostępny. Pozostałe moduły i dane firmowe pozostają lokalnie.":"Odczyt chronionej tożsamości urządzenia…"}</p>:<>
      <div className="lan-grid">
      <article className="card"><h2>Bieżące urządzenie</h2>
        <form ref={guard.ref} onSubmit={rename}><label className="field">Nazwa urządzenia<input required maxLength={80} value={name} onChange={e=>{nameDirty.current=true;setName(e.target.value);}}/></label><button className="button secondary" disabled={busy||name===originalName}>Zapisz nazwę urządzenia</button></form>
        <p className="muted">Identyfikator instalacji: {view.device?.id}</p><details><summary>Odcisk klucza urządzenia</summary><code className="lan-hash">{view.device?.fingerprint}</code></details>
        <p>Klucze i zaufane urządzenia pozostają lokalnie, poza kopiami JSON/ZIP danych firmowych.</p>
      </article>
      <article className="card"><h2>Sesja komunikacji</h2>
        <p role="status">{view.connected?"Połączono i uwierzytelniono: "+view.connected.name:view.active?"Sesja aktywna — brak uwierzytelnionego połączenia":"Sesja wyłączona"}</p>
        <p>{view.diagnostic}</p>
        {!view.active&&<>
          {view.platform==="windows"&&<label className="field">Interfejs LAN<select value={address} onChange={e=>setAddress(e.target.value)}>{!view.interfaces.length&&<option value="">Brak prywatnego IPv4</option>}{view.interfaces.map(i=><option key={i.address} value={i.address}>{i.name} · {i.address}</option>)}</select></label>}
          <button className="button primary" disabled={busy||(view.platform==="windows"&&!address)} onClick={()=>{void run({action:"start",address});}}>Rozpocznij sesję</button>
        </>}
        {view.active&&<button className="button secondary" onClick={()=>{if(port){void port.command({action:"stop"}).then(apply).catch(e=>setError(e.message));}}}>Zakończ sesję</button>}
        {view.endpoint&&<p>Adres tego komputera: <strong>{view.endpoint.host}:{view.endpoint.port}</strong></p>}
        <p className="muted">Sesja wygasa po 15 minutach. Wyjście z tego widoku kończy komunikację. Na telefonie przejście aplikacji w tło również zamyka połączenie. Internet nie jest wymagany.</p>
      </article>
      </div>
      {view.platform==="windows"?<article className="card"><h2>Pierwsze parowanie telefonu</h2>
        <p>Rozpocznij sesję i pokaż kod. Na telefonie wybierz odczyt QR, sfotografuj kod, rozpocznij sesję i porównaj tożsamości na obu ekranach.</p>
        <button className="button secondary" disabled={!view.active||busy} onClick={()=>{void run({action:"invite"});}}>Pokaż nowy kod parowania</button>
        {view.invitation&&<div className="lan-invitation"><img src={view.invitation.qr} alt="Jednorazowy kod parowania Garden Manager" width={480} height={480}/><p>Ważny do {new Date(view.invitation.expiresAt).toLocaleTimeString("pl-PL")}. Nie udostępniaj go osobom trzecim.</p>
          <button className="button secondary" onClick={()=>{void run({action:"copy"});}}>Kopiuj zaproszenie do parowania</button></div>}
      </article>:<article className="card"><h2>Pierwsze parowanie komputera</h2>
        <p>Na Windows pokaż nowy kod. Odczyt aparatem działa lokalnie i nie zapisuje zdjęcia w dokumentacji ogrodu. Powrót z aparatu wymaga ponownego rozpoczęcia sesji na telefonie.</p>
        <button className="button secondary" disabled={busy} onClick={()=>{void run({action:"scan"});}}>Odczytaj kod QR aparatem</button>
        <label className="field">Zaproszenie z Windows<input type="password" autoComplete="off" maxLength={8192} value={invitation} onChange={e=>setInvitation(e.target.value)} placeholder="GM011A:…"/></label>
        <button className="button primary" disabled={!view.active||busy||!invitation} onClick={()=>{void run({action:"pair",invitation});}}>Połącz i porównaj kody</button>
      </article>}
      {view.pending&&<article className="card lan-pending"><h2>Potwierdź tożsamość urządzenia</h2><p>{view.pending.name}</p><p className="lan-code">{view.pending.code}</p><code className="lan-hash">SHA256: {view.pending.fingerprint}</code>
        <label className="lan-check"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>Kod i urządzenie zgadzają się na obu ekranach.</label>
        <button className="button primary" disabled={!confirmed||busy||view.pending.localConfirmed} onClick={()=>{void run({action:"confirm"});}}>Potwierdź parowanie</button>
        <p>{view.pending.localConfirmed?"Potwierdzono tutaj. ":""}{view.pending.remoteConfirmed?"Potwierdzono na drugim urządzeniu.":"Oczekiwanie na drugie urządzenie."}</p></article>}
      <div className="lan-grid">
      <article className="card"><h2>Wykryte urządzenia</h2>
        {view.platform==="windows"&&<p>Telefon wyszukuje ten komputer przez mDNS podczas aktywnej sesji. Windows przyjmuje połączenie z telefonu.</p>}
        {!view.discovered.length&&<p>Brak wykrytych komputerów. Sieć lub hotspot może blokować mDNS; użyj kodu parowania albo ręcznego adresu.</p>}
        {view.discovered.map(d=><div className="lan-device" key={d.id}><p>{view.peers.find(p=>p.id===d.id)?.name??"Garden Manager · "+d.id.slice(0,8)} · {d.host}:{d.port}</p>
          <button className="button secondary" disabled={busy||!view.peers.some(p=>p.id===d.id)||!!view.connected} onClick={()=>{setPeer(d.id);setHost(d.host);setTcpPort(String(d.port));void run({action:"connect",id:d.id,host:d.host,port:d.port});}}>Połącz z zaufanym urządzeniem</button></div>)}
      </article>
      <article className="card"><h2>Zaufane urządzenia</h2>
        {!view.peers.length&&<p>Brak sparowanych urządzeń.</p>}
        {view.peers.map(p=><div className="lan-device" key={p.id}><strong>{p.name}</strong><p className="muted">{p.id}</p><details><summary>Odcisk klucza</summary><code className="lan-hash">{p.fingerprint}</code></details>
          <button className="button ghost" disabled={busy} onClick={()=>{if(window.confirm("Usunąć zaufanie do urządzenia „"+p.name+"”? Bieżące połączenie zostanie zamknięte. Dane firmowe pozostaną bez zmian."))void run({action:"forget",id:p.id});}}>Usuń zaufanie</button></div>)}
      </article>
      </div>
      {view.platform==="android"&&<article className="card"><h2>Ręczne połączenie</h2><p>Wybierz wcześniej sparowany komputer. Przy zmianie sieci podaj jego aktualny adres i port z ekranu Windows; tożsamość i zaufanie pozostają te same.</p>
        <div className="form-grid"><label className="field">Sparowany komputer<select value={peer} onChange={e=>setPeer(e.target.value)}><option value="">Wybierz urządzenie</option>{view.peers.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="field">Adres IPv4<input value={host} onChange={e=>setHost(e.target.value)} inputMode="decimal" placeholder="192.168.1.10"/></label>
        <label className="field">Port TLS<input value={tcpPort} onChange={e=>setTcpPort(e.target.value)} inputMode="numeric"/></label></div>
        <button className="button primary" disabled={!view.active||busy||!peer||!host||!tcpPort||!!view.connected} onClick={()=>{void run({action:"connect",id:peer,host,port:Number(tcpPort)});}}>Połącz ręcznie</button>
      </article>}
      <article className="card"><h2>Test połączenia</h2><p>Wyłącznie syntetyczny JSON lub dane binarne w obu kierunkach. Wynik nie oznacza synchronizacji klientów, zleceń ani zdjęć.</p>
        <div className="form-grid"><label className="field">Rozmiar testu<select value={bytes} onChange={e=>setBytes(Number(e.target.value) as LanSize)}>{[[1024,"1 KB"],[102400,"100 KB"],[1048576,"1 MB"],[10485760,"10 MB"]].map(([n,label])=><option key={n} value={n}>{label}</option>)}</select></label>
        <label className="field">Typ danych testowych<select value={kind} onChange={e=>setKind(e.target.value as LanKind)}><option value="json">JSON syntetyczny</option><option value="binary">Dane binarne syntetyczne</option></select></label></div>
        <button className="button primary" disabled={!view.connected||busy||view.busy} onClick={()=>{void run({action:"test",bytes,kind});}}>Testuj połączenie</button>
        {(busy||view.busy)&&<p role="status">Trwa operacja komunikacji… Możesz zakończyć sesję.</p>}
        {view.result&&<div className="lan-result" role="status"><strong>{view.result.ok?"Test komunikacji zakończony — sumy SHA256 zgodne":"Test przerwany lub odrzucony"}</strong><p>{view.result.bytes} bajtów w każdym kierunku · {view.result.kind} · {view.result.elapsedMs} ms</p><p>Wysłano: <code className="lan-hash">{view.result.sentSha256||"—"}</code></p><p>Odebrano: <code className="lan-hash">{view.result.receivedSha256||"—"}</code></p><p>{new Date(view.result.at).toLocaleString("pl-PL")}{view.result.error&&" · "+view.result.error}</p></div>}
      </article>
      <details className="card"><summary>Diagnostyka LAN</summary><p>Obie aplikacje muszą mieć aktywną sesję. Sprawdź aktualny prywatny IPv4 i port, Wi-Fi/Ethernet tego samego routera lub połączenie komputera z hotspotem telefonu. Internet mobilny nie jest potrzebny.</p><p>Brak wykrywania nie dowodzi braku połączenia — spróbuj ręcznego adresu. Sieć gościnna, izolacja klientów, sieć firmowa lub zapora mogą blokować LAN. Na Windows zezwól tej aplikacji na zaufanej sieci prywatnej zgodnie z polityką administratora; nie wyłączaj zapory ani innych zabezpieczeń.</p><p>Przy zmianie klucza, odmowie uprawnienia lub błędzie daty nie akceptuj połączenia automatycznie. Sprawdź tożsamość na obu urządzeniach i w razie potrzeby świadomie sparuj ponownie.</p></details>
      </>}
    </>}
  </section>;
}
