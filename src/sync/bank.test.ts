import { afterEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { AtomicRepository } from "../data/atomic";
import { createDemoData } from "../data/demo";
import { STORAGE_KEY, validateData } from "../data/repository";
import type { Data } from "../domain";
import { defaultOptions, otherCategory, reviewRows, rowIdentity, rulesKey, type BankRow, type ExpenseProfile } from "../expenses/model";
import { appendLocal } from "./causal";
import { RECEIVER_KEY } from "./receiver-model";
import { JOURNAL_SOURCE } from "./journal";
import type { Json, Operation } from "./model";
import { prepareTransfer, TransferAssembler } from "./packets";

const origins=["11111111-1111-4111-8111-111111111111","22222222-2222-4222-8222-222222222222","33333333-3333-4333-8333-333333333333"];
class MemoryStorage {
  rows=new Map<string,string>();
  getItem(key:string){return this.rows.get(key)??null;}
  setItem(key:string,value:string){this.rows.set(key,value);}
}
async function replica(n:number,active=true) {
  const factory=new IDBFactory(),storage=new MemoryStorage(),data=createDemoData(new Date("2026-11-22T12:00:00Z"));
  data.jobs[0].status="in-progress";data.timer={jobId:"job-1",startedAt:1000+n,paused:false};
  data.payments.push({id:"existing-payment",jobId:"job-5",amountCents:100,receivedDate:"2026-11-22",method:"cash",note:"Synthetic"});
  validateData(data);storage.setItem(STORAGE_KEY,JSON.stringify({version:12,data}));
  const name="csv-independent-"+n,repo=new AtomicRepository(storage,factory,name);await repo.initialize();
  if(active)await repo.enableSyncJournal(origins[n]);
  return {n,repo,factory,storage,name,initial:data};
}
type Replica=Awaited<ReturnType<typeof replica>>;
async function restart(r:Replica) {await r.repo.close();r.repo=new AtomicRepository(r.storage,r.factory,r.name);await r.repo.initialize();}
async function deliver(b:Replica,operations:Operation[],apply=true) {
  const received=await b.repo.receiveSyncOperations(operations),plan=await b.repo.planSyncOperations();
  const committed=apply&&plan.plan?await b.repo.applySyncPlan(plan.plan.id):null;
  return {received,plan,committed};
}
async function send(a:Replica,b:Replica,apply=true) {
  if([a.n,b.n].sort().join("")==="02")throw Error("A and C must never communicate directly");
  const source=(await a.repo.readSyncJournal())!,peer=(await b.repo.readSyncJournal())!;
  const t=await prepareTransfer(source,peer.log.known),parser=new TransferAssembler(t.offer);
  for(const c of [...t.chunks].reverse())parser.accept(c);
  return deliver(b,(await parser.finish()).operations,apply);
}
async function exchange(a:Replica,b:Replica) {await send(a,b);await send(b,a);}
function profile(id="profile-main",name="Synthetic bank"):ExpenseProfile {
  const options=defaultOptions();options.mapping={...options.mapping,date:0,amount:1,counterparty:2,description:3,transactionId:4};
  return {id,name,headers:["date","amount","party","description","id"],options,archived:false,revision:1,createdAt:0,updatedAt:0};
}
async function addProfile(r:Replica,id="profile-main",name="Synthetic bank") {await r.repo.command(s=>s.saveExpenseProfile(profile(id,name),null));}
const row=(patch:Partial<BankRow>={}):BankRow=>({line:2,date:"2026-11-22",signedCents:-12345,counterparty:"Synthetic vendor",description:"Synthetic statement",transactionId:"synthetic-tx-1",occurrence:1,...patch});
interface Input {profileId?:string;categoryId?:string;statement?:string;file?:string;rows?:{line:number;row:BankRow|null;error:string}[];statuses?:("approved"|"excluded")[];skip?:number[];separate?:boolean}
async function importCsv(r:Replica,id="import-main",opts:Input={}) {
  const data=(await r.repo.read()).data,p=data.expenseProfiles.find(p=>p.id===(opts.profileId??"profile-main"))!;
  const statementKey=opts.statement??"a".repeat(64),fileHash=opts.file??"b".repeat(64);
  const reviewed=reviewRows(data,p.id,statementKey,opts.rows??[{line:2,row:row(),error:""}]);
  await r.repo.command(s=>s.importExpenses({id,profile:p,rulesKey:rulesKey(data),statementKey,fileHash,filename:"synthetic.csv",
    requestKey:"c".repeat(64),rows:reviewed.map((v,i)=>({...v,selected:!(opts.skip??[]).includes(i),status:opts.statuses?.[i]??"approved",categoryId:opts.categoryId??v.categoryId,separate:opts.separate??false}))}));
  return (await r.repo.readSyncJournal())?.log.operations.at(-1);
}
const cost=(data:Data)=>data.expenses.filter(e=>e.direction==="outgoing"&&e.status==="approved").reduce((n,e)=>n+e.amountCents,0);
async function checkProtected(r:Replica) {
  const d=(await r.repo.read()).data;
  for(const key of ["jobs","payments","timer","photos","reportSequence","settings"] as const)expect(d[key]).toEqual(r.initial[key]);
  expect(JSON.parse(r.storage.getItem(STORAGE_KEY)!).version).toBe(12);
}
async function stage(r:Replica,o:Operation) {return (await r.repo.readSyncReceiver())!.receipts.find(v=>v.operation.id===o.id)!;}
async function raw(r:Replica,key:string) {
  const db=await new Promise<IDBDatabase>(ok=>{const q=r.factory.open(r.name);q.onsuccess=()=>ok(q.result);});
  const value=await new Promise<unknown>((ok,no)=>{const t=db.transaction("sync"),q=t.objectStore("sync").get(key);t.oncomplete=()=>ok(q.result);t.onabort=()=>no(t.error);});
  db.close();return value;
}
afterEach(()=>vi.restoreAllMocks());
describe("GM-011B 5b CSV, three independent durable IndexedDB stores",()=>{
  it("A -> B -> C preserves the import, origin, histories, settings and integer costs; replay creates no copies",async()=>{
    const a=await replica(0),b=await replica(1),c=await replica(2);
    await addProfile(a);const original=(await importCsv(a))!;await send(a,b);await send(b,c);
    const data=(await a.repo.read()).data;
    for(const r of [b,c]) {
      const d=(await r.repo.read()).data;
      expect(d.expenseProfiles).toEqual(data.expenseProfiles);expect(d.expenseImports).toEqual(data.expenseImports);
      expect(d.expenses).toEqual(data.expenses);expect(cost(d)).toBe(12345);
      expect((await r.repo.readSyncJournal())!.log.operations.find(o=>o.id===original.id)).toEqual(original);
      expect((await stage(r,original)).stage).toBe("applied");await checkProtected(r);
    }
    for(let i=0;i<3;i++){await exchange(a,b);await exchange(b,c);}
    for(const r of [a,b,c]) {
      const d=(await r.repo.read()).data;expect(d.expenses).toHaveLength(1);expect(d.expenseImports).toHaveLength(1);expect(cost(d)).toBe(12345);
    }
  },30000);
  it("records duplicate-only re-import history without copying or changing the original expense",async()=>{
    const a=await replica(0),b=await replica(1);await addProfile(a);await importCsv(a);
    const original=(await a.repo.read()).data.expenses[0];await send(a,b);
    await importCsv(a,"second-import");await send(a,b);
    const d=(await b.repo.read()).data;
    expect(d.expenses).toEqual([original]);expect(d.expenseImports).toHaveLength(2);
    expect(d.expenseImports[1]).toMatchObject({duplicates:1,approved:0});
    expect(d.expenseImports[1].rows[0].expenseId).toBe(original.id);expect(cost(d)).toBe(12345);
  });
  it("retains approvals, exclusions, incoming transfers, errors, skipped rows and within-file duplicates",async()=>{
    const a=await replica(0),b=await replica(1);await addProfile(a);
    await importCsv(a,"audit",{rows:[
      {line:2,row:row(),error:""},{line:3,row:row({line:3}),error:""},
      {line:4,row:row({line:4,signedCents:1000,transactionId:"income"}),error:""},
      {line:5,row:row({line:5,signedCents:-500,transactionId:"excluded"}),error:""},
      {line:6,row:row({line:6,transactionId:"skip"}),error:""},{line:7,row:null,error:"Synthetic parse error"},
    ],statuses:["approved","approved","approved","excluded","approved","approved"],skip:[4]});
    await send(a,b);
    const actual=(await b.repo.read()).data,expected=(await a.repo.read()).data;
    expect(actual.expenseImports).toEqual(expected.expenseImports);expect(actual.expenses).toEqual(expected.expenses);
    expect(actual.expenseImports[0]).toMatchObject({approved:1,excluded:2,duplicates:1,skipped:1,errors:1});
    expect(cost(actual)).toBe(12345);await checkProtected(b);
  });
  it("keeps similarly named independent profiles distinct and holds cross-profile imports durably",async()=>{
    const a=await replica(0),b=await replica(1);
    await addProfile(a,"home-profile","Bank");await addProfile(b,"phone-profile","Bank");
    await importCsv(a,"home-import",{profileId:"home-profile"});await importCsv(b,"phone-import",{profileId:"phone-profile"});
    const ownA=(await a.repo.read()).data.expenses,ownB=(await b.repo.read()).data.expenses;
    await exchange(a,b);await restart(a);await restart(b);
    for(const r of [a,b]) {
      const d=(await r.repo.read()).data;
      expect(d.expenseProfiles.map(p=>p.id).sort()).toEqual(["home-profile","phone-profile"]);
      expect(d.expenses).toEqual(r===a?ownA:ownB);expect(cost(d)).toBe(12345);
      expect((await r.repo.readSyncReceiver())!.receipts.some(v=>v.stage==="blocked"&&v.reason.includes("CSV_PROFILE_SCOPE"))).toBe(true);
    }
  });
  it("does not double-count the same statement independently imported under a shared profile",async()=>{
    const a=await replica(0),b=await replica(1);await addProfile(a);await exchange(a,b);
    await importCsv(a,"independent-a");await importCsv(b,"independent-b");
    await exchange(a,b);await restart(b);
    for(const r of [a,b]) {
      const d=(await r.repo.read()).data;expect(d.expenses).toHaveLength(1);expect(d.expenseImports).toHaveLength(1);expect(cost(d)).toBe(12345);
      expect((await r.repo.readSyncReceiver())!.receipts.some(v=>v.stage==="blocked"&&v.reason.includes("CSV_DUPLICATE_IDENTITY"))).toBe(true);
    }
  });
  it("protects a received ledger against a new local import through an unverified second profile",async()=>{
    const a=await replica(0),b=await replica(1);await addProfile(a);await importCsv(a);await send(a,b);
    await addProfile(b,"other-profile","Synthetic bank");
    const before=await b.repo.read(),journal=await b.repo.readSyncJournal(),mirror=b.storage.getItem(STORAGE_KEY);
    await expect(importCsv(b,"wrong-scope",{profileId:"other-profile"})).rejects.toThrow("CSV_PROFILE_SCOPE");
    expect(await b.repo.read()).toEqual(before);expect(await b.repo.readSyncJournal()).toEqual(journal);
    expect(b.storage.getItem(STORAGE_KEY)).toBe(mirror);
  });
  it("keeps category and approval/exclusion conflicts as entire audited records after restart",async()=>{
    for(const type of ["category","status"] as const) {
      const a=await replica(0),b=await replica(1);await addProfile(a);await importCsv(a,"conflict",{statuses:["excluded"]});await exchange(a,b);
      for(const [r,index] of [[a,0],[b,1]] as const) {
        const e=(await r.repo.read()).data.expenses[0];
        await r.repo.command(s=>s.saveExpense({...e,categoryId:type==="category"?"expense-category-"+index:e.categoryId,
          status:type==="status"&&index===0?"approved":"excluded",note:"Synthetic decision "+index},e));
      }
      await exchange(a,b);await restart(b);
      const receiver=(await b.repo.readSyncReceiver())!,conflict=receiver.conflicts.find(c=>c.key==="expenses/conflict-2"&&c.status==="open")!;
      expect(conflict).toBeDefined();expect(conflict.baseAvailable).toBe(true);
      expect((await b.repo.read()).data.expenses[0].history).toHaveLength(2);
      expect((await b.repo.read()).data.expenseImports[0].rows[0].decision).toBe("excluded");
      const before=await b.repo.read();
      await expect(b.repo.resolveSyncConflict({conflictId:conflict.id,token:conflict.token,choice:{kind:"local"}})).rejects.toThrow("Nieobsługiwana");
      expect(await b.repo.read()).toEqual(before);await checkProtected(b);
    }
  },30000);
  it("keeps parallel profile mappings and classification rules in durable conflicts without reclassifying history",async()=>{
    const a=await replica(0),b=await replica(1);await addProfile(a);
    await a.repo.command(s=>s.saveExpenseRule({id:"shared-rule",revision:1,createdAt:0,updatedAt:0,name:"Synthetic",
      field:"any",pattern:"Synthetic",categoryId:otherCategory,action:"category",enabled:true,priority:1},null));
    await importCsv(a);await exchange(a,b);
    const histories=(await b.repo.read()).data.expenseImports,expenses=(await b.repo.read()).data.expenses;
    for(const [r,n] of [[a,0],[b,1]] as const) {
      const d=(await r.repo.read()).data,p=d.expenseProfiles[0],rule=d.expenseRules.find(v=>v.id==="shared-rule")!;
      await r.repo.command(s=>{
        s.saveExpenseProfile({...p,options:{...p.options,delimiter:n===0?",":"|"}},p);
        s.saveExpenseRule({...rule,pattern:n===0?"First":"Second"},rule);
      });
    }
    await send(a,b);await restart(b);
    const keys=(await b.repo.readSyncReceiver())!.conflicts.filter(c=>c.status==="open").map(c=>c.key);
    expect(keys).toContain("expenseProfiles/profile-main");expect(keys).toContain("expenseRules/shared-rule");
    expect((await b.repo.read()).data.expenseImports).toEqual(histories);expect((await b.repo.read()).data.expenses).toEqual(expenses);
  });
  it("waits for missing causal dependencies, survives restart and accepts reverse delivery without rollback",async()=>{
    const a=await replica(0),b=await replica(1);await addProfile(a);const created=(await importCsv(a))!;
    const e=(await a.repo.read()).data.expenses[0];await a.repo.command(s=>s.saveExpense({...e,status:"excluded",note:"Synthetic later"},e));
    const latest=(await a.repo.readSyncJournal())!.log.operations.at(-1)!;
    await b.repo.receiveSyncOperations([latest]);await restart(b);
    expect((await stage(b,latest)).stage).toBe("waiting-dependencies");expect((await b.repo.read()).data.expenses).toEqual([]);
    await deliver(b,[...(await a.repo.readSyncJournal())!.log.operations].reverse());
    const before=await b.repo.read();
    expect(before.data.expenses).toEqual((await a.repo.read()).data.expenses);
    await deliver(b,[created]);expect(await b.repo.read()).toEqual(before);expect(cost(before.data)).toBe(0);
  });
  it("never attaches to missing profile/category records merely because a later record reuses the ID",async()=>{
    for(const type of ["profile","category"] as const) {
      const a=await replica(0),b=await replica(1);await addProfile(a);const original=(await importCsv(a))!;
      const log=(await a.repo.readSyncJournal())!.log;
      await deliver(b,log.operations.filter(o=>o.id!==original.id));
      const bad=structuredClone(original);bad.id=crypto.randomUUID();bad.origin=origins[2];bad.sequence=1;
      for(const c of bad.changes) {
        if(c.key.startsWith("expenseImports/")&&type==="profile")(c.after as any).profileId="absent-profile";
        if(c.key.startsWith("expenses/")) {
          const e=c.after as any;
          if(type==="profile") {
            e.origin.profileId="absent-profile";const parts=JSON.parse(e.origin.match);
            e.origin.identity=rowIdentity("absent-profile",e.origin.statementKey,{...row(),date:parts[0],signedCents:parts[1],counterparty:parts[2],description:parts[3]});
          } else {e.categoryId="absent-category";e.history[0].categoryId="absent-category";}
        }
      }
      await deliver(b,[bad]);await restart(b);
      expect((await stage(b,bad)).stage).toBe("waiting-records");
      expect((await b.repo.read()).data.expenses).toEqual([]);expect((await b.repo.read()).data.expenseImports).toEqual([]);
    }
  });
  it("persists an unapplied import plan over restart; lost confirmation replay is idempotent",async()=>{
    const a=await replica(0),b=await replica(1);await addProfile(a);const op=(await importCsv(a))!;
    const result=await send(a,b,false),id=result.plan.plan!.id;
    expect((await b.repo.read()).data.expenses).toEqual([]);expect((await stage(b,op)).stage).toBe("planned");
    await restart(b);const done=await b.repo.applySyncPlan(id),after=await b.repo.read();
    await restart(b);expect(await b.repo.applySyncPlan(id)).toEqual(done);expect(await b.repo.read()).toEqual(after);
    expect(after.data.expenseImports).toHaveLength(1);expect(after.data.expenses).toHaveLength(1);
  });
  it("rolls back import, expense, journal and applied markers together on quota and safely retries",async()=>{
    const a=await replica(0),b=await replica(1);await addProfile(a);await importCsv(a);const result=await send(a,b,false);
    const before=await b.repo.read(),journal=await b.repo.readSyncJournal(),receiver=await b.repo.readSyncReceiver(),mirror=b.storage.getItem(STORAGE_KEY);
    const put=IDBObjectStore.prototype.put;
    const failure=vi.spyOn(IDBObjectStore.prototype,"put").mockImplementation(function(this:IDBObjectStore,value:unknown,key?:IDBValidKey) {
      if(this.name==="sync"&&key===RECEIVER_KEY)throw new DOMException("Synthetic CSV quota","QuotaExceededError");return put.call(this,value,key);
    });
    await expect(b.repo.applySyncPlan(result.plan.plan!.id)).rejects.toThrow();failure.mockRestore();
    expect(await b.repo.read()).toEqual(before);expect(await b.repo.readSyncJournal()).toEqual(journal);expect(await b.repo.readSyncReceiver()).toEqual(receiver);
    expect(b.storage.getItem(STORAGE_KEY)).toBe(mirror);await restart(b);await b.repo.applySyncPlan(result.plan.plan!.id);
    expect(cost((await b.repo.read()).data)).toBe(12345);await checkProtected(b);
  });
  it("groups preactivation CSV snapshots without rewriting an existing journal and orders duplicate-audit dependencies",async()=>{
    const a=await replica(0,false),b=await replica(1),c=await replica(2);await addProfile(a);await importCsv(a,"z-first");await importCsv(a,"a-later");
    const before=await a.repo.read(),j=await a.repo.enableSyncJournal(origins[0]);
    expect(await raw(a,JOURNAL_SOURCE)).toEqual(before);
    const first=j.log.operations.find(o=>o.changes.some(x=>x.key==="expenseImports/z-first"))!;
    expect(first.changes.map(x=>x.key).sort()).toEqual(["expenseImports/z-first","expenses/z-first-2"]);
    const later=j.log.operations.find(o=>o.changes.some(x=>x.key==="expenseImports/a-later"))!;
    expect(later.sequence).toBeGreaterThan(first.sequence);
    expect(await a.repo.enableSyncJournal()).toEqual(j);expect(await a.repo.read()).toEqual(before);
    await send(a,b);await send(b,c);
    for(const r of [b,c]) {
      const d=(await r.repo.read()).data;expect(d.expenses).toEqual(before.data.expenses);expect(d.expenseImports).toHaveLength(2);
      expect(cost(d)).toBe(12345);await checkProtected(r);
    }
  });
  it("keeps archived parent identities and original history without reactivating or reclassifying",async()=>{
    const a=await replica(0,false),b=await replica(1);await addProfile(a);
    await a.repo.command(s=>s.saveExpenseCategory({id:"historical-category",name:"Synthetic historical",archived:false,revision:1,createdAt:0,updatedAt:0},null));
    await importCsv(a,"import-main",{categoryId:"historical-category"});
    const d=(await a.repo.read()).data,p=d.expenseProfiles[0],cat=d.expenseCategories.find(c=>c.id==="historical-category")!;
    await a.repo.command(s=>{s.saveExpenseProfile({...p,archived:true},p);s.saveExpenseCategory({...cat,archived:true},cat);});
    const before=(await a.repo.read()).data;await a.repo.enableSyncJournal(origins[0]);await send(a,b);
    const actual=(await b.repo.read()).data;
    expect(actual.expenseProfiles).toEqual(before.expenseProfiles);expect(actual.expenses).toEqual(before.expenses);
    expect(actual.expenseImports).toEqual(before.expenseImports);expect(actual.expenseCategories.find(c=>c.id==="historical-category")?.archived).toBe(true);
  });
  it("does not overwrite an independent default category while adopting a historical import",async()=>{
    const a=await replica(0,false),b=await replica(1);await addProfile(a);await importCsv(a);
    const category=(await a.repo.read()).data.expenseCategories.find(c=>c.id===otherCategory)!;
    await a.repo.command(s=>s.saveExpenseCategory({...category,archived:true},category));
    await a.repo.enableSyncJournal(origins[0]);await send(a,b);await restart(b);
    const d=(await b.repo.read()).data,r=(await b.repo.readSyncReceiver())!;
    expect(d.expenseCategories.find(c=>c.id===otherCategory)?.archived).toBe(false);
    expect(d.expenses).toEqual([]);expect(d.expenseImports).toEqual([]);
    expect(r.conflicts.some(v=>v.key==="expenseCategories/"+otherCategory&&v.status==="open")).toBe(true);
    expect(r.receipts.some(v=>v.stage==="waiting-records"&&v.operation.changes.some(x=>x.key==="expenseImports/import-main"))).toBe(true);
  });
  it("keeps distinct occurrences in one no-ID statement but holds ambiguous rows from another statement",async()=>{
    const a=await replica(0),b=await replica(1);await addProfile(a);
    const base=row({transactionId:null});
    await importCsv(a,"no-id",{rows:[{line:2,row:base,error:""},{line:3,row:{...base,line:3,occurrence:2},error:""}]});await send(a,b);
    expect((await b.repo.read()).data.expenses).toHaveLength(2);expect(cost((await b.repo.read()).data)).toBe(24690);
    const next=(await importCsv(a,"ambiguous",{statement:"d".repeat(64),file:"e".repeat(64),rows:[{line:2,row:base,error:""}],separate:true}))!;
    await send(a,b);
    expect((await stage(b,next)).reason).toContain("CSV_AMBIGUOUS_ROW");
    expect((await b.repo.read()).data.expenses).toHaveLength(2);
  });
  it("rejects invalid mappings, counters and forged transaction identities without applying a fragment",async()=>{
    for(const type of ["mapping","counters","identity"] as const) {
      const a=await replica(0),b=await replica(1);await addProfile(a);const original=(await importCsv(a))!, log=(await a.repo.readSyncJournal())!.log;
      if(type==="mapping") {
        const op=structuredClone(log.operations.find(o=>o.changes.some(x=>x.key==="expenseProfiles/profile-main"))!);
        (op.changes.find(x=>x.key==="expenseProfiles/profile-main")!.after as any).options.mapping.amount=999;
        await b.repo.receiveSyncOperations(log.operations.filter(o=>o.sequence<op.sequence));
        expect((await b.repo.receiveSyncOperations([op])).rejected).toHaveLength(1);
      } else {
        await deliver(b,log.operations.filter(o=>o.id!==original.id));const op=structuredClone(original);
        if(type==="counters")(op.changes.find(x=>x.key.startsWith("expenseImports/"))!.after as any).approved=999;
        else(op.changes.find(x=>x.key.startsWith("expenses/"))!.after as any).origin.identity="forged-synthetic";
        expect((await b.repo.receiveSyncOperations([op])).rejected).toHaveLength(1);
      }
      expect((await b.repo.read()).data.expenses).toEqual([]);expect((await b.repo.read()).data.expenseImports).toEqual([]);
      await checkProtected(b);
    }
  });
  it("blocks orphan CSV expense fragments, modified import audits and financial deletions",async()=>{
    const a=await replica(0),b=await replica(1);await addProfile(a);const original=(await importCsv(a))!,log=(await a.repo.readSyncJournal())!.log;
    await deliver(b,log.operations.filter(o=>o.id!==original.id));
    const orphan={...structuredClone(original),changes:original.changes.filter(x=>x.key.startsWith("expenses/"))};
    await deliver(b,[orphan]);expect((await stage(b,orphan)).reason).toContain("CSV_ATOMIC_GROUP");expect((await b.repo.read()).data.expenses).toEqual([]);
    const c=await replica(1);await send(a,c);
    const i=(await a.repo.read()).data.expenseImports[0];
    const edited=appendLocal(log,[{key:"expenseImports/import-main",before:i as unknown as Json,after:{...i,filename:"Changed.csv"} as unknown as Json}]).operation!;
    await deliver(c,[edited]);expect((await stage(c,edited)).reason).toContain("CSV_AUDIT_IMMUTABLE");
    const d=await replica(1);await send(a,d);
    const deleted=appendLocal(log,[{key:"expenseProfiles/profile-main",before:(await a.repo.read()).data.expenseProfiles[0] as unknown as Json,after:null}]).operation!;
    await deliver(d,[deleted]);expect((await stage(d,deleted)).stage).toBe("blocked");expect((await d.repo.read()).data.expenseImports).toHaveLength(1);
  });
  it("keeps distinct bank IDs separate despite equal date, amount, counterparty and description",async()=>{
    const a=await replica(0),b=await replica(1);await addProfile(a);await importCsv(a,"first");
    await importCsv(a,"distinct",{statement:"d".repeat(64),file:"e".repeat(64),
      rows:[{line:2,row:row({transactionId:"a-different-bank-id"}),error:""}]});
    await send(a,b);
    const d=(await b.repo.read()).data;expect(d.expenses).toHaveLength(2);expect(cost(d)).toBe(24690);
    expect(new Set(d.expenses.map(e=>e.origin!.identity)).size).toBe(2);
  });
  it("blocks an ID-column upgrade that would give a previously ID-less transaction a second identity",async()=>{
    const a=await replica(0),b=await replica(1);await addProfile(a);
    await importCsv(a,"id-less",{rows:[{line:2,row:row({transactionId:null}),error:""}]});await send(a,b);
    const before=await a.repo.read(),journal=await a.repo.readSyncJournal();
    await expect(importCsv(a,"new-identity",{statement:"d".repeat(64),file:"e".repeat(64)})).rejects.toThrow("CSV_AMBIGUOUS_ROW");
    expect(await a.repo.read()).toEqual(before);expect(await a.repo.readSyncJournal()).toEqual(journal);
    expect(cost((await b.repo.read()).data)).toBe(12345);
  });
  it("validates occurrence ordinals and the original incoming-transfer exclusion inside the atomic candidate",async()=>{
    for(const type of ["occurrence","incoming"] as const) {
      const a=await replica(0),b=await replica(1);await addProfile(a);
      const op=(await importCsv(a,"integrity",type==="incoming"?{rows:[{line:2,row:row({signedCents:1000}),error:""}]}:{}))!;
      await deliver(b,(await a.repo.readSyncJournal())!.log.operations.filter(o=>o.id!==op.id));
      const bad=structuredClone(op),e=bad.changes.find(c=>c.key.startsWith("expenses/"))!.after as any;
      if(type==="occurrence")e.origin.occurrence=999;
      else {
        const audit=bad.changes.find(c=>c.key.startsWith("expenseImports/"))!.after as any;
        audit.approved=1;audit.excluded=0;audit.rows[0].decision="approved";
        e.history=[{...e.history[0],status:"approved"},e.history[0]];e.revision=2;
      }
      await deliver(b,[bad]);expect((await stage(b,bad)).stage).toBe("blocked");
      expect((await stage(b,bad)).reason).toContain(type==="occurrence"?"CSV_OCCURRENCE":"CSV_LINK");
      expect((await b.repo.read()).data.expenses).toEqual([]);expect((await b.repo.read()).data.expenseImports).toEqual([]);
      await checkProtected(b);
    }
  });

});
