/** Diagnostic uses only ephemeral synthetic identities and prints no credentials. */
const {app}=require("electron"),tls=require("node:tls");
const {LanServer}=require("../desktop/build/lan-server.cjs");
const {createIdentity,Memory,pub,pair,connect,socket,until}=require("./helpers.cjs");
app.whenReady().then(async()=>{
 let failed=false;
 for(const version of ["TLSv1.3","TLSv1.2"])for(const placement of ["initial-trust","pairing-refresh"]){
  tls.DEFAULT_MAX_VERSION=version;let server,client;
  try{
   const own=await createIdentity("CI Windows"),phone=await createIdentity("CI phone");
   if(placement==="initial-trust"){own.peers=[pub(phone)];phone.peers=[pub(own)];}
   server=new LanServer(new Memory(own),{interfaces:()=>[{name:"CI",address:"127.0.0.1"}],discovery:false});await server.start("127.0.0.1");
   server.server.on("secureConnection",s=>console.log(JSON.stringify({synthetic:true,event:"tls-accepted",authorized:s.authorized,legacyRaw:!!s.getPeerCertificate(true).raw,x509Raw:!!s.getPeerX509Certificate()?.raw,protocol:s.getProtocol()})));
   server.server.on("tlsClientError",e=>console.log(JSON.stringify({synthetic:true,event:"tls-rejected",code:/^[A-Z0-9_]{1,80}$/.test(e.code||"")?e.code:"TLS"})));
   if(placement==="pairing-refresh")await pair(server,phone);
   client=await connect(server,phone);const result=await client.channel.test(1024,"json");
   client.channel.close();await until(async()=>!(await server.view()).connected);
   const wrong=await createIdentity("CI wrong certificate"),v=await server.view();
   await require("node:assert/strict").rejects(socket(phone,{...pub(own),cert:wrong.cert},v.endpoint.host,v.endpoint.port));
   let rejected;try{rejected=await socket(wrong,pub(own),v.endpoint.host,v.endpoint.port);await require("node:events").once(rejected,"close");}catch{/* TLS 1.2 rejects before secureConnect. */}finally{rejected?.destroy();}
   require("node:assert/strict").equal((await server.view()).connected,undefined);
   console.log(JSON.stringify({synthetic:true,runtime:"Electron "+process.versions.electron,version,placement,ok:result.ok,sha256Matches:result.sentSha256===result.receivedSha256}));
  }catch(e){failed=true;console.log(JSON.stringify({synthetic:true,runtime:"Electron "+process.versions.electron,version,placement,ok:false,diagnostic:String(e.message)}));}
  finally{client?.channel.close();await server?.stop();}
 }
 app.exit(failed?1:0);
}).catch(()=>{console.error("Synthetic Electron TLS probe failed");app.exit(1);});
