import { test, expect, chromium, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { settled } from "./atomic-fixture";

async function boot(page:Page,active=true) {
  await page.goto("/");await page.locator(".app-shell").waitFor();
  await page.evaluate(async active=>{
    const a="/src/data/atomic.ts",d="/src/data/demo.ts",s="/src/reports/service.ts",m="/src/reports/model.ts",
      p="/src/photos/assets.ts",codecPath="/src/sync/packets.ts";
    const {AtomicRepository}=await import(a),{createDemoData}=await import(d),{ReportService}=await import(s),
      {defaultReportOptions}=await import(m),{IndexedDbPhotoRepository}=await import(p),codec=await import(codecPath);
    const labels=["A","B","C"],origins=["11111111-1111-4111-8111-111111111111","22222222-2222-4222-8222-222222222222","33333333-3333-4333-8333-333333333333"];
    const rigs:any={},at=Date.parse("2026-11-23T12:00:00Z");
    for(let n=0;n<3;n++) {
      const label=labels[n],prefix="report-fixture-"+label+":";
      const storage={getItem:(k:string)=>localStorage.getItem(prefix+k),setItem:(k:string,v:string)=>localStorage.setItem(prefix+k,v)};
      if(storage.getItem("garden-manager:v1")===null) {
        const data=createDemoData(new Date(at));
        data.jobs=[{...data.jobs.find((j:any)=>j.id==="job-5"),id:"report-job-"+label,gardenId:"garden-1",activities:["Synthetic work"],materials:[]}];
        data.payments=[];storage.setItem("garden-manager:v1",JSON.stringify({version:12,data}));
      }
      const repo=new AtomicRepository(storage,indexedDB,"gm011b-report-"+label);await repo.initialize();
      if(active&&!await repo.readSyncJournal())await repo.enableSyncJournal(origins[n]);
      const assets=new IndexedDbPhotoRepository(undefined,"gm011b-report-assets-"+label);
      rigs[label]={repo,assets};
    }
    const api:any={
      rigs,at,origins,
      async data(label:string){return(await rigs[label].repo.read()).data;},
      async enable(label:string){return rigs[label].repo.enableSyncJournal(origins[labels.indexOf(label)]);},
      service(label:string){
        const r=rigs[label];
        return new ReportService({snapshot:()=>api.data(label),reserveReportIdentity:(...args:any[])=>r.repo.reserveReportIdentity(...args),
          saveVisitReport:async(...args:any[])=>{await r.repo.command((s:any)=>s.saveVisitReport(...args));}},r.assets,undefined,()=>at);
      },
      async prepare(label:string,options:any=defaultReportOptions()){
        return api.service(label).prepare("report-job-"+label,options);
      },
      async issue(label:string,options:any=defaultReportOptions()){
        const p=await api.prepare(label,options);await api.service(label).save("report-job-"+label,p);
        return{record:p.record,pdfHeader:new TextDecoder().decode(p.bytes.slice(0,5))};
      },
      async numbering(label:string){
        return new Promise((ok,no)=>{
          const q=indexedDB.open("gm011b-report-"+label);q.onerror=()=>no(q.error);
          q.onsuccess=()=>{const db=q.result,t=db.transaction("sync"),get=t.objectStore("sync").get("report-numbering-v1");
            t.oncomplete=()=>{db.close();ok(get.result);};t.onabort=()=>no(t.error);};
        });
      },
      async send(from:string,to:string){
        if([from,to].sort().join("")==="AC")throw Error("A-C link forbidden");
        const a=rigs[from].repo,b=rigs[to].repo,j=await a.readSyncJournal(),peer=await b.readSyncJournal();
        const t=await codec.prepareTransfer(j,peer.log.known),reader=new codec.TransferAssembler(t.offer);
        for(const chunk of [...t.chunks].reverse())reader.accept(chunk);
        await b.receiveSyncOperations((await reader.finish()).operations);
        const p=await b.planSyncOperations();if(p.plan)await b.applySyncPlan(p.plan.id);return p;
      },
      async receiver(label:string){return rigs[label].repo.readSyncReceiver();},
      async close(){await Promise.all(Object.values(rigs).map((r:any)=>r.repo.close()));},
    };
    (window as any).__reportRig=api; // TEST ONLY, never added to production IPC/window.
  },active);
}
test.describe("5c2a actual independent report stores, no native business LAN",()=>{
  test.setTimeout(180000);
  test("real PDF uses independent A/C namespaces; versions and relay preserve originals",async({page})=>{
    await boot(page);
    const result=await page.evaluate(async()=>{
      const x=(window as any).__reportRig,a=await x.issue("A"),c=await x.issue("C");
      await x.send("A","B");await x.send("B","C");await x.send("C","B");await x.send("B","A");
      await x.rigs.A.repo.command((s:any)=>s.saveVisitDetails("report-job-A",{publicWork:"Synthetic version two",clientRemarks:"",zoneId:null},0));
      const v2=await x.issue("A"),n=await x.numbering("A");
      const records=await Promise.all(["A","B","C"].map(async label=>({data:await x.data(label),receiver:await x.receiver(label)})));
      await x.close();return{a,c,v2,n,records};
    });
    expect(result.a.pdfHeader).toBe("%PDF-");expect(result.c.pdfHeader).toBe("%PDF-");
    expect(result.a.record.number).not.toBe(result.c.record.number);
    expect(result.v2.record.number).toBe(result.a.record.number);expect(result.v2.record.version).toBe(2);
    expect(result.n.nextSequence).toBe(2);
    for(const r of result.records)expect(r.receiver.reportConflicts).toEqual([]);
    expect(result.records[0].data.jobs.find((j:any)=>j.id==="report-job-A").reports[0]).toEqual(result.a.record);
  });
  test("historical identical numbers remain distinct durable conflicts across reload, without blocking a client",async({page})=>{
    await boot(page,false);
    const saved=await page.evaluate(async()=>{
      const x=(window as any).__reportRig,a=await x.issue("A"),c=await x.issue("C");
      for(const label of ["A","B","C"])await x.enable(label);
      await x.rigs.A.repo.command((s:any)=>s.saveClient({id:"safe-number-client",name:"Synthetic",phone:"",email:"",notes:""},null));
      await x.send("A","B");await x.send("B","C");await x.send("C","B");await x.send("B","A");
      const before=await x.receiver("B");await x.close();return{a,c,before};
    });
    await page.reload();await boot(page);
    const result=await page.evaluate(async()=>{
      const x=(window as any).__reportRig,b=await x.receiver("B");
      await x.send("A","B");await x.send("B","C");
      const records=await Promise.all(["A","B","C"].map((label:string)=>x.data(label)));
      return{b,records,after:await x.receiver("B")};
    });
    expect(saved.a.record.number).toBe(saved.c.record.number);expect(saved.a.record.id).not.toBe(saved.c.record.id);
    expect(result.b.reportConflicts).toEqual(saved.before.reportConflicts);
    expect(result.after.reportConflicts).toEqual(saved.before.reportConflicts);
    expect(result.b.reportConflicts.some((c:any)=>c.type==="number")).toBe(true);
    for(const d of result.records)expect(d.clients.some((c:any)=>c.id==="safe-number-client")).toBe(true);
    expect(result.records[0].jobs.find((j:any)=>j.id==="report-job-A").reports[0]).toEqual(saved.a.record);
    expect(result.records[2].jobs.find((j:any)=>j.id==="report-job-C").reports[0]).toEqual(saved.c.record);
  });
  test("a forced full namespace collision freezes issuance and never renumbers either document",async({page})=>{
    await boot(page);
    const result=await page.evaluate(async()=>{
      const x=(window as any).__reportRig,real=crypto.randomUUID.bind(crypto),namespace="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      const issue=async(label:string)=>{
        let count=0;
        crypto.randomUUID=()=>++count===2?namespace:real();
        try{return await x.issue(label);}finally{crypto.randomUUID=real;}
      };
      const a=await issue("A"),c=await issue("C");
      await x.send("A","B");await x.send("B","C");await x.send("C","B");await x.send("B","A");
      await x.rigs.A.repo.command((s:any)=>s.saveVisitDetails("report-job-A",{publicWork:"Synthetic changed",clientRemarks:"",zoneId:null},0));
      const before=await x.rigs.A.repo.read(),n=await x.numbering("A");
      let error="";try{await x.prepare("A");}catch(e){error=String(e);}
      return{a,c,before,after:await x.rigs.A.repo.read(),n,next:await x.numbering("A"),error,receiver:await x.receiver("A")};
    });
    expect(result.a.record.number).toBe(result.c.record.number);expect(result.a.record.id).not.toBe(result.c.record.id);
    expect(result.receiver.reportConflicts.some((c:any)=>c.type==="namespace")).toBe(true);
    expect(result.error).toContain("REPORT_NAMESPACE_COLLISION");expect(result.after).toEqual(result.before);
    expect(result.next).toEqual(result.n);
  });
  test("quota on history commit keeps Data, journal, reservation and receiver; retry saves the same number",async({page})=>{
    await boot(page);
    const result=await page.evaluate(async()=>{
      const x=(window as any).__reportRig,p=await x.prepare("A"),r=x.rigs.A.repo;
      const before={data:await r.read(),journal:await r.readSyncJournal(),receiver:await r.readSyncReceiver(),numbering:await x.numbering("A")};
      const put=IDBObjectStore.prototype.put;let failed=false;
      IDBObjectStore.prototype.put=function(value:unknown,key?:IDBValidKey){
        if(this.name==="sync"&&key==="report-numbering-v1")throw new DOMException("Synthetic quota","QuotaExceededError");
        return put.call(this,value,key);
      };
      try{await x.service("A").save("report-job-A",p);}catch{failed=true;}finally{IDBObjectStore.prototype.put=put;}
      const rolled={data:await r.read(),journal:await r.readSyncJournal(),receiver:await r.readSyncReceiver(),numbering:await x.numbering("A")};
      await x.service("A").save("report-job-A",p);await x.service("A").save("report-job-A",p);
      const after=await x.data("A"),numbering=await x.numbering("A");return{before,rolled,failed,after,numbering,record:p.record};
    });
    expect(result.failed).toBe(true);expect(result.rolled).toEqual(result.before);
    expect(result.after.jobs[0].reports).toEqual([result.record]);expect(result.numbering.pending).toHaveLength(0);
  });
  test("full browser process restart retains high-water and an abandoned preview cannot reuse its number",async()=>{
    const dir=await mkdtemp(path.join(tmpdir(),"gm011b-numbers-"));
    let context=await chromium.launchPersistentContext(dir,{headless:true,baseURL:"http://127.0.0.1:5173"});
    try{
      let page=await context.newPage();await boot(page);
      const old=await page.evaluate(async()=>{
        const x=(window as any).__reportRig,p=await x.prepare("A");const n=await x.numbering("A");await x.close();
        return{number:p.record.number,n};
      });
      await context.close();context=await chromium.launchPersistentContext(dir,{headless:true,baseURL:"http://127.0.0.1:5173"});
      page=await context.newPage();await boot(page);
      const next=await page.evaluate(async()=>{const x=(window as any).__reportRig,p=await x.issue("A");return{p,n:await x.numbering("A")};});
      expect(next.p.record.number).not.toBe(old.number);expect(next.n.claim).toEqual(old.n.claim);
      expect(next.n.nextSequence).toBe(3);expect(next.p.record.number.endsWith("/000002")).toBe(true);
    }finally{await context.close();await rm(dir,{recursive:true,force:true});}
  });
  test("scoped photo report keeps local JPEG and full v12 ZIP, without creating a remote complete document",async({page})=>{
    await boot(page);
    const result=await page.evaluate(async()=>{
      const x=(window as any).__reportRig,sp="/src/photos/service.ts",ip="/src/photos/images.ts",bp="/src/photos/backup.ts",mp="/src/reports/model.ts";
      const {PhotoService}=await import(sp),{BrowserPhotoProcessor}=await import(ip),
        {makeFullBackup,readFullBackup}=await import(bp),{defaultReportOptions}=await import(mp);
      const canvas=document.createElement("canvas");canvas.width=2;canvas.height=2;canvas.getContext("2d")!.fillRect(0,0,2,2);
      const blob=await new Promise<Blob>(ok=>canvas.toBlob(b=>ok(b!),"image/jpeg")),r=x.rigs.A;
      const photos=new PhotoService({snapshot:()=>x.data("A"),appendPhotos:async(p:any[])=>{await r.repo.command((s:any)=>s.appendPhotos(p));}},r.assets,new BrowserPhotoProcessor());
      const [photo]=await photos.add([{id:"scoped-pixel",blob,name:"synthetic.jpg"}],{clientId:"client-1",gardenId:"garden-1",
        zoneId:null,jobId:"report-job-A",category:"before",description:"Synthetic",capturedDate:null});
      const issued=await x.issue("A",{...defaultReportOptions(),showPhotos:true,photoIds:[photo.id]});
      const before=await x.data("A");await x.send("A","B");
      const zip=await readFullBackup(await makeFullBackup(before,r.assets)),after=await x.data("A"),b=await x.data("B");
      const asset=await r.assets.get(photo.assetId),sha=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",await asset.image.arrayBuffer()))).map(n=>n.toString(16).padStart(2,"0")).join("");
      return{issued,before,after,b,zipData:zip.data,count:zip.assets.length,sha,photo};
    });
    expect(result.after).toEqual(result.before);expect(result.sha).toBe(result.photo.sha256);
    expect(result.zipData).toEqual(result.before);expect(result.count).toBe(1);
    expect(result.b.photos).toEqual([]);expect(result.b.jobs.find((j:any)=>j.id==="report-job-A")?.reports??[]).toEqual([]);
    expect(result.before.jobs[0].reports[0]).toEqual(result.issued.record);
  });
});
for(const width of [360,390,430])test("active numbered ReportPanel uses the canonical reservation at "+width+"px",async({page})=>{
  await page.setViewportSize({width,height:850});await page.goto("/");await page.locator(".app-shell").waitFor();
  await page.evaluate(async()=>{
    const p="/src/data/atomic.ts",{AtomicRepository}=await import(p),r=new AtomicRepository(localStorage);
    await r.initialize();await r.enableSyncJournal("44444444-4444-4444-8444-444444444444");await r.close();
  });
  await page.getByRole("button",{name:"Więcej",exact:true}).click();
  await page.getByRole("dialog",{name:"Więcej opcji",exact:true}).getByRole("button",{name:"Historia prac",exact:true}).click();
  await page.locator(".job-title-button").filter({hasText:"Przygotowanie ogrodu do sezonu"}).click();
  await page.getByRole("dialog",{name:"Szczegóły zlecenia",exact:true}).getByRole("button",{name:"Podsumowanie wizyty",exact:true}).click();
  await page.getByRole("dialog",{name:"Podsumowanie wizyty",exact:true}).getByRole("button",{name:"Generuj raport PDF",exact:true}).click();
  const panel=page.getByRole("dialog",{name:"Raport PDF dla klienta",exact:true});
  await panel.getByRole("button",{name:"Przygotuj podgląd raportu",exact:true}).click();
  await expect(panel.locator(".report-number")).toContainText(/BO\/\d{4}\/[0-9a-f-]{36}\/000001/);
  const download=page.waitForEvent("download");await panel.getByRole("button",{name:"Zapisz raport i pobierz PDF",exact:true}).click();
  await download;await settled(page);
  const record=await page.evaluate(()=>JSON.parse(localStorage.getItem("garden-manager:v1")!).data.jobs.find((j:any)=>j.id==="job-5").reports[0]);
  await expect(panel.locator(".report-number")).toContainText(record.number);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});


