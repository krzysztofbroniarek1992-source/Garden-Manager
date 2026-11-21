import tls from "node:tls";
import type { Socket } from "node:net";
import os from "node:os";
import { randomBytes, randomUUID, constants } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { LanView, LanKind, LanSize } from "./lan-contracts.js" with { "resolution-mode":"import" };
import { certificate, publicPeer, peer, proof, secretEqual, pairingCode, type Identity, type Peer } from "./lan-identity.cjs";
import type { Store } from "./lan-vault.cjs";
import { Wire, fields, privateAddress, deviceName, sha, fail } from "./lan-wire.cjs";
import { Channel } from "./lan-channel.cjs";
import { advertise } from "./lan-discovery.cjs";
interface Candidate { peer:Peer; code:string; wire:Wire; local:boolean; remote:boolean; finish?:Promise<void> }
export const tlsOptions=(own:Identity,peers:Peer[]=[])=>({
  key:own.key,cert:own.cert,ca:peers.map(p=>p.cert),minVersion:"TLSv1.2" as const,
  ciphers:"TLS_AES_256_GCM_SHA384:TLS_AES_128_GCM_SHA256:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384",
  secureOptions:constants.SSL_OP_NO_TICKET,
  sessionIdContext:randomBytes(16).toString("hex"),handshakeTimeout:10000,
});
export function interfaces(){return Object.entries(os.networkInterfaces()).flatMap(([name,ips])=>(ips??[]).filter(i=>i.family==="IPv4"&&!i.internal&&privateAddress(i.address)).map(i=>({name,address:i.address})));}
export class LanServer {
  private server?:tls.Server;private pairing?:tls.Server;private sockets=new Set<Socket>();private pairSockets=new Set<tls.TLSSocket>();private sessionTimer?:NodeJS.Timeout;
  private expires?:NodeJS.Timeout;private stopAdvertisement?:()=>void;private generation=0;
  private invitation?:LanView["invitation"];private ticket="";private pairId="";private deadline=0;private candidate?:Candidate;
  private inviting=false;private inviteVersion=0;private attempts:number[]=[];private endpoint?:{host:string;port:number};private channel?:Channel;private connecting=false;
  private last?:LanView["result"];private diagnostic="Sesja komunikacji nie jest uruchomiona.";
  constructor(readonly store:Store,private options:{interfaces?:typeof interfaces;discovery?:boolean;advertisedAddress?:string}={}){}
  async view():Promise<LanView>{
    if(this.server&&this.endpoint&&!(this.options.interfaces??interfaces)().some(i=>i.address===this.endpoint!.host)){await this.stop();this.diagnostic="Adres interfejsu zmienił się. Rozpocznij sesję na aktualnym adresie; sparowanie pozostaje ważne.";}
    const own=await this.store.get(),p=this.candidate;
    return {supported:true,platform:"windows",device:publicPeer(own),active:!!this.server,
      interfaces:(this.options.interfaces??interfaces)(),endpoint:this.endpoint,peers:own.peers.map(publicPeer),discovered:[],
      connected:this.channel?.ready?publicPeer(this.channel.remote):undefined,invitation:this.invitation,
      pending:p?{...publicPeer(p.peer),code:p.code,localConfirmed:p.local,remoteConfirmed:p.remote}:undefined,
      result:this.last,busy:!!this.channel?.busy,diagnostic:this.diagnostic};
  }
  async rename(name:string){await this.store.update(d=>({...d,name:deviceName(name)}));return this.view();}
  async start(address:string){
    if(this.server)fail("BUSY");
    if(!(this.options.interfaces??interfaces)().some(i=>i.address===address))fail("ADDRESS");
    const generation=++this.generation,own=await this.store.get();
    if(generation!==this.generation)fail("CLOSED");
    const server=tls.createServer({...tlsOptions(own,own.peers),requestCert:true,rejectUnauthorized:true},socket=>{
      void this.accept(socket,generation).catch(()=>socket.destroy());
    });
    this.track(server);this.server=server;
    try {
      await this.listen(server,address);
      if(generation!==this.generation)fail("CLOSED");
      this.endpoint={host:address,port:(server.address() as {port:number}).port};
      this.diagnostic="Nasłuch TLS aktywny. Sparuj telefon lub połącz zaufane urządzenie.";
      if(this.options.discovery!==false)try{this.stopAdvertisement=advertise(own.id,address,this.endpoint.port,()=>{this.diagnostic="Wykrywanie mDNS jest niedostępne. Użyj ręcznego IP i portu.";});}catch{this.diagnostic="Wykrywanie mDNS jest niedostępne. Użyj ręcznego IP i portu."; }
      this.sessionTimer=setTimeout(()=>{void this.stop();},15*60*1000);this.sessionTimer.unref();
      return this.view();
    }catch(e){if(generation===this.generation&&this.server===server)await this.stop();else if(server.listening)server.close();throw e;}
  }
  private track(server:tls.Server){
    server.maxConnections=4;server.on("error",()=>{this.diagnostic="Nie można uruchomić lub utrzymać nasłuchu. Sprawdź interfejs i zaporę.";});
    server.on("connection",socket=>{
      if(this.sockets.size>=4){socket.destroy();return;}
      this.sockets.add(socket);socket.once("close",()=>this.sockets.delete(socket));
    });
    server.on("tlsClientError",(error)=>{const code=(error as NodeJS.ErrnoException).code;const detail=typeof code==="string"&&/^[A-Z0-9_]{1,80}$/.test(code)?code:"TLS";this.diagnostic="Odrzucono nieuprawnione połączenie TLS ("+detail+"). Sprawdź sparowanie i datę obu urządzeń.";});
    server.on("resumeSession",(_id,cb)=>cb(null,null));
  }
  private listen(server:tls.Server,address:string){return new Promise<void>((resolve,reject)=>{
    const error=()=>{server.off("listening",ready);reject(new Error("LISTEN"));};
    const ready=()=>{server.off("error",error);resolve();};
    server.once("error",error);server.once("listening",ready);server.listen(0,address);
  });}
  private async accept(socket:tls.TLSSocket,generation:number){
    if(!socket.authorized||generation!==this.generation||this.channel||this.connecting){socket.destroy();return;}
    this.connecting=true;
    try {
      const own=await this.store.get(),raw=socket.getPeerCertificate().raw;
      const p=raw&&own.peers.find(p=>p.fingerprint===sha(raw));
      if(!p||!this.server||generation!==this.generation)fail("CERTIFICATE");
      certificate(p.cert,p.id);
      this.last=undefined;
      this.channel=new Channel(socket,own,p,true,r=>{this.last=r;},()=>{},code=>{
        this.channel=undefined;this.diagnostic=code==="CLOSED"?"Połączenie zakończone.":"Połączenie przerwane lub odrzucone: "+code+". Połącz ponownie; dane firmowe pozostają bez zmian.";
      });
      this.diagnostic="Połączenie z zaufanym urządzeniem.";
      void this.channel.start(true);
    }finally{this.connecting=false;}
  }
  async invite(){
    if(this.inviting)fail("BUSY");
    if(!this.server||!this.endpoint)fail("CLOSED");
    this.inviting=true;const generation=this.generation,version=++this.inviteVersion;let listener:tls.Server|undefined;
    try{
      await this.closePairing();
      const own=await this.store.get();
      if(generation!==this.generation||version!==this.inviteVersion||!this.server||!this.endpoint)fail("CLOSED");
      this.ticket=randomBytes(32).toString("base64url");this.pairId=randomUUID();this.deadline=performance.now()+120000;
      const server=tls.createServer({...tlsOptions(own),requestCert:false,rejectUnauthorized:true},socket=>{
        this.pairSockets.add(socket);socket.once("close",()=>this.pairSockets.delete(socket));
        void this.pairConnection(socket,generation).catch(()=>socket.destroy());
      });
      listener=server;this.track(server);this.pairing=server;await this.listen(server,this.endpoint.host);
      if(generation!==this.generation||version!==this.inviteVersion||this.pairing!==server)fail("CLOSED");
      const raw={v:1,host:this.options.advertisedAddress??this.endpoint.host,port:this.endpoint.port,pairPort:(server.address() as {port:number}).port,
        pairId:this.pairId,ticket:this.ticket,expiresAt:Date.now()+120000,device:{...publicPeer(own),cert:own.cert}};
      const text="GM011A:"+Buffer.from(JSON.stringify(raw)).toString("base64url");
      const qr=await (require("qrcode") as {toDataURL:(s:string,o:unknown)=>Promise<string>}).toDataURL(text,{errorCorrectionLevel:"M",width:480,margin:4});
      if(generation!==this.generation||version!==this.inviteVersion||this.pairing!==server)fail("CLOSED");
      this.invitation={text,qr,expiresAt:raw.expiresAt};
      this.expires=setTimeout(()=>{void this.closePairing();},120000);this.expires.unref();return this.view();
    }catch(e){if(listener&&this.pairing===listener)await this.closePairing();throw e;}
    finally{if(version===this.inviteVersion)this.inviting=false;}
  }
  private async pairConnection(socket:tls.TLSSocket,generation:number){
    socket.setTimeout(120000,()=>socket.destroy());
    const now=Date.now();this.attempts=this.attempts.filter(t=>now-t<60000);
    if(this.attempts.length>=5||this.candidate||performance.now()>this.deadline||generation!==this.generation)fail("PAIRING");
    this.attempts.push(now);const wire=new Wire(socket,this.pairId),{message:m}=await wire.receive();
    if(m.type!=="pair")fail("PROTOCOL");
    fields(m.payload,["ticket","device","signature"]);
    if(!secretEqual(m.payload.ticket,this.ticket)||this.candidate||performance.now()>this.deadline||!this.pairing)fail("PAIRING");
    const p=peer(m.payload.device),own=await this.store.get();
    if(p.id===own.id||own.peers.some(x=>x.id===p.id&&x.fingerprint!==p.fingerprint))fail("IDENTITY");
    proof(this.ticket,own.id,p,m.payload.signature);
    if(this.candidate||generation!==this.generation||!this.pairing)fail("CLOSED");
    const c:Candidate={peer:p,code:pairingCode(this.ticket,own.id,p),wire,local:false,remote:false};
    this.candidate=c;this.invitation=undefined;this.ticket=""; // A captured proof cannot reuse this invitation.
    socket.once("close",()=>{if(this.candidate===c){this.candidate=undefined;this.diagnostic="Parowanie przerwane. Pokaż nowy kod i ponów."; }});
    await wire.send("pair-pending",{code:c.code});
    while(this.candidate===c){
      const {message:r}=await wire.receive();if(r.type!=="pair-confirm")fail();
      fields(r.payload,["code"]);if(c.remote||r.payload.code!==c.code)fail("REPLAY");
      c.remote=true;await this.finishPair(c,generation);
    }
  }
  async confirm(){
    const c=this.candidate;if(!c||performance.now()>this.deadline)fail("PAIRING");
    c.local=true;await c.wire.send("pair-approved",{code:c.code});await this.finishPair(c,this.generation);return this.view();
  }
  private async finishPair(c:Candidate,generation:number){
    if(!c.local||!c.remote||c.finish)return c.finish;
    c.finish=(async()=>{
      if(this.candidate!==c||generation!==this.generation||performance.now()>this.deadline)fail("CLOSED");
      await this.store.update(d=>{if(this.candidate!==c||generation!==this.generation)fail("CLOSED");return {...d,peers:[...d.peers.filter(p=>p.id!==c.peer.id),c.peer]};});
      if(this.candidate!==c||generation!==this.generation)fail("CLOSED");
      await this.refreshTrust();
      await c.wire.send("pair-done",{deviceId:(await this.store.get()).id,code:c.code});
      this.diagnostic="Parowanie potwierdzone na obu urządzeniach. Telefon może połączyć się przez wzajemny TLS.";
      await this.closePairing();
    })();return c.finish;
  }
  private async refreshTrust(){const d=await this.store.get();this.server?.setSecureContext(tlsOptions(d,d.peers));}
  async forget(id:string){
    if(this.candidate?.peer.id===id)await this.closePairing();
    if(this.channel?.remote.id===id)this.channel.close("CLOSED");
    await this.store.update(d=>({...d,peers:d.peers.filter(p=>p.id!==id)}));
    await this.refreshTrust();return this.view();
  }
  async test(bytes:LanSize,kind:LanKind){if(!this.channel)fail("DISCONNECTED");await this.channel.test(bytes,kind);return this.view();}
  private async closePairing(){
    clearTimeout(this.expires);this.expires=undefined;this.invitation=undefined;this.ticket="";this.deadline=0;
    const c=this.candidate;this.candidate=undefined;c?.wire.socket.destroy();
    for(const socket of this.pairSockets)socket.destroy();this.pairSockets.clear();
    const s=this.pairing;this.pairing=undefined;if(s)await new Promise<void>(r=>s.close(()=>r()));
  }
  async stop(){
    ++this.generation;++this.inviteVersion;this.inviting=false;clearTimeout(this.sessionTimer);this.sessionTimer=undefined;
    try{this.stopAdvertisement?.();}catch{/* Closing TLS must not depend on mDNS. */}this.stopAdvertisement=undefined;
    this.channel?.close("CLOSED");this.channel=undefined;
    for(const s of this.sockets)s.destroy();this.sockets.clear();
    await this.closePairing();const s=this.server;this.server=undefined;this.endpoint=undefined;
    if(s)await new Promise<void>(r=>s.close(()=>r()));
    this.diagnostic="Sesja zakończona. Porty są zamknięte, zaproszenie unieważnione.";
  }
}
