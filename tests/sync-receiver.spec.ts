import { expect, test, chromium, type Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

async function boot(page:Page) {
  await page.goto("/"); await page.locator(".app-shell").waitFor();
  await page.evaluate(async()=>{
    const atomic="/src/data/atomic.ts", demo="/src/data/demo.ts", repoPath="/src/data/repository.ts",
      packets="/src/sync/packets.ts", causal="/src/sync/causal.ts";
    const {AtomicRepository}=await import(atomic), {createDemoData}=await import(demo),
      {STORAGE_KEY}=await import(repoPath), codec=await import(packets), engine=await import(causal);
    const labels=["A","B","C"], origins=[
      "11111111-1111-4111-8111-111111111111","22222222-2222-4222-8222-222222222222","33333333-3333-4333-8333-333333333333"];
    const rigs:any={};
    for(let i=0;i<labels.length;i++) {
      const label=labels[i], prefix="gm011b-receiver-fixture:"+label+":";
      const storage={getItem:(k:string)=>localStorage.getItem(prefix+k),setItem:(k:string,v:string)=>localStorage.setItem(prefix+k,v)};
      if(storage.getItem(STORAGE_KEY)===null) storage.setItem(STORAGE_KEY,JSON.stringify({version:12,data:createDemoData(new Date("2026-11-22T12:00:00Z"))}));
      const repo=new AtomicRepository(storage,indexedDB,"gm011b-receiver-"+label);
      await repo.initialize();
      if(!await repo.readSyncJournal())await repo.enableSyncJournal(origins[i]);
      rigs[label]=repo;
    }
    const api:any={
      rigs,codec,engine,
      async client(label:string,id:string,patch:any={}) {
        const r=rigs[label], old=(await r.read()).data.clients.find((c:any)=>c.id===id);
        await r.command((s:any)=>s.saveClient({...old,id,name:old?.name??"Synthetic "+id,
          phone:old?.phone??"",email:old?.email??"",notes:old?.notes??"",...patch},old??null));
      },
      async send(from:string,to:string,apply=true) {
        if([from,to].sort().join("")==="AC")throw Error("A and C must never communicate directly in this test");
        const source=await rigs[from].readSyncJournal(), target=await rigs[to].readSyncJournal();
        const packet=await codec.prepareTransfer(source,target.log.known), parser=new codec.TransferAssembler(packet.offer);
        for(const c of [...packet.chunks].reverse())parser.accept(c);
        const bundle=await parser.finish();
        const receipt=await rigs[to].receiveSyncOperations(bundle.operations);
        const plan=await rigs[to].planSyncOperations();
        const commit=apply&&plan.plan?await rigs[to].applySyncPlan(plan.plan.id):null;
        return {receipt,plan,commit};
      },
      async exchange(a:string,b:string){await api.send(a,b);await api.send(b,a);},
      async data(label:string){return (await rigs[label].read()).data;},
      async receiver(label:string){return rigs[label].readSyncReceiver();},
      async close(){await Promise.all(Object.values(rigs).map((r:any)=>r.close()));},
    };
    (window as any).__receiverRig=api; // Test-only; production source exposes no global database API.
  });
}
test.describe("GM-011B actual independent IndexedDB databases (no native transport)",()=>{
  test.setTimeout(120000);
  test("A -> B -> C, independent B/C records, repeated exchanges and unchanged origin",async({page})=>{
    await boot(page);
    const result=await page.evaluate(async()=>{
      const x=(window as any).__receiverRig;
      await x.client("A","relay");
      const original=(await x.rigs.A.readSyncJournal()).log.operations.at(-1);
      const nextB=(await x.rigs.B.readSyncJournal()).log.nextSequence;
      await x.send("A","B");await x.send("B","C");
      const receipt=(await x.receiver("C")).receipts.find((r:any)=>r.operation.id===original.id);
      const bNextAfterReceipt=(await x.rigs.B.readSyncJournal()).log.nextSequence;
      await x.client("B","from-b");await x.client("C","from-c");
      await x.exchange("B","C");await x.exchange("A","B");
      for(let i=0;i<2;i++){await x.exchange("A","B");await x.exchange("B","C");}
      const records=await Promise.all(["A","B","C"].map(async label=>{
        const data=await x.data(label), journal=await x.rigs[label].readSyncJournal();
        return {ids:data.clients.filter((c:any)=>["relay","from-b","from-c"].includes(c.id)).map((c:any)=>c.id).sort(),
          unique:new Set(journal.log.operations.map((o:any)=>o.id)).size===journal.log.operations.length,
          original:journal.log.operations.find((o:any)=>o.id===original.id)};
      }));
      await x.close();return{records,original,receipt,nextB,bNextAfterReceipt};
    });
    for(const record of result.records) {
      expect(record.ids).toEqual(["from-b","from-c","relay"]);expect(record.unique).toBe(true);expect(record.original).toEqual(result.original);
    }
    expect(result.receipt.stage).toBe("applied");expect(result.receipt.appliedRevision).not.toBeNull();
    expect(result.bNextAfterReceipt).toBe(result.nextB);
  });
  test("disjoint fields merge; same field persists as a conflict across reload and decision reaches C",async({page})=>{
    await boot(page);
    const token=await page.evaluate(async()=>{
      const x=(window as any).__receiverRig;
      await x.client("A","fields");await x.exchange("A","B");await x.exchange("B","C");
      await x.client("A","fields",{phone:"111"});await x.client("B","fields",{notes:"Keep this independent note"});
      await x.exchange("A","B");
      const merged=(await x.data("A")).clients.find((c:any)=>c.id==="fields");
      if(merged.phone!=="111"||merged.notes!=="Keep this independent note")throw Error("Disjoint fields lost");
      await x.client("A","fields",{phone:"222"});await x.client("B","fields",{phone:"333"});
      await x.send("A","B");
      const conflict=(await x.receiver("B")).conflicts.find((c:any)=>c.key==="clients/fields"&&c.status==="open");
      const oldData=await x.data("B");
      await x.close();return {conflict,oldData};
    });
    await page.reload();await boot(page);
    const result=await page.evaluate(async expected=>{
      const x=(window as any).__receiverRig, conflict=(await x.receiver("B")).conflicts.find((c:any)=>c.id===expected.id);
      const remote=conflict.remote.find((r:any)=>r.value?.phone==="222");
      const decision=await x.rigs.B.resolveSyncConflict({conflictId:conflict.id,token:conflict.token,choice:{kind:"remote",operationId:remote.operationId}});
      await x.send("B","C");await x.send("B","A");
      const records=await Promise.all(["A","B","C"].map(async label=>(await x.data(label)).clients.find((c:any)=>c.id==="fields")));
      return {conflict,decision,records,status:(await x.receiver("B")).conflicts.find((c:any)=>c.id===conflict.id).status};
    },token.conflict);
    expect(result.conflict).toEqual(token.conflict);
    expect(result.status).toBe("resolved");
    for(const c of result.records)expect(c).toMatchObject({phone:"222",notes:"Keep this independent note"});
  });
  test("delete, old replay, edit/delete conflict and independent progress survive reload",async({page})=>{
    await boot(page);
    const result=await page.evaluate(async()=>{
      const x=(window as any).__receiverRig;
      await x.client("A","deleted");await x.exchange("A","B");await x.exchange("B","C");
      const stale=(await x.rigs.C.readSyncJournal()).log.operations;
      await x.rigs.A.command((s:any)=>s.deleteClient("deleted"));await x.send("A","B");
      await x.rigs.B.receiveSyncOperations(stale);
      let p=await x.rigs.B.planSyncOperations();if(p.plan)await x.rigs.B.applySyncPlan(p.plan.id);
      const afterReplay=(await x.data("B")).clients.some((c:any)=>c.id==="deleted");
      await x.client("C","deleted",{phone:"offline"});
      await x.client("C","independent");
      await x.send("C","B");
      const conflict=(await x.receiver("B")).conflicts.find((c:any)=>c.key==="clients/deleted"&&c.status==="open");
      const independent=(await x.data("B")).clients.some((c:any)=>c.id==="independent");
      await x.close();return {afterReplay,conflict,independent};
    });
    expect(result.afterReplay).toBe(false);expect(result.conflict.reason).toBe("edit-delete");expect(result.independent).toBe(true);
    await page.reload();await boot(page);
    expect(await page.evaluate(async()=>{
      const x=(window as any).__receiverRig;return {deleted:(await x.data("B")).clients.some((c:any)=>c.id==="deleted"),
        conflict:(await x.receiver("B")).conflicts.some((c:any)=>c.key==="clients/deleted"&&c.status==="open")};
    })).toEqual({deleted:false,conflict:true});
  });
  test("reverse-order causal gaps and explicit garden/zone parent dependencies",async({page})=>{
    await boot(page);
    const result=await page.evaluate(async()=>{
      const x=(window as any).__receiverRig;
      await x.client("A","parent");
      const garden={id:"garden-sync",clientId:"parent",name:"Synthetic garden",address:"Synthetic",area:20,notes:"",
        zones:[{id:"zone-sync",name:"Synthetic lawn",type:"trawnik",area:10,length:null,plants:"",requirements:"",treatments:""}]};
      await x.rigs.A.command((s:any)=>s.saveGarden(garden,null));
      const source=(await x.rigs.A.readSyncJournal()).log, last=source.operations.at(-1);
      await x.rigs.B.receiveSyncOperations([last]);
      const gap=(await x.receiver("B")).receipts.find((r:any)=>r.operation.id===last.id);
      const before=(await x.data("B")).gardens.some((g:any)=>g.id===garden.id);
      await x.rigs.B.receiveSyncOperations([...source.operations].reverse());
      const plan=await x.rigs.B.planSyncOperations();
      const untouched=(await x.data("B")).gardens.some((g:any)=>g.id===garden.id);
      await x.rigs.B.applySyncPlan(plan.plan.id);
      const saved=(await x.data("B")).gardens.find((g:any)=>g.id===garden.id);
      await x.send("B","C");
      const forwarded=(await x.data("C")).gardens.find((g:any)=>g.id===garden.id);
      return{gap,before,untouched,saved,forwarded,garden};
    });
    expect(result.gap.stage).toBe("waiting-dependencies");expect(result.before).toBe(false);expect(result.untouched).toBe(false);
    expect(result.saved).toEqual(result.garden);expect(result.forwarded).toEqual(result.garden);
  });
  test("actual browser process restart between receipt and apply, then durable lost-ack retry",async()=>{
    const dir=await mkdtemp(path.join(tmpdir(),"gm011b-three-db-"));
    let context=await chromium.launchPersistentContext(dir,{headless:true,baseURL:"http://127.0.0.1:5173"});
    try {
      let page=await context.newPage();await boot(page);
      const prepared=await page.evaluate(async()=>{
        const x=(window as any).__receiverRig;
        await x.client("A","browser-restart");await x.send("A","B",false);
        const receiver=await x.receiver("B"), journal=await x.rigs.B.readSyncJournal();
        await x.close();return {plan:receiver.plan,origin:journal.log.installation,receiver};
      });
      await context.close();
      context=await chromium.launchPersistentContext(dir,{headless:true,baseURL:"http://127.0.0.1:5173"});
      page=await context.newPage();await boot(page);
      const applied=await page.evaluate(async expected=>{
        const x=(window as any).__receiverRig;
        const receiver=await x.receiver("B"), before=(await x.data("B")).clients.some((c:any)=>c.id==="browser-restart");
        const first=await x.rigs.B.applySyncPlan(expected.plan.id), state=await x.rigs.B.read();
        const retry=await x.rigs.B.applySyncPlan(expected.plan.id), after=await x.rigs.B.read();
        const present=(await x.data("B")).clients.some((c:any)=>c.id==="browser-restart");
        await x.close();return {receiver,before,first,retry,state,after,present,origin:(await x.rigs.B.readSyncJournal()).log.installation};
      },prepared);
      expect(applied.receiver).toEqual(prepared.receiver);expect(applied.before).toBe(false);expect(applied.present).toBe(true);
      expect(applied.origin).toBe(prepared.origin);expect(applied.retry).toEqual(applied.first);expect(applied.after).toEqual(applied.state);
    } finally {await context.close();await rm(dir,{recursive:true,force:true});}
  });
  test("real IDB quota abort rolls back Data, source and applied metadata; retries cannot duplicate",async({page})=>{
    await boot(page);
    const result=await page.evaluate(async()=>{
      const x=(window as any).__receiverRig;
      await x.client("A","quota");await x.send("A","B",false);
      const before=await x.rigs.B.read(), journal=await x.rigs.B.readSyncJournal(), receiver=await x.receiver("B"), plan=receiver.plan;
      const put=IDBObjectStore.prototype.put;let failed=false;
      IDBObjectStore.prototype.put=function(value:unknown,key?:IDBValidKey){
        if(this.name==="sync"&&key==="receiver-v1")throw new DOMException("Synthetic quota","QuotaExceededError");
        return put.call(this,value,key);
      };
      try{await x.rigs.B.applySyncPlan(plan.id);}catch{failed=true;}finally{IDBObjectStore.prototype.put=put;}
      const rolled={data:await x.rigs.B.read(),journal:await x.rigs.B.readSyncJournal(),receiver:await x.receiver("B")};
      const first=await x.rigs.B.applySyncPlan(plan.id), after=await x.rigs.B.read(), retry=await x.rigs.B.applySyncPlan(plan.id);
      return{failed,before,journal,receiver,rolled,first,after,retry,last:await x.rigs.B.read()};
    });
    expect(result.failed).toBe(true);expect(result.rolled).toEqual({data:result.before,journal:result.journal,receiver:result.receiver});
    expect(result.retry).toEqual(result.first);expect(result.last).toEqual(result.after);
  });
  test("local photo blobs and references, timer, finances and unsupported atomic groups remain safe",async({page})=>{
    await boot(page);
    const result=await page.evaluate(async()=>{
      const x=(window as any).__receiverRig, assetsPath="/src/photos/assets.ts", servicePath="/src/photos/service.ts",
        imagePath="/src/photos/images.ts", deskPath="/src/desk/model.ts";
      const {IndexedDbPhotoRepository}=await import(assetsPath),{PhotoService}=await import(servicePath),
        {BrowserPhotoProcessor}=await import(imagePath),{newNote}=await import(deskPath);
      const assets=new IndexedDbPhotoRepository(undefined,"gm011b-receiver-B-photos"), repo=x.rigs.B;
      await x.client("B","photo-owner");await x.exchange("B","A");
      const canvas=document.createElement("canvas");canvas.width=2;canvas.height=2;canvas.getContext("2d")!.fillRect(0,0,2,2);
      const blob=await new Promise<Blob>(ok=>canvas.toBlob(v=>ok(v!),"image/jpeg"));
      const service=new PhotoService({snapshot:async()=>(await repo.read()).data,
        appendPhotos:async(metadata:any[])=>{await repo.command((s:any)=>s.appendPhotos(metadata));}},assets,new BrowserPhotoProcessor());
      const [photo]=await service.add([{id:"receiver-local-photo",blob,name:"synthetic-local.jpg"}],{
        clientId:"photo-owner",gardenId:null,zoneId:null,jobId:null,category:"before",description:"Synthetic pixel",capturedDate:null});
      const note={...newNote(await x.data("B")),id:"local-reference",title:"Synthetic independent note"};
      await repo.command((s:any)=>s.saveNote(note));await x.exchange("B","A");
      const n=(await x.data("B")).notes.find((n:any)=>n.id===note.id);
      await repo.command((s:any)=>s.saveNote({...n,photoId:photo.id}));
      await x.send("B","A");
      await repo.command((s:any)=>s.startTimer("job-1"));
      const before=await x.data("B"), asset=await assets.get(photo.assetId);
      const hash=async(b:Blob)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",await b.arrayBuffer()))).map(v=>v.toString(16).padStart(2,"0")).join("");
      const initialHash=await hash(asset.image);
      const remote=(await x.data("A")).notes.find((v:any)=>v.id===note.id);
      await x.rigs.A.command((s:any)=>s.saveNote({...remote,body:"Remote safe note update"}));
      await x.client("A","safe");
      await x.rigs.A.command((s:any)=>s.setRate(999));
      await x.rigs.A.command((s:any)=>s.deleteClient("photo-owner"));
      await x.send("A","B");
      const after=await x.data("B"), stored=await assets.get(photo.assetId), receiver=await x.receiver("B");
      return{before,after,initialHash,afterHash:await hash(stored.image),
        blocked:receiver.receipts.some((r:any)=>r.stage==="blocked"),localPhoto:photo.id,
        note:after.notes.find((v:any)=>v.id===note.id)};
    });
    for(const k of ["photos","timer","jobs","payments","expenses","expenseImports","shoppingItems","settings","reportSequence"] as const)
      expect(result.after[k]).toEqual(result.before[k]);
    expect(result.afterHash).toBe(result.initialHash);
    expect(result.note).toMatchObject({photoId:result.localPhoto,body:"Remote safe note update"});expect(result.blocked).toBe(true);
    expect(result.after.clients.some((c:any)=>c.id==="photo-owner")).toBe(true);
  });
  test("network applied forgery and changed operation identity are rejected, stale plans cannot commit",async({page})=>{
    await boot(page);
    const result=await page.evaluate(async()=>{
      const x=(window as any).__receiverRig;
      await x.client("A","identity");await x.send("A","B");
      const op=(await x.rigs.A.readSyncJournal()).log.operations.at(-1), before=await x.rigs.B.read();
      const fake=await x.rigs.B.receiveSyncOperations([{...op,applied:true,appliedRevision:10000}]);
      const changed=structuredClone(op);changed.changes[0].after.name="Forged";
      const reuse=await x.rigs.B.receiveSyncOperations([changed]), after=await x.rigs.B.read();
      await x.client("A","stale");await x.send("A","B",false);const p=(await x.receiver("B")).plan;
      await x.client("B","local");let stale=false;
      try{await x.rigs.B.applySyncPlan(p.id);}catch{stale=true;}
      return {fake,reuse,before,after,stale,receipt:(await x.receiver("B")).receipts.find((r:any)=>r.operation.id===op.id)};
    });
    expect(result.fake.rejected).toHaveLength(1);expect(result.reuse.rejected).toHaveLength(1);
    expect(result.after).toEqual(result.before);expect(result.receipt.stage).toBe("applied");expect(result.stale).toBe(true);
  });
});
