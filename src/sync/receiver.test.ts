import { afterEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { AtomicRepository } from "../data/atomic";
import { createDemoData } from "../data/demo";
import { STORAGE_KEY, validateData } from "../data/repository";
import { newNote, newTodo } from "../desk/model";
import type { Client, Data } from "../domain";
import { dotId } from "./causal";
import { RECEIVER_KEY, RECEIVE_SOURCE } from "./receiver-model";
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

describe("GM-011B controlled durable receiver, three independent IDB stores",()=>{
  it("relays A -> B -> C with original identity and durable receipts, replay creates no local operations",async()=>{
    const a=await replica(0),b=await replica(1),c=await replica(2);
    await client(a,"relay");
    const original=(await a.repo.readSyncJournal())!.log.operations.at(-1)!;
    const bCounter=(await b.repo.readSyncJournal())!.log.nextSequence;
    await send(a,b);
    expect(await row(b,"relay")).toEqual(await row(a,"relay"));
    await send(b,c);
    expect(await row(c,"relay")).toEqual(await row(a,"relay"));
    const applied=(await c.repo.readSyncReceiver())!.receipts.find(r=>r.operation.id===original.id)!;
    expect(applied.stage).toBe("applied"); expect(applied.appliedRevision).not.toBeNull();
    expect(applied.operation).toEqual(original);
    expect((await b.repo.readSyncJournal())!.log.nextSequence).toBe(bCounter);
    await client(b,"from-b"); await client(c,"from-c");
    await exchange(b,c); await exchange(a,b);
    for(const r of [a,b,c]) {
      expect(await row(r,"from-b")).toBeDefined(); expect(await row(r,"from-c")).toBeDefined();
    }
    for(let i=0;i<3;i++){await exchange(a,b);await exchange(b,c);}
    for(const r of [a,b,c]) {
      const data=(await r.repo.read()).data;
      expect(data.clients.filter(x=>["relay","from-b","from-c"].includes(x.id))).toHaveLength(3);
      const log=(await r.repo.readSyncJournal())!.log;
      expect(new Set(log.operations.map(dotId)).size).toBe(log.operations.length);
      expect(log.operations.find(o=>o.id===original.id)).toEqual(original);
    }
  },30000);
  it("persists receipt across restart without applying Data, then explicitly commits",async()=>{
    const a=await replica(0),b=await replica(1); await client(a,"restart");
    await send(a,b,false);
    expect(await row(b,"restart")).toBeUndefined();
    expect((await b.repo.readSyncReceiver())!.receipts.some(r=>r.stage==="planned")).toBe(true);
    const plan=(await b.repo.readSyncReceiver())!.plan!;
    await restart(b);
    expect(await row(b,"restart")).toBeUndefined();
    const committed=await b.repo.applySyncPlan(plan.id);
    expect(await row(b,"restart")).toBeDefined();
    const before=await b.repo.read(), again=await b.repo.applySyncPlan(plan.id);
    expect(again).toEqual(committed); expect(await b.repo.read()).toEqual(before);
    await restart(b); expect(await b.repo.applySyncPlan(plan.id)).toEqual(committed);
  });
  it("merges disjoint phone and note edits without relying on wall clocks",async()=>{
    const a=await replica(0),b=await replica(1); await client(a,"merge");await exchange(a,b);
    await client(a,"merge",{phone:"111"});await client(b,"merge",{notes:"Keep this note"});
    await exchange(a,b);
    for(const r of [a,b]) expect(await row(r,"merge")).toMatchObject({phone:"111",notes:"Keep this note"});
  });
  it("persists same-field conflicts and propagates an explicit decision through B to C",async()=>{
    const a=await replica(0),b=await replica(1),c=await replica(2);
    await client(a,"conflict"); await exchange(a,b);await exchange(b,c);
    await client(a,"conflict",{phone:"111",notes:"Uncontested note"});
    await client(b,"conflict",{phone:"222"});
    await send(a,b);
    expect((await row(b,"conflict"))!.phone).toBe("222");
    let conflict=(await b.repo.readSyncReceiver())!.conflicts.find(x=>x.key==="clients/conflict" && x.status==="open")!;
    expect(conflict.baseAvailable).toBe(true);expect(conflict.base).toMatchObject({phone:""});
    expect(conflict.local).toMatchObject({phone:"222"});
    const remote=conflict.remote.find(x=>(x.value as Client|null)?.phone==="111")!;
    await restart(b);
    conflict=(await b.repo.readSyncReceiver())!.conflicts.find(x=>x.id===conflict.id)!;
    const decided=await b.repo.resolveSyncConflict({conflictId:conflict.id,token:conflict.token,
      choice:{kind:"remote",operationId:remote.operationId}});
    expect(await row(b,"conflict")).toMatchObject({phone:"111",notes:"Uncontested note"});
    expect((await b.repo.readSyncReceiver())!.conflicts.find(x=>x.id===conflict.id)).toMatchObject({status:"resolved",resolvedBy:decided.operationId});
    await send(b,c); await send(b,a); await restart(c);
    for(const r of [a,b,c]) expect(await row(r,"conflict")).toMatchObject({phone:"111",notes:"Uncontested note"});
  },30000);
  it("keeps safe independent records moving while conflicted records and local drafts remain guarded",async()=>{
    const a=await replica(0),b=await replica(1);await client(a,"same");await exchange(a,b);
    await client(a,"same",{phone:"111"});await client(b,"same",{phone:"222"});await client(a,"independent");
    await send(a,b);
    expect(await row(b,"independent")).toBeDefined();
    const before=await b.repo.read();
    await expect(client(b,"same",{phone:"333"})).rejects.toThrow("konflikt");
    expect(await b.repo.read()).toEqual(before);
    await client(b,"another");expect(await row(b,"another")).toBeDefined();
  });
  it("retains deletions against an old replica and detects edit versus delete",async()=>{
    const a=await replica(0),b=await replica(1),c=await replica(2);
    await client(a,"deleted");await exchange(a,b);await exchange(b,c);
    const old=(await c.repo.readSyncJournal())!.log.operations;
    await a.repo.command(s=>s.deleteClient("deleted"));await send(a,b);
    expect(await row(b,"deleted")).toBeUndefined();
    await b.repo.receiveSyncOperations(old); const p=await b.repo.planSyncOperations();if(p.plan)await b.repo.applySyncPlan(p.plan.id);
    expect(await row(b,"deleted")).toBeUndefined();
    await client(c,"deleted",{phone:"offline edit"});await send(c,b);
    expect(await row(b,"deleted")).toBeUndefined();
    expect((await b.repo.readSyncReceiver())!.conflicts.find(x=>x.key==="clients/deleted" && x.status==="open")?.reason).toBe("edit-delete");
  },30000);
  it("does not combine independent different creations that happen to have the same ID",async()=>{
    const a=await replica(0),b=await replica(1);
    await client(a,"collision",{name:"First"});await client(b,"collision",{name:"Second"});
    await send(a,b);
    expect((await row(b,"collision"))!.name).toBe("Second");
    expect((await b.repo.readSyncReceiver())!.conflicts.find(x=>x.key==="clients/collision")?.reason).toBe("independent-create");
  });
  it("holds reverse-order gaps durably, without falsely advancing known or applied",async()=>{
    const a=await replica(0),b=await replica(1);await client(a,"gap");await client(a,"gap",{phone:"111"});
    const log=(await a.repo.readSyncJournal())!.log, last=log.operations.at(-1)!;
    await b.repo.receiveSyncOperations([last]); await restart(b);
    const pending=(await b.repo.readSyncReceiver())!.receipts.find(x=>x.operation.id===last.id)!;
    expect(pending.stage).toBe("waiting-dependencies");
    expect((await b.repo.readSyncJournal())!.log.known[origins[0]]).toBeUndefined();
    expect(await row(b,"gap")).toBeUndefined();
    await b.repo.receiveSyncOperations([...log.operations].reverse());
    const plan=await b.repo.planSyncOperations(); await b.repo.applySyncPlan(plan.plan!.id);
    expect(await row(b,"gap")).toMatchObject({phone:"111"});
  });
  it("rejects a delayed bad predecessor without poisoning the valid parent or unrelated records",async()=>{
    const a=await replica(0),b=await replica(1);await client(a,"valid");
    const log=(await a.repo.readSyncJournal())!.log, parent=log.operations.at(-1)!;
    const bad={...parent,id:crypto.randomUUID(),sequence:parent.sequence+1,
      context:{...log.known},changes:[{key:"clients/valid",before:{...parent.changes[0].after as object,name:"Wrong"},after:null}]};
    await b.repo.receiveSyncOperations([bad]);
    await b.repo.receiveSyncOperations(log.operations);
    const p=await b.repo.planSyncOperations();await b.repo.applySyncPlan(p.plan!.id);
    expect(await row(b,"valid")).toBeDefined();
    expect((await b.repo.readSyncReceiver())!.receipts.find(x=>x.operation.id===bad.id)?.stage).toBe("rejected");
    expect((await b.repo.readSyncJournal())!.log.known[origins[0]]).toBe(parent.sequence);
  });
  it("rolls back Data and application receipts on quota; retry and lost-confirmation retry are idempotent",async()=>{
    const a=await replica(0),b=await replica(1);await client(a,"quota");await send(a,b,false);
    const plan=(await b.repo.readSyncReceiver())!.plan!, before=await b.repo.read(), receiver=await b.repo.readSyncReceiver(),
      journal=await b.repo.readSyncJournal(), mirror=b.storage.getItem(STORAGE_KEY);
    const put=IDBObjectStore.prototype.put;
    const failure=vi.spyOn(IDBObjectStore.prototype,"put").mockImplementation(function(this:IDBObjectStore,value:unknown,key?:IDBValidKey){
      if(this.name==="sync" && key===RECEIVER_KEY)throw new DOMException("Synthetic quota","QuotaExceededError");
      return put.call(this,value,key);
    });
    await expect(b.repo.applySyncPlan(plan.id)).rejects.toThrow();
    failure.mockRestore();
    expect(await b.repo.read()).toEqual(before);expect(await b.repo.readSyncReceiver()).toEqual(receiver);
    expect(await b.repo.readSyncJournal()).toEqual(journal);expect(b.storage.getItem(STORAGE_KEY)).toBe(mirror);
    const done=await b.repo.applySyncPlan(plan.id), after=await b.repo.read();
    expect(await b.repo.applySyncPlan(plan.id)).toEqual(done);expect(await b.repo.read()).toEqual(after);
  });
  it("does not allow network metadata or changed payloads to forge an applied receipt",async()=>{
    const a=await replica(0),b=await replica(1);await client(a,"auth");await send(a,b);
    const op=(await a.repo.readSyncJournal())!.log.operations.at(-1)!, before=await b.repo.read();
    const forged=await b.repo.receiveSyncOperations([{...op,applied:true,appliedRevision:999}]);
    expect(forged.rejected).toHaveLength(1);
    const changed=structuredClone(op);changed.changes[0].after={...changed.changes[0].after as object,name:"Forged"};
    expect((await b.repo.receiveSyncOperations([changed])).rejected).toHaveLength(1);
    expect(await b.repo.read()).toEqual(before);
    expect((await b.repo.readSyncReceiver())!.receipts.find(r=>r.operation.id===op.id)?.stage).toBe("applied");
  });
  it("atomically creates a client, garden and zones with correct IDs; a deleted parent blocks a late garden",async()=>{
    const a=await replica(0),b=await replica(1);await client(a,"parent");await exchange(a,b);
    const garden={id:"garden-sync",clientId:"parent",name:"Synthetic garden",address:"Synthetic",area:20,notes:"",
      zones:[{id:"zone-sync",name:"Synthetic lawn",type:"trawnik",area:10,length:null,plants:"",requirements:"",treatments:""}]};
    await a.repo.command(s=>s.saveGarden(garden,null));
    await b.repo.command(s=>s.deleteClient("parent"));
    await send(a,b);
    expect((await b.repo.read()).data.gardens.some(g=>g.id===garden.id)).toBe(false);
    expect((await b.repo.readSyncReceiver())!.receipts.some(r=>r.stage==="waiting-records" && r.operation.changes.some(x=>x.key==="gardens/garden-sync"))).toBe(true);
    const c=await replica(2);await send(a,c);
    expect((await c.repo.read()).data.gardens.find(g=>g.id===garden.id)).toEqual(garden);
  });
  it("supports catalog records and independent desk records with their deletion tombstones",async()=>{
    const a=await replica(0),b=await replica(1);
    await a.repo.command(s=>{
      s.saveCatalogMaterial({id:"catalog-sync",name:"Synthetic soil",category:"Synthetic",unit:"l",purchaseUnitPrice:1.25,packageName:"",packageQuantity:null,notes:""},null);
    });
    const state=(await a.repo.read()).data, note={...newNote(state),id:"note-sync",title:"Synthetic note"},
      todo={...newTodo(state),id:"todo-sync",title:"Synthetic task"};
    await a.repo.command(s=>s.saveNote(note));await a.repo.command(s=>s.saveTodo(todo));await send(a,b);
    const data=(await b.repo.read()).data;
    expect(data.materialCatalog.some(x=>x.id==="catalog-sync")).toBe(true);
    expect(data.notes.some(x=>x.id==="note-sync")).toBe(true);expect(data.todos.some(x=>x.id==="todo-sync")).toBe(true);
    await a.repo.command(s=>s.deleteDeskRecord("note","note-sync",(s.data.notes.find(n=>n.id==="note-sync"))!.revision));
    await send(a,b);
    expect((await b.repo.read()).data.notes.some(x=>x.id==="note-sync")).toBe(false);
    expect((await b.repo.read()).data.deskTombstones.some(x=>x.id==="note-sync")).toBe(true);
  });
  it("blocks financial/time/report/setting units and preserves the active local timer",async()=>{
    const a=await replica(0),b=await replica(1,data=>{
      data.jobs[0].status="in-progress";data.timer={jobId:data.jobs[0].id,startedAt:1000,paused:false};
    });
    await a.repo.command(s=>s.setRate(999));await client(a,"safe-client");
    const before=(await b.repo.read()).data;
    await send(a,b);
    const after=(await b.repo.read()).data;
    for(const k of ["jobs","payments","expenses","expenseImports","shoppingItems","settings","timer","photos","reportSequence"] as const)
      expect(after[k]).toEqual(before[k]);
    expect(await row(b,"safe-client")).toBeDefined();
    expect((await b.repo.readSyncReceiver())!.receipts.some(x=>x.stage==="blocked")).toBe(true);
  });
  it("invalidates stale approvals and requires history review after restore without erasing receipts",async()=>{
    const a=await replica(0),b=await replica(1);await client(a,"stale");await send(a,b,false);
    const plan=(await b.repo.readSyncReceiver())!.plan!;
    await client(b,"local");
    await expect(b.repo.applySyncPlan(plan.id)).rejects.toThrow("nieaktualny");
    const p=await b.repo.planSyncOperations();await b.repo.applySyncPlan(p.plan!.id);
    const saved=(await b.repo.read()).data, receiver=await b.repo.readSyncReceiver();
    await b.repo.command(s=>s.restoreSnapshot(saved,JSON.stringify(saved)));
    await expect(b.repo.planSyncOperations()).rejects.toThrow("przywróceniu");
    expect(await b.repo.readSyncReceiver()).toEqual(receiver);
  });
  it("never splits unsupported atomic groups or smuggles their writes through a later supported edit",async()=>{
    const a=await replica(0),b=await replica(1);
    await a.repo.command(s=>{
      s.saveClient({id:"mixed",name:"Synthetic mixed",phone:"",email:"",notes:""},null);
      s.setRate(999);
    });
    const mixed=(await a.repo.readSyncJournal())!.log.operations.at(-1)!;
    await client(a,"mixed",{phone:"later"});
    await client(a,"unrelated");
    await send(a,b);
    expect(await row(b,"mixed")).toBeUndefined();expect(await row(b,"unrelated")).toBeDefined();
    expect((await b.repo.read()).data.settings).toEqual(b.initial.settings);
    expect((await b.repo.readSyncReceiver())!.receipts.find(r=>r.operation.id===mixed.id)?.stage).toBe("blocked");
    expect((await b.repo.readSyncReceiver())!.receipts.some(r=>r.stage==="waiting-records"&&r.operation.changes.some(x=>x.key==="clients/mixed"))).toBe(true);
  });
  it("resolves note edit/deletion together with the native tombstone and forwards the decision",async()=>{
    const a=await replica(0),b=await replica(1),note={...newNote(a.initial),id:"note-decision",title:"Synthetic note"};
    await a.repo.command(s=>s.saveNote(note));await exchange(a,b);
    const local=(await b.repo.read()).data.notes.find(n=>n.id===note.id)!;
    await b.repo.command(s=>s.saveNote({...local,body:"Keep this edit"}));
    await a.repo.command(s=>s.deleteDeskRecord("note",note.id,1));await send(a,b);
    const conflict=(await b.repo.readSyncReceiver())!.conflicts.find(c=>c.key==="notes/note-decision"&&c.status==="open")!;
    await b.repo.resolveSyncConflict({conflictId:conflict.id,token:conflict.token,choice:{kind:"local"}});
    await send(b,a);await restart(a);
    for(const r of [a,b]) {
      const d=(await r.repo.read()).data;
      expect(d.notes.find(n=>n.id===note.id)).toMatchObject({body:"Keep this edit"});
      expect(d.deskTombstones.some(t=>t.kind==="note"&&t.id===note.id)).toBe(false);
    }
  });
  it("does not attach a garden to an unrelated local client whose ID is in conflict",async()=>{
    const a=await replica(0),b=await replica(1);
    await client(a,"owner",{name:"First owner"});await client(b,"owner",{name:"Different owner"});
    await a.repo.command(s=>s.saveGarden({id:"owned-garden",clientId:"owner",name:"Synthetic garden",address:"",area:0,notes:"",zones:[]},null));
    await send(a,b);
    expect((await row(b,"owner"))!.name).toBe("Different owner");
    expect((await b.repo.read()).data.gardens.some(g=>g.id==="owned-garden")).toBe(false);
    expect((await b.repo.readSyncReceiver())!.receipts.some(r=>r.stage==="waiting-records"&&r.operation.changes.some(x=>x.key==="gardens/owned-garden"))).toBe(true);
  });
  it("never enables the decision API for financial conflicts",async()=>{
    const a=await replica(0),b=await replica(1,data=>{
      data.jobs[0].status="in-progress";data.timer={jobId:data.jobs[0].id,startedAt:1000,paused:false};
    });
    await send(a,b);
    const receiver=(await b.repo.readSyncReceiver())!, conflict=receiver.conflicts.find(c=>c.key==="visits/job-1"&&c.status==="open")!;
    expect(conflict).toBeDefined();
    const state=await b.repo.read(), journal=await b.repo.readSyncJournal();
    await expect(b.repo.resolveSyncConflict({conflictId:conflict.id,token:conflict.token,choice:{kind:"local"}})).rejects.toThrow("Nieobsługiwana");
    expect(await b.repo.read()).toEqual(state);expect(await b.repo.readSyncJournal()).toEqual(journal);
    expect(await b.repo.readSyncReceiver()).toEqual(receiver);
  });
  it("rejects damaged conflict alternatives instead of accepting them as a remote decision",async()=>{
    const a=await replica(0),b=await replica(1);
    await client(a,"damaged");await exchange(a,b);
    await client(a,"damaged",{phone:"111"});await client(b,"damaged",{phone:"222"});await send(a,b);
    const metadata=(await b.repo.readSyncReceiver())!, conflict=metadata.conflicts.find(c=>c.key==="clients/damaged"&&c.status==="open")!;
    const damaged=structuredClone(metadata), changed=damaged.conflicts.find(c=>c.id===conflict.id)!;
    changed.remote[0].value={...changed.remote[0].value as object,phone:"forged metadata"};
    const db=await new Promise<IDBDatabase>(ok=>{const q=b.factory.open(b.name);q.onsuccess=()=>ok(q.result);});
    await new Promise<void>((ok,no)=>{const t=db.transaction("sync","readwrite");t.objectStore("sync").put(damaged,RECEIVER_KEY);
      t.oncomplete=()=>{db.close();ok();};t.onabort=()=>no(t.error);});
    const before=await b.repo.read();
    await expect(b.repo.readSyncReceiver()).rejects.toThrow("niezmiennej historii");
    await expect(b.repo.resolveSyncConflict({conflictId:conflict.id,token:conflict.token,
      choice:{kind:"remote",operationId:changed.remote[0].operationId}})).rejects.toThrow();
    expect(await b.repo.read()).toEqual(before);
  });
  it("keeps the pre-application checkpoint and rejects malformed client contents without changing Data",async()=>{
    const a=await replica(0),b=await replica(1);const before=await b.repo.read();
    await client(a,"check");await send(a,b);
    const db=await new Promise<IDBDatabase>(ok=>{const q=b.factory.open(b.name);q.onsuccess=()=>ok(q.result);});
    const source=await new Promise<unknown>(ok=>{const t=db.transaction("sync"),q=t.objectStore("sync").get(RECEIVE_SOURCE);t.oncomplete=()=>ok(q.result);});
    db.close();expect(source).toEqual(before);
    const op=(await a.repo.readSyncJournal())!.log.operations.at(-1)!;
    const invalid={...op,id:crypto.randomUUID(),origin:origins[2],sequence:1,context:{},
      changes:[{key:"clients/bad",before:null,after:{id:"bad",name:"",phone:"",email:"",notes:""}}]};
    const data=await b.repo.read();
    const receipt=await b.repo.receiveSyncOperations([invalid]);
    expect(receipt.rejected).toHaveLength(1);
    expect(await b.repo.read()).toEqual(data);
    expect((await b.repo.readSyncReceiver())!.receipts.find(r=>r.operation.id===invalid.id)?.stage).toBe("rejected");
  });
});
