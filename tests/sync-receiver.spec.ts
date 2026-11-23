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
async function bankBoot(page:Page) {
  await boot(page);
  await page.evaluate(async()=>{
    const p="/src/expenses/model.ts",m=await import(p),x=(window as any).__receiverRig;
    x.bank={
      async profile(label:string,id="browser-bank",name="Synthetic bank") {
        const options=m.defaultOptions();options.mapping={...options.mapping,date:0,amount:1,counterparty:2,description:3,transactionId:4};
        await x.rigs[label].command((s:any)=>s.saveExpenseProfile({id,name,revision:1,createdAt:0,updatedAt:0,
          headers:["date","amount","party","description","id"],options,archived:false},null));
      },
      async import(label:string,id="browser-import",profileId="browser-bank") {
        const d=await x.data(label),profile=d.expenseProfiles.find((p:any)=>p.id===profileId),hash="a".repeat(64);
        const rows=m.reviewRows(d,profileId,hash,[{line:2,error:"",row:{line:2,date:"2026-11-22",signedCents:-12345,
          counterparty:"Synthetic vendor",description:"Synthetic",transactionId:"synthetic-browser-tx",occurrence:1}}]);
        await x.rigs[label].command((s:any)=>s.importExpenses({id,profile,rulesKey:m.rulesKey(d),statementKey:hash,fileHash:"b".repeat(64),
          requestKey:"c".repeat(64),filename:"synthetic.csv",rows:rows.map((r:any)=>({...r,selected:true,status:"approved"}))}));
        return (await x.rigs[label].readSyncJournal()).log.operations.at(-1);
      },
    };
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
  test("financial checkpoint: client, shopping, expense and payments relay through B without duplication",async({page})=>{
    await boot(page);
    const first=await page.evaluate(async()=>{
      const x=(window as any).__receiverRig, shoppingPath="/src/shopping/model.ts", expensePath="/src/expenses/model.ts";
      const {newShoppingItem}=await import(shoppingPath), {otherCategory}=await import(expensePath);
      await x.client("A","financial-relay");
      await x.rigs.B.command((s:any)=>s.saveShoppingItem({...newShoppingItem("Synthetic tool"),id:"financial-shopping"},null));
      await x.exchange("A","B");
      const expense={id:"financial-expense",revision:1,createdAt:0,updatedAt:0,date:"2026-11-22",amountCents:12345,
        direction:"outgoing",counterparty:"Synthetic",description:"Synthetic",categoryId:otherCategory,
        source:"manual",origin:null,status:"approved",note:"Synthetic",history:[]};
      await x.rigs.C.command((s:any)=>s.saveExpense(expense,null));
      await x.exchange("B","C");await x.exchange("A","B");
      await x.rigs.A.command((s:any)=>s.savePayment({id:"financial-payment",jobId:"job-5",amountCents:1000,
        receivedDate:"2026-11-22",method:"cash",note:"Synthetic"},null));
      await x.exchange("A","B");await x.exchange("B","C");
      await x.close();return true;
    });
    expect(first).toBe(true);
    await page.reload();await boot(page);
    const result=await page.evaluate(async()=>{
      const x=(window as any).__receiverRig;
      const snapshots=await Promise.all(["A","B","C"].map((label:string)=>x.data(label)));
      for(let i=0;i<2;i++){await x.exchange("A","B");await x.exchange("B","C");}
      const final=await Promise.all(["A","B","C"].map((label:string)=>x.data(label)));
      await x.close();return {snapshots,final};
    });
    expect(result.final).toEqual(result.snapshots);
    for(const d of result.final) {
      expect(d.clients.some((c:any)=>c.id==="financial-relay")).toBe(true);
      expect(d.shoppingItems.filter((p:any)=>p.id==="financial-shopping")).toHaveLength(1);
      expect(d.expenses.map((e:any)=>[e.id,e.amountCents])).toEqual([["financial-expense",12345]]);
      expect(d.payments.map((p:any)=>[p.id,p.amountCents])).toEqual([["financial-payment",1000]]);
      expect(d.jobs.find((j:any)=>j.id==="job-5").seconds).toBe(14400);
      expect(d.timer).toBeNull();
    }
  });

  test("CSV A -> B -> C retains its atomic plan over reload and protects existing financial records",async({page})=>{
    await bankBoot(page);
    const initial=await page.evaluate(async()=>{
      const x=(window as any).__receiverRig;
      await x.rigs.B.command((s:any)=>s.savePayment({id:"csv-existing-payment",jobId:"job-5",amountCents:100,
        receivedDate:"2026-11-22",method:"cash",note:"Synthetic"},null));
      const protectedBefore=await Promise.all(["A","B","C"].map((label:string)=>x.data(label)));
      await x.bank.profile("A");const original=await x.bank.import("A");
      const source=await x.data("A"),r=await x.send("A","B",false),pending=await x.data("B");
      await x.close();return{original,source,plan:r.plan.plan,protectedBefore,pending};
    });
    expect(initial.pending.expenses).toEqual([]);expect(initial.pending.expenseImports).toEqual([]);
    await page.reload();await bankBoot(page);
    const result=await page.evaluate(async id=>{
      const x=(window as any).__receiverRig,receipt=await x.rigs.B.applySyncPlan(id);
      await x.send("B","C");
      for(let n=0;n<2;n++){await x.exchange("A","B");await x.exchange("B","C");}
      const data=await Promise.all(["A","B","C"].map((label:string)=>x.data(label)));
      const origin=(await x.receiver("C")).receipts.find((r:any)=>r.operation.changes.some((c:any)=>c.key==="expenseImports/browser-import"));
      const repeated=await x.rigs.B.applySyncPlan(id);
      await x.close();return{data,origin,receipt,repeated};
    },initial.plan.id);
    expect(result.repeated).toEqual(result.receipt);expect(result.origin.operation).toEqual(initial.original);
    expect(result.origin.stage).toBe("applied");
    for(let n=0;n<3;n++) {
      const d=result.data[n];
      expect(d.expenses).toEqual(initial.source.expenses);expect(d.expenseImports).toEqual(initial.source.expenseImports);
      expect(d.expenseProfiles).toEqual(initial.source.expenseProfiles);
      expect(d.expenses.reduce((sum:number,e:any)=>sum+e.amountCents,0)).toBe(12345);
      for(const k of ["jobs","payments","photos","timer","reportSequence"])expect(d[k]).toEqual(initial.protectedBefore[n][k]);
    }
  });
  test("independent CSV identities and profiles require durable review instead of duplicated cost",async({page})=>{
    await bankBoot(page);
    await page.evaluate(async()=>{
      const x=(window as any).__receiverRig;
      await x.bank.profile("A","browser-bank","Bank");await x.exchange("A","B");
      await x.bank.import("A","independent-A");await x.bank.import("B","independent-B");
      await x.exchange("A","B");
      await x.bank.profile("C","other-bank","Bank");await x.bank.import("C","independent-C","other-bank");
      await x.exchange("B","C");await x.close();
    });
    await page.reload();await bankBoot(page);
    const result=await page.evaluate(async()=>{
      const x=(window as any).__receiverRig,data=await Promise.all(["A","B","C"].map((label:string)=>x.data(label))),
        receiver=await x.receiver("B");
      await x.close();return{data,receiver};
    });
    for(const d of result.data) {
      expect(d.expenses).toHaveLength(1);expect(d.expenseImports).toHaveLength(1);
      expect(d.expenses[0].amountCents).toBe(12345);
    }
    expect(result.data[1].expenseProfiles.map((p:any)=>p.id).sort()).toEqual(["browser-bank","other-bank"]);
    expect(result.receiver.receipts.some((r:any)=>r.stage==="blocked"&&r.reason.includes("CSV_DUPLICATE_IDENTITY"))).toBe(true);
    expect(result.receiver.receipts.some((r:any)=>r.stage==="blocked"&&r.reason.includes("CSV_PROFILE_SCOPE"))).toBe(true);
  });
  test("real CSV IndexedDB abort leaves neither import nor expense applied, retry commits both exactly once",async({page})=>{
    await bankBoot(page);
    const result=await page.evaluate(async()=>{
      const x=(window as any).__receiverRig;
      await x.bank.profile("A");const operation=await x.bank.import("A"),incoming=await x.send("A","B",false),id=incoming.plan.plan.id;
      const before={state:await x.rigs.B.read(),journal:await x.rigs.B.readSyncJournal(),receiver:await x.receiver("B")};
      const original=IDBObjectStore.prototype.put;let failed=false;
      IDBObjectStore.prototype.put=function(value:any,key?:IDBValidKey){
        if(this.name==="sync"&&key==="receiver-v1")throw new DOMException("Synthetic CSV quota","QuotaExceededError");
        return original.call(this,value,key);
      };
      try {await x.rigs.B.applySyncPlan(id);}catch{failed=true;}finally{IDBObjectStore.prototype.put=original;}
      const afterFailure={state:await x.rigs.B.read(),journal:await x.rigs.B.readSyncJournal(),receiver:await x.receiver("B")};
      const receipt=await x.rigs.B.applySyncPlan(id),retry=await x.rigs.B.applySyncPlan(id),data=await x.data("B");
      const row=(await x.receiver("B")).receipts.find((r:any)=>r.operation.id===operation.id);
      await x.close();return{failed,before,afterFailure,receipt,retry,data,row};
    });
    expect(result.failed).toBe(true);expect(result.afterFailure).toEqual(result.before);
    expect(result.retry).toEqual(result.receipt);expect(result.data.expenseImports).toHaveLength(1);expect(result.data.expenses).toHaveLength(1);
    expect(result.row.stage).toBe("applied");expect(result.data.expenses[0].amountCents).toBe(12345);
  });

});


test.describe("5c1 real persistent visit aggregates (no native business LAN)",()=>{
  test.setTimeout(120000);
  async function visits(page:Page) {
    await boot(page);
    await page.evaluate(()=>{
      const x=(window as any).__receiverRig;
      x.visit=(id="browser-visit")=>({id,gardenId:"garden-1",title:"Synthetic visit",date:"2026-11-23",time:"09:00",
        status:"planned",billing:"hourly",rate:120,fixedPrice:0,seconds:0,materials:[],notes:"Synthetic",
        activities:["Synthetic work"],settlement:null});
    });
  }
  test("closed time, materials, approval and payments persist across reload, relay and lost acknowledgment",async({page})=>{
    await visits(page);
    const saved=await page.evaluate(async()=>{
      const x=(window as any).__receiverRig,r=x.rigs.A,id="browser-visit";
      await r.command((s:any)=>s.saveJob(x.visit()));
      await r.command((s:any)=>s.startTimer(id),()=>1000);
      await r.command((s:any)=>s.pauseTimer(),()=>4100);
      await r.command((s:any)=>s.resumeTimer(),()=>5100);
      await r.command((s:any)=>s.stopTimer(),()=>7200);
      await r.command((s:any)=>s.correctJobTime(id,3601,5),()=>8000);
      await r.command((s:any)=>s.addJobMaterial(id,"garden-1",{id:"synthetic-m",name:"Synthetic material",quantity:2,unitPrice:12.34}));
      await r.command((s:any)=>s.finishFieldVisit(id),()=>9000);
      await r.command((s:any)=>s.approveSettlement(id,15001,"manual"),()=>10000);
      await r.command((s:any)=>s.savePayment({id:"synthetic-pay",jobId:id,amountCents:123,receivedDate:"2026-11-23",method:"blik",note:"Synthetic"},null));
      await x.send("A","B",false);
      const original=(await r.readSyncJournal()).log.operations.at(-1),plan=(await x.receiver("B")).plan;
      const source=await x.data("A");await x.close();return{source,original,plan};
    });
    await page.reload();await visits(page);
    const result=await page.evaluate(async expected=>{
      const x=(window as any).__receiverRig;
      const first=await x.rigs.B.applySyncPlan(expected.plan.id);
      const retry=await x.rigs.B.applySyncPlan(expected.plan.id);
      await x.send("B","C");await x.exchange("A","B");await x.exchange("B","C");
      const records=await Promise.all(["A","B","C"].map(async n=>({data:await x.data(n),
        original:(await x.rigs[n].readSyncJournal()).log.operations.find((o:any)=>o.id===expected.original.id)})));
      await x.close();return{first,retry,records};
    },saved);
    expect(result.retry).toEqual(result.first);
    for(const r of result.records) {
      expect(r.original).toEqual(saved.original);expect(r.data.timer).toBeNull();
      expect(r.data.jobs.find((j:any)=>j.id==="browser-visit")).toEqual(saved.source.jobs.find((j:any)=>j.id==="browser-visit"));
      expect(r.data.payments).toEqual(saved.source.payments);
    }
  });
  test("real quota abort rolls back the complete visit, time and receipt together",async({page})=>{
    await visits(page);
    const result=await page.evaluate(async()=>{
      const x=(window as any).__receiverRig;
      await x.rigs.A.command((s:any)=>{s.saveJob(x.visit());s.correctJobTime("browser-visit",123,0);});
      await x.send("A","B",false);
      const before=await x.rigs.B.read(),receiver=await x.receiver("B"),journal=await x.rigs.B.readSyncJournal();
      const put=IDBObjectStore.prototype.put;let failed=false;
      IDBObjectStore.prototype.put=function(value:unknown,key?:IDBValidKey){
        if(this.name==="sync"&&key==="receiver-v1")throw new DOMException("Synthetic quota","QuotaExceededError");
        return put.call(this,value,key);
      };
      try{await x.rigs.B.applySyncPlan(receiver.plan.id);}catch{failed=true;}finally{IDBObjectStore.prototype.put=put;}
      const rolled={data:await x.rigs.B.read(),receiver:await x.receiver("B"),journal:await x.rigs.B.readSyncJournal()};
      await x.rigs.B.applySyncPlan(receiver.plan.id);await x.send("B","C");
      const final=await x.data("C");await x.close();return{failed,before,receiver,journal,rolled,final};
    });
    expect(result.failed).toBe(true);
    expect(result.rolled).toEqual({data:result.before,receiver:result.receiver,journal:result.journal});
    expect(result.final.jobs.find((j:any)=>j.id==="browser-visit").seconds).toBe(123);
  });
  test("parallel corrections remain durable conflicts, while an unrelated visit bypasses active timer protection",async({page})=>{
    await visits(page);
    const saved=await page.evaluate(async()=>{
      const x=(window as any).__receiverRig,id="browser-visit";
      await x.rigs.A.command((s:any)=>s.saveJob(x.visit()));await x.exchange("A","B");
      await x.rigs.A.command((s:any)=>s.correctJobTime(id,101,0));
      await x.rigs.B.command((s:any)=>s.correctJobTime(id,202,0));await x.send("A","B");
      const conflict=(await x.receiver("B")).conflicts.find((c:any)=>c.key==="visits/"+id&&c.status==="open");
      await x.rigs.B.command((s:any)=>s.startTimer("job-1"),()=>1000);
      await x.rigs.A.command((s:any)=>s.completeJob("job-1"));
      await x.rigs.A.command((s:any)=>s.saveJob(x.visit("safe-visit")));
      const before=await x.data("B");await x.send("A","B");await x.close();return{conflict,before};
    });
    await page.reload();await visits(page);
    const result=await page.evaluate(async()=>{
      const x=(window as any).__receiverRig;return{data:await x.data("B"),receiver:await x.receiver("B")};
    });
    expect(result.receiver.conflicts.find((c:any)=>c.id===saved.conflict.id)).toEqual(saved.conflict);
    expect(result.data.jobs.find((j:any)=>j.id==="browser-visit").seconds).toBe(202);
    expect(result.data.timer).toEqual(saved.before.timer);
    expect(result.data.jobs.find((j:any)=>j.id==="job-1")).toEqual(saved.before.jobs.find((j:any)=>j.id==="job-1"));
    expect(result.data.jobs.find((j:any)=>j.id==="safe-visit")).toBeDefined();
    expect(result.receiver.receipts.some((r:any)=>r.stage==="blocked"&&r.reason.includes("Aktywny stoper"))).toBe(true);
  });
});
