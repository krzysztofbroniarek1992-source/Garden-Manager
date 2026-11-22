const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs/promises"),os=require("node:os"),path=require("node:path"),crypto=require("node:crypto");
const {Vault}=require("../desktop/build/lan-vault.cjs");
test("native vault serializes updates, persists identity and fails closed on tampering",{timeout:20000},async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),"gm-lan-vault-")),file=path.join(dir,"identity.sealed"),key=crypto.randomBytes(32);
 const seal=s=>{const iv=crypto.randomBytes(12),c=crypto.createCipheriv("aes-256-gcm",key,iv);return Buffer.concat([iv,c.update(s,"utf8"),c.final(),c.getAuthTag()]);};
 const unseal=b=>{const c=crypto.createDecipheriv("aes-256-gcm",key,b.subarray(0,12));c.setAuthTag(b.subarray(-16));return Buffer.concat([c.update(b.subarray(12,-16)),c.final()]).toString("utf8");};
 try{
  const v=new Vault(file,seal,unseal),initial=await v.get();let updates=0;
  await Promise.all(Array.from({length:20},()=>v.update(d=>({...d,name:"Test "+ ++updates}))));
  const again=await new Vault(file,seal,unseal).get();assert.equal(again.id,initial.id);assert.equal(again.name,"Test 20");
  const valid=await fs.readFile(file);assert.equal(valid.includes(Buffer.from("PRIVATE KEY")),false);
  const broken=Buffer.from(valid);broken[15]^=1;await fs.writeFile(file,broken);
  await assert.rejects(new Vault(file,seal,unseal).get(),/VAULT/);assert.deepEqual(await fs.readFile(file),broken);
  await fs.writeFile(file,valid);let fail=false;const failing=new Vault(file,s=>{if(fail)throw Error("disk");return seal(s);},unseal);await failing.get();fail=true;
  await assert.rejects(failing.update(d=>({...d,name:"Lost"})));assert.deepEqual(await fs.readFile(file),valid);
  assert.equal((await failing.get()).name,"Test 20");assert.deepEqual(await fs.readdir(dir),["identity.sealed"]);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
