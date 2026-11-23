import { businessRecords } from "./records";
import { newShoppingItem } from "../shopping/model";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { AtomicRepository } from "../data/atomic";
import { createDemoData } from "../data/demo";
import { STORAGE_KEY, validateData } from "../data/repository";
import { jobTotalCents, paidCents, type Data, type Job, type Payment } from "../domain";
import { defaultOptions, reviewRows, rulesKey, otherCategory, type Expense } from "../expenses/model";
import { RECEIVER_KEY, type StoredConflict } from "./receiver-model";
import { prepareTransfer, TransferAssembler } from "./packets";
import { appendLocal, canonical } from "./causal";
import { decisionKey, type FinancialDecisionRequest, type FinancialEvidence, type FinancialIntent } from "./resolution-model";

const origins=["11111111-1111-4111-8111-111111111111","22222222-2222-4222-8222-222222222222","33333333-3333-4333-8333-333333333333"];
class Storage {
  rows=new Map<string,string>();
  getItem(k:string){return this.rows.get(k)??null;}
  setItem(k:string,v:string){this.rows.set(k,v);}
}
async function replica(n:number) {
  const data=createDemoData(new Date("2026-11-22T12:00:00Z"));data.jobs=[];data.payments=[];
  const factory=new IDBFactory(),storage=new Storage(),name="resolution-"+n;
  storage.setItem(STORAGE_KEY,JSON.stringify({version:12,data}));
  const repo=new AtomicRepository(storage,factory,name);await repo.initialize();await repo.enableSyncJournal(origins[n]);
  return {repo,storage,factory,name};
}
type Replica=Awaited<ReturnType<typeof replica>>;
async function restart(r:Replica){await r.repo.close();r.repo=new AtomicRepository(r.storage,r.factory,r.name);await r.repo.initialize();}
const data=async(r:Replica)=>(await r.repo.read()).data;
const job=async(r:Replica)=>(await data(r)).jobs.find(j=>j.id==="visit")!;
async function send(a:Replica,b:Replica,apply=true) {
  if([a.name,b.name].sort().join("|")==="resolution-0|resolution-2")throw Error("No direct A-C");
  const j=(await a.repo.readSyncJournal())!,peer=(await b.repo.readSyncJournal())!,
    transfer=await prepareTransfer(j,peer.log.known),parser=new TransferAssembler(transfer.offer);
  for(const chunk of [...transfer.chunks].reverse())parser.accept(chunk);
  await b.repo.receiveSyncOperations((await parser.finish()).operations);
  const plan=await b.repo.planSyncOperations();
  if(apply&&plan.plan)await b.repo.applySyncPlan(plan.plan.id);
  return plan;
}
async function base() {
  const a=await replica(0),b=await replica(1),c=await replica(2);
  const j:Job={id:"visit",gardenId:"garden-1",title:"Synthetic",date:"2026-11-23",time:"09:00",
    status:"planned",billing:"hourly",rate:100,fixedPrice:0,seconds:3600,materials:[],notes:"",activities:[],settlement:null};
  await a.repo.command(s=>s.saveJob(j));await send(a,b);await send(b,c);
  return {a,b,c};
}
async function conflict(r:Replica,key="visits/visit") {
  await r.repo.planSyncOperations();
  return (await r.repo.readSyncReceiver())!.conflicts.find(c=>c.key===key&&c.status==="open")!;
}
function request(c:StoredConflict,patch:Partial<Extract<FinancialIntent,{kind:"visit"}>>={},source=0):FinancialDecisionRequest {
  const basis=c.remote[source],payments=new Map<string,string>();
  for(const v of c.remote)for(const p of (v.value as any).payments??[])if(!payments.has(p.id))payments.set(p.id,v.operationId);
  return {id:crypto.randomUUID(),conflictId:c.id,token:c.token,rationale:"Synthetic conscious decision",
    intent:{kind:"visit",basisOperationId:basis.operationId,labor:{kind:"source"},time:{kind:"source"},
      payments:[...payments].map(([id,sourceOperationId])=>({id,action:"keep",sourceOperationId})),...patch}};
}
async function approvals() {
  const r=await base();
  await r.a.repo.command(s=>s.completeJob("visit"),()=>1000);await send(r.a,r.b);await send(r.b,r.c);
  await r.a.repo.command(s=>s.approveSettlement("visit",25000,"manual"),()=>2000);
  await r.c.repo.command(s=>s.approveSettlement("visit",30000,"manual"),()=>2000);
  await send(r.a,r.b,false);await send(r.c,r.b);return r;
}
async function pay(r:Replica,id:string,amountCents=1000) {
  const p:Payment={id,jobId:"visit",amountCents,receivedDate:"2026-11-23",method:"cash",note:"Synthetic"};
  await r.repo.command(s=>s.savePayment(p,null));return p;
}
async function evidence(r:Replica,id:string) {
  const o=(await r.repo.readSyncJournal())!.log.operations.find(o=>o.id===id)!;
  return o.changes.find(c=>c.key===decisionKey(id))!.after as unknown as FinancialEvidence;
}
afterEach(()=>vi.restoreAllMocks());
describe("5c2c controlled decisions in three separate durable IndexedDB stores",()=>{
  it.each([0,1,"custom"] as const)("settles approvals (%s), preserves both proofs, relays B-A/B-C and safely retries",async choice=>{
    const {a,b,c}=await approvals(),cf=await conflict(b);
    expect(cf).toBeDefined();
    await expect(b.repo.resolveSyncConflict({conflictId:cf.id,token:cf.token,choice:{kind:"local"}})).rejects.toThrow();
    const req=request(cf,choice==="custom"?{labor:{kind:"amount",cents:27501}}:{},choice==="custom"?0:choice);
    const expected=choice==="custom"?27501:(cf.remote[choice].value as any).job.settlement.finalLaborCents;
    const result=await b.repo.resolveFinancialSyncConflict(req),state=await b.repo.read();
    const audit=await evidence(b,req.id);
    expect(audit.sources.map(s=>(s.after as any).job.settlement.finalLaborCents).sort()).toEqual([25000,30000]);
    expect((await job(b)).settlement!.finalLaborCents).toBe(expected);
    await restart(b);
    expect(await b.repo.resolveFinancialSyncConflict(req)).toEqual(result);
    expect(await b.repo.read()).toEqual(state);
    await send(b,a);await send(b,c);await send(a,b);await send(c,b);
    for(const r of [a,b,c]) {
      expect((await job(r)).settlement!.finalLaborCents).toBe(expected);
      expect(await evidence(r,req.id)).toEqual(audit);
      validateData(await data(r));
    }
    const rows=(await b.repo.readSyncReceiver())!.receipts.filter(row=>audit.sources.some(s=>s.operationId===row.operation.id));
    expect(rows.every(row=>row.stage==="resolved"&&row.appliedRevision===null&&row.resolvedBy===req.id)).toBe(true);
  },30000);
  it("preserves distinct equal-amount payments, then explicitly corrects/cancels by original ID",async()=>{
    const {a,b,c}=await base();
    await a.repo.command(s=>s.completeJob("visit"));await a.repo.command(s=>s.approveSettlement("visit",30000,"manual"));
    await send(a,b);await send(b,c);
    await pay(a,"payment-a");await pay(c,"payment-c");
    await send(a,b);await send(c,b);
    const cf=await conflict(b),req=request(cf);
    await b.repo.resolveFinancialSyncConflict(req);await send(b,a);await send(b,c);
    for(const r of [a,b,c])expect(paidCents("visit",(await data(r)).payments)).toBe(2000);
    const pA=(await data(a)).payments.find(p=>p.id==="payment-a")!,
      pC=(await data(c)).payments.find(p=>p.id==="payment-a")!;
    await a.repo.command(s=>s.savePayment({...pA,amountCents:1200},pA));
    await c.repo.command(s=>s.deletePayment(pC.id,pC));
    await send(a,b);await send(c,b);
    const next=await conflict(b),cancel=request(next);
    (cancel.intent as Extract<FinancialIntent,{kind:"visit"}>).payments=
      (cancel.intent as Extract<FinancialIntent,{kind:"visit"}>).payments.map(p=>p.id==="payment-a"?{...p,action:"cancel"}:p);
    await b.repo.resolveFinancialSyncConflict(cancel);await send(b,a);await send(b,c);
    for(const r of [a,b,c]) {
      expect((await data(r)).payments.map(p=>p.id)).toEqual(["payment-c"]);
      const audit=await evidence(r,cancel.id);
      expect(audit.sources.some(s=>(s.after as any).payments.some((p:any)=>p.id==="payment-a"&&p.amountCents===1200))).toBe(true);
      expect((await r.repo.readSyncJournal())!.log.operations.some(o=>o.changes.some(x=>canonical(x).includes("payment-a")))).toBe(true);
    }
  },30000);
  it("does not accept an overpayment, a fabricated ID, or incomplete payment dispositions",async()=>{
    const {a,b,c}=await base();
    await a.repo.command(s=>s.completeJob("visit"));await a.repo.command(s=>s.approveSettlement("visit",1500,"manual"));
    await send(a,b);await send(b,c);await pay(a,"a");await pay(c,"c");await send(a,b);await send(c,b);
    const cf=await conflict(b),before=await b.repo.read();
    await expect(b.repo.resolveFinancialSyncConflict(request(cf))).rejects.toThrow();
    await expect(b.repo.resolveFinancialSyncConflict(request(cf,{payments:[]}))).rejects.toThrow();
    const forged=request(cf);(forged.intent as any).payments[0].id="fabricated";
    await expect(b.repo.resolveFinancialSyncConflict(forged)).rejects.toThrow();
    expect(await b.repo.read()).toEqual(before);
  });
  it("records alternate time histories without summing and appends a genuine explicit correction",async()=>{
    const {a,b,c}=await base();
    await a.repo.command(s=>s.correctJobTime("visit",7200,3600),()=>2000);
    await c.repo.command(s=>s.correctJobTime("visit",9000,3600),()=>2000);
    await send(a,b);await send(c,b);await restart(b);
    const cf=await conflict(b),req=request(cf,{time:{kind:"seconds",seconds:8000}});
    await b.repo.resolveFinancialSyncConflict(req);await send(b,a);await send(b,c);await restart(c);
    const audit=await evidence(c,req.id);
    expect(audit.sources.map(s=>(s.after as any).job.seconds).sort()).toEqual([7200,9000]);
    for(const r of [a,b,c]) {
      const j=await job(r);expect(j.seconds).toBe(8000);expect(j.timeHistory).toHaveLength(2);
      expect(j.timeHistory!.at(-1)).toMatchObject({id:req.id,kind:"corrected",afterSeconds:8000,pauseDurationMs:null});
      expect(j.timeHistory!.some(e=>["started","stopped"].includes(e.kind))).toBe(false);
      expect(await evidence(r,req.id)).toEqual(audit);
    }
  },30000);
  it("refuses stale tokens/UUID reuse and preserves two concurrent decisions as a durable conflict",async()=>{
    const {a,b,c}=await approvals();await send(b,a);await send(b,c);
    const ca=await conflict(a),cc=await conflict(c),ra=request(ca),rc=request(cc,{labor:{kind:"amount",cents:28000}});
    await a.repo.resolveFinancialSyncConflict(ra);await c.repo.resolveFinancialSyncConflict(rc);
    await expect(a.repo.resolveFinancialSyncConflict({...ra,rationale:"Different request"})).rejects.toThrow();
    await expect(a.repo.resolveFinancialSyncConflict({...ra,id:crypto.randomUUID()})).rejects.toThrow();
    await send(a,b,false);await send(c,b);await restart(b);
    const cf=await conflict(b);
    expect(cf.remote).toHaveLength(2);
    expect(cf.operations.sort()).toEqual([ra.id,rc.id].sort());
    expect((await b.repo.readSyncReceiver())!.receipts.filter(r=>[ra.id,rc.id].includes(r.operation.id)).every(r=>r.stage==="conflict")).toBe(true);
  },30000);
  it("rolls back Data, operation, conflict status and local decision receipt on quota, then retries once",async()=>{
    const {b}=await approvals(),cf=await conflict(b),req=request(cf,{labor:{kind:"amount",cents:27500}});
    const before=await b.repo.read(),journal=await b.repo.readSyncJournal(),receiver=await b.repo.readSyncReceiver();
    const original=IDBObjectStore.prototype.put;
    const spy=vi.spyOn(IDBObjectStore.prototype,"put").mockImplementation(function(this:IDBObjectStore,...args:Parameters<IDBObjectStore["put"]>){
      if(this.name==="sync"&&args[1]===RECEIVER_KEY)throw new DOMException("Synthetic quota","QuotaExceededError");
      return original.apply(this,args);
    });
    await expect(b.repo.resolveFinancialSyncConflict(req)).rejects.toThrow();spy.mockRestore();
    expect(await b.repo.read()).toEqual(before);expect(await b.repo.readSyncJournal()).toEqual(journal);
    expect(await b.repo.readSyncReceiver()).toEqual(receiver);await restart(b);
    await b.repo.resolveFinancialSyncConflict(req);
    expect((await job(b)).settlement!.finalLaborCents).toBe(27500);
  });
  it("keeps expenses' origins, both histories and purchase links when consciously choosing approved/excluded",async()=>{
    const {a,b,c}=await base();
    const e:Expense={id:"expense",revision:1,createdAt:0,updatedAt:0,date:"2026-11-23",amountCents:1000,
      direction:"outgoing",counterparty:"Synthetic vendor",description:"Synthetic",categoryId:otherCategory,
      source:"manual",origin:null,status:"approved",note:"",history:[]};
    await a.repo.command(s=>s.saveExpense(e,null));
    await a.repo.command(s=>s.saveShoppingItem({...newShoppingItem("Synthetic linked"),id:"linked"},null));
    await a.repo.command(s=>s.shoppingAction("linked",1,"ordered"));
    await a.repo.command(s=>s.shoppingAction("linked",2,"purchased"));
    await a.repo.command(s=>s.linkShoppingExpense("linked",3,"expense",1));
    await send(a,b);await send(b,c);
    const ea=(await data(a)).expenses[0],ec=(await data(c)).expenses[0];
    await a.repo.command(s=>s.saveExpense({...ea,amountCents:1200},ea));
    await c.repo.command(s=>s.saveExpense({...ec,status:"excluded"},ec));
    await send(a,b);await send(c,b);
    const cf=await conflict(b,"expenses/expense"),req:FinancialDecisionRequest={id:crypto.randomUUID(),conflictId:cf.id,
      token:cf.token,rationale:"Synthetic reviewed cost",intent:{kind:"expense",basisOperationId:cf.remote[0].operationId,
        amountCents:1100,categoryId:otherCategory,status:"approved"}};
    await b.repo.resolveFinancialSyncConflict(req);await send(b,a);await send(b,c);
    for(const r of [a,b,c]) {
      expect((await data(r)).expenses[0]).toMatchObject({amountCents:1100,status:"approved",origin:null,source:"manual"});
      expect((await data(r)).expenses[0].history.at(-1)?.reason).toBe(req.rationale);
      expect((await data(r)).shoppingItems.find(i=>i.id==="linked")!.expenseId).toBe("expense");
      expect((await evidence(r,req.id)).sources).toHaveLength(2);
    }
  },30000);
  it("preserves the active timer and blocks its decision without preventing a different visit resolution",async()=>{
    const {a,b,c}=await base();
    await a.repo.command(s=>s.saveJob({...((s.snapshot()).jobs[0]),id:"other",title:"Other synthetic",seconds:0}));
    await send(a,b);await send(b,c);
    await b.repo.command(s=>s.startTimer("visit"),()=>1000);
    await a.repo.command(s=>s.correctJobTime("visit",7200,3600),()=>2000);
    await c.repo.command(s=>s.correctJobTime("visit",9000,3600),()=>2000);
    await a.repo.command(s=>s.correctJobTime("other",100,0),()=>2100);
    await c.repo.command(s=>s.correctJobTime("other",200,0),()=>2100);
    await send(a,b);await send(c,b);
    const cf=await conflict(b),timer=(await data(b)).timer,original=await job(b);
    await expect(b.repo.resolveFinancialSyncConflict(request(cf,{time:{kind:"seconds",seconds:8000}}))).rejects.toThrow();
    expect((await data(b)).timer).toEqual(timer);expect(await job(b)).toEqual(original);
    const other=await conflict(b,"visits/other");
    await b.repo.resolveFinancialSyncConflict(request(other,{time:{kind:"seconds",seconds:150}}));
    expect((await data(b)).jobs.find(j=>j.id==="other")!.seconds).toBe(150);
    expect((await data(b)).timer).toEqual(timer);
    // Honest safety boundary: current command causality cannot append STOP to
    // this known conflict. It fails closed instead of losing either branch.
    const before=await b.repo.read();
    await expect(b.repo.command(s=>s.stopTimer(),()=>5000)).rejects.toThrow();
    expect(await b.repo.read()).toEqual(before);
  },30000);
  it("does not split a pending older multi-record command into a financial decision",async()=>{
    const {a,b,c}=await base();
    await a.repo.command(s=>s.completeJob("visit"));await send(a,b);await send(b,c);
    await a.repo.command(s=>{
      s.approveSettlement("visit",25000,"manual");
      s.saveClient({id:"atomic-client",name:"Synthetic",phone:"",email:"",notes:""},null);
    });
    await c.repo.command(s=>s.approveSettlement("visit",30000,"manual"));
    await send(c,b,false);await send(a,b,false);
    const cf=await conflict(b),before=await b.repo.read(),j=await b.repo.readSyncJournal();
    await expect(b.repo.resolveFinancialSyncConflict(request(cf))).rejects.toThrow("ATOMIC_GROUP");
    expect(await b.repo.read()).toEqual(before);expect(await b.repo.readSyncJournal()).toEqual(j);
    expect((await data(b)).clients.some(c=>c.id==="atomic-client")).toBe(false);
  });
  it("rejects network result tampering, ignores forged applied receipts and waits for full predecessors",async()=>{
    const {a,b,c}=await approvals(),cf=await conflict(b),req=request(cf,{labor:{kind:"amount",cents:27500}});
    await b.repo.resolveFinancialSyncConflict(req);
    const log=(await b.repo.readSyncJournal())!.log,op=log.operations.find(o=>o.id===req.id)!;
    await a.repo.receiveSyncOperations([op]);
    expect((await a.repo.readSyncReceiver())!.receipts.find(r=>r.operation.id===req.id)?.stage).toBe("waiting-dependencies");
    await restart(a);await send(b,a);
    expect((await job(a)).settlement!.finalLaborCents).toBe(27500);
    await c.repo.receiveSyncOperations(log.operations.filter(o=>o.id!==req.id));
    const copy=structuredClone(op);(copy.changes[0].after as any).job.settlement.finalLaborCents=1;
    const before=await c.repo.read();
    const bad=await c.repo.receiveSyncOperations([copy]);
    expect(bad.rejected.length).toBeGreaterThan(0);
    expect(await c.repo.read()).toEqual(before);
    const flags=await c.repo.receiveSyncOperations([{operation:op,stage:"applied",appliedRevision:100}]);
    expect(flags.rejected.length).toBeGreaterThan(0);expect(await c.repo.read()).toEqual(before);
  },30000);
  it("converges under deterministic repeated decisions while retaining every immutable original audit",async()=>{
    const {a,b,c}=await approvals(),ids:string[]=[];
    for(let round=0;round<5;round++) {
      if(round) {
        await a.repo.command(s=>s.approveSettlement("visit",25000+round,"manual"),()=>10000+round);
        await c.repo.command(s=>s.approveSettlement("visit",30000+round,"manual"),()=>10000+round);
        await send(a,b,false);await send(c,b);
      }
      const cf=await conflict(b),req=request(cf,{labor:{kind:"amount",cents:27500+round}});
      await b.repo.resolveFinancialSyncConflict(req);ids.push(req.id);
      for(let repeat=0;repeat<2;repeat++){await send(b,a);await send(b,c);await send(a,b);await send(c,b);}
      for(const r of [a,b,c]) {
        expect(jobTotalCents(await job(r))).toBe(27500+round);
        expect(paidCents("visit",(await data(r)).payments)).toBe(0);
        expect((await job(r)).seconds).toBe(3600);
        for(const id of ids)expect((await evidence(r,id)).sources).toHaveLength(2);
      }
    }
  },60000);

  it("rolls back received decision application and its applied/resolved markers on abort, then reuses the exact plan",async()=>{
    const {a,b}=await approvals(),cf=await conflict(b),req=request(cf,{labor:{kind:"amount",cents:27500}});
    await b.repo.resolveFinancialSyncConflict(req);await send(b,a,false);
    const p=await a.repo.planSyncOperations(),before=await a.repo.read(),receiver=await a.repo.readSyncReceiver(),
      journal=await a.repo.readSyncJournal(),original=IDBObjectStore.prototype.put;
    const spy=vi.spyOn(IDBObjectStore.prototype,"put").mockImplementation(function(this:IDBObjectStore,...args:Parameters<IDBObjectStore["put"]>){
      if(this.name==="state"&&args[1]==="current")throw new DOMException("Synthetic abort","AbortError");
      return original.apply(this,args);
    });
    await expect(a.repo.applySyncPlan(p.plan!.id)).rejects.toThrow();spy.mockRestore();
    expect(await a.repo.read()).toEqual(before);expect(await a.repo.readSyncReceiver()).toEqual(receiver);
    expect(await a.repo.readSyncJournal()).toEqual(journal);await restart(a);
    const receipt=await a.repo.applySyncPlan(p.plan!.id),after=await a.repo.read();
    expect((await job(a)).settlement!.finalLaborCents).toBe(27500);
    expect(await a.repo.applySyncPlan(p.plan!.id)).toEqual(receipt);expect(await a.repo.read()).toEqual(after);
  });

  it("resolves a verified shared CSV expense without changing transaction identity or the original import audit",async()=>{
    const {a,b,c}=await base(),options=defaultOptions();
    options.mapping={...options.mapping,date:0,amount:1,counterparty:2,description:3,transactionId:4};
    await a.repo.command(s=>s.saveExpenseProfile({id:"shared-profile",name:"Synthetic bank",
      headers:["date","amount","party","description","id"],options,archived:false,revision:1,createdAt:0,updatedAt:0},null));
    const d=await data(a),p=d.expenseProfiles[0],statementKey="a".repeat(64);
    const rows=reviewRows(d,p.id,statementKey,[{line:2,error:"",row:{line:2,date:"2026-11-23",
      signedCents:-1000,counterparty:"Synthetic bank vendor",description:"Synthetic transaction",
      transactionId:"synthetic-tx-resolution",occurrence:1}}]);
    await a.repo.command(s=>s.importExpenses({id:"shared-import",profile:p,rulesKey:rulesKey(d),statementKey,
      fileHash:"b".repeat(64),filename:"synthetic.csv",requestKey:"c".repeat(64),
      rows:rows.map(r=>({...r,selected:true,status:"approved",categoryId:otherCategory}))}));
    await send(a,b);await send(b,c);
    const original=await data(a),ea=original.expenses[0],ec=(await data(c)).expenses[0];
    await a.repo.command(s=>s.saveExpense({...ea,categoryId:"expense-category-0"},ea));
    await c.repo.command(s=>s.saveExpense({...ec,status:"excluded"},ec));
    await send(a,b,false);await send(c,b);
    const cf=await conflict(b,"expenses/"+encodeURIComponent(ea.id)),req:FinancialDecisionRequest={
      id:crypto.randomUUID(),conflictId:cf.id,token:cf.token,rationale:"Synthetic bank decision",
      intent:{kind:"expense",basisOperationId:cf.remote[0].operationId,amountCents:1000,
        categoryId:"expense-category-0",status:"approved"}};
    await b.repo.resolveFinancialSyncConflict(req);await send(b,a);await send(b,c);
    for(const r of [a,b,c]) {
      const d=await data(r);expect(d.expenses).toHaveLength(1);
      expect(d.expenses[0]).toMatchObject({amountCents:1000,status:"approved",categoryId:"expense-category-0",origin:ea.origin});
      expect(d.expenseImports).toEqual(original.expenseImports);
      expect((await evidence(r,req.id)).sources).toHaveLength(2);
    }
  },30000);
  it("refuses generic profile reconciliation and retains the original CSV settings conflict",async()=>{
    const {a,b,c}=await base(),options=defaultOptions();
    options.mapping={...options.mapping,date:0,amount:1,counterparty:2,description:3};
    await a.repo.command(s=>s.saveExpenseProfile({id:"profile",name:"Synthetic bank",headers:[],options,
      archived:false,revision:1,createdAt:0,updatedAt:0},null));
    await send(a,b);await send(b,c);
    const pa=(await data(a)).expenseProfiles[0],pc=(await data(c)).expenseProfiles[0];
    await a.repo.command(s=>s.saveExpenseProfile({...pa,name:"Synthetic A"},pa));
    await c.repo.command(s=>s.saveExpenseProfile({...pc,name:"Synthetic C"},pc));
    await send(a,b,false);await send(c,b);await restart(b);
    const cf=await conflict(b,"expenseProfiles/profile"),before=await b.repo.read();
    await expect(b.repo.resolveFinancialSyncConflict({id:crypto.randomUUID(),conflictId:cf.id,token:cf.token,
      rationale:"Must not reconcile account identity",intent:{kind:"expense",basisOperationId:cf.remote[0].operationId,
        amountCents:1,categoryId:otherCategory,status:"approved"}})).rejects.toThrow(/onboardingu|adaptera/);
    expect(await b.repo.read()).toEqual(before);
    expect((await b.repo.readSyncReceiver())!.conflicts.find(c=>c.id===cf.id)?.status).toBe("open");
  });

  it.each(["time-base","approval-source","expense-audit"] as const)("cannot bless an intrinsically shaped but invalid source transition (%s)",async variant=>{
    const {a,b,c}=await base();
    let key="visits/visit";
    if(variant==="approval-source") {
      await a.repo.command(s=>s.completeJob("visit"));await send(a,b);await send(b,c);
    }
    if(variant==="expense-audit") {
      key="expenses/guarded";
      const e:Expense={id:"guarded",revision:1,createdAt:0,updatedAt:0,date:"2026-11-23",amountCents:1000,
        direction:"outgoing",counterparty:"Synthetic",description:"Synthetic",categoryId:otherCategory,
        source:"manual",origin:null,status:"approved",note:"",history:[]};
      await a.repo.command(s=>s.saveExpense(e,null));await send(a,b);await send(b,c);
    }
    const before=businessRecords(await data(a)).get(key)!,after=structuredClone(before) as any;
    if(variant==="time-base") {
      after.job.seconds=7200;after.job.timeHistory=[{id:"invalid-source-event",kind:"corrected",at:1,
        beforeSeconds:999,afterSeconds:7200,pauseDurationMs:null}];
      await c.repo.command(s=>s.correctJobTime("visit",9000,3600));
    } else if(variant==="approval-source") {
      after.job.settlement={calculatedLaborCents:0,suggestedLaborCents:10000,materialsCents:0,
        finalLaborCents:25000,approvedAt:1,source:"manual"};
      await c.repo.command(s=>s.approveSettlement("visit",30000,"manual"));
    } else {
      after.amountCents=1200;after.revision++;after.updatedAt++;
      const e=(await data(c)).expenses[0];await c.repo.command(s=>s.saveExpense({...e,amountCents:1300},e));
    }
    const source=appendLocal((await a.repo.readSyncJournal())!.log,[{key,before,after}]).operation!;
    await b.repo.receiveSyncOperations([source]);await send(c,b,false);
    const cf=await conflict(b,key),original=await b.repo.read();
    const req=variant==="expense-audit"?{id:crypto.randomUUID(),conflictId:cf.id,token:cf.token,rationale:"Must not bless invalid audit",
      intent:{kind:"expense" as const,basisOperationId:cf.remote[0].operationId,amountCents:1100,categoryId:otherCategory,status:"approved" as const}}:
      request(cf,variant==="time-base"?{time:{kind:"seconds",seconds:8000}}:{});
    const expected=variant==="time-base"?"VISIT_TIME_BASE":variant==="approval-source"?"VISIT_APPROVAL":"FINANCIAL_EXPENSE_AUDIT";
    await expect(b.repo.resolveFinancialSyncConflict(req)).rejects.toThrow(expected);
    expect(await b.repo.read()).toEqual(original);
    expect((await b.repo.readSyncJournal())!.log.operations.find(o=>o.id===source.id)).toEqual(source);
  });

  it("does not require synchronized device clocks to record an expense decision",async()=>{
    const {a,b,c}=await base();
    const e:Expense={id:"clock",revision:1,createdAt:0,updatedAt:0,date:"2026-11-23",amountCents:1000,
      direction:"outgoing",counterparty:"Synthetic",description:"Synthetic",categoryId:otherCategory,
      source:"manual",origin:null,status:"approved",note:"",history:[]};
    await a.repo.command(s=>s.saveExpense(e,null),()=>5000);await send(a,b);await send(b,c);
    const ea=(await data(a)).expenses[0],ec=(await data(c)).expenses[0];
    await a.repo.command(s=>s.saveExpense({...ea,amountCents:1200},ea),()=>6000);
    await c.repo.command(s=>s.saveExpense({...ec,status:"excluded"},ec),()=>7000);
    await send(a,b,false);await send(c,b);
    const cf=await conflict(b,"expenses/clock"),req:FinancialDecisionRequest={id:crypto.randomUUID(),
      conflictId:cf.id,token:cf.token,rationale:"Synthetic clock-independent result",
      intent:{kind:"expense",basisOperationId:cf.remote[0].operationId,amountCents:1100,categoryId:otherCategory,status:"approved"}};
    const clock=vi.spyOn(Date,"now").mockReturnValue(0);
    await b.repo.resolveFinancialSyncConflict(req);clock.mockRestore();await send(b,a);await send(b,c);
    for(const r of [a,b,c]) {
      expect((await data(r)).expenses[0]).toMatchObject({amountCents:1100,createdAt:5000,updatedAt:5000});
      expect((await evidence(r,req.id)).at).toBe(0);validateData(await data(r));
    }
  });

});
