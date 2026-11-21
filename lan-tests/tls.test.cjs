const {test}=require("node:test");const assert=require("node:assert/strict");const {once}=require("node:events");
const {setup,socket,pair,connect,until,Wire,createIdentity}=require("./helpers.cjs");
test("real TLS: two-sided pairing, mutual authentication, duplex synthetic JSON/binary SHA256 and reconnect",{timeout:90000},async()=>{
  const {server,phone,store}=await setup();let client;
  try{
    await pair(server,phone);assert.equal((await store.get()).peers.length,1);
    client=await connect(server,phone);
    for(const bytes of [1024,102400,1048576,10485760])for(const kind of ["json","binary"]){
      const a=await client.channel.test(bytes,kind);assert.equal(a.ok,true);assert.equal(a.sentSha256,a.receivedSha256);
      const b=(await server.test(bytes,kind)).result;assert.equal(b.ok,true);assert.equal(b.sentSha256,b.receivedSha256);
      console.log(JSON.stringify({synthetic:true,bytes,kind,clientInitiatedMs:a.elapsedMs,serverInitiatedMs:b.elapsedMs,sha256Matches:true}));
    }
    client.channel.close();await until(async()=>!(await server.view()).connected);
    client=await connect(server,phone);assert.equal((await client.channel.test(1024,"json")).ok,true);
    await server.forget(phone.id);await until(()=>client.s.destroyed);
    const s=await socket(phone,phone.peers[0],(await server.view()).endpoint.host,(await server.view()).endpoint.port);
    await once(s,"close");assert.equal(s.authorized,true); // server cert is valid; client admission is refused.
  }finally{client?.channel.close();await server.stop();}
});
test("real TLS refuses unpaired certificates and a mismatching server trust anchor",{timeout:20000},async()=>{
  const {server,pc,phone}=await setup();
  try{
    const v=await server.view();
    const unpaired=await socket(phone,pc,v.endpoint.host,v.endpoint.port);
    await once(unpaired,"close");assert.equal((await server.view()).connected,undefined);
    const wrong=await createIdentity("Syntetyczny fałszywy serwer");
    await assert.rejects(socket(phone,{...pc,cert:wrong.cert},v.endpoint.host,v.endpoint.port));
  }finally{await server.stop();}
});
for(const attack of ["version","replay","oversized-header","oversized-body","corrupt"]){
test("real authenticated TLS rejects "+attack,{timeout:20000},async()=>{
  const {server,phone}=await setup();let s;
  try{
    await pair(server,phone);const v=await server.view();s=await socket(phone,phone.peers[0],v.endpoint.host,v.endpoint.port);
    const w=new Wire(s,""),hello=(await w.receive()).message;
    if(attack==="oversized-header"){const b=Buffer.alloc(4);b.writeUInt32BE(8193);s.write(b);}
    else{
      await w.send("hello",{deviceId:phone.id,name:phone.name,nonce:crypto.randomUUID(),versions:[1],maxBytes:10485760,mode:"synthetic-only"});
      let h={v:1,type:"probe",id:crypto.randomUUID(),seq:1,sid:w.sid,payload:{probeId:crypto.randomUUID(),bytes:1024,kind:"json"}};
      if(attack==="version")h.v=2;
      if(attack==="replay")h.seq=0;
      if(attack==="corrupt")h.payload.customer="forbidden";
      const b=Buffer.from(JSON.stringify(h)),a=Buffer.alloc(4),n=Buffer.alloc(4);a.writeUInt32BE(b.length);if(attack==="oversized-body")n.writeUInt32BE(10485761);
      s.write(Buffer.concat([a,b,n]));
    }
    await once(s,"close");assert.equal((await server.view()).connected,undefined);
  }finally{s?.destroy();await server.stop();}
});}
test("trusted identity survives changing IP and two Windows identities pair sequentially with one phone",{timeout:30000},async()=>{
  const a=await setup(),b=await setup();let c;
  try{
    await pair(a.server,a.phone);c=await connect(a.server,a.phone);assert.equal((await c.channel.test(1024,"binary")).ok,true);c.channel.close();
    await a.server.stop();await a.server.start("127.0.0.2");c=await connect(a.server,a.phone);assert.equal((await c.channel.test(1024,"json")).ok,true);c.channel.close();
    await a.server.stop();await pair(b.server,a.phone);c=await connect(b.server,a.phone);assert.equal((await c.channel.test(1024,"json")).ok,true);
    assert.equal(a.phone.peers.length,2);assert.notEqual(a.phone.peers[0].id,a.phone.peers[1].id);
  }finally{c?.channel.close();await a.server.stop();await b.server.stop();}
});
