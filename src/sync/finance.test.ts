import { afterEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { AtomicRepository } from "../data/atomic";
import { createDemoData } from "../data/demo";
import { STORAGE_KEY, validateData } from "../data/repository";
import type { Client, Data } from "../domain";
import { appendLocal } from "./causal";
import { businessRecords } from "./records";
import { newShoppingItem } from "../shopping/model";
import { defaultOptions, otherCategory, reviewRows, rulesKey, type Expense } from "../expenses/model";
import type { Json } from "./model";
import { RECEIVER_KEY } from "./receiver-model";
import { prepareTransfer, TransferAssembler } from "./packets";

const origins=["11111111-1111-4111-8111-111111111111","22222222-2222-4222-8222-222222222222","33333333-3333-4333-8333-333333333333"];
class Storage {
  rows=new Map<string,string>();
  getItem(k:string){return this.rows.get(k)??null;}
  setItem(k:string,v:string){this.rows.set(k,v);}
}
async function replica(n:number, mutate?:(data:Data)=>void) {
  const factory=new IDBFactory(), storage=new Storage(), data=createDemoData(new Date("2026-11-22T12:00:00Z"));
  mutate?.(data); validateData(data);
  storage.setItem(STORAGE_KEY,JSON.stringify({version:12,data}));
  const name="durable-replica-"+n;
  const repo=new AtomicRepository(storage,factory,name); await repo.initialize(); await repo.enableSyncJournal(origins[n]);
  return {repo,storage,factory,name,initial:data};
}
type Replica=Awaited<ReturnType<typeof replica>>;
async function restart(r:Replica) {
  await r.repo.close(); r.repo=new AtomicRepository(r.storage,r.factory,r.name); await r.repo.initialize();
}
async function client(r:Replica,id:string,patch:Partial<Client>={}) {
  const prior=(await r.repo.read()).data.clients.find(c=>c.id===id);
  const base=prior??{id,name:"Synthetic "+id,phone:"",email:"",notes:""};
  await r.repo.command(s=>s.saveClient({...base,...patch,id},prior??null));
}
async function send(a:Replica,b:Replica,apply=true) {
  const j=(await a.repo.readSyncJournal())!, peer=(await b.repo.readSyncJournal())!;
  const transfer=await prepareTransfer(j,peer.log.known), parser=new TransferAssembler(transfer.offer);
  for(const chunk of [...transfer.chunks].reverse()) parser.accept(chunk);
  const bundle=await parser.finish();
  await b.repo.receiveSyncOperations(bundle.operations);
  const plan=await b.repo.planSyncOperations();
  if(apply && plan.plan) await b.repo.applySyncPlan(plan.plan.id);
  return plan;
}
async function exchange(a:Replica,b:Replica) {await send(a,b);await send(b,a);}
async function row(r:Replica,id:string) {return (await r.repo.read()).data.clients.find(c=>c.id===id);}
afterEach(()=>vi.restoreAllMocks());


const expense=(id:string,amountCents=12345):Expense=>({
  id,revision:1,createdAt:0,updatedAt:0,date:"2026-11-22",amountCents,direction:"outgoing",
  counterparty:"Synthetic vendor",description:"Synthetic purchase",categoryId:otherCategory,
  source:"manual",origin:null,status:"approved",note:"Synthetic",history:[],
});
async function pay(r:Replica,id:string,amountCents=1000) {
  await r.repo.command(s=>s.savePayment({id,jobId:"job-5",amountCents,receivedDate:"2026-11-22",method:"cash",note:"Synthetic"},null));
}
async function inject(a:Replica,b:Replica,key:string,after:Json) {
  const j=(await a.repo.readSyncJournal())!, before=businessRecords((await a.repo.read()).data).get(key)??null;
  const o=appendLocal(j.log,[{key,before,after}]).operation!;
  await b.repo.receiveSyncOperations([o]);
  const p=await b.repo.planSyncOperations();
  if(p.plan) await b.repo.applySyncPlan(p.plan.id);
  return (await b.repo.readSyncReceiver())!.receipts.find(r=>r.operation.id===o.id)!;
}
describe("GM-011B bounded financial units in independent durable stores",()=>{
  it("relays independent client, purchase and expense A-B-C without duplicate money or rewritten origins",async()=>{
    const a=await replica(0),b=await replica(1),c=await replica(2);
    await client(a,"money-client");
    await b.repo.command(s=>s.saveShoppingItem({...newShoppingItem("Synthetic tool"),id:"shopping-b"},null));
    await exchange(a,b);
    await c.repo.command(s=>s.saveExpense(expense("expense-c"),null));
    const original=(await c.repo.readSyncJournal())!.log.operations.at(-1)!;
    await exchange(b,c);await exchange(a,b);
    for(let n=0;n<2;n++){await exchange(b,c);await exchange(a,b);}
    for(const r of [a,b,c]) {
      const d=(await r.repo.read()).data;
      expect(d.clients.some(x=>x.id==="money-client")).toBe(true);
      expect(d.shoppingItems.filter(x=>x.id==="shopping-b")).toHaveLength(1);
      expect(d.expenses.filter(x=>x.id==="expense-c")).toHaveLength(1);
      expect(d.expenses.reduce((n,e)=>n+e.amountCents,0)).toBe(12345);
      expect((await r.repo.readSyncJournal())!.log.operations.find(o=>o.id===original.id)).toEqual(original);
      expect(d.jobs).toEqual(r.initial.jobs);expect(d.timer).toEqual(r.initial.timer);
    }
  },30000);
  it("preserves sequential manual expense history, categories and amounts across restart",async()=>{
    const a=await replica(0),b=await replica(1);
    await a.repo.command(s=>{
      s.saveExpenseCategory({id:"new-category",name:"Synthetic category",archived:false,revision:1,createdAt:0,updatedAt:0},null);
      s.saveExpense({...expense("manual"),categoryId:"new-category"},null);
    });
    await send(a,b);
    const old=(await a.repo.read()).data.expenses.find(e=>e.id==="manual")!;
    await a.repo.command(s=>s.saveExpense({...old,amountCents:15001,note:"Synthetic correction"},old));
    await send(a,b);await restart(b);
    const actual=(await b.repo.read()).data.expenses.find(e=>e.id==="manual")!;
    expect(actual).toEqual((await a.repo.read()).data.expenses.find(e=>e.id==="manual"));
    expect(actual.history).toHaveLength(2);expect(actual.history[0].amountCents).toBe(12345);
    expect(actual.amountCents).toBe(15001);
  });
  it("makes purchase + new expense atomic, preserves its link on replay and creates no automatic expense",async()=>{
    const a=await replica(0),b=await replica(1),c=await replica(2);
    await a.repo.command(s=>s.saveShoppingItem({...newShoppingItem("Synthetic purchase"),id:"linked"},null));
    await a.repo.command(s=>s.shoppingAction("linked",1,"purchased"));
    await send(a,b);expect((await b.repo.read()).data.expenses).toEqual([]);
    await a.repo.command(s=>s.createShoppingExpense("linked",2,expense("linked-expense",3300)));
    const source=(await a.repo.readSyncJournal())!.log.operations.at(-1)!;
    await send(a,b,false);await restart(b);
    expect((await b.repo.read()).data.expenses).toEqual([]);
    expect((await b.repo.read()).data.shoppingItems.find(x=>x.id==="linked")!.expenseId).toBeNull();
    const p=(await b.repo.readSyncReceiver())!.plan!;await b.repo.applySyncPlan(p.id);
    await send(b,c);await exchange(a,b);await exchange(b,c);
    for(const r of [a,b,c]) {
      const d=(await r.repo.read()).data;
      expect(d.shoppingItems.find(x=>x.id==="linked")!.expenseId).toBe("linked-expense");
      expect(d.expenses.filter(e=>e.id==="linked-expense")).toHaveLength(1);
      expect(d.expenses.reduce((n,e)=>n+e.amountCents,0)).toBe(3300);
      expect((await r.repo.readSyncJournal())!.log.operations.find(o=>o.id===source.id)).toEqual(source);
    }
  },30000);
  it("links an existing expense, keeps ordered items and propagates soft deletion without resurrection",async()=>{
    const a=await replica(0),b=await replica(1);
    await a.repo.command(s=>s.saveExpense(expense("existing"),null));
    await a.repo.command(s=>s.saveShoppingItem({...newShoppingItem("Synthetic"),id:"repeat"},null));
    await a.repo.command(s=>s.shoppingAction("repeat",1,"ordered"));await send(a,b);
    expect((await b.repo.read()).data.shoppingItems.find(x=>x.id==="repeat")!.status).toBe("ordered");
    await a.repo.command(s=>s.shoppingAction("repeat",2,"purchased"));
    await a.repo.command(s=>s.linkShoppingExpense("repeat",3,"existing",1));await send(a,b);
    expect((await b.repo.read()).data.expenses).toHaveLength(1);
    await a.repo.command(s=>s.shoppingAction("repeat",4,"delete"));await send(a,b);await send(b,a);
    for(const r of [a,b]) {
      const d=(await r.repo.read()).data;
      expect(d.shoppingItems.find(x=>x.id==="repeat")!.deletedAt).not.toBeNull();
      expect(d.shoppingItems.find(x=>x.id==="repeat")!.expenseId).toBe("existing");
      expect(d.expenses).toHaveLength(1);
    }
  });
  it("appends stable payment IDs to an unchanged approved visit and never changes time or settlements",async()=>{
    const a=await replica(0),b=await replica(1),c=await replica(2);await exchange(a,b);
    await pay(a,"payment-a");await send(a,b);await send(b,c);await restart(c);
    await pay(c,"payment-c",2000);await send(c,b);await send(b,a);
    for(let n=0;n<2;n++){await exchange(a,b);await exchange(b,c);}
    for(const r of [a,b,c]) {
      const d=(await r.repo.read()).data;
      expect(d.payments.map(p=>p.id).sort()).toEqual(["payment-a","payment-c"]);
      expect(d.payments.reduce((n,p)=>n+p.amountCents,0)).toBe(3000);
      expect(d.jobs).toEqual(r.initial.jobs);expect(d.timer).toEqual(r.initial.timer);
    }
  },30000);
  it("keeps concurrent payments as a durable whole-visit conflict instead of combining money",async()=>{
    const a=await replica(0),b=await replica(1);await exchange(a,b);
    await pay(a,"payment-a");await pay(b,"payment-b");await send(a,b);await restart(b);
    const d=(await b.repo.read()).data;
    expect(d.payments.map(p=>p.id)).toEqual(["payment-b"]);
    const conflict=(await b.repo.readSyncReceiver())!.conflicts.find(c=>c.key==="visits/job-5"&&c.status==="open")!;
    expect(conflict).toBeDefined();
    await expect(b.repo.resolveSyncConflict({conflictId:conflict.id,token:conflict.token,choice:{kind:"local"}})).rejects.toThrow("Nieobsługiwana");
    expect((await b.repo.read()).data).toEqual(d);
  });
  it("keeps concurrent expense edits and their local histories; remote resolution cannot bypass the gate",async()=>{
    const a=await replica(0),b=await replica(1);await a.repo.command(s=>s.saveExpense(expense("conflict"),null));await exchange(a,b);
    for(const [r,amountCents] of [[a,11111],[b,22222]] as const) {
      const e=(await r.repo.read()).data.expenses.find(x=>x.id==="conflict")!;
      await r.repo.command(s=>s.saveExpense({...e,amountCents},e));
    }
    await send(a,b);await restart(b);
    const before=await b.repo.read(), log=(await b.repo.readSyncJournal())!.log;
    const conflict=(await b.repo.readSyncReceiver())!.conflicts.find(c=>c.key==="expenses/conflict"&&c.status==="open")!;
    expect(conflict).toBeDefined();
    await expect(b.repo.resolveSyncConflict({conflictId:conflict.id,token:conflict.token,choice:{kind:"local"}})).rejects.toThrow("Nieobsługiwana");
    const known=log.known[origins[2]]??0, local=businessRecords(before.data).get("expenses/conflict")!;
    const resolution={protocol:1,id:crypto.randomUUID(),origin:origins[2],sequence:known+1,context:{...log.known},resolution:true,
      changes:[{key:"expenses/conflict",before:local,after:local}]};
    await b.repo.receiveSyncOperations([resolution]);await b.repo.planSyncOperations();
    expect((await b.repo.readSyncReceiver())!.receipts.find(r=>r.operation.id===resolution.id)?.stage).toBe("blocked");
    expect(await b.repo.read()).toEqual(before);
  });
  it("blocks history truncation and financial deletion without splitting an otherwise safe client change",async()=>{
    const a=await replica(0),b=await replica(1);await a.repo.command(s=>s.saveExpense(expense("history"),null));await exchange(a,b);
    const old=businessRecords((await a.repo.read()).data).get("expenses/history") as {[key:string]:Json};
    const bad={...old,revision:2,amountCents:999,history:[]};
    expect((await inject(a,b,"expenses/history",bad)).stage).toBe("blocked");
    expect((await b.repo.read()).data.expenses.find(e=>e.id==="history")!.amountCents).toBe(12345);
    const c=await replica(2);await exchange(a,c);
    const j=(await a.repo.readSyncJournal())!;
    const mixed=appendLocal(j.log,[
      {key:"expenses/history",before:old,after:null},
      {key:"clients/mixed-money",before:null,after:{id:"mixed-money",name:"Synthetic",phone:"",email:"",notes:""}},
    ]).operation!;
    await c.repo.receiveSyncOperations([mixed]);const plan=await c.repo.planSyncOperations();
    if(plan.plan)await c.repo.applySyncPlan(plan.plan.id);
    expect((await c.repo.read()).data.expenses.find(e=>e.id==="history")).toBeDefined();
    expect(await row(c,"mixed-money")).toBeUndefined();
  });
  it("defers new CSV/imports and preserves original bank identity and duplicate evidence locally",async()=>{
    const a=await replica(0),b=await replica(1);
    const options=defaultOptions();options.mapping={...options.mapping,date:0,amount:1,counterparty:2,description:3,transactionId:4};
    await a.repo.command(s=>s.saveExpenseProfile({id:"bank-profile",name:"Synthetic bank",headers:[],options,archived:false,
      revision:1,createdAt:0,updatedAt:0},null));
    const state=(await a.repo.read()).data, profile=state.expenseProfiles[0], hash="a".repeat(64);
    const rows=reviewRows(state,profile.id,hash,[{line:2,error:"",row:{line:2,date:"2026-11-22",signedCents:-1234,
      counterparty:"Synthetic bank vendor",description:"Synthetic",transactionId:"synthetic-bank-id",occurrence:1}}]);
    await a.repo.command(s=>s.importExpenses({id:"bank-import",profile,rulesKey:rulesKey(state),statementKey:hash,fileHash:hash,
      filename:"synthetic.csv",rows:rows.map(r=>({...r,selected:true,status:"approved" as const})),requestKey:"b".repeat(64)}));
    const original=(await a.repo.read()).data.expenses[0].origin;
    await send(a,b);await restart(b);
    expect((await b.repo.read()).data.expenses).toEqual([]);expect((await b.repo.read()).data.expenseImports).toEqual([]);
    expect((await a.repo.read()).data.expenses[0].origin).toEqual(original);
    expect((await b.repo.readSyncReceiver())!.receipts.some(r=>r.stage==="blocked"&&r.operation.changes.some(x=>x.key==="expenses/bank-import-2"))).toBe(true);
  });
  it("blocks overpayment, edits of time/settlement/report headers, and active-timer visits",async()=>{
    const a=await replica(0),b=await replica(1);await exchange(a,b);
    const current=businessRecords((await a.repo.read()).data).get("visits/job-5") as {[key:string]:Json};
    const excessive={...current,payments:[{id:"over",jobId:"job-5",amountCents:99999999,receivedDate:"2026-11-22",method:"cash",note:""}]};
    expect((await inject(a,b,"visits/job-5",excessive)).stage).toBe("blocked");
    const c=await replica(2);await send(a,c);
    const modified={...current,job:{...current.job as object,seconds:99999}};
    expect((await inject(a,c,"visits/job-5",modified)).stage).toBe("blocked");
    expect((await b.repo.read()).data.jobs).toEqual(b.initial.jobs);
    const active=await replica(2,d=>{d.timer={jobId:"job-5",startedAt:1000,paused:false};});
    await pay(a,"active-received");await send(a,active);
    expect((await active.repo.read()).data.timer).toEqual(active.initial.timer);
    expect((await active.repo.read()).data.payments).toEqual([]);
    expect((await active.repo.readSyncReceiver())!.receipts.some(r=>r.stage==="blocked"&&r.reason.includes("Aktywny stoper"))).toBe(true);
  });
  it("does not lose expense/link data or claim applied on quota; confirmation replay remains stable after restart",async()=>{
    const a=await replica(0),b=await replica(1);
    await a.repo.command(s=>s.saveExpense(expense("quota-money"),null));await send(a,b,false);
    const p=(await b.repo.readSyncReceiver())!.plan!, before=await b.repo.read(), receiver=await b.repo.readSyncReceiver();
    const put=IDBObjectStore.prototype.put;
    const failure=vi.spyOn(IDBObjectStore.prototype,"put").mockImplementation(function(this:IDBObjectStore,value:unknown,key?:IDBValidKey){
      if(this.name==="sync" && key===RECEIVER_KEY)throw new DOMException("Synthetic quota","QuotaExceededError");
      return put.call(this,value,key);
    });
    await expect(b.repo.applySyncPlan(p.id)).rejects.toThrow();failure.mockRestore();
    expect(await b.repo.read()).toEqual(before);expect(await b.repo.readSyncReceiver()).toEqual(receiver);
    const receipt=await b.repo.applySyncPlan(p.id);await restart(b);
    expect(await b.repo.applySyncPlan(p.id)).toEqual(receipt);
    expect((await b.repo.read()).data.expenses.filter(e=>e.id==="quota-money")).toHaveLength(1);
  });
});
