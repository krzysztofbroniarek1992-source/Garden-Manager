import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { TLSSocket } from "node:tls";
import type { LanKind, LanResult } from "./lan-contracts.js" with { "resolution-mode": "import" };
import type { Peer } from "./lan-identity.cjs";
import { Wire, fields, identifier, deviceName, probeOptions, synthetic, sha, fail } from "./lan-wire.cjs";
interface Probe {
  id:string; bytes:number; kind:LanKind; initiator:boolean; start:number;
  sent:string; received:string; acknowledged:boolean; timer:NodeJS.Timeout;
  resolve?:(r:LanResult)=>void; reject?:(e:Error)=>void;
}
/** The only application protocol implemented here exchanges known synthetic bytes.
 * No generic RPC, business storage port, arbitrary file or renderer payload exists. */
export class Channel {
  readonly wire:Wire;
  ready=false; busy=false; private probe?:Probe; private closed=false;
  constructor(readonly socket:TLSSocket,readonly own:Peer,readonly remote:Peer,server:boolean,
    private result:(r:LanResult)=>void, private changed:()=>void, private ended:(code:string)=>void) {
    this.wire=new Wire(socket,server?randomUUID():"");
    socket.setTimeout(90000,()=>this.close("TIMEOUT"));
  }
  async start(server:boolean) {
    try {
      if(server) await this.wire.send("hello",{deviceId:this.own.id,name:this.own.name,nonce:randomUUID(),versions:[1],maxBytes:10485760,mode:"synthetic-only"});
      const {message:m}=await this.wire.receive();
      if(m.type!=="hello") fail(); fields(m.payload,["deviceId","name","nonce","versions","maxBytes","mode"]);
      if(!Array.isArray(m.payload.versions)||m.payload.versions.length!==1||m.payload.versions[0]!==1||m.payload.maxBytes!==10485760||m.payload.mode!=="synthetic-only")fail("VERSION");
      identifier(m.payload.deviceId);identifier(m.payload.nonce);deviceName(m.payload.name);
      if(m.payload.deviceId!==this.remote.id)fail("IDENTITY");
      if(!server)await this.wire.send("hello",{deviceId:this.own.id,name:this.own.name,nonce:randomUUID(),versions:[1],maxBytes:10485760,mode:"synthetic-only"});
      this.ready=true;this.changed();
      while(!this.closed){
        const {message,body}=await this.wire.receive((m,n)=>m.type==="data"?
          !!this.probe&&n===this.probe.bytes&&m.payload.probeId===this.probe.id:n===0);
        await this.handle(message.type,message.payload,body);
      }
    }catch(e){this.close(safeCode(e));}
  }
  test(bytes:number,kind:LanKind):Promise<LanResult>{
    probeOptions(bytes,kind); if(!this.ready||this.probe||this.closed)fail("BUSY");
    const p=this.createProbe(randomUUID(),bytes,kind,true);
    const promise=new Promise<LanResult>((resolve,reject)=>{p.resolve=resolve;p.reject=reject;});
    void this.wire.send("probe",{probeId:p.id,bytes,kind}).catch(()=>this.close("DISCONNECTED"));
    return promise;
  }
  private createProbe(id:string,bytes:number,kind:LanKind,initiator:boolean){
    const p:Probe={id,bytes,kind,initiator,start:performance.now(),sent:"",received:"",acknowledged:false,
      timer:setTimeout(()=>this.close("TIMEOUT"),120000)};
    p.timer.unref();this.probe=p;this.busy=true;this.changed();return p;
  }
  private async sendData(p:Probe){
    const body=synthetic(p.bytes,p.kind);p.sent=sha(body);
    await this.wire.send("data",{probeId:p.id,bytes:p.bytes,kind:p.kind,sha256:p.sent},body);
  }
  private async handle(type:string,v:Record<string,unknown>,body:Buffer){
    if(type==="bye"){fields(v,[]);this.close("CLOSED");return;}
    if(type==="error"){fields(v,["code"]);fail(typeof v.code==="string"?v.code:"PROTOCOL");}
    if(type==="probe"){
      fields(v,["probeId","bytes","kind"]);identifier(v.probeId);probeOptions(v.bytes,v.kind);
      if(this.probe)fail("BUSY");
      const p=this.createProbe(v.probeId,v.bytes as number,v.kind,false);await this.sendData(p);return;
    }
    const p=this.probe;if(!p||v.probeId!==p.id)fail("REPLAY");
    if(type==="data"){
      fields(v,["probeId","bytes","kind","sha256"]);
      if(p.received||v.bytes!==p.bytes||v.kind!==p.kind||body.length!==p.bytes)fail();
      const hash=sha(body),expected=synthetic(p.bytes,p.kind);
      if(hash!==v.sha256||!body.equals(expected))fail("INTEGRITY");
      p.received=hash;
      await this.wire.send("ack",{probeId:p.id,sha256:hash});
      if(p.initiator)await this.sendData(p);
      else await this.finishIfComplete(p);
    }else if(type==="ack"){
      fields(v,["probeId","sha256"]);if(p.acknowledged||!p.sent||v.sha256!==p.sent)fail("INTEGRITY");
      p.acknowledged=true;if(!p.initiator)await this.finishIfComplete(p);
    }else if(type==="done"){
      fields(v,["probeId","bytes","kind","sentSha256","receivedSha256","elapsedMs"]);
      if(!p.initiator||!p.acknowledged||!p.received||v.bytes!==p.bytes||v.kind!==p.kind||
        v.sentSha256!==p.received||v.receivedSha256!==p.sent||typeof v.elapsedMs!=="number"||
        !Number.isFinite(v.elapsedMs)||v.elapsedMs<0||v.elapsedMs>120000)fail("INTEGRITY");
      this.complete(p);
    }else fail();
  }
  private async finishIfComplete(p:Probe){
    if(!p.received||!p.acknowledged)return;
    const r=this.summary(p);
    await this.wire.send("done",{probeId:p.id,bytes:p.bytes,kind:p.kind,sentSha256:p.sent,receivedSha256:p.received,elapsedMs:r.elapsedMs});
    this.complete(p);
  }
  private summary(p:Probe):LanResult{return {peerId:this.remote.id,ok:true,bytes:p.bytes,kind:p.kind,sentSha256:p.sent,receivedSha256:p.received,elapsedMs:Math.round(performance.now()-p.start),at:Date.now()};}
  private complete(p:Probe){clearTimeout(p.timer);const r=this.summary(p);this.probe=undefined;this.busy=false;this.result(r);p.resolve?.(r);this.changed();}
  close(code="CLOSED"){
    if(this.closed)return;this.closed=true;this.ready=false;
    const p=this.probe;this.probe=undefined;this.busy=false;
    if(p){clearTimeout(p.timer);this.result({...this.summary(p),ok:false,error:code});p.reject?.(new Error(code));}
    this.socket.destroy();this.ended(code);this.changed();
  }
}
export function safeCode(e:unknown){
  const s=e instanceof Error?e.message:"PROTOCOL";
  return ["PROTOCOL","VERSION","LIMIT","REPLAY","CERTIFICATE","IDENTITY","BUSY","TIMEOUT","DISCONNECTED","INTEGRITY","CLOSED"].includes(s)?s:"PROTOCOL";
}
