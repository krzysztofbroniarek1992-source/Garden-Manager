import { afterEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { AtomicRepository } from "../data/atomic";
import { createDemoData } from "../data/demo";
import { STORAGE_KEY, validateData } from "../data/repository";
import { jobTotalCents, paidCents, type Data, type Job } from "../domain";
import { newShoppingItem } from "../shopping/model";
import { businessRecords } from "./records";
import { appendLocal } from "./causal";
import { prepareTransfer, TransferAssembler } from "./packets";
import { RECEIVER_KEY } from "./receiver-model";
import type { Json } from "./model";

const origins=["11111111-1111-4111-8111-111111111111","22222222-2222-4222-8222-222222222222","33333333-3333-4333-8333-333333333333"];
class Storage {
  rows=new Map<string,string>();
  getItem(k:string){return this.rows.get(k)??null;}
  setItem(k:string,v:string){this.rows.set(k,v);}
}
const draft=(id:string):Job=>({id,gardenId:"garden-1",title:"Synthetic visit "+id,date:"2026-11-23",time:"09:00",
  status:"planned",billing:"hourly",rate:120,fixedPrice:0,seconds:0,materials:[],notes:"Synthetic",activities:["Synthetic work"],settlement:null});
async function replica(n:number,edit?:(d:Data)=>void) {
  const factory=new IDBFactory(),storage=new Storage(),data=createDemoData(new Date("2026-11-22T12:00:00Z"));
  data.jobs=[];data.payments=[];edit?.(data);validateData(data);
  storage.setItem(STORAGE_KEY,JSON.stringify({version:12,data}));
  const name="visit-replica-"+n,repo=new AtomicRepository(storage,factory,name);
  await repo.initialize();await repo.enableSyncJournal(origins[n]);
  return{repo,factory,storage,name};
}
type Replica=Awaited<ReturnType<typeof replica>>;
async function restart(r:Replica) {
  await r.repo.close();r.repo=new AtomicRepository(r.storage,r.factory,r.name);await r.repo.initialize();
}
const data=async(r:Replica)=>(await r.repo.read()).data;
const job=async(r:Replica,id="visit")=>(await data(r)).jobs.find(j=>j.id===id)!;
async function create(r:Replica,id="visit",patch:Partial<Job>={}) {
  await r.repo.command(s=>s.saveJob({...draft(id),...patch}),()=>1000);
}
async function send(a:Replica,b:Replica,apply=true) {
  if(a.name.endsWith("0")&&b.name.endsWith("2")||a.name.endsWith("2")&&b.name.endsWith("0"))
    throw Error("A and C never communicate directly");
  const j=(await a.repo.readSyncJournal())!,peer=(await b.repo.readSyncJournal())!;
  const packet=await prepareTransfer(j,peer.log.known),reader=new TransferAssembler(packet.offer);
  for(const c of [...packet.chunks].reverse())reader.accept(c);
  await b.repo.receiveSyncOperations((await reader.finish()).operations);
  const plan=await b.repo.planSyncOperations();
  if(apply&&plan.plan)await b.repo.applySyncPlan(plan.plan.id);
  return plan;
}
async function exchange(a:Replica,b:Replica){await send(a,b);await send(b,a);}
async function payment(r:Replica,id:string,amountCents=100) {
  await r.repo.command(s=>s.savePayment({id,jobId:"visit",amountCents,receivedDate:"2026-11-23",method:"transfer",note:"Synthetic"},null));
}
async function inject(a:Replica,b:Replica,after:Json) {
  const j=(await a.repo.readSyncJournal())!,before=businessRecords(await data(a)).get("visits/visit")!;
  const o=appendLocal(j.log,[{key:"visits/visit",before,after}]).operation!;
  await b.repo.receiveSyncOperations([o]);const p=await b.repo.planSyncOperations();
  if(p.plan)await b.repo.applySyncPlan(p.plan.id);
  return (await b.repo.readSyncReceiver())!.receipts.find(r=>r.operation.id===o.id)!;
}
afterEach(()=>vi.restoreAllMocks());

describe("5c1 complete visit transitions in independent durable IndexedDB stores",()=>{
  it("creates A-B-C visits, forwards original IDs, merges independent new visits and replays without local echo",async()=>{
    const a=await replica(0),b=await replica(1),c=await replica(2);
    await create(a);const original=(await a.repo.readSyncJournal())!.log.operations.at(-1)!;
    const next=(await b.repo.readSyncJournal())!.log.nextSequence;
    await send(a,b);expect((await b.repo.readSyncJournal())!.log.nextSequence).toBe(next);
    await restart(b);await send(b,c);
    await create(b,"visit-b");await create(c,"visit-c");
    for(let i=0;i<2;i++){await exchange(a,b);await exchange(b,c);}
    for(const r of [a,b,c]) {
      expect((await data(r)).jobs.map(j=>j.id).sort()).toEqual(["visit","visit-b","visit-c"]);
      expect((await r.repo.readSyncJournal())!.log.operations.find(o=>o.id===original.id)).toEqual(original);
    }
    expect((await c.repo.readSyncReceiver())!.receipts.find(r=>r.operation.id===original.id)?.stage).toBe("applied");
  },30000);
  it("preserves source date, status, activities, materials, visit details and a job-linked shopping item",async()=>{
    const a=await replica(0),b=await replica(1);await create(a);await exchange(a,b);
    await a.repo.command(s=>{
      const old=s.snapshot().jobs.find(j=>j.id==="visit")!;
      s.saveJob({...old,date:"2026-11-25",time:"11:45",status:"in-progress",notes:"Source note",activities:["First","Second"]},old);
      s.addJobMaterial("visit","garden-1",{id:"material",name:"Synthetic bark",quantity:1.25,unitPrice:12.34,unit:"m³",purchaseUnitPrice:9.87});
      s.saveVisitDetails("visit",{publicWork:"Public work",clientRemarks:"Source remarks",zoneId:null},0);
      s.saveShoppingItem({...newShoppingItem("Synthetic purchase"),id:"visit-shopping",jobId:"visit"},null);
    },()=>2000);
    await send(a,b);await restart(b);
    expect(await job(b)).toEqual(await job(a));
    expect((await data(b)).shoppingItems).toEqual((await data(a)).shoppingItems);
    expect((await data(b)).timer).toBeNull();
  });
  it("keeps source UUID/order for start-pause-resume-stop, correction and completion without replaying a Timer",async()=>{
    const a=await replica(0),b=await replica(1),c=await replica(2);await create(a);
    await a.repo.command(s=>s.startTimer("visit"),()=>1000);
    await a.repo.command(s=>s.pauseTimer(),()=>4100);
    await a.repo.command(s=>s.resumeTimer(),()=>5100);
    await a.repo.command(s=>s.stopTimer(),()=>7200);
    await a.repo.command(s=>s.correctJobTime("visit",10,5),()=>8000);
    await a.repo.command(s=>s.finishFieldVisit("visit"),()=>9000);
    await send(a,b,false);await restart(b);
    const plan=await b.repo.planSyncOperations();await b.repo.applySyncPlan(plan.plan!.id);
    await send(b,c);await restart(c);
    for(const r of [b,c]) {
      expect(await job(r)).toEqual(await job(a));
      expect((await data(r)).timer).toBeNull();
      expect((await job(r)).seconds).toBe(10);
      expect((await job(r)).timeHistory!.map(e=>e.kind)).toEqual(["started","paused","resumed","stopped","corrected","completed"]);
      expect((await job(r)).timeHistory![2].pauseDurationMs).toBe(1000);
    }
    await exchange(a,b);await exchange(b,c);expect((await job(c)).seconds).toBe(10);
  });
  it("can receive an open source audit as history without starting a local timer, then receive its closed measurement",async()=>{
    const a=await replica(0),b=await replica(1);await create(a);
    await a.repo.command(s=>s.startTimer("visit"),()=>1000);await send(a,b);
    expect((await data(b)).timer).toBeNull();expect((await job(b)).seconds).toBe(0);
    await a.repo.command(s=>s.stopTimer(),()=>6500);await send(a,b);
    expect((await job(b)).seconds).toBe(5);expect((await data(b)).timer).toBeNull();
  });
  it("persists concurrent corrections and both histories across restart, refuses destructive generic decisions",async()=>{
    const a=await replica(0),b=await replica(1);await create(a);await exchange(a,b);
    await a.repo.command(s=>s.correctJobTime("visit",101,0),()=>1000);
    await b.repo.command(s=>s.correctJobTime("visit",202,0),()=>1000);
    await send(a,b);await restart(b);
    const conflict=(await b.repo.readSyncReceiver())!.conflicts.find(c=>c.key==="visits/visit"&&c.status==="open")!;
    expect(conflict.baseAvailable).toBe(true);
    expect(conflict.remote.map(v=>(v.value as any).job.seconds).sort()).toEqual([101,202]);
    expect((await job(b)).seconds).toBe(202);expect((await job(b)).timeHistory).toHaveLength(1);
    await expect(b.repo.resolveSyncConflict({conflictId:conflict.id,token:conflict.token,choice:{kind:"local"}})).rejects.toThrow();
    await b.repo.command(s=>s.saveClient({id:"independent",name:"Synthetic",phone:"",email:"",notes:""},null));
    await send(b,a);expect((await data(a)).clients.some(c=>c.id==="independent")).toBe(true);
  });
  it.each([false,true])("protects the local active/paused timer (%s) and allows unrelated visits/clients",async paused=>{
    const a=await replica(0),b=await replica(1);await create(a);await exchange(a,b);
    await b.repo.command(s=>s.startTimer("visit"),()=>1000);
    if(paused)await b.repo.command(s=>s.pauseTimer(),()=>3000);
    const before=await job(b),timer=(await data(b)).timer;
    await a.repo.command(s=>s.completeJob("visit"),()=>5000);
    await create(a,"unrelated");await send(a,b);
    expect(await job(b)).toEqual(before);expect((await data(b)).timer).toEqual(timer);
    expect(await job(b,"unrelated")).toBeDefined();
    expect((await b.repo.readSyncReceiver())!.receipts.some(r=>r.stage==="blocked"&&r.reason.includes("Aktywny stoper"))).toBe(true);
  });
  it("preserves exact approved cents and sequential independent payment IDs on A-B-C with no recalculation",async()=>{
    const a=await replica(0),b=await replica(1),c=await replica(2);await create(a);
    await a.repo.command(s=>s.correctJobTime("visit",3601,0),()=>2000);
    await a.repo.command(s=>s.addJobMaterial("visit","garden-1",{id:"m",name:"Synthetic",quantity:2,unitPrice:12.34}));
    await a.repo.command(s=>s.completeJob("visit"),()=>3000);
    await a.repo.command(s=>s.approveSettlement("visit",15001,"manual"),()=>4000);
    await payment(a,"payment-a",101);await send(a,b);await send(b,c);
    await payment(c,"payment-c",202);await send(c,b);await send(b,a);
    await a.repo.command(s=>s.setRate(999)); // Unsupported settings do not block independent payment history.
    await payment(a,"payment-a-2",303);await send(a,b);await send(b,c);
    for(const r of [a,b,c]) {
      const d=await data(r),j=await job(r);
      expect(j.settlement).toEqual((await job(a)).settlement);
      expect(j.settlement!.finalLaborCents).toBe(15001);
      expect(jobTotalCents(j)).toBe(17469);expect(paidCents("visit",d.payments)).toBe(606);
      expect(d.payments).toHaveLength(3);
    }
  },30000);
  it("keeps conflicting approvals and concurrent payment alternatives durably, never adds their amounts",async()=>{
    for(const variant of ["settlement","payment"] as const) {
      const a=await replica(0),b=await replica(1);await create(a);
      await a.repo.command(s=>s.completeJob("visit"),()=>2000);
      if(variant==="payment")await a.repo.command(s=>s.approveSettlement("visit",5000,"manual"),()=>3000);
      await exchange(a,b);
      if(variant==="settlement") {
        await a.repo.command(s=>s.approveSettlement("visit",6000,"manual"),()=>4000);
        await b.repo.command(s=>s.approveSettlement("visit",7000,"manual"),()=>4000);
      } else {await payment(a,"a-pay");await payment(b,"b-pay");}
      await send(a,b);await restart(b);
      expect((await b.repo.readSyncReceiver())!.conflicts.some(c=>c.key==="visits/visit"&&c.status==="open")).toBe(true);
      if(variant==="settlement")expect((await job(b)).settlement!.finalLaborCents).toBe(7000);
      else expect((await data(b)).payments.map(p=>p.id)).toEqual(["b-pay"]);
      await a.repo.close();await b.repo.close();
    }
  });
  it("blocks causally ordered settlement rewrites, payment edits and deletion instead of erasing history",async()=>{
    for(const variant of ["settlement","payment-edit","payment-delete"] as const) {
      const a=await replica(0),b=await replica(1);await create(a);
      await a.repo.command(s=>s.completeJob("visit"));await a.repo.command(s=>s.approveSettlement("visit",5000,"manual"));
      await payment(a,"retained");await exchange(a,b);const before=await data(b);
      if(variant==="settlement")await a.repo.command(s=>s.approveSettlement("visit",6000,"manual"));
      else if(variant==="payment-edit") {
        const p=(await data(a)).payments[0];await a.repo.command(s=>s.savePayment({...p,amountCents:200},p));
      } else await a.repo.command(s=>s.deletePayment("retained",(before.payments[0])));
      const operation=(await a.repo.readSyncJournal())!.log.operations.at(-1)!;await send(a,b);await restart(b);
      expect(await data(b)).toEqual(before);
      expect((await b.repo.readSyncReceiver())!.receipts.find(r=>r.operation.id===operation.id)?.stage).toBe("blocked");
    }
  });
  it("waits for source parents and reversed predecessors instead of inventing a garden",async()=>{
    const a=await replica(0),b=await replica(1);
    await a.repo.command(s=>s.saveClient({id:"source-parent",name:"Synthetic",phone:"",email:"",notes:""},null));
    await a.repo.command(s=>s.saveGarden({id:"source-garden",clientId:"source-parent",name:"Synthetic",address:"",area:0,notes:"",zones:[]},null));
    await create(a,"visit",{gardenId:"source-garden"});
    const all=(await a.repo.readSyncJournal())!.log.operations,leaf=all.at(-1)!;
    await b.repo.receiveSyncOperations([leaf]);await b.repo.planSyncOperations();
    expect(await job(b)).toBeUndefined();
    await b.repo.receiveSyncOperations([...all.slice(0,-1)].reverse());
    const p=await b.repo.planSyncOperations();await b.repo.applySyncPlan(p.plan!.id);
    expect((await job(b)).gardenId).toBe("source-garden");
    expect((await data(b)).gardens.find(g=>g.id==="source-garden")!.clientId).toBe("source-parent");
  });
  it("retains garden-zone and catalog references only after their source versions are materialized",async()=>{
    const a=await replica(0),b=await replica(1),c=await replica(2);
    // Equal independent default gardens do not prove shared ancestry. Exchange
    // the original roots through B before editing their zones.
    await exchange(a,b);await exchange(b,c);await exchange(a,b);await exchange(b,c);
    await a.repo.command(s=>{
      s.saveZone("garden-1",{id:"zone",name:"Synthetic zone",type:"lawn",area:100,length:null,plants:"",requirements:"",treatments:""},null);
      s.saveCatalogMaterial({id:"catalog",name:"Synthetic material",category:"Synthetic",unit:"kg",purchaseUnitPrice:10,
        packageName:"",packageQuantity:null,notes:""},null);
    });
    await create(a);await a.repo.command(s=>{
      s.addJobMaterial("visit","garden-1",{id:"m",name:"Synthetic material",quantity:1,unitPrice:20,catalogId:"catalog",zoneId:"zone",zoneName:"Synthetic zone"});
      s.saveVisitDetails("visit",{publicWork:"Zone work",clientRemarks:"",zoneId:"zone"},0);
    });
    await send(a,b);await send(b,c);
    for(const r of [b,c]) {
      expect((await job(r)).materials[0]).toEqual((await job(a)).materials[0]);
      expect((await job(r)).visitDetails?.zoneId).toBe("zone");
      expect((await data(r)).gardens.find(g=>g.id==="garden-1")!.zones[0].id).toBe("zone");
    }
  });
  it("does not attach a historical source visit to a concurrently changed garden owner",async()=>{
    const a=await replica(0),b=await replica(1);await exchange(a,b);
    const garden=(await data(b)).gardens.find(g=>g.id==="garden-1")!;
    await b.repo.command(s=>s.saveGarden({...garden,clientId:"client-2"},garden));
    await create(a);await send(a,b);await restart(b);
    expect(await job(b)).toBeUndefined();
    expect((await data(b)).gardens.find(g=>g.id==="garden-1")!.clientId).toBe("client-2");
    expect((await b.repo.readSyncReceiver())!.receipts.some(r=>r.stage==="waiting-records"&&r.reason.includes("VISIT_OWNER"))).toBe(true);
  });
  it("rejects malformed intrinsic time, blocks truncation and unexplained seconds, and keeps source data",async()=>{
    for(const variant of ["seconds","truncated","chain"] as const) {
      const a=await replica(0),b=await replica(1);await create(a);
      await a.repo.command(s=>s.correctJobTime("visit",100,0),()=>2000);await exchange(a,b);
      const before=await data(b),unit=businessRecords(await data(a)).get("visits/visit") as any;
      const value=structuredClone(unit);
      if(variant==="seconds")value.job.seconds=101;
      else if(variant==="truncated")delete value.job.timeHistory;
      else value.job.timeHistory.push({id:"bad",kind:"corrected",at:1000,beforeSeconds:99,afterSeconds:100,pauseDurationMs:null});
      const result=await inject(a,b,value);
      expect(["blocked","rejected"]).toContain(result.stage);expect(await data(b)).toEqual(before);
    }
  });
  it("blocks a completion without its source event and a stale visit-details revision",async()=>{
    for(const variant of ["completion","details"] as const) {
      const a=await replica(0),b=await replica(1);await create(a);
      await a.repo.command(s=>s.saveVisitDetails("visit",{publicWork:"Original",clientRemarks:"",zoneId:null},0),()=>2000);
      await exchange(a,b);const before=await data(b),unit=businessRecords(await data(a)).get("visits/visit") as any;
      const value=structuredClone(unit);
      if(variant==="completion")value.job.status="completed";
      else value.job.visitDetails.publicWork="Unversioned rewrite";
      expect((await inject(a,b,value)).stage).toBe("blocked");
      expect(await data(b)).toEqual(before);
    }
  });
  it("rolls back Data+journal+receiver on quota/abort and replays the durable receipt after a lost acknowledgment",async()=>{
    const a=await replica(0),b=await replica(1);await create(a);
    await a.repo.command(s=>s.correctJobTime("visit",1234,0));await send(a,b,false);
    const p=(await b.repo.readSyncReceiver())!.plan!,before=await b.repo.read(),receiver=await b.repo.readSyncReceiver(),journal=await b.repo.readSyncJournal();
    const put=IDBObjectStore.prototype.put;
    const failure=vi.spyOn(IDBObjectStore.prototype,"put").mockImplementation(function(this:IDBObjectStore,value:unknown,key?:IDBValidKey) {
      if(this.name==="sync"&&key===RECEIVER_KEY)throw new DOMException("Synthetic quota","QuotaExceededError");
      return put.call(this,value,key);
    });
    await expect(b.repo.applySyncPlan(p.id)).rejects.toThrow();failure.mockRestore();
    expect(await b.repo.read()).toEqual(before);expect(await b.repo.readSyncReceiver()).toEqual(receiver);
    expect(await b.repo.readSyncJournal()).toEqual(journal);
    const receipt=await b.repo.applySyncPlan(p.id);await restart(b);
    expect(await b.repo.applySyncPlan(p.id)).toEqual(receipt);expect((await job(b)).seconds).toBe(1234);
    await send(a,b);expect((await job(b)).timeHistory).toHaveLength(1);
  });
  it("does not touch local photos, protected report headers, unrelated Timer or photo restore ID",async()=>{
    const a=await replica(0),b=await replica(1,d=>{
      d.jobs=[{...draft("local-active"),status:"in-progress"}];
      d.timer={jobId:"local-active",startedAt:1000,paused:true,remainderMs:123};
      d.photoRestoreId="synthetic-restore";
    });
    const old=await data(b);await create(a);await send(a,b);
    expect((await data(b)).timer).toEqual(old.timer);expect((await data(b)).photos).toEqual(old.photos);
    expect((await data(b)).photoRestoreId).toBe(old.photoRestoreId);
    const unit=businessRecords(await data(a)).get("visits/visit") as any;
    const result=await inject(a,b,{...unit,reportIdentities:[{id:"asset-report",number:"BO/2026/000001",version:1,
      generatedAt:1,fingerprint:"a".repeat(64),requiresAssets:true}]});
    expect(result.stage).toBe("blocked");expect((await job(b)).reports).toBeUndefined();
  });
  it("keeps seeded independent visits, financial sums and full time audits stable under repeated relay",async()=>{
    const rigs=[await replica(0),await replica(1),await replica(2)];let seed=11311,total=0,seconds=0;
    const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
    for(let n=0;n<9;n++) {
      const r=rigs[random()%3],id="seed-visit-"+n,time=random()%9000,amount=random()%50000+100;
      await create(r,id);await r.repo.command(s=>s.correctJobTime(id,time,0));
      await r.repo.command(s=>s.completeJob(id));await r.repo.command(s=>s.approveSettlement(id,amount,"manual"));
      total+=amount;seconds+=time;
      if(random()%2)await exchange(rigs[0],rigs[1]);else await exchange(rigs[1],rigs[2]);
    }
    for(let n=0;n<3;n++){await exchange(rigs[0],rigs[1]);await exchange(rigs[1],rigs[2]);}
    const baseline=await Promise.all(rigs.map(data));
    for(const d of baseline) {
      expect(d.jobs).toHaveLength(9);expect(d.jobs.reduce((n,j)=>n+jobTotalCents(j),0)).toBe(total);
      expect(d.jobs.reduce((n,j)=>n+j.seconds,0)).toBe(seconds);
      expect(d.jobs.every(j=>j.timeHistory?.length===2)).toBe(true);
    }
    await exchange(rigs[1],rigs[2]);await exchange(rigs[0],rigs[1]);
    for(let n=0;n<3;n++)expect(await data(rigs[n])).toEqual(baseline[n]);
  },60000);
});
