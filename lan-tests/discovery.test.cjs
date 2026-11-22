const {test}=require("node:test"),assert=require("node:assert/strict"),crypto=require("node:crypto");
const {advertise,SERVICE}=require("../desktop/build/lan-discovery.cjs");
const {interfaces}=require("../desktop/build/lan-server.cjs");
test("real UDP mDNS advertises only protocol and installation metadata",{timeout:20000},async()=>{
 const address=interfaces()[0]?.address;assert.ok(address,"Runner needs a private LAN interface for real mDNS");
 const id=crypto.randomUUID(),browser=require("multicast-dns")({interface:address,bind:"0.0.0.0",type:"udp4",reuseAddr:true});
 let close,warning;const responses=[];
 try{
  const found=new Promise((resolve,reject)=>{
   browser.on("error",reject);browser.on("response",p=>{
    const answers=(p.answers||[]).filter(a=>a.name==="GM-"+id+"."+SERVICE||a.name==="gm-"+id+".local"||(a.name===SERVICE&&a.data==="GM-"+id+"."+SERVICE));
    if(answers.length){responses.push(...answers);if(answers.some(a=>a.type==="TXT"))resolve();}
   });
  });
  close=advertise(id,address,45881,()=>warning=true);
  const query=setInterval(()=>browser.query({questions:[{name:SERVICE,type:"PTR"}]}),500);
  try{await Promise.race([found,new Promise((_,reject)=>{const timeout=setTimeout(()=>reject(Error("mDNS timeout")),10000);timeout.unref();})]);}finally{clearInterval(query);}
  assert.equal(warning,undefined);const txt=responses.find(a=>a.type==="TXT").data.map(b=>b.toString()).sort();
  assert.deepEqual(txt,["id="+id,"v=1"]);assert.equal(responses.find(a=>a.type==="SRV").data.port,45881);
  assert.ok(responses.some(a=>a.type==="A"&&a.data===address));
 }finally{close?.();browser.destroy();}
});
