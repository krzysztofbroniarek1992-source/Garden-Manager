import {test,expect} from "@playwright/test";
import {createRequire} from "node:module";
import {readFile,stat} from "node:fs/promises";
import path from "node:path";
import {launch,route,snapshot,saveDialog,openDialog,exportButton,jsonFile,addPhoto,metadata} from "./helpers";
const require=createRequire(import.meta.url),helper=require("../lan-tests/helpers.cjs");
// Ephemeral invitations must not be captured in Playwright traces/screenshots.
test.use({trace:"off",screenshot:"off"});
test("real Electron DPAPI, narrow IPC, mutual TLS, synthetic duplex, ZIP isolation and restart",async()=>{
 const a=await launch();let closed=false,client:any;
 const view=()=>a.page.evaluate(()=>window.gardenDesktop!.lan.command({action:"status"}));
 try{
  await a.instance.context().setOffline(true);const before=await snapshot(a.page);
  await route(a.page,"#sync");await expect(a.page.getByLabel("Nazwa urządzenia",{exact:true})).toHaveValue("Komputer Windows");
  const initial=(await view()).device!;
  for(const command of [{action:"execute",path:"C:/Windows"},{action:"start",address:"8.8.8.8"},{action:"status",extra:true},{action:"test",bytes:123,kind:"json"}]){
   expect(await a.page.evaluate(async c=>{try{await window.gardenDesktop!.lan.command(c as any);return "allowed";}catch{return "denied";}},command)).toBe("denied");
  }
  await a.page.getByLabel("Nazwa urządzenia",{exact:true}).fill("Windows test LAN");
  a.page.once("dialog",d=>d.dismiss());
  await a.instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());
  await expect(a.page.getByLabel("Nazwa urządzenia",{exact:true})).toHaveValue("Windows test LAN");
  await a.page.getByRole("button",{name:"Zapisz nazwę urządzenia",exact:true}).click();
  await expect.poll(async()=>(await view()).device?.name).toBe("Windows test LAN");
  await a.page.getByRole("button",{name:"Rozpocznij sesję",exact:true}).click();
  await expect.poll(async()=>(await view()).active).toBe(true);
  const phone=await helper.createIdentity("Syntetyczny klient CI");
  const adapter={
   view,invite:async()=>{await a.page.getByRole("button",{name:"Pokaż nowy kod parowania",exact:true}).click();await expect(a.page.locator(".lan-invitation img")).toBeVisible();return view();},
   confirm:async()=>{
    await expect(a.page.locator(".lan-pending")).toBeVisible();
    // Only OS consent is automated; production IPC, DPAPI, TLS and proof remain real.
    await a.instance.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});});
    await a.page.locator(".lan-check input").check();await a.page.getByRole("button",{name:"Potwierdź parowanie",exact:true}).click();
    await expect.poll(async()=>(await view()).peers.length).toBe(1);
   }
  };
  await helper.pair(adapter,phone);client=await helper.connect(adapter,phone);
  const result=await client.channel.test(10485760,"binary");expect(result.ok).toBe(true);expect(result.sentSha256).toBe(result.receivedSha256);
  await a.page.getByLabel("Rozmiar testu",{exact:true}).selectOption("102400");
  await a.page.getByRole("button",{name:"Testuj połączenie",exact:true}).click();
  await expect.poll(async()=>(await view()).result?.bytes).toBe(102400);
  expect((await view()).result?.ok).toBe(true);expect(await snapshot(a.page)).toEqual(before);
  client.channel.close();await a.page.getByRole("button",{name:"Zakończ sesję",exact:true}).click();
  await expect.poll(async()=>(await view()).active).toBe(false);
  const vault=path.join(a.profile,"lan","identity.dpapi"),encrypted=await readFile(vault);
  expect(encrypted.includes(Buffer.from("PRIVATE KEY"))).toBe(false);
  // Real business backup includes photos and stays independent of native credentials.
  await addPhoto(a.page);const saved=await snapshot(a.page),photos=await metadata(a.page);
  await a.page.getByRole("button",{name:"Ustawienia konta demonstracyjnego",exact:true}).click();
  const json=path.join(a.profile,"synthetic-export.json");await saveDialog(a.instance,json);await exportButton(a.page,"Eksportuj dane");
  const backup=await jsonFile(json);expect(backup.version).toBe(12);expect(JSON.stringify(backup)).not.toContain(initial.id);
  const zip=path.join(a.profile,"synthetic-full.zip");await saveDialog(a.instance,zip);await exportButton(a.page,"Pobierz pełną kopię ZIP");
  await expect.poll(async()=>{try{return (await stat(zip)).size;}catch{return 0;}}).toBeGreaterThan(1000);
  await openDialog(a.instance,zip);await a.page.getByRole("button",{name:"Wczytaj pełną kopię ZIP",exact:true}).click();
  await expect(a.page.getByRole("button",{name:"Odtwórz dane i zdjęcia",exact:true})).toBeVisible();
  await a.page.getByRole("checkbox",{name:"Rozumiem, że bieżący zestaw zostanie zastąpiony.",exact:true}).check();
  await a.page.getByLabel("Wpisz ODTWÓRZ",{exact:true}).fill("ODTWÓRZ");
  await a.page.getByRole("button",{name:"Odtwórz dane i zdjęcia",exact:true}).click();
  await expect(a.page.getByRole("dialog",{name:"Ustawienia",exact:true})).toContainText("Dane i zdjęcia zostały odtworzone");
  await expect(a.page.locator("html")).not.toHaveAttribute("aria-busy","true");
  const restored=await snapshot(a.page);
  for(const key of Object.keys(saved).filter(k=>k!=="photos"&&k!=="photoRestoreId"))expect(restored[key]).toEqual(saved[key]);
  expect(restored.photoRestoreId).toEqual(expect.any(String));
  expect(restored.photos.map(({assetId,...p}:any)=>p)).toEqual(saved.photos.map(({assetId,...p}:any)=>p));
  const restoredAssets=(await metadata(a.page)).filter(a=>restored.photos.some((p:any)=>p.assetId===a.id));
  expect(restoredAssets.map(({id,...a})=>a)).toEqual(photos.map(({id,...a})=>a));expect(await readFile(vault)).toEqual(encrypted);
  const exit=new Promise<void>(r=>a.instance.process().once("exit",()=>r()));
  await a.instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await exit;closed=true;
  const b=await launch(a.profile);
  try{
   await route(b.page,"#sync");const status=()=>b.page.evaluate(()=>window.gardenDesktop!.lan.command({action:"status"}));
   await expect.poll(async()=>(await status()).device?.id).toBe(initial.id);expect((await status()).device?.fingerprint).toBe(initial.fingerprint);
   expect((await status()).active).toBe(false);expect((await status()).peers).toHaveLength(1);expect(await snapshot(b.page)).toEqual(restored);
   await b.page.getByRole("button",{name:"Rozpocznij sesję",exact:true}).click();await expect.poll(async()=>(await status()).active).toBe(true);
   client=await helper.connect({view:status},phone);expect((await client.channel.test(1024,"json")).ok).toBe(true);client.channel.close();
  }finally{await b.instance.close();}
 }finally{client?.channel.close();if(!closed)await a.instance.close();}
});
