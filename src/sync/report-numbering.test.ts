import { afterEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { AtomicRepository } from "../data/atomic";
import { createDemoData } from "../data/demo";
import { STORAGE_KEY, validateData } from "../data/repository";
import { IndexedDbPhotoRepository } from "../photos/assets";
import { ReportService, type PdfGenerator } from "../reports/service";
import { defaultReportOptions } from "../reports/model";
import { parseReportNumber } from "../reports/numbering";
import { REPORT_NUMBER_KEY, type ReportNumberState } from "./report-number-state";
import { same } from "./causal";
import { prepareTransfer, TransferAssembler } from "./packets";

const at=Date.parse("2026-11-23T12:00:00Z");
const origins=["11111111-1111-4111-8111-111111111111","22222222-2222-4222-8222-222222222222","33333333-3333-4333-8333-333333333333"];
class Storage {
  rows=new Map<string,string>();
  getItem(k:string){return this.rows.get(k)??null;}
  setItem(k:string,v:string){this.rows.set(k,v);}
}
async function replica(n:number,active=true) {
  const storage=new Storage(),factory=new IDBFactory(),seed=createDemoData(new Date(at));
  seed.jobs=[{...seed.jobs.find(j=>j.id==="job-5")!,id:"job-"+n,gardenId:"garden-1",activities:["Synthetic work"],materials:[]}];
  seed.payments=[];validateData(seed);
  storage.setItem(STORAGE_KEY,JSON.stringify({version:12,data:seed}));
  const name="report-replica-"+n,repo=new AtomicRepository(storage,factory,name);await repo.initialize();
  if(active)await repo.enableSyncJournal(origins[n]);
  return{repo,factory,storage,name,n};
}
type Replica=Awaited<ReturnType<typeof replica>>;
const data=async(r:Replica)=>(await r.repo.read()).data;
const service=(r:Replica,clock=()=>at,generator:PdfGenerator=async()=>new Uint8Array([37,80,68,70]))=>new ReportService({
  snapshot:()=>data(r),reserveReportIdentity:(...args)=>r.repo.reserveReportIdentity(...args),
  saveVisitReport:async(...args)=>{await r.repo.command(s=>s.saveVisitReport(...args));},
},new IndexedDbPhotoRepository(new IDBFactory()),generator,clock);
async function issue(r:Replica) {
  const s=service(r),p=await s.prepare("job-"+r.n,defaultReportOptions());await s.save("job-"+r.n,p);return p;
}
async function restart(r:Replica) {
  await r.repo.close();r.repo=new AtomicRepository(r.storage,r.factory,r.name);await r.repo.initialize();
}
async function numberState(r:Replica):Promise<ReportNumberState|undefined> {
  return new Promise((ok,no)=>{
    const open=r.factory.open(r.name);open.onerror=()=>no(open.error);
    open.onsuccess=()=>{
      const db=open.result,tx=db.transaction("sync"),get=tx.objectStore("sync").get(REPORT_NUMBER_KEY);
      tx.oncomplete=()=>{db.close();ok(get.result);};tx.onabort=()=>no(tx.error);
    };
  });
}
async function send(a:Replica,b:Replica) {
  if(Math.abs(a.n-b.n)===2)throw Error("A-C direct link forbidden");
  const j=(await a.repo.readSyncJournal())!,peer=(await b.repo.readSyncJournal())!;
  const t=await prepareTransfer(j,peer.log.known),reader=new TransferAssembler(t.offer);
  for(const c of [...t.chunks].reverse())reader.accept(c);
  await b.repo.receiveSyncOperations((await reader.finish()).operations);
  const p=await b.repo.planSyncOperations();if(p.plan)await b.repo.applySyncPlan(p.plan.id);return p;
}
afterEach(()=>vi.restoreAllMocks());
describe("5c2a durable offline report spaces, not business LAN",()=>{
  it("keeps inactive numbering unchanged and uses distinct full namespaces offline on A/C",async()=>{
    const old=await replica(1,false),legacy=await issue(old);
    expect(legacy.record.number).toBe("BO/2026/000001");expect(await old.repo.readSyncJournal()).toBeNull();
    const a=await replica(0),c=await replica(2),ra=await issue(a),rc=await issue(c);
    const pa=parseReportNumber(ra.record.number)!,pc=parseReportNumber(rc.record.number)!;
    expect(pa.namespace).not.toBeNull();expect(pc.namespace).not.toBe(pa.namespace);
    expect(pa.sequence).toBe(1);expect(pc.sequence).toBe(1);
    expect((await numberState(a))!.nextSequence).toBe(2);
    expect((await a.repo.readSyncJournal())!.version).toBe(2);
    expect((await data(a)).jobs[0].reports![0]).toEqual(ra.record);
  });
  it("reserves before PDF, burns abandoned numbers and does not reuse after restart or older restore",async()=>{
    const a=await replica(0),s=service(a),before=await data(a);
    const abandoned=await s.prepare("job-0",defaultReportOptions());
    expect((await numberState(a))!.nextSequence).toBe(2);
    expect(await data(a)).toEqual(before);
    await restart(a);const p=await issue(a);
    expect(parseReportNumber(p.record.number)!.sequence).toBe(2);
    expect(p.record.number).not.toBe(abandoned.record.number);
    const numbering=await numberState(a);
    await a.repo.command(s=>s.restoreSnapshot(before,JSON.stringify(s.snapshot())));
    expect(await numberState(a)).toEqual(numbering);
    await expect(service(a).prepare("job-0",defaultReportOptions())).rejects.toThrow(/odtworzeniu|restore/);
    expect((await a.repo.readSyncJournal())!.mode).toBe("restore-review");
  });
  it("continues versions without allocating a new family and keeps save/reuse idempotent",async()=>{
    const a=await replica(0),p=await issue(a);
    await a.repo.command(s=>s.saveVisitDetails("job-0",{publicWork:"Synthetic revision",clientRemarks:"",zoneId:null},0),()=>at+1);
    const s=service(a,()=>at+2),next=await s.prepare("job-0",defaultReportOptions());
    expect(next.record.number).toBe(p.record.number);expect(next.record.version).toBe(2);
    await s.save("job-0",next);await restart(a);
    const before=await data(a);await service(a).save("job-0",next);
    expect(await data(a)).toEqual(before);expect((await numberState(a))!.nextSequence).toBe(2);
    const reused=await service(a).prepare("job-0",defaultReportOptions());
    expect(reused.reused).toBe(true);expect(reused.record).toEqual(next.record);
    expect((await numberState(a))!.pending).toHaveLength(0);
  });
  it("detects two historical equal numbers across A-B-C, retains originals and allows an unrelated client",async()=>{
    const a=await replica(0,false),b=await replica(1),c=await replica(2,false);
    const ra=await issue(a),rc=await issue(c);
    expect(ra.record.number).toBe(rc.record.number);expect(ra.record.id).not.toBe(rc.record.id);
    await a.repo.enableSyncJournal(origins[0]);await c.repo.enableSyncJournal(origins[2]);
    await a.repo.command(s=>s.saveClient({id:"safe-client",name:"Synthetic",phone:"",email:"",notes:""},null));
    await send(a,b);await send(b,c);await send(c,b);await send(b,a);await restart(b);
    for(const r of [a,b,c]) {
      const collisions=(await r.repo.readSyncReceiver())!.reportConflicts!;
      expect(collisions.some(x=>x.type==="number"&&x.identity===ra.record.number)).toBe(true);
      expect((await data(r)).clients.some(x=>x.id==="safe-client")).toBe(true);
    }
    expect((await data(a)).jobs.find(j=>j.id==="job-0")!.reports![0]).toEqual(ra.record);
    expect((await data(c)).jobs.find(j=>j.id==="job-2")!.reports![0]).toEqual(rc.record);
    const before=await b.repo.readSyncReceiver();await send(a,b);
    expect((await b.repo.readSyncReceiver())!.reportConflicts).toEqual(before!.reportConflicts);
  },30000);
  it("holds forced namespace collisions, preserves all numbers and stops further issuance",async()=>{
    const a=await replica(0),b=await replica(1),c=await replica(2),namespace="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const real=crypto.randomUUID.bind(crypto);
    vi.spyOn(crypto,"randomUUID").mockImplementationOnce(real).mockReturnValueOnce(namespace as ReturnType<typeof crypto.randomUUID>).mockImplementation(real);
    const ra=await issue(a);
    vi.restoreAllMocks();
    vi.spyOn(crypto,"randomUUID").mockImplementationOnce(real).mockReturnValueOnce(namespace as ReturnType<typeof crypto.randomUUID>).mockImplementation(real);
    const rc=await issue(c);vi.restoreAllMocks();
    expect(ra.record.id).not.toBe(rc.record.id);expect(ra.record.number).toBe(rc.record.number);
    expect(same((await numberState(a))!.claim,(await numberState(c))!.claim)).toBe(false);
    await send(a,b);await send(b,c);await send(c,b);await send(b,a);await restart(a);
    expect((await a.repo.readSyncReceiver())!.reportConflicts!.some(c=>c.type==="namespace"&&c.identity===namespace)).toBe(true);
    await a.repo.command(s=>s.saveVisitDetails("job-0",{publicWork:"Synthetic changed work",clientRemarks:"",zoneId:null},0));
    const before=await a.repo.read(),n=await numberState(a);
    await expect(service(a).prepare("job-0",defaultReportOptions())).rejects.toThrow("REPORT_NAMESPACE_COLLISION");
    expect(await a.repo.read()).toEqual(before);expect(await numberState(a)).toEqual(n);
    expect((await data(a)).jobs.find(j=>j.id==="job-0")!.reports![0]).toEqual(ra.record);
    expect((await data(c)).jobs.find(j=>j.id==="job-2")!.reports![0]).toEqual(rc.record);
  });
  it("rolls back report, consumed reservation, journal and receiver on quota; retry retains its exact number",async()=>{
    const a=await replica(0),s=service(a),p=await s.prepare("job-0",defaultReportOptions());
    const before=await a.repo.read(),journal=await a.repo.readSyncJournal(),numbering=await numberState(a);
    const put=IDBObjectStore.prototype.put;
    const failure=vi.spyOn(IDBObjectStore.prototype,"put").mockImplementation(function(this:IDBObjectStore,v:unknown,k?:IDBValidKey){
      if(this.name==="sync"&&k===REPORT_NUMBER_KEY)throw new DOMException("Synthetic quota","QuotaExceededError");
      return put.call(this,v,k);
    });
    await expect(s.save("job-0",p)).rejects.toThrow();failure.mockRestore();
    expect(await a.repo.read()).toEqual(before);expect(await a.repo.readSyncJournal()).toEqual(journal);
    expect(await numberState(a)).toEqual(numbering);
    await s.save("job-0",p);await restart(a);
    expect((await data(a)).jobs[0].reports![0]).toEqual(p.record);
    expect((await numberState(a))!.pending).toHaveLength(0);
  });
  it("does not render a PDF or change the original journal when allocation itself fails",async()=>{
    const a=await replica(0),generator=vi.fn(async()=>new Uint8Array([37,80,68,70]));
    const before=await a.repo.read(),journal=await a.repo.readSyncJournal(),put=IDBObjectStore.prototype.put;
    const failure=vi.spyOn(IDBObjectStore.prototype,"put").mockImplementation(function(this:IDBObjectStore,v:unknown,k?:IDBValidKey){
      if(this.name==="sync"&&k===REPORT_NUMBER_KEY)throw new DOMException("Synthetic quota","QuotaExceededError");
      return put.call(this,v,k);
    });
    await expect(service(a,()=>at,generator).prepare("job-0",defaultReportOptions())).rejects.toThrow();
    failure.mockRestore();expect(generator).not.toHaveBeenCalled();
    expect(await a.repo.read()).toEqual(before);expect(await a.repo.readSyncJournal()).toEqual(journal);
    expect(await numberState(a)).toBeUndefined();
    expect(parseReportNumber((await issue(a)).record.number)!.sequence).toBe(1);
  });
  it("allocates fresh counters for two canonical writers without trusting either mirror",async()=>{
    const a=await replica(0);
    const original=(await data(a)).jobs[0],second={...original,id:"parallel-job",settlement:null};
    await a.repo.command(s=>s.saveJob(second));
    const stale=new Storage(),other=new AtomicRepository(stale,a.factory,a.name);await other.initialize();
    const port=new ReportService({snapshot:async()=>(await other.read()).data,
      reserveReportIdentity:(...args)=>other.reserveReportIdentity(...args),
      saveVisitReport:async(...args)=>{await other.command(s=>s.saveVisitReport(...args));}
    },new IndexedDbPhotoRepository(new IDBFactory()),async()=>new Uint8Array([37,80,68,70]),()=>at);
    const [first,next]=await Promise.all([service(a).prepare("job-0",defaultReportOptions()),port.prepare("parallel-job",defaultReportOptions())]);
    expect(first.record.number).not.toBe(next.record.number);
    expect(parseReportNumber(first.record.number)!.namespace).toBe(parseReportNumber(next.record.number)!.namespace);
    await Promise.all([service(a).save("job-0",first),port.save("parallel-job",next)]);
    expect((await numberState(a))!.nextSequence).toBe(3);
    expect((await numberState(a))!.pending).toHaveLength(0);
    expect((await data(a)).jobs.flatMap(j=>j.reports??[])).toHaveLength(2);await other.close();
  });
  it("does not issue two alternatives of one visit version even with distinct reserved numbers",async()=>{
    const a=await replica(0),s=service(a);
    const [first,other]=await Promise.all([s.prepare("job-0",defaultReportOptions()),s.prepare("job-0",defaultReportOptions())]);
    expect(first.record.number).not.toBe(other.record.number);
    await s.save("job-0",first);const before=await data(a);
    await expect(s.save("job-0",other)).rejects.toThrow();
    expect(await data(a)).toEqual(before);expect((await data(a)).jobs[0].reports).toEqual([first.record]);
    expect((await numberState(a))!.nextSequence).toBe(3);
  });
  it("preserves legacy history but blocks unowned family versions after activation",async()=>{
    const a=await replica(0,false),old=await issue(a);
    await a.repo.enableSyncJournal(origins[0]);
    await a.repo.command(s=>s.saveVisitDetails("job-0",{publicWork:"Synthetic changed",clientRemarks:"",zoneId:null},0));
    await expect(service(a).prepare("job-0",defaultReportOptions())).rejects.toThrow(/właściciela/);
    expect((await data(a)).jobs[0].reports![0]).toEqual(old.record);
  });
  it("treats a business copy of a scoped family as data, never ownership or a reset of its counter",async()=>{
    const a=await replica(0),p=await issue(a),copy=JSON.parse(JSON.stringify(await data(a)));
    const b=await replica(1,false);
    await b.repo.command(s=>s.restoreSnapshot(copy,JSON.stringify(s.snapshot())));
    validateData(await data(b));
    expect((await data(b)).jobs[0].reports![0]).toEqual(p.record);
    await b.repo.command(s=>s.saveVisitDetails("job-0",{publicWork:"Synthetic changed",clientRemarks:"",zoneId:null},0));
    await expect(service(b).prepare("job-0",defaultReportOptions())).rejects.toThrow(/przestrzeni/);
    expect(await b.repo.readSyncJournal()).toBeNull();
  });
  it("keeps the high-water across years and clock rollback, independently of legacy reportSequence",async()=>{
    const a=await replica(0,false),before=await data(a);
    await a.repo.command(s=>s.restoreSnapshot({...before,reportSequence:9876},JSON.stringify(before)));
    await a.repo.enableSyncJournal(origins[0]);const first=await issue(a);
    expect(parseReportNumber(first.record.number)!.sequence).toBe(1);
    for(const [jobId,time,sequence] of [["future",Date.parse("2027-01-01T12:00:00Z"),2],["clock-back",Date.parse("2025-01-01T12:00:00Z"),3]] as const) {
      const original=(await data(a)).jobs.find(j=>j.id==="job-0")!;
      const {reports:_reports,...job}=original;
      await a.repo.command(s=>s.saveJob({...job,id:jobId,settlement:null}));
      const svc=service(a,()=>time),prepared=await svc.prepare(jobId,defaultReportOptions());await svc.save(jobId,prepared);
      expect(parseReportNumber(prepared.record.number)!.sequence).toBe(sequence);
      expect(parseReportNumber(prepared.record.number)!.namespace).toBe(parseReportNumber(first.record.number)!.namespace);
    }
    expect((await numberState(a))!.nextSequence).toBe(4);
    expect((await data(a)).reportSequence).toBe(9876);
  });
  it("detects a divergent operation under the local replica identity and preserves the receipt over restart",async()=>{
    const a=await replica(0);await issue(a);
    const journal=(await a.repo.readSyncJournal())!,original=journal.log.operations[0];
    const bad={...structuredClone(original),id:crypto.randomUUID()};
    await a.repo.receiveSyncOperations([bad]);await restart(a);
    expect((await a.repo.readSyncReceiver())!.reportConflicts!.some(c=>c.type==="replica")).toBe(true);
    await a.repo.command(s=>s.saveVisitDetails("job-0",{publicWork:"Synthetic new revision",clientRemarks:"",zoneId:null},0));
    await expect(service(a).prepare("job-0",defaultReportOptions())).rejects.toThrow("REPORT_NAMESPACE_COLLISION");
    expect((await a.repo.readSyncJournal())!.log.operations.find(o=>o.id===original.id)).toEqual(original);
  });
  it("refuses a rolled-back local high-water when the original issued operation still exists",async()=>{
    const a=await replica(0);await issue(a);
    const n=(await numberState(a))!;n.nextSequence=1;
    await new Promise<void>((ok,no)=>{
      const q=a.factory.open(a.name);q.onerror=()=>no(q.error);
      q.onsuccess=()=>{const db=q.result,tx=db.transaction("sync","readwrite");
        tx.objectStore("sync").put(n,REPORT_NUMBER_KEY);tx.oncomplete=()=>{db.close();ok();};tx.onabort=()=>no(tx.error);};
    });
    await a.repo.command(s=>s.saveVisitDetails("job-0",{publicWork:"Synthetic changed",clientRemarks:"",zoneId:null},0));
    const before=await a.repo.read();
    await expect(service(a).prepare("job-0",defaultReportOptions())).rejects.toThrow(/Licznik cofa/);
    expect(await a.repo.read()).toEqual(before);
  });
  it("does not accept an arbitrary scoped save without its original reservation",async()=>{
    const a=await replica(0),p=await service(a).prepare("job-0",defaultReportOptions()),before=await a.repo.read();
    const bad={...p,record:{...p.record,id:crypto.randomUUID()}};
    await expect(service(a).save("job-0",bad)).rejects.toThrow(/rezerwac/);
    expect(await a.repo.read()).toEqual(before);
    await service(a).save("job-0",p);
  });
});
