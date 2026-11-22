import { dns } from "./lan-identity.cjs";
export const SERVICE="_gardenmanager._tcp.local";
/** Standard mDNS/DNS-SD records only. No name, invitation, key or business fields. */
export function advertise(id:string,address:string,port:number,warning:()=>void){
  const mdns=require("multicast-dns")({interface:address,bind:"0.0.0.0",type:"udp4",reuseAddr:true}) as {
    on:(event:string,listener:(packet:any)=>void)=>void;respond:(packet:unknown)=>void;destroy:()=>void;
  };
  const instance="GM-"+id+"."+SERVICE,host=dns(id),records=(ttl:number)=>[
    {name:SERVICE,type:"PTR",ttl,data:instance},
    {name:instance,type:"SRV",ttl,data:{port,target:host,priority:0,weight:0}},
    {name:instance,type:"TXT",ttl,data:[Buffer.from("v=1"),Buffer.from("id="+id)]},
    {name:host,type:"A",ttl,data:address},
  ];
  let last=0,closed=false;
  mdns.on("error",warning);mdns.on("warning",()=>{});
  mdns.on("query",packet=>{
    if(closed||!packet||typeof packet!=="object"||Date.now()-last<1000||!Array.isArray(packet.questions))return;
    if(packet.questions.some((q:unknown)=>q&&typeof q==="object"&&[SERVICE,instance,host].includes((q as {name:string}).name))){
      last=Date.now();mdns.respond({answers:records(120)});
    }
  });
  const announce=setTimeout(()=>{if(!closed)mdns.respond({answers:records(120)});},150);announce.unref();
  return ()=>{if(closed)return;closed=true;clearTimeout(announce);try{mdns.respond({answers:records(0)});}finally{mdns.destroy();}};
}
