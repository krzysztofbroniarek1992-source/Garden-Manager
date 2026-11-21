const {test}=require("node:test");const assert=require("node:assert/strict");
const w=require("../desktop/build/lan-wire.cjs");
test("closed protocol validates private IPv4, UUIDs, sizes, exact fields and versions",()=>{
  for(const ip of ["192.168.1.2","10.0.2.2","172.16.0.1"])assert.equal(w.privateAddress(ip),true);
  for(const ip of ["127.0.0.1","8.8.8.8","::1","192.168.01.1","172.32.1.1","10.0.0.999","host.local","file:///tmp"])assert.equal(w.privateAddress(ip),false);
  assert.throws(()=>w.fields({a:1,b:2},["a"]));
  assert.throws(()=>w.probeOptions(1025,"json"));assert.throws(()=>w.probeOptions(1024,"business"));
  for(const size of w.SIZES)for(const kind of ["json","binary"]){const b=w.synthetic(size,kind);assert.equal(b.length,size);assert.match(w.sha(b),w.HASH);if(kind==="json")assert.equal(JSON.parse(b).kind,"gm011a-synthetic");}
  assert.throws(()=>w.header({v:2,type:"hello",id:crypto.randomUUID(),sid:crypto.randomUUID(),seq:0,payload:{}}),/VERSION/);
});
