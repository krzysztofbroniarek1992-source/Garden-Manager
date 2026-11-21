import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createIdentity, identity, type Identity } from "./lan-identity.cjs";
export interface Store {
  get():Promise<Identity>;
  update(change:(current:Identity)=>Identity):Promise<Identity>;
}
export class Vault implements Store {
  private cached?:Promise<Identity>; private queue:Promise<unknown>=Promise.resolve();
  constructor(private file:string,private seal:(s:string)=>Buffer,private unseal:(b:Buffer)=>string){}
  get(){return this.cached??=this.load();}
  private async load(){
    try {
      const stat=await fs.stat(this.file);if(stat.size>200000)throw Error("VAULT");
      return identity(JSON.parse(this.unseal(await fs.readFile(this.file))));
    }catch(e){
      if((e as NodeJS.ErrnoException).code!=="ENOENT")throw Error("VAULT");
      const data=await createIdentity("Komputer Windows");await this.save(data);return data;
    }
  }
  private async save(data:Identity){
    identity(data);const bytes=this.seal(JSON.stringify(data)), tmp=this.file+"."+randomUUID()+".tmp";
    await fs.mkdir(path.dirname(this.file),{recursive:true});
    const file=await fs.open(tmp,"wx",0o600);
    try {await file.writeFile(bytes);await file.sync();}finally{await file.close();}
    try {await fs.rename(tmp,this.file);}catch(e){await fs.unlink(tmp).catch(()=>{});throw e;}
  }
  update(change:(current:Identity)=>Identity):Promise<Identity>{
    const run=async()=>{const next=identity(change(await this.get()));await this.save(next);this.cached=Promise.resolve(next);return next;};
    const next=this.queue.then(run);this.queue=next.catch(()=>{});return next;
  }
}
