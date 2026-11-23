import { afterEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { AtomicRepository } from "../data/atomic";
import { createDemoData } from "../data/demo";
import { STORAGE_KEY, validateData } from "../data/repository";
import { IndexedDbPhotoRepository } from "../photos/assets";
import { ReportService } from "../reports/service";
import { defaultReportOptions, type ReportOptions } from "../reports/model";
import { prepareTransfer, TransferAssembler } from "./packets";
import { appendLocal, canonical, dotId, receive } from "./causal";
import { reportHashes } from "./report-documents";

const at=Date.parse("2026-11-23T12:00:00Z");
const origins=["11111111-1111-4111-8111-111111111111","22222222-2222-4222-8222-222222222222","33333333-3333-4333-8333-333333333333"];
class Storage {rows=new Map<string,string>();getItem(k:string){return this.rows.get(k)??null;}setItem(k:string,v:string){this.rows.set(k,v);}}
async function replica(n:number,active=true,empty=false) {
  const storage=new Storage(),factory=new IDBFactory(),seed=createDemoData(new Date(at));
  seed.jobs=[{...seed.jobs.find(j=>j.id==="job-5")!,id:"report-job-"+n,gardenId:"garden-1",activities:["Synthetic work"],materials:[]}];
  seed.payments=[];if(empty){seed.jobs=[];seed.gardens=[];seed.clients=[];}validateData(seed);storage.setItem(STORAGE_KEY,JSON.stringify({version:12,data:seed}));
  const name="report-apply-"+n,repo=new AtomicRepository(storage,factory,name);await repo.initialize();
  if(active)await repo.enableSyncJournal(origins[n]);
  return{repo,storage,factory,name,n};
}
type Replica=Awaited<ReturnType<typeof replica>>;
const data=async(r:Replica)=>(await r.repo.read()).data;
function service(r:Replica) {
  return new ReportService({snapshot:()=>data(r),reserveReportIdentity:(...a)=>r.repo.reserveReportIdentity(...a),
    saveVisitReport:async(...a)=>{await r.repo.command(s=>s.saveVisitReport(...a));}},new IndexedDbPhotoRepository(new IDBFactory()),
    async()=>new Uint8Array([37,80,68,70]),()=>at);
}
async function issue(r:Replica,options:ReportOptions=defaultReportOptions()) {
  const s=service(r),p=await s.prepare("report-job-"+r.n,options);await s.save("report-job-"+r.n,p);return p.record;
}
async function restart(r:Replica) {await r.repo.close();r.repo=new AtomicRepository(r.storage,r.factory,r.name);await r.repo.initialize();}
async function packet(a:Replica,b:Replica) {
  if(Math.abs(a.n-b.n)===2)throw Error("Direct A-C forbidden");
  await a.repo.prepareSyncReports();
  const transfer=await prepareTransfer((await a.repo.readSyncJournal())!,(await b.repo.readSyncJournal())!.log.known);
  const reader=new TransferAssembler(transfer.offer);
  for(const part of [...transfer.chunks].reverse())reader.accept(part);
  return (await reader.finish()).operations;
}
async function apply(r:Replica) {const p=await r.repo.planSyncOperations();if(p.plan)await r.repo.applySyncPlan(p.plan.id);return p;}
async function send(a:Replica,b:Replica) {await b.repo.receiveSyncOperations(await packet(a,b));return apply(b);}
const reports=async(r:Replica,id="report-job-0")=>(await data(r)).jobs.find(j=>j.id===id)?.reports??[];
afterEach(()=>vi.restoreAllMocks());
describe("5c2b immutable documents, independent durable A/B/C (not native LAN)",()=>{
  it("applies exact report A-B-C, relays original evidence, and retries without new document or operation",async()=>{
    const a=await replica(0),b=await replica(1),c=await replica(2),report=await issue(a);
    const p=await send(a,b);expect(p.planned).toBeGreaterThan(0);expect(await reports(b)).toEqual([report]);
    const reused=await service(b).prepare("report-job-0",defaultReportOptions());
    expect(reused.reused).toBe(true);expect(reused.record).toEqual(report);
    await send(b,c);expect(await reports(c)).toEqual([report]);
    const log=(await c.repo.readSyncJournal())!.log,proof=log.operations.find(o=>o.changes.some(c=>c.key.startsWith("reportDocuments/")))!;
    expect(proof.origin).toBe(origins[0]);
    const before=await c.repo.read();await send(a,b);await send(b,c);
    expect(await c.repo.read()).toEqual(before);expect(await reports(c)).toHaveLength(1);
    expect((await c.repo.readSyncReceiver())!.reportAvailability!.find(v=>v.reportId===report.id)!.status).toBe("portable");
  });
  it("receipt and planning leave Data untouched; restart before apply and lost confirmation are safe",async()=>{
    const a=await replica(0),b=await replica(1),report=await issue(a),before=await b.repo.read();
    await b.repo.receiveSyncOperations(await packet(a,b));expect(await b.repo.read()).toEqual(before);
    await restart(b);const p=await b.repo.planSyncOperations();expect(p.plan).not.toBeNull();
    expect(await b.repo.read()).toEqual(before);
    const receipt=await b.repo.applySyncPlan(p.plan!.id);await restart(b);
    expect(await reports(b)).toEqual([report]);expect(await b.repo.applySyncPlan(p.plan!.id)).toEqual(receipt);
    expect((await b.repo.readSyncReceiver())!.receipts.filter(r=>receipt.operations.includes(dotId(r.operation))).every(r=>r.stage==="applied")).toBe(true);
  });
  it("keeps historical snapshot after visit/client changes and adds exact next version",async()=>{
    const a=await replica(0),b=await replica(1,true,true),c=await replica(2,true,true),first=await issue(a);
    await send(a,b);
    await a.repo.command(s=>s.saveVisitDetails("report-job-0",{publicWork:"Later changed work",clientRemarks:"Later",zoneId:null},0),()=>at+10);
    const client=(await data(a)).clients.find(c=>c.id==="client-1")!;
    await a.repo.command(s=>s.saveClient({...client,name:"Later client name"},client));
    await send(a,b);expect(await reports(b)).toEqual([first]);
    const second=await issue(a);expect(second.version).toBe(2);expect(second.number).toBe(first.number);
    expect(second.snapshot.clientName).toBe("Later client name");
    await send(a,b);expect(await reports(b)).toEqual([first,second]);await send(b,c);expect(await reports(c)).toEqual([first,second]);
    const before=await reports(c);await send(a,b);await send(b,c);expect(await reports(c)).toEqual(before);
  });
  it("uses separate canonical document/snapshot SHA256 without redefining old fingerprint or plain source CAS",async()=>{
    const a=await replica(0),r=await issue(a),h=await reportHashes("report-job-0",r);
    const reordered=JSON.parse(canonical(r));
    expect(await reportHashes("report-job-0",reordered)).toEqual(h);
    expect(h.fingerprintMatches).toBe(true);expect(h.documentSha256).toHaveLength(64);
    expect(h.documentSha256).not.toBe(h.snapshotSha256);expect(h.snapshotSha256).not.toBe(r.fingerprint);
    expect((await reportHashes("other-job",r)).documentSha256).not.toBe(h.documentSha256);
    const changed=structuredClone(r);changed.snapshot.workDescription="Tampered";
    expect((await reportHashes("report-job-0",changed)).fingerprintMatches).toBe(false);
  });
  it.each(["snapshot","documentHash","snapshotHash","identity","parent"] as const)("quarantines %s damage without touching unrelated data",async(mode)=>{
    const a=await replica(0),b=await replica(1);await issue(a);
    await a.repo.command(s=>s.saveClient({id:"safe-doc-client",name:"Synthetic independent",phone:"",email:"",notes:""},null));
    const ops=await packet(a,b);
    const full=ops.find(o=>o.changes.some(c=>c.key.startsWith("reports/")))!;
    const proof=ops.find(o=>o.changes.some(c=>c.key.startsWith("reportDocuments/")))!;
    if(mode==="snapshot")((full.changes.find(c=>c.key.startsWith("reports/"))!.after as any).report.snapshot).workDescription="Damaged";
    if(mode==="documentHash")(proof.changes[0].after as any).documentSha256="0".repeat(64);
    if(mode==="snapshotHash")(proof.changes[0].after as any).snapshotSha256="0".repeat(64);
    if(mode==="identity")full.changes=full.changes.filter(c=>!c.key.startsWith("visits/"));
    if(mode==="parent")for(const o of ops)for(const ch of o.changes)if(ch.key==="visits/report-job-0")
      for(const v of [ch.before,ch.after])if(v)(v as any).job.gardenId="missing-parent";
    await b.repo.receiveSyncOperations(ops);await apply(b);await restart(b);
    expect(await reports(b)).toEqual([]);
    expect((await data(b)).clients.some(c=>c.id==="safe-doc-client")).toBe(true);
    const rx=(await b.repo.readSyncReceiver())!;
    if(mode==="parent")expect(rx.receipts.some(r=>r.stage==="waiting-records")).toBe(true);
    else expect(rx.reportAvailability!.some(r=>r.status==="conflict")).toBe(true);
  });
  it("rejects malformed report structure before known and detects a changed body under an existing operation UUID",async()=>{
    const a=await replica(0),b=await replica(1);await issue(a);const ops=await packet(a,b);
    const bad=structuredClone(ops),source=bad.find(o=>o.changes.some(c=>c.key.startsWith("reports/")))!;
    (source.changes.find(c=>c.key.startsWith("reports/"))!.after as any).report.unexpected=true;
    const result=await b.repo.receiveSyncOperations(bad);expect(result.rejected.length).toBeGreaterThan(0);
    expect(await reports(b)).toEqual([]);
    const c=await replica(2); // no A-C wire: forward through B's original codec after fresh B
    const fresh=await replica(1);await fresh.repo.receiveSyncOperations(ops);await apply(fresh);
    const equiv=structuredClone(ops.find(o=>o.changes.some(c=>c.key.startsWith("reports/")))!);
    (equiv.changes.find(c=>c.key.startsWith("reports/"))!.after as any).report.snapshot.workDescription="Different body";
    expect((await fresh.repo.receiveSyncOperations([equiv])).rejected.length).toBeGreaterThan(0);
    expect((await fresh.repo.readSyncReceiver())!.identityAlerts!.length).toBeGreaterThan(0);
    await send(fresh,c);expect(await reports(fresh)).toHaveLength(1);
  });
  it("rolls back Data, receipt, evidence and checkpoints on quota and safely repeats the same plan",async()=>{
    const a=await replica(0),b=await replica(1),r=await issue(a);
    await b.repo.receiveSyncOperations(await packet(a,b));const p=await b.repo.planSyncOperations();
    expect(p.plan).not.toBeNull();
    const before={data:await b.repo.read(),log:await b.repo.readSyncJournal(),receiver:await b.repo.readSyncReceiver()};
    const put=IDBObjectStore.prototype.put;
    const fail=vi.spyOn(IDBObjectStore.prototype,"put").mockImplementation(function(this:IDBObjectStore,v:unknown,k?:IDBValidKey){
      if(this.name==="sync"&&k==="receiver-v1")throw new DOMException("Synthetic quota","QuotaExceededError");
      return put.call(this,v,k);
    });
    await expect(b.repo.applySyncPlan(p.plan!.id)).rejects.toThrow();fail.mockRestore();await restart(b);
    expect({data:await b.repo.read(),log:await b.repo.readSyncJournal(),receiver:await b.repo.readSyncReceiver()}).toEqual(before);
    await b.repo.applySyncPlan(p.plan!.id);expect(await reports(b)).toEqual([r]);
  });
  it("preserves old originals and blocks missing evidence instead of replaying creation commands",async()=>{
    const a=await replica(0),b=await replica(1),r=await issue(a);
    const j=(await a.repo.readSyncJournal())!;
    await b.repo.receiveSyncOperations(j.log.operations);await apply(b);
    expect(await reports(b)).toEqual([]);
    expect((await b.repo.readSyncReceiver())!.reportAvailability!.some(v=>v.reportId===r.id&&v.status==="conflict")).toBe(true);
    await send(a,b);expect(await reports(b)).toEqual([r]);
  });
  it("blocks active local timer on the target while unrelated client passes",async()=>{
    const a=await replica(0,false),b=await replica(1);
    const initial=await data(a);
    await a.repo.command(s=>s.restoreSnapshot({...initial,jobs:initial.jobs.map(j=>({...j,settlement:null}))},JSON.stringify(initial)));
    await a.repo.enableSyncJournal(origins[0]);await send(a,b);
    const existing=(await data(b)).jobs.find(j=>j.id==="report-job-0")!;
    await b.repo.command(s=>s.saveJob({...existing,status:"in-progress"},existing));
    await b.repo.command(s=>s.controlVisitTimer("report-job-0","start",null,null),()=>at+1);
    const timer=(await data(b)).timer;
    await issue(a);await a.repo.command(s=>s.saveClient({id:"timer-independent",name:"Synthetic",phone:"",email:"",notes:""},null));
    await send(a,b);expect((await data(b)).timer).toEqual(timer);expect(await reports(b)).toEqual([]);
    expect((await data(b)).clients.some(c=>c.id==="timer-independent")).toBe(true);
  });
  it("restoring with pending report history retains all evidence and enters restore-review atomically",async()=>{
    const a=await replica(0),b=await replica(1),old=await data(b);await issue(a);
    await b.repo.receiveSyncOperations(await packet(a,b));await apply(b);
    // Force a pending later source identity; it must not become a fictitious
    // new rollback operation merely to satisfy the causal precondition.
    await a.repo.command(s=>s.saveVisitDetails("report-job-0",{publicWork:"Second",clientRemarks:"",zoneId:null},0));
    await issue(a);await b.repo.receiveSyncOperations(await packet(a,b));
    const journal=(await b.repo.readSyncJournal())!,receiver=await b.repo.readSyncReceiver(),current=await data(b);
    await b.repo.command(s=>s.restoreSnapshot(old,JSON.stringify(current)));await restart(b);
    const after=(await b.repo.readSyncJournal())!;
    expect(after.mode).toBe("restore-review");expect(after.log).toEqual(journal.log);
    expect((await b.repo.readSyncReceiver())!.reportAvailability).toEqual(receiver!.reportAvailability);
    await expect(b.repo.planSyncOperations()).rejects.toThrow(/przywróceniu|historię/);
    expect((await data(b)).clients).toEqual(old.clients);
  });
  it("retains an issued original and quarantines a new causal operation trying to alter its snapshot",async()=>{
    const a=await replica(0),b=await replica(1),r=await issue(a);await send(a,b);
    const log=(await a.repo.readSyncJournal())!.log,key="reports/"+encodeURIComponent("report-job-0/"+r.id);
    const value={jobId:"report-job-0",report:r},altered=structuredClone(value);altered.report.snapshot.workDescription="Rewritten";
    const forged=appendLocal(log,[{key,before:value as any,after:altered as any}]).operation!;
    await b.repo.receiveSyncOperations([forged]);await apply(b);await restart(b);
    expect(await reports(b)).toEqual([r]);
    expect((await b.repo.readSyncReceiver())!.receipts.find(v=>v.operation.id===forged.id)!.stage).not.toBe("applied");
    expect((await b.repo.readSyncReceiver())!.reportAvailability!.some(v=>v.reportId===r.id&&v.status==="conflict")).toBe(true);
  });
  it("supports a legacy immutable family without borrowing the foreign sequence as a reservation",async()=>{
    const a=await replica(0,false),b=await replica(1,true,true),c=await replica(2,true,true),r=await issue(a);
    expect(r.number).toBe("BO/2026/000001");await a.repo.enableSyncJournal(origins[0]);
    await send(a,b);await send(b,c);expect(await reports(c)).toEqual([r]);
    expect((await data(c)).reportSequence).toBe(1);expect((await data(c)).timer).toBeNull();
  });
  it("copies historical finance/time exactly without repricing after current settings change",async()=>{
    const a=await replica(0),b=await replica(1,true,true),c=await replica(2,true,true);
    const r=await issue(a,{...defaultReportOptions(),showFinance:true,showChecklists:true,showRemarks:true});
    const original=(await data(a)).jobs[0],payments=(await data(a)).payments;
    await send(a,b);await b.repo.command(s=>s.setRate(999));await send(b,c);
    const received=(await data(c)).jobs.find(j=>j.id===original.id)!;
    expect(received.seconds).toBe(original.seconds);expect(received.timeHistory).toEqual(original.timeHistory);
    expect(received.settlement).toEqual(original.settlement);expect((await data(c)).payments).toEqual(payments);
    expect(received.reports).toEqual([r]);expect(received.reports![0].snapshot.finance).toEqual(r.snapshot.finance);
    const before=await c.repo.read();await send(b,c);expect(await c.repo.read()).toEqual(before);
  });
  it("keeps both historical colliding originals with valid seals and applies an independent client",async()=>{
    const a=await replica(0,false),b=await replica(1,true,true),c=await replica(2,false);
    const ra=await issue(a),rc=await issue(c);expect(ra.number).toBe(rc.number);
    await a.repo.enableSyncJournal(origins[0]);await c.repo.enableSyncJournal(origins[2]);
    await c.repo.command(s=>s.saveClient({id:"collision-independent",name:"Synthetic",phone:"",email:"",notes:""},null));
    await send(a,b);expect(await reports(b)).toEqual([ra]);
    await send(c,b);await send(b,c);await restart(b);
    expect(await reports(b)).toEqual([ra]);expect(await reports(c,"report-job-2")).toEqual([rc]);
    expect((await data(b)).clients.some(c=>c.id==="collision-independent")).toBe(true);
    expect((await b.repo.readSyncReceiver())!.reportConflicts!.some(c=>c.type==="number"&&c.identity===ra.number)).toBe(true);
    const originals=(await b.repo.readSyncJournal())!.log.operations.flatMap(o=>o.changes.filter(c=>c.key.startsWith("reports/")));
    expect(originals).toHaveLength(2);expect(ra.id).not.toBe(rc.id);
  });
  it("blocks actual namespace collisions even when complete document seals are supplied",async()=>{
    const a=await replica(0),b=await replica(1,true,true),c=await replica(2),namespace="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const real=crypto.randomUUID.bind(crypto);
    vi.spyOn(crypto,"randomUUID").mockImplementationOnce(real).mockReturnValueOnce(namespace as ReturnType<typeof crypto.randomUUID>).mockImplementation(real);
    const ra=await issue(a);vi.restoreAllMocks();
    vi.spyOn(crypto,"randomUUID").mockImplementationOnce(real).mockReturnValueOnce(namespace as ReturnType<typeof crypto.randomUUID>).mockImplementation(real);
    const rc=await issue(c);vi.restoreAllMocks();expect(ra.number).toBe(rc.number);
    await send(a,b);await send(c,b);await restart(b);
    expect(await reports(b)).toEqual([ra]);expect(await reports(b,"report-job-2")).toEqual([]);
    expect((await b.repo.readSyncReceiver())!.reportConflicts!.some(c=>c.type==="namespace"&&c.identity===namespace)).toBe(true);
  });
  it("quarantines an opaque report already known by a pre-5c2b receiver without blocking independent data",async()=>{
    const a=await replica(0),b=await replica(1),c=await replica(2);await send(a,b);
    const source=(await a.repo.readSyncJournal())!.log;
    const opaque=appendLocal(source,[{key:"reports/"+encodeURIComponent("old-visit/opaque"),before:null,
      after:{jobId:"old-visit",report:{id:"opaque",options:{photoIds:[],logoPhotoId:null},snapshot:{photos:[],logo:null}}}}]).operation!;
    const journal=(await b.repo.readSyncJournal())!,receiver=(await b.repo.readSyncReceiver())!;
    journal.log=receive(journal.log,[opaque]);
    receiver.receipts.push({operation:opaque,stage:"verified",reason:"",appliedRevision:null,resolvedBy:null});
    await new Promise<void>((ok,no)=>{
      const q=b.factory.open(b.name);q.onerror=()=>no(q.error);q.onsuccess=()=>{
        const db=q.result,tx=db.transaction("sync","readwrite"),s=tx.objectStore("sync");
        s.put(journal,"journal-v1");s.put(receiver,"receiver-v1");
        tx.oncomplete=()=>{db.close();ok();};tx.onabort=()=>no(tx.error);
      };
    });
    await c.repo.command(s=>s.saveClient({id:"after-opaque",name:"Synthetic",phone:"",email:"",notes:""},null));
    await send(c,b);await restart(b);
    expect((await data(b)).clients.some(c=>c.id==="after-opaque")).toBe(true);
    const row=(await b.repo.readSyncReceiver())!.receipts.find(v=>v.operation.id===opaque.id)!;
    expect(row.stage).toBe("blocked");expect(row.reason).toContain("REPORT_INVALID");expect(row.appliedRevision).toBeNull();
  });
});
