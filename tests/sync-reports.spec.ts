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
  await page.getByRole("navigation",{name:"Nawigacja główna"}).getByRole("button",{name:"Historia prac",exact:true}).click();
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
