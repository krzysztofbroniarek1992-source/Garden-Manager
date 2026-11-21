/** CI ONLY. No private key or invitation is logged or included in release artifacts.
 * Android uses its real Keystore/JSSE client against the production server code.
 * Auto-consent here is a synthetic test peer, not a substitute for Windows UI tests. */
const fs=require("node:fs"),path=require("node:path");
const {createIdentity}=require("../desktop/build/lan-identity.cjs");
const {LanServer}=require("../desktop/build/lan-server.cjs");
const {Memory}=require("./helpers.cjs");
(async()=>{
 const folder=process.argv[2];fs.mkdirSync(folder,{recursive:true,mode:0o700});
 const servers=[];
 for(const name of ["CI Windows dom","CI Windows praca"]){
  const identity=await createIdentity(name),store=new Memory(identity);
  const server=new LanServer(store,{interfaces:()=>[{name:"CI only",address:"0.0.0.0"}],advertisedAddress:"10.0.2.2",discovery:false});
  await server.start("0.0.0.0");servers.push({server,store});
 }
 const fixtures=[];
 for(const {server}of servers){const v=await server.invite();fixtures.push({invitation:v.invitation.text,device:v.device,host:"10.0.2.2",port:v.endpoint.port});}
 fs.writeFileSync(path.join(folder,"fixture.json"),JSON.stringify({servers:fixtures}),{mode:0o600});
 let polling=false;
 const timer=setInterval(async()=>{
  if(polling)return;polling=true;
  try{
   for(const {server}of servers){
    const v=await server.view();
    if(v.pending&&!v.pending.localConfirmed)await server.confirm();
    if(v.connected&&!v.busy&&!server.__reverseTested){
      server.__reverseTested=true;
      await new Promise(r=>setTimeout(r,250));
      const result=await server.test(1024,"binary");
      fs.appendFileSync(path.join(folder,"metrics.jsonl"),JSON.stringify({synthetic:true,initiator:"server",result:result.result})+"\n");
    }
   }
  }catch{/* Peer cancellation is an expected part of the fixture lifecycle. */}
  finally{polling=false;}
 },100);
 process.on("SIGTERM",async()=>{clearInterval(timer);await Promise.all(servers.map(s=>s.server.stop()));process.exit(0);});
})().catch(()=>{console.error("Synthetic LAN test peer failed");process.exit(1);});
