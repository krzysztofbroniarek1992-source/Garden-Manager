import { clipboard, dialog, safeStorage, type BrowserWindow } from "electron";
import path from "node:path";
import { LanServer } from "./lan-server.cjs";
import { Vault } from "./lan-vault.cjs";
import { fields, identifier, deviceName, port, probeOptions, fail } from "./lan-wire.cjs";
import type { LanView } from "./lan-contracts.js" with { "resolution-mode":"import" };
export class LanCapability {
  private server?:LanServer;
  constructor(private profile:string,private window:()=>BrowserWindow|null){}
  private get(){
    if(process.platform!=="win32"||!safeStorage.isEncryptionAvailable())fail("VAULT");
    return this.server??=new LanServer(new Vault(path.join(this.profile,"lan","identity.dpapi"),
      s=>safeStorage.encryptString(s),b=>safeStorage.decryptString(b)));
  }
  async command(value:unknown):Promise<LanView>{
    try{
      if(!value||typeof value!=="object"||Array.isArray(value))fail();
      const a=value as Record<string,unknown>,s=this.get();
      switch(a.action){
        case "status":fields(a,["action"]);return s.view();
        case "start":fields(a,["action","address"]);if(typeof a.address!=="string")fail();return s.start(a.address);
        case "stop":fields(a,["action"]);await s.stop();return s.view();
        case "rename":fields(a,["action","name"]);return s.rename(deviceName(a.name));
        case "invite":fields(a,["action"]);return s.invite();
        case "confirm":{
          fields(a,["action"]);const p=(await s.view()).pending,w=this.window();if(!p||!w)fail("CLOSED");
          const result=await dialog.showMessageBox(w,{type:"question",title:"Potwierdź tożsamość telefonu",message:"Porównaj kod na obu ekranach: "+p.code,
            detail:p.name+"\nSHA256: "+p.fingerprint+"\nZaufaj tylko zgodnemu urządzeniu.",buttons:["Anuluj","Zaufaj"],defaultId:0,cancelId:0});
          if(result.response!==1)fail("CLOSED");
          const now=(await s.view()).pending;if(!now||now.id!==p.id||now.fingerprint!==p.fingerprint||now.code!==p.code)fail("PAIRING");
          return s.confirm();
        }
        case "forget":fields(a,["action","id"]);identifier(a.id);return s.forget(a.id);
        case "test":fields(a,["action","bytes","kind"]);probeOptions(a.bytes,a.kind);return s.test(a.bytes as 1024,a.kind);
        case "copy":{
          fields(a,["action"]);const v=await s.view();if(!v.invitation)fail("CLOSED");clipboard.writeText(v.invitation.text);return v;
        }
        default:fail();
      }
    }catch(e){
      const code=e instanceof Error?e.message:"PROTOCOL";
      const messages:Record<string,string>={
        VAULT:"Chroniony magazyn DPAPI jest niedostępny lub uszkodzony. Nie zmieniono oryginalnego zapisu ani danych firmowych.",
        ADDRESS:"Wybierz aktualny prywatny interfejs IPv4. Sprawdź połączenie Wi-Fi, Ethernet lub hotspot.",
        LISTEN:"Nie można uruchomić nasłuchu. Sprawdź adres interfejsu i zasady zapory.",
        CLOSED:"Sesja lub zaproszenie nie są aktywne. Rozpocznij sesję i ponów operację.",
        PAIRING:"Zaproszenie wygasło lub zmieniło się urządzenie. Pokaż nowy kod i porównaj oba ekrany.",
        BUSY:"Dokończ poprzednią operację komunikacji.",
        VERSION:"Urządzenia używają niezgodnych wersji protokołu. Zaktualizuj obie aplikacje.",
        CERTIFICATE:"Nie potwierdzono tożsamości urządzenia. Sprawdź sparowanie i datę systemu.",
      };
      throw new Error(messages[code]??"Odrzucono nieprawidłową operację lub połączenie LAN. Sprawdź sesję, sparowanie i zaporę; internet nie jest wymagany.");
    }
  }
  stop(){return this.server?.stop();}
}
