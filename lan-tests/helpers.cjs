const tls=require("node:tls");const crypto=require("node:crypto");const {once}=require("node:events");
const {createIdentity,dns,transcript,publicPeer}=require("../desktop/build/lan-identity.cjs");
const {Wire}=require("../desktop/build/lan-wire.cjs");const {Channel}=require("../desktop/build/lan-channel.cjs");
const {LanServer}=require("../desktop/build/lan-server.cjs");
class Memory {constructor(data){this.data=data;} async get(){return this.data;} async update(f){this.data=f(this.data);return this.data;}}
const pub=p=>({...publicPeer(p),cert:p.cert});
async function setup(){const pc=await createIdentity("Syntetyczny Windows"),phone=await createIdentity("Syntetyczny Android");
const store=new Memory(pc),server=new LanServer(store,{interfaces:()=>[{name:"CI loopback",address:"127.0.0.1"},{name:"CI second address",address:"127.0.0.2"}],discovery:false});
await server.start("127.0.0.1");return {pc,phone,store,server};}
async function socket(own,peer,host,port,clientCert=true){
const s=tls.connect({host,port,servername:dns(peer.id),ca:[peer.cert],...(clientCert?{key:own.key,cert:own.cert}:{}),rejectUnauthorized:true,minVersion:"TLSv1.2"});
s.on("error",()=>{});s.setTimeout(10000,()=>s.destroy(Error("TIMEOUT")));
await Promise.race([once(s,"secureConnect"),once(s,"error").then(([e])=>Promise.reject(e))]);return s;}
async function pair(server,phone){
const v=await server.invite(),invite=JSON.parse(Buffer.from(v.invitation.text.slice(7),"base64url"));
const s=await socket(phone,invite.device,invite.host,invite.pairPort,false),w=new Wire(s,invite.pairId);
const signature=crypto.sign("sha256",transcript(invite.ticket,invite.device.id,phone),phone.key).toString("base64");
await w.send("pair",{ticket:invite.ticket,device:pub(phone),signature});
const pending=(await w.receive()).message; if(pending.type!=="pair-pending")throw Error("pending");
await w.send("pair-confirm",{code:pending.payload.code});await server.confirm();
const approved=(await w.receive()).message,done=(await w.receive()).message;
if(approved.type!=="pair-approved"||done.type!=="pair-done")throw Error("confirmation");
phone.peers.push(invite.device);s.destroy();return invite.device;}
async function connect(server,phone){
const v=await server.view(),peer=phone.peers.find(p=>p.id===v.device.id);
const s=await socket(phone,peer,v.endpoint.host,v.endpoint.port);
let last;const channel=new Channel(s,phone,peer,false,r=>last=r,()=>{},()=>{});
void channel.start(false);await until(()=>channel.ready);return {channel,s,last:()=>last};
}
async function until(f){const end=Date.now()+10000;while(!await f()){if(Date.now()>end)throw Error("condition timeout");await new Promise(r=>setTimeout(r,10));}}
module.exports={Memory,pub,setup,socket,pair,connect,until,Wire,Channel,createIdentity};
