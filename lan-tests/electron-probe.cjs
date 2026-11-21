/** Diagnostic uses only ephemeral synthetic identities and prints no credentials. */
const {app}=require("electron"),tls=require("node:tls");
const {LanServer}=require("../desktop/build/lan-server.cjs");
const {createIdentity,Memory,pub,pair,connect}=require("./helpers.cjs");
app.whenReady().then(async()=>{
 let failed=false;
 for(const version of ["TLSv1.3","TLSv1.2"])for(const placement of ["initial-trust","pairing-refresh"]){
  tls.DEFAULT_MAX_VERSION=version;let server,client;
  try{
   const own=await createIdentity("CI Windows"),phone=await createIdentity("CI phone");
   if(placement==="initial-trust"){own.peers=[pub(phone)];phone.peers=[pub(own)];}
   server=new LanServer(new Memory(own),{interfaces:()=>[{name:"CI",address:"127.0.0.1"}],discovery:false});await server.start("127.0.0.1");
   if(placement==="pairing-refresh")await pair(server,phone);
   client=await connect(server,phone);const result=await client.channel.test(1024,"json");
   console.log(JSON.stringify({synthetic:true,runtime:"Electron "+process.versions.electron,version,placement,ok:result.ok,sha256Matches:result.sentSha256===result.receivedSha256}));
  }catch(e){failed=true;console.log(JSON.stringify({synthetic:true,runtime:"Electron "+process.versions.electron,version,placement,ok:false,diagnostic:String(e.message)}));}
  finally{client?.channel.close();await server?.stop();}
 }
 app.exit(failed?1:0);
}).catch(()=>{console.error("Synthetic Electron TLS probe failed");app.exit(1);});