async function bootDocuments(page:Page,active=true) {
  await boot(page,active);
  await page.evaluate(async()=>{
    const x=(window as any).__reportRig,oldSend=x.send;
    x.send=async(from:string,to:string)=>{await x.rigs[from].repo.prepareSyncReports();return oldSend(from,to);};
    x.packet=async(from:string,to:string)=>{
      if([from,to].sort().join("")==="AC")throw Error("Direct A-C forbidden");
      const cp="/src/sync/packets.ts",codec=await import(cp),a=x.rigs[from].repo,b=x.rigs[to].repo;
      await a.prepareSyncReports();
      const t=await codec.prepareTransfer(await a.readSyncJournal(),(await b.readSyncJournal()).log.known),reader=new codec.TransferAssembler(t.offer);
      for(const part of [...t.chunks].reverse())reader.accept(part);
      return(await reader.finish()).operations;
    };
    x.apply=async(label:string)=>{const r=x.rigs[label].repo,p=await r.planSyncOperations();if(p.plan)await r.applySyncPlan(p.plan.id);return p;};
    x.checkpoint=async(label:string)=>{const r=x.rigs[label].repo;return{state:await r.read(),journal:await r.readSyncJournal(),receiver:await r.readSyncReceiver()};};
    x.addPixel=async(label:string,logo=false)=>{
      const sp="/src/photos/service.ts",ip="/src/photos/images.ts",{PhotoService}=await import(sp),{BrowserPhotoProcessor}=await import(ip),r=x.rigs[label];
      const c=document.createElement("canvas");c.width=3;c.height=3;c.getContext("2d")!.fillStyle=label==="A"?"#118811":"#1122cc";c.getContext("2d")!.fillRect(0,0,3,3);
      const blob=await new Promise<Blob>(ok=>c.toBlob(b=>ok(b!),"image/jpeg"));
      const port={snapshot:()=>x.data(label),appendPhotos:async(p:any[])=>{await r.repo.command((s:any)=>s.appendPhotos(p));},
        restoreSnapshot:async(...args:any[])=>{await r.repo.command((s:any)=>s.restoreSnapshot(...args));}};
      const service=new PhotoService(port,r.assets,new BrowserPhotoProcessor());
      const [photo]=await service.add([{id:"document-pixel-"+label,blob,name:"synthetic.jpg"}],{clientId:"client-1",gardenId:"garden-1",
        zoneId:null,jobId:"report-job-"+label,category:logo?"other":"before",description:"Synthetic document asset",capturedDate:null});
      return photo;
    };
  });
}
test.describe("5c2b real durable document receiving (not native business LAN)",()=>{
  test.setTimeout(180000);
  test("exact historical report A-B-C, version two, original proof UUID and safe replay",async({page})=>{
    await bootDocuments(page);
    const result=await page.evaluate(async()=>{
      const x=(window as any).__reportRig,first=await x.issue("A");
      await x.send("A","B");
      await x.rigs.A.repo.command((s:any)=>s.saveVisitDetails("report-job-A",{publicWork:"Synthetic later snapshot",clientRemarks:"",zoneId:null},0));
      await x.send("A","B");
      const historical=(await x.data("B")).jobs.find((j:any)=>j.id==="report-job-A").reports;
      const second=await x.issue("A");await x.send("A","B");await x.send("B","C");
      const c=await x.checkpoint("C"),before=await x.data("C");
      await x.send("A","B");await x.send("B","C");
      const rows=c.journal.log.operations.filter((o:any)=>o.changes.some((m:any)=>m.key.startsWith("reportDocuments/")));
      return{first,second,historical,c,after:await x.data("C"),before,rows};
    });
    expect(result.first.pdfHeader).toBe("%PDF-");expect(result.second.record.version).toBe(2);
    expect(result.second.record.number).toBe(result.first.record.number);
    expect(result.historical).toEqual([result.first.record]);
    expect(result.c.state.data.jobs.find((j:any)=>j.id==="report-job-A").reports).toEqual([result.first.record,result.second.record]);
    expect(result.after).toEqual(result.before);expect(result.rows).toHaveLength(2);
    expect(result.rows.every((o:any)=>o.origin==="11111111-1111-4111-8111-111111111111")).toBe(true);
    expect(result.c.receiver.reportAvailability.filter((r:any)=>r.status==="portable")).toHaveLength(2);
    expect(result.after.timer).toBeNull();
  });
  test("process restarts before apply and after commit preserve exact report and lost confirmation",async()=>{
    const dir=await mkdtemp(path.join(tmpdir(),"gm011b-documents-"));
    let context=await chromium.launchPersistentContext(dir,{headless:true,baseURL:"http://127.0.0.1:5173"});
    try {
      let page=await context.newPage();await bootDocuments(page);
      const saved=await page.evaluate(async()=>{
        const x=(window as any).__reportRig,p=await x.issue("A"),before=await x.data("B");
        await x.rigs.B.repo.receiveSyncOperations(await x.packet("A","B"));
        const receiver=await x.receiver("B"),after=await x.data("B");await x.close();return{p,before,after,receiver};
      });
      expect(saved.after).toEqual(saved.before);
      await context.close();context=await chromium.launchPersistentContext(dir,{headless:true,baseURL:"http://127.0.0.1:5173"});
      page=await context.newPage();await bootDocuments(page);
      const committed=await page.evaluate(async()=>{
        const x=(window as any).__reportRig,r=x.rigs.B.repo,p=await r.planSyncOperations();
        const before=await x.data("B"),receipt=await r.applySyncPlan(p.plan.id),after=await x.data("B");await x.close();return{before,after,receipt,plan:p.plan};
      });
      expect(committed.before).toEqual(saved.before);
      expect(committed.after.jobs.find((j:any)=>j.id==="report-job-A").reports).toEqual([saved.p.record]);
      await context.close();context=await chromium.launchPersistentContext(dir,{headless:true,baseURL:"http://127.0.0.1:5173"});
      page=await context.newPage();await bootDocuments(page);
      const retried=await page.evaluate(async id=>{const x=(window as any).__reportRig,receipt=await x.rigs.B.repo.applySyncPlan(id);await x.send("B","C");return{receipt,b:await x.data("B"),c:await x.data("C")};},committed.plan.id);
      expect(retried.receipt).toEqual(committed.receipt);
      expect(retried.b).toEqual(committed.after);expect(retried.c.jobs.find((j:any)=>j.id==="report-job-A").reports).toEqual([saved.p.record]);
    }finally{await context.close();await rm(dir,{recursive:true,force:true});}
  });
  for(const fault of ["snapshot","checksum","identity","parent","shape"])test("isolates "+fault+" corruption with valid outer packet and preserves an independent client",async({page})=>{
    await bootDocuments(page);
    const result=await page.evaluate(async fault=>{
      const x=(window as any).__reportRig;
      await x.rigs.A.repo.command((s:any)=>s.saveClient({id:"safe-document-client",name:"Synthetic",phone:"",email:"",notes:""},null));
      await x.issue("A");
      const ops=await x.packet("A","B"),o=ops.find((p:any)=>p.changes.some((m:any)=>m.key.startsWith("reports/")));
      if(fault==="snapshot")o.changes.find((m:any)=>m.key.startsWith("reports/")).after.report.snapshot.workDescription="Damaged";
      if(fault==="checksum")ops.find((p:any)=>p.changes.some((m:any)=>m.key.startsWith("reportDocuments/"))).changes[0].after.documentSha256="0".repeat(64);
      if(fault==="identity")o.changes=o.changes.filter((m:any)=>!m.key.startsWith("visits/"));
      if(fault==="parent")for(const op of ops)for(const c of op.changes)if(c.key==="visits/report-job-A")for(const v of [c.before,c.after])if(v)v.job.gardenId="missing-source-parent";
      if(fault==="shape")o.changes.find((m:any)=>m.key.startsWith("reports/")).after.report.extra="invalid";
      const received=await x.rigs.B.repo.receiveSyncOperations(ops);await x.apply("B");
      return{received,b:await x.data("B"),rx:await x.receiver("B")};
    },fault);
    expect(result.b.jobs.find((j:any)=>j.id==="report-job-A")?.reports??[]).toEqual([]);
    expect(result.b.clients.some((c:any)=>c.id==="safe-document-client")).toBe(true);
    if(fault==="shape")expect(result.received.rejected.length).toBeGreaterThan(0);
    else if(fault==="parent")expect(result.rx.receipts.some((r:any)=>r.stage==="waiting-records")).toBe(true);
    else expect(result.rx.reportAvailability.some((v:any)=>v.status==="conflict")).toBe(true);
  });
  test("quota and explicit abort roll back whole report group before durable applied",async({page})=>{
    await bootDocuments(page);
    const result=await page.evaluate(async()=>{
      const x=(window as any).__reportRig,p=await x.issue("A"),r=x.rigs.B.repo;
      await r.receiveSyncOperations(await x.packet("A","B"));const plan=await r.planSyncOperations(),before=await x.checkpoint("B");
      const put=IDBObjectStore.prototype.put,attempts:any[]=[];
      for(const mode of ["quota","abort"]) {
        IDBObjectStore.prototype.put=function(value:unknown,key?:IDBValidKey){
          if(this.name==="sync"&&key==="receiver-v1") {
            if(mode==="quota")throw new DOMException("Synthetic quota","QuotaExceededError");
            this.transaction.abort();throw new DOMException("Synthetic abort","AbortError");
          }
          return put.call(this,value,key);
        };
        let failed=false;try{await r.applySyncPlan(plan.plan.id);}catch{failed=true;}finally{IDBObjectStore.prototype.put=put;}
        attempts.push({failed,state:await x.checkpoint("B")});
      }
      const receipt=await r.applySyncPlan(plan.plan.id),again=await r.applySyncPlan(plan.plan.id);
      return{before,attempts,receipt,again,after:await x.data("B"),p};
    });
    for(const a of result.attempts){expect(a.failed).toBe(true);expect(a.state).toEqual(result.before);}
    expect(result.again).toEqual(result.receipt);
    expect(result.after.jobs.find((j:any)=>j.id==="report-job-A").reports).toEqual([result.p.record]);
  });
  for(const kind of ["photo","logo"])test(kind+" stays source-only across relay/reload; JPEG/ZIP and restore-review remain safe",async({page})=>{
    await bootDocuments(page);
    const saved=await page.evaluate(async kind=>{
      const x=(window as any).__reportRig,photo=await x.addPixel("A",kind==="logo"),own=await x.addPixel("B"),
        mp="/src/reports/model.ts",bp="/src/photos/backup.ts",sp="/src/photos/service.ts",ip="/src/photos/images.ts",
        {defaultReportOptions}=await import(mp),{makeFullBackup,readFullBackup}=await import(bp),
        {PhotoService}=await import(sp),{BrowserPhotoProcessor}=await import(ip);
      const options={...defaultReportOptions(),showPhotos:kind==="photo",photoIds:kind==="photo"?[photo.id]:[],logoPhotoId:kind==="logo"?photo.id:null};
      const report=await x.issue("A",options),source=await x.data("A"),local=await x.data("B");
      await x.send("A","B");await x.send("B","C");
      const b=await x.data("B"),c=await x.data("C"),rx=await x.receiver("B");
      const hash=async(blob:Blob)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",await blob.arrayBuffer()))).map(n=>n.toString(16).padStart(2,"0")).join("");
      const original=await x.rigs.A.assets.get(photo.assetId),untouched=await x.rigs.B.assets.get(own.assetId);
      const backup=await readFullBackup(await makeFullBackup(source,x.rigs.A.assets)),oldBackup=await readFullBackup(await makeFullBackup(local,x.rigs.B.assets));
      const beforeJournal=await x.rigs.B.repo.readSyncJournal();
      const service=new PhotoService({snapshot:()=>x.data("B"),restoreSnapshot:async(...a:any[])=>{await x.rigs.B.repo.command((s:any)=>s.restoreSnapshot(...a));}},
        x.rigs.B.assets,new BrowserPhotoProcessor());
      await service.importFull(oldBackup,JSON.stringify(b));
      let blocked=false;try{await x.rigs.B.repo.planSyncOperations();}catch{blocked=true;}
      const afterJournal=await x.rigs.B.repo.readSyncJournal(),afterReceiver=await x.receiver("B");await x.close();
      return{report,photo,own,source,local,b,c,rx,backupData:backup.data,backupCount:backup.assets.length,
        sha:await hash(original.image),ownSha:await hash(untouched.image),beforeJournal,afterJournal,afterReceiver,blocked};
    },kind);
    expect(saved.sha).toBe(saved.photo.sha256);expect(saved.ownSha).toBe(saved.own.sha256);
    expect(saved.backupData).toEqual(saved.source);expect(saved.backupCount).toBe(1);
    expect(saved.b.photos).toEqual(saved.local.photos);expect(saved.c.photos).toEqual([]);
    for(const d of [saved.b,saved.c])expect(d.jobs.find((j:any)=>j.id==="report-job-A")?.reports??[]).toEqual([]);
    const limited=saved.rx.reportAvailability.find((v:any)=>v.reportId===saved.report.record.id);
    expect(limited.status).toBe("source-only");expect(limited.identity.number).toBe(saved.report.record.number);
    expect(limited.identity.fingerprint).toBe(saved.report.record.fingerprint);
    expect(limited.reason).toContain("pełna zawartość");
    expect(saved.afterJournal.mode).toBe("restore-review");expect(saved.afterJournal.log.operations.length).toBeGreaterThanOrEqual(saved.beforeJournal.log.operations.length);
    expect(saved.blocked).toBe(true);expect(saved.afterReceiver.reportAvailability).toEqual(saved.rx.reportAvailability);
    await page.reload();await bootDocuments(page);
    const persisted=await page.evaluate(async()=>{const x=(window as any).__reportRig;return{b:await x.receiver("B"),c:await x.receiver("C")};});
    expect(persisted.b.reportAvailability.find((v:any)=>v.reportId===saved.report.record.id).status).toBe("source-only");
    expect(persisted.c.reportAvailability.find((v:any)=>v.reportId===saved.report.record.id).status).toBe("source-only");
  });
});
