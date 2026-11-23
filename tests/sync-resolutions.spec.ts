import { test, expect, chromium, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/** Test-only harness: three separate durable business DBs and photo DBs.
 * It does not expose an application API or exercise native LAN. */
async function boot(page:Page) {
  await page.goto("/");await page.locator(".app-shell").waitFor();
  await page.evaluate(async()=>{
    const ap="/src/data/atomic.ts",dp="/src/data/demo.ts",cp="/src/sync/packets.ts",
      pp="/src/photos/assets.ts",sp="/src/reports/service.ts",mp="/src/reports/model.ts";
    const {AtomicRepository}=await import(ap),{createDemoData}=await import(dp),codec=await import(cp),
      {IndexedDbPhotoRepository}=await import(pp),{ReportService}=await import(sp),{defaultReportOptions}=await import(mp);
    const labels=["A","B","C"],origins=["11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222","33333333-3333-4333-8333-333333333333"],rigs:any={};
    const at=Date.parse("2026-11-23T12:00:00Z");
    for(let i=0;i<3;i++) {
      const label=labels[i],prefix="resolution-fixture-"+label+":";
      const storage={getItem:(k:string)=>localStorage.getItem(prefix+k),setItem:(k:string,v:string)=>localStorage.setItem(prefix+k,v)};
      if(storage.getItem("garden-manager:v1")===null) {
        const data=createDemoData(new Date(at));data.jobs=[];data.payments=[];
        storage.setItem("garden-manager:v1",JSON.stringify({version:12,data}));
      }
      const repo=new AtomicRepository(storage,indexedDB,"gm011b-resolutions-"+label);
      await repo.initialize();if(!await repo.readSyncJournal())await repo.enableSyncJournal(origins[i]);
      rigs[label]={repo,assets:new IndexedDbPhotoRepository(undefined,"gm011b-resolutions-photos-"+label)};
    }
    const api:any={
      rigs,at,
      async data(label:string){return(await rigs[label].repo.read()).data;},
      async state(label:string){const r=rigs[label].repo;return{state:await r.read(),journal:await r.readSyncJournal(),receiver:await r.readSyncReceiver()};},
      async send(from:string,to:string,apply=true) {
        if([from,to].sort().join("")==="AC")throw Error("No A-C link");
        const a=rigs[from].repo,b=rigs[to].repo;
        await a.prepareSyncReports();
        const packet=await codec.prepareTransfer(await a.readSyncJournal(),(await b.readSyncJournal()).log.known),
          reader=new codec.TransferAssembler(packet.offer);
        for(const c of [...packet.chunks].reverse())reader.accept(c);
        await b.receiveSyncOperations((await reader.finish()).operations);
        const plan=await b.planSyncOperations();
        if(apply&&plan.plan)await b.applySyncPlan(plan.plan.id);return plan;
      },
      async base(approval:number|null=null,report=false) {
        await rigs.A.repo.command((s:any)=>s.saveJob({id:"visit",gardenId:"garden-1",title:"Synthetic",date:"2026-11-23",
          time:"09:00",status:"planned",billing:"hourly",rate:100,fixedPrice:0,seconds:3600,materials:[],
          notes:"",activities:["Synthetic"],settlement:null}),()=>at);
        await rigs.A.repo.command((s:any)=>s.completeJob("visit"),()=>at+1);
        if(approval!==null)await rigs.A.repo.command((s:any)=>s.approveSettlement("visit",approval,"manual"),()=>at+2);
        let issued=null;
        if(report) {
          const service=new ReportService({snapshot:()=>api.data("A"),
            reserveReportIdentity:(...a:any[])=>rigs.A.repo.reserveReportIdentity(...a),
            saveVisitReport:async(...a:any[])=>{await rigs.A.repo.command((s:any)=>s.saveVisitReport(...a));}},
            rigs.A.assets,undefined,()=>at+3);
          const p=await service.prepare("visit",{...defaultReportOptions(),showFinance:true});await service.save("visit",p);
          issued={record:p.record,header:new TextDecoder().decode(p.bytes.slice(0,5))};
        }
        await api.send("A","B");await api.send("B","C");return issued;
      },
      async approvals(left=25000,right=30000) {
        await rigs.A.repo.command((s:any)=>s.approveSettlement("visit",left,"manual"),()=>at+10);
        await rigs.C.repo.command((s:any)=>s.approveSettlement("visit",right,"manual"),()=>at+10);
        await api.send("A","B",false);await api.send("C","B");
      },
      async conflict(label:string,key="visits/visit"){
        await rigs[label].repo.planSyncOperations();
        return(await rigs[label].repo.readSyncReceiver()).conflicts.find((c:any)=>c.key===key&&c.status==="open");
      },
      async request(label:string,patch:any={},key="visits/visit") {
        const c=await api.conflict(label,key),payments=new Map<string,string>();
        for(const v of c.remote)for(const p of v.value.payments??[])if(!payments.has(p.id))payments.set(p.id,v.operationId);
        return{id:crypto.randomUUID(),conflictId:c.id,token:c.token,rationale:"Synthetic explicit reviewed result",
          intent:{kind:"visit",basisOperationId:c.remote[0].operationId,labor:{kind:"source"},time:{kind:"source"},
            payments:[...payments].map(([id,sourceOperationId])=>({id,action:"keep",sourceOperationId})),...patch}};
      },
      async audit(label:string,id:string) {
        const j=await rigs[label].repo.readSyncJournal();
        return j.log.operations.find((o:any)=>o.id===id).changes.find((c:any)=>c.key.startsWith("financialDecisions/")).after;
      },
      async hash(value:any) {
        const bytes=value instanceof Blob?await value.arrayBuffer():new TextEncoder().encode(JSON.stringify(value));
        return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))).map(n=>n.toString(16).padStart(2,"0")).join("");
      },
      async pixel(label:string) {
        const p="/src/photos/service.ts",i="/src/photos/images.ts",
          {PhotoService}=await import(p),{BrowserPhotoProcessor}=await import(i),r=rigs[label];
        const canvas=document.createElement("canvas");canvas.width=2;canvas.height=2;canvas.getContext("2d")!.fillRect(0,0,2,2);
        const blob=await new Promise<Blob>(ok=>canvas.toBlob(b=>ok(b!),"image/jpeg"));
        const service=new PhotoService({snapshot:()=>api.data(label),appendPhotos:async(p:any[])=>{await r.repo.command((s:any)=>s.appendPhotos(p));}},
          r.assets,new BrowserPhotoProcessor());
        return(await service.add([{id:"synthetic-resolution-jpeg",blob,name:"synthetic.jpg"}],
          {clientId:"client-1",gardenId:"garden-1",zoneId:null,jobId:"visit",category:"before",description:"Synthetic",capturedDate:null}))[0];
      },
      async close(){for(const r of Object.values(rigs) as any[]){await r.repo.close();}},
    };
    (window as any).__resolutionRig=api;
  });
}
test.describe("5c2c real Chromium durable decisions (not native LAN)",()=>{
  test.setTimeout(180000);
  test("preserves an issued PDF, exact snapshot/SHA and local JPEG while relaying a settlement decision",async({page})=>{
    await boot(page);
    const result=await page.evaluate(async()=>{
      const x=(window as any).__resolutionRig,issued=await x.base(25000,true),photo=await x.pixel("B"),
        blobBefore=await x.rigs.B.assets.get(photo.assetId),shaBefore=await x.hash(blobBefore.image);
      await x.approvals(26000,30000);
      const req=await x.request("B",{labor:{kind:"amount",cents:27501}}),before=await x.data("B"),
        receiver=await x.rigs.B.repo.resolveFinancialSyncConflict(req);
      await x.send("B","A");await x.send("B","C");await x.send("A","B");await x.send("C","B");
      const states=await Promise.all(["A","B","C"].map((l:string)=>x.state(l))),
        audit=await x.audit("B",req.id),asset=await x.rigs.B.assets.get(photo.assetId),
        bp="/src/photos/backup.ts",{makeFullBackup,readFullBackup}=await import(bp),
        parsed=await readFullBackup(await makeFullBackup(await x.data("B"),x.rigs.B.assets));
      const result={issued,photo,shaBefore,shaAfter:await x.hash(asset.image),before,states,audit,receiver,
        snapshotSHA:await x.hash(issued.record.snapshot),
        currentSHAs:await Promise.all(states.map((s:any)=>x.hash(s.state.data.jobs[0].reports[0].snapshot))),
        zip:parsed.data,zipAssets:parsed.assets.length};
      await x.close();return result;
    });
    expect(result.issued.header).toBe("%PDF-");
    expect(result.audit.sources.map((s:any)=>s.after.job.settlement.finalLaborCents).sort()).toEqual([26000,30000]);
    for(const s of result.states) {
      expect(s.state.data.jobs[0].settlement.finalLaborCents).toBe(27501);
      expect(s.state.data.jobs[0].reports).toEqual([result.issued.record]);
      expect(s.state.data.jobs[0].seconds).toBe(3600);expect(s.state.data.payments).toEqual([]);
    }
    expect(new Set(result.currentSHAs)).toEqual(new Set([result.snapshotSHA]));
    expect(result.shaAfter).toBe(result.shaBefore);expect(result.shaAfter).toBe(result.photo.sha256);
    expect(result.states[1].state.data.photos).toEqual(result.before.photos);
    expect(result.states[0].state.data.photos).toEqual([]);expect(result.states[2].state.data.photos).toEqual([]);
    expect(result.zip).toEqual(result.states[1].state.data);expect(result.zipAssets).toBe(1);
  });
  test("full Chromium restarts retain unresolved alternatives, the decision and an exact idempotent response",async({baseURL})=>{
    const profile=await mkdtemp(path.join(tmpdir(),"gm-resolution-"));
    let context=await chromium.launchPersistentContext(profile,{baseURL});
    try {
      let page=await context.newPage();await boot(page);
      const saved=await page.evaluate(async()=>{
        const x=(window as any).__resolutionRig;await x.base();await x.approvals();
        const req=await x.request("B",{labor:{kind:"amount",cents:27500}});
        localStorage.setItem("synthetic-resolution-request",JSON.stringify(req));
        const before=await x.state("B");await x.close();return{req,before};
      });
      await context.close();context=await chromium.launchPersistentContext(profile,{baseURL});page=await context.newPage();await boot(page);
      const applied=await page.evaluate(async()=>{
        const x=(window as any).__resolutionRig,req=JSON.parse(localStorage.getItem("synthetic-resolution-request")!),
          before=await x.state("B"),result=await x.rigs.B.repo.resolveFinancialSyncConflict(req);
        await x.send("B","A");await x.send("B","C");
        const after=await x.state("B"),audit=await x.audit("C",req.id);await x.close();return{before,after,result,audit};
      });
      expect(applied.before).toEqual(saved.before);
      expect(applied.audit.sources).toHaveLength(2);
      await context.close();context=await chromium.launchPersistentContext(profile,{baseURL});page=await context.newPage();await boot(page);
      const retry=await page.evaluate(async()=>{
        const x=(window as any).__resolutionRig,req=JSON.parse(localStorage.getItem("synthetic-resolution-request")!),
          before=await x.state("B"),result=await x.rigs.B.repo.resolveFinancialSyncConflict(req),after=await x.state("B");
        await x.close();return{before,result,after};
      });
      expect(retry.result).toEqual(applied.result);expect(retry.after).toEqual(retry.before);
      expect(retry.before).toEqual(applied.after);
    } finally {await context.close();await rm(profile,{recursive:true,force:true});}
  });
  test("reconciles distinct payment identities, correction and cancellation without duplicating cents",async({page})=>{
    await boot(page);
    const result=await page.evaluate(async()=>{
      const x=(window as any).__resolutionRig;await x.base(30000);
      for(const [label,id] of [["A","pay-a"],["C","pay-c"]])await x.rigs[label].repo.command((s:any)=>s.savePayment(
        {id,jobId:"visit",amountCents:1000,receivedDate:"2026-11-23",method:"cash",note:"Synthetic"},null));
      await x.send("A","B",false);await x.send("C","B");
      const req=await x.request("B");req.intent.payments=req.intent.payments.map((p:any)=>p.id==="pay-a"?
        {...p,action:"correct",amountCents:1250,receivedDate:"2026-11-23",method:"transfer",note:"Reviewed correction"}:p);
      await x.rigs.B.repo.resolveFinancialSyncConflict(req);await x.send("B","A");await x.send("B","C");
      const first=await x.data("B");
      for(const [label,amount] of [["A",1300],["C",1400]] as const) {
        const p=(await x.data(label)).payments.find((p:any)=>p.id==="pay-a");
        await x.rigs[label].repo.command((s:any)=>s.savePayment({...p,amountCents:amount},p));
      }
      await x.send("A","B",false);await x.send("C","B");
      const cancel=await x.request("B");cancel.intent.payments=cancel.intent.payments.map((p:any)=>p.id==="pay-a"?{...p,action:"cancel"}:p);
      await x.rigs.B.repo.resolveFinancialSyncConflict(cancel);
      for(let i=0;i<2;i++){await x.send("B","A");await x.send("B","C");await x.send("A","B");await x.send("C","B");}
      const states=await Promise.all(["A","B","C"].map((l:string)=>x.data(l))),audit=await x.audit("B",cancel.id);
      await x.close();return{first,states,audit};
    });
    expect(result.first.payments.map((p:any)=>p.amountCents).sort()).toEqual([1000,1250]);
    for(const d of result.states)expect(d.payments.map((p:any)=>({id:p.id,amount:p.amountCents}))).toEqual([{id:"pay-c",amount:1000}]);
    expect(result.audit.sources.map((s:any)=>s.after.payments.find((p:any)=>p.id==="pay-a").amountCents).sort()).toEqual([1300,1400]);
  });
  test("real quota/abort rolls back Data, journal, conflict status, receipts and checkpoints",async({page})=>{
    await boot(page);
    const result=await page.evaluate(async()=>{
      const x=(window as any).__resolutionRig;await x.base();await x.approvals();
      const req=await x.request("B",{labor:{kind:"amount",cents:27500}}),before=await x.state("B"),
        original=IDBObjectStore.prototype.put;
      let failure="";
      IDBObjectStore.prototype.put=function(...args:any[]) {
        if(this.name==="sync"&&args[1]==="receiver-v1")throw new DOMException("Synthetic quota","QuotaExceededError");
        return original.apply(this,args as any);
      };
      try {await x.rigs.B.repo.resolveFinancialSyncConflict(req);}catch(e){failure=(e as Error).message;}
      finally {IDBObjectStore.prototype.put=original;}
      const aborted=await x.state("B"),result=await x.rigs.B.repo.resolveFinancialSyncConflict(req),
        committed=await x.state("B"),retry=await x.rigs.B.repo.resolveFinancialSyncConflict(req),after=await x.state("B");
      await x.close();return{before,aborted,failure,result,retry,committed,after};
    });
    expect(result.failure).not.toBe("");expect(result.aborted).toEqual(result.before);
    expect(result.retry).toEqual(result.result);expect(result.after).toEqual(result.committed);
    expect(result.after.state.data.jobs[0].settlement.finalLaborCents).toBe(27500);
  });
  test("preserves both correction histories and a valid selected linear time audit over repeated relays",async({page})=>{
    await boot(page);
    const result=await page.evaluate(async()=>{
      const x=(window as any).__resolutionRig;await x.base();
      await x.rigs.A.repo.command((s:any)=>s.correctJobTime("visit",7200,3600),()=>x.at+10);
      await x.rigs.C.repo.command((s:any)=>s.correctJobTime("visit",9000,3600),()=>x.at+10);
      await x.send("A","B",false);await x.send("C","B");
      const req=await x.request("B",{time:{kind:"seconds",seconds:8000}});
      await x.rigs.B.repo.resolveFinancialSyncConflict(req);
      for(let i=0;i<3;i++){await x.send("B","A");await x.send("B","C");await x.send("A","B");await x.send("C","B");}
      const states=await Promise.all(["A","B","C"].map((l:string)=>x.data(l))),audit=await x.audit("C",req.id);
      await x.close();return{states,audit,req};
    });
    expect(result.audit.sources.map((s:any)=>s.after.job.seconds).sort()).toEqual([7200,9000]);
    for(const d of result.states) {
      expect(d.jobs[0].seconds).toBe(8000);
      expect(d.jobs[0].timeHistory.at(-1)).toMatchObject({id:result.req.id,kind:"corrected",beforeSeconds:7200,afterSeconds:8000});
      expect(d.jobs[0].timeHistory.map((e:any)=>e.kind)).toEqual(["completed","corrected","corrected"]);
      expect(d.timer).toBeNull();
    }
  });
});
