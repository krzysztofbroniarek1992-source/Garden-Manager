const {test}=require("node:test"),assert=require("node:assert/strict"),crypto=require("node:crypto"),{once}=require("node:events");
const {setup,socket,pair,connect,until,Wire,pub}=require("./helpers.cjs");
const {transcript}=require("../desktop/build/lan-identity.cjs");
test("pairing requires both confirmations; a consumed ticket cannot be replayed after disconnection",{timeout:20000},async()=>{
 const {server,phone}=await setup();let s;
 try{
  const v=await server.invite(),i=JSON.parse(Buffer.from(v.invitation.text.slice(7),"base64url"));
  const payload={ticket:i.ticket,device:pub(phone),signature:crypto.sign("sha256",transcript(i.ticket,i.device.id,phone),phone.key).toString("base64")};
  s=await socket(phone,i.device,i.host,i.pairPort,false);const w=new Wire(s,i.pairId);
  await w.send("pair",payload);const pending=(await w.receive()).message;
  assert.equal((await server.view()).peers.length,0);await server.confirm();await w.receive();
  assert.equal((await server.view()).peers.length,0);
  s.destroy();await until(async()=>!(await server.view()).pending);
  s=await socket(phone,i.device,i.host,i.pairPort,false);const closed=once(s,"close");await new Wire(s,i.pairId).send("pair",payload);await closed;
  assert.equal((await server.view()).peers.length,0);await pair(server,phone);assert.equal((await server.view()).peers.length,1);
 }finally{s?.destroy();await server.stop();}
});
test("concurrent invitations cannot leave extra pairing listeners",{timeout:20000},async()=>{
 const {server}=await setup();try{
  const first=server.invite(),second=server.invite();await assert.rejects(second,/BUSY/);const v=await first;
  assert.ok(v.invitation);assert.ok(server.pairing.listening);await server.stop();assert.equal(server.pairing,undefined);
 }finally{await server.stop();}
});
for(const mode of ["interrupted","corrupt-body"]){
test("real authenticated transfer "+mode+" fails and a new connection succeeds",{timeout:25000},async()=>{
 const {server,phone}=await setup();let s,c;
 try{
  await pair(server,phone);const v=await server.view();s=await socket(phone,phone.peers[0],v.endpoint.host,v.endpoint.port);
  const w=new Wire(s,"");await w.receive();await w.send("hello",{deviceId:phone.id,name:phone.name,nonce:crypto.randomUUID(),versions:[1],maxBytes:10485760,mode:"synthetic-only"});
  await until(async()=>!!(await server.view()).connected);
  const pending=server.test(1048576,"binary"),rejected=assert.rejects(pending);const request=(await w.receive()).message;
  const h=Buffer.from(JSON.stringify({v:1,type:"data",id:crypto.randomUUID(),seq:1,sid:w.sid,payload:{probeId:request.payload.probeId,bytes:1048576,kind:"binary",sha256:"0".repeat(64)}}));
  const a=Buffer.alloc(4),b=Buffer.alloc(4);a.writeUInt32BE(h.length);b.writeUInt32BE(1048576);
  await new Promise(r=>s.write(Buffer.concat([a,h,b,Buffer.alloc(mode==="interrupted"?100:1048576)]),r));
  if(mode==="interrupted")s.destroy();await rejected;await until(async()=>!(await server.view()).connected);
  assert.equal((await server.view()).result.ok,false);
  c=await connect(server,phone);assert.equal((await c.channel.test(1024,"json")).ok,true);
 }finally{s?.destroy();c?.channel.close();await server.stop();}
});}

test("a valid invitation cannot pair a device without its private signing key",{timeout:15000},async()=>{
 const {server,phone}=await setup();let s;
 try{
  const v=await server.invite(),i=JSON.parse(Buffer.from(v.invitation.text.slice(7),"base64url"));
  s=await socket(phone,i.device,i.host,i.pairPort,false);const closed=once(s,"close");
  await new Wire(s,i.pairId).send("pair",{ticket:i.ticket,device:pub(phone),signature:Buffer.alloc(72,65).toString("base64")});
  await closed;assert.equal((await server.view()).peers.length,0);
 }finally{s?.destroy();await server.stop();}
});

test("a connection arriving during the revocation write is closed before forget resolves",{timeout:20000},async()=>{
 const {server,phone,store}=await setup();let client,release;
 try{
  await pair(server,phone);const update=store.update.bind(store);let entered=false;
  const gate=new Promise(r=>release=r);
  store.update=async change=>{entered=true;await gate;return update(change);};
  const deleting=server.forget(phone.id);await until(()=>entered);
  client=await connect(server,phone);assert.equal(client.channel.ready,true);
  release();await deleting;await until(()=>client.s.destroyed);
  assert.equal((await server.view()).connected,undefined);assert.equal((await server.view()).peers.length,0);
 }finally{release?.();client?.channel.close();await server.stop();}
});
