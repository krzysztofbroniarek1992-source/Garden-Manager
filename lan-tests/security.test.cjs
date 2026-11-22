const {test}=require("node:test");const assert=require("node:assert/strict");const {once}=require("node:events");
const {setup,socket,until,Wire,createIdentity,Memory}=require("./helpers.cjs");const crypto=require("node:crypto");
const {LanServer}=require("../desktop/build/lan-server.cjs");const {certificate}=require("../desktop/build/lan-identity.cjs");
test("closing a session while identity storage is pending cannot start a late listener",async()=>{
 const own=await createIdentity("Syntetyczny"),real=new Memory(own);let release;
 const delayed={get:()=>new Promise(r=>release=r),update:real.update.bind(real)};
 const server=new LanServer(delayed,{interfaces:()=>[{name:"test",address:"127.0.0.1"}],discovery:false});
 const pending=server.start("127.0.0.1");const rejected=assert.rejects(pending,/CLOSED/);await server.stop();release(own);await rejected;
 assert.equal(server.server,undefined);
});
test("certificates must be a single canonical DER certificate, not an appended chain",async()=>{
 const id=await createIdentity("Syntetyczny");assert.throws(()=>certificate(id.cert+id.cert,id.id),/CERTIFICATE/);
});
test("invalid pairing tickets exhaust a bounded application attempt budget and never establish trust",{timeout:20000},async()=>{
 const {server,phone}=await setup();try{
 const v=await server.invite(),i=JSON.parse(Buffer.from(v.invitation.text.slice(7),"base64url"));
 for(let n=0;n<6;n++){
  const s=await socket(phone,i.device,i.host,i.pairPort,false),w=new Wire(s,i.pairId);
  if(n<5){await w.send("pair",{ticket:"A".repeat(43),device:{},signature:"A".repeat(96)});}
  await once(s,"close");assert.equal((await server.view()).peers.length,0);
 }
 }finally{await server.stop();}
});
test("expiry and explicit session closure revoke invitations and close the listening endpoint",{timeout:20000},async()=>{
 const {server,phone}=await setup();try{
 const v=await server.invite(),i=JSON.parse(Buffer.from(v.invitation.text.slice(7),"base64url"));
 server.deadline=-1;
 const s=await socket(phone,i.device,i.host,i.pairPort,false);await once(s,"close");
 const endpoint=v.endpoint;await server.stop();
 await assert.rejects(socket(phone,i.device,endpoint.host,endpoint.port));
 }finally{await server.stop();}
});
