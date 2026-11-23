import type { Json, Operation, ReplicaLog } from "./model";
import { SyncError } from "./model";
import { canonical, covers, same, validateOperation } from "./causal";
import { keyParts } from "./basic";
import { isReportNamespace, parseReportNumber } from "../reports/numbering";

export interface ReportNamespaceClaim { format:1; namespace:string; owner:string; claimId:string }
export interface ReportIdentityHeader {
  id:string;number:string;version:number;generatedAt:number;fingerprint:string;requiresAssets:boolean;
}
export interface ReportCollision {
  id:string;type:"namespace"|"number"|"version"|"report-id"|"replica";
  identity:string;operations:string[];evidence:Json[];status:"open";
}
const object=(v:unknown):v is {[k:string]:unknown}=>!!v&&typeof v==="object"&&!Array.isArray(v);
const exact=(v:unknown,names:string[])=>object(v)&&Object.keys(v).sort().join("|")===[...names].sort().join("|");
function invalid(message:string):never {throw new SyncError("INVALID","REPORT_IDENTITY: "+message);}
const id=(v:unknown)=>typeof v==="string"&&/^[A-Za-z0-9_-]{1,100}$/.test(v);
const stamp=(v:unknown)=>Number.isSafeInteger(v)&&(v as number)>=0&&(v as number)<=8.64e15;
export function validateReportHeader(v:unknown):asserts v is ReportIdentityHeader {
  if(!exact(v,["id","number","version","generatedAt","fingerprint","requiresAssets"]))invalid("Nieprawidłowy nagłówek.");
  const r=v as unknown as ReportIdentityHeader;
  if(!id(r.id)||!parseReportNumber(r.number)||!Number.isSafeInteger(r.version)||r.version<1||
    !stamp(r.generatedAt)||typeof r.fingerprint!=="string"||!/^[a-f0-9]{64}$/.test(r.fingerprint)||
    typeof r.requiresAssets!=="boolean")invalid("Nieprawidłowa tożsamość dokumentu.");
}
export function validateReportHeaders(value:Json) {
  if(value===null)return;
  if(!object(value)||!Array.isArray(value.reportIdentities))invalid("Brak listy dokumentów.");
  const ids=new Set<string>();let number:string|undefined;
  for(const [index,r] of (value.reportIdentities as unknown[]).entries()) {
    validateReportHeader(r);
    if(ids.has(r.id)||r.version!==index+1||number!==undefined&&r.number!==number)invalid("Niespójna rodzina dokumentów.");
    ids.add(r.id);number=r.number;
  }
}
export function validateNamespaceClaim(value:unknown,key:string):asserts value is ReportNamespaceClaim {
  if(!exact(value,["format","namespace","owner","claimId"]))invalid("Nieprawidłowa deklaracja przestrzeni.");
  const v=value as unknown as ReportNamespaceClaim;
  if(v.format!==1||!isReportNamespace(v.namespace)||!isReportNamespace(v.owner)||
    !isReportNamespace(v.claimId)||key!=="reportNamespaces/"+v.namespace)invalid("Nieprawidłowa tożsamość przestrzeni.");
}
export function validateNamespaceOperation(o:Operation) {
  for(const c of o.changes)if(keyParts(c.key).kind==="reportNamespaces") {
    validateNamespaceClaim(c.after,c.key);
    if(c.before!==null||o.resolution||c.after.owner!==o.origin)
      invalid("Deklaracja jest niezmienna i musi pochodzić od właściciela.");
  }
}
/** Historical evidence comes only from original immutable operations, not
 * receipt stages. Equal document numbers never establish document identity. */
function evidence(log:ReplicaLog) {
  const claims:{value:ReportNamespaceClaim;operationId:string;operation:Operation}[]=[], reports:{value:ReportIdentityHeader;jobId:string;operationId:string;operation:Operation;born:boolean}[]=[];
  for(const o of log.operations)for(const c of o.changes) {
    const {kind,id}=keyParts(c.key);
    if(kind==="reportNamespaces") {
      validateNamespaceOperation(o);claims.push({value:c.after as unknown as ReportNamespaceClaim,operationId:o.id,operation:o});
    }
    if(kind==="visits")for(const v of [c.after]) {
      if(v===null)continue;
      // Known 5a logs may contain opaque legacy headers. Quarantine is handled
      // by the receiver; malformed data must not manufacture a valid collision.
      try {validateReportHeaders(v);}catch{continue;}
      for(const r of (v as unknown as {reportIdentities:ReportIdentityHeader[]}).reportIdentities) {
        const prior=(c.before as unknown as {reportIdentities?:ReportIdentityHeader[]}|null)?.reportIdentities?.find(p=>p.id===r.id);
        if(prior&&same(prior,r))continue;
        reports.push({value:r,jobId:id,operationId:o.id,operation:o,born:v===c.after&&!(c.before as unknown as {reportIdentities?:ReportIdentityHeader[]}|null)?.reportIdentities?.some(p=>p.id===r.id)});
      }
    }
  }
  return {claims,reports};
}
type Finding=Omit<ReportCollision,"id"|"status">;
export function findReportCollisions(log:ReplicaLog,identityAlerts:readonly Operation[]=[]):Finding[] {
  const {claims,reports}=evidence(log),result:Finding[]=[];
  function group<T>(rows:T[],key:(row:T)=>string,variant:(row:T)=>string,
    type:ReportCollision["type"],wire:(row:T)=>Json,operation:(row:T)=>string) {
    const groups=new Map<string,T[]>();
    for(const row of rows){const k=key(row);groups.set(k,[...(groups.get(k)??[]),row]);}
    for(const [identity,values] of groups)if(new Set(values.map(variant)).size>1) {
      const unique=new Map(values.map(r=>[canonical(wire(r)),wire(r)]));
      result.push({type,identity,operations:[...new Set(values.map(operation))].sort(),
        evidence:[...unique].sort(([a],[b])=>a.localeCompare(b,"en")).map(([,v])=>v)});
    }
  }
  group(claims,r=>r.value.namespace,r=>canonical(r.value),"namespace",
    r=>r.value as unknown as Json,r=>r.operationId);
  group(reports,r=>r.value.number,r=>r.jobId,"number",
    r=>({jobId:r.jobId,...r.value}) as unknown as Json,r=>r.operationId);
  group(reports,r=>r.value.number+"#"+r.value.version,r=>canonical([r.jobId,r.value]),"version",
    r=>({jobId:r.jobId,...r.value}) as unknown as Json,r=>r.operationId);
  group(reports,r=>r.value.id,r=>canonical([r.jobId,r.value]),"report-id",
    r=>({jobId:r.jobId,...r.value}) as unknown as Json,r=>r.operationId);
  // A number copied through a business ZIP does not transfer issuance rights.
  // Each scoped document needs its original source claim and birth operation.
  const tuple=(r:typeof reports[number])=>canonical([r.jobId,r.value]);
  const proven=new Set(reports.filter(r=>r.born&&claims.some(c=>
    c.value.namespace===parseReportNumber(r.value.number)?.namespace&&c.value.owner===r.operation.origin&&
    covers(r.operation.context,c.operation))).map(tuple));
  for(const r of reports) {
    const namespace=parseReportNumber(r.value.number)?.namespace;
    if(namespace&&!proven.has(tuple(r)))result.push({type:"namespace",identity:namespace,operations:[r.operationId],
      evidence:[{reason:"missing-original-issuance-proof",jobId:r.jobId,...r.value} as unknown as Json]});
  }
  for(const o of identityAlerts) {
    validateOperation(o);
    result.push({type:"replica",identity:o.origin,operations:[o.id],evidence:[o as unknown as Json]});
  }
  const merged=new Map<string,Finding>();
  for(const f of result) {
    const key=f.type+"/"+f.identity,old=merged.get(key);
    const evidence=new Map([...(old?.evidence??[]),...f.evidence].map(v=>[canonical(v),v]));
    merged.set(key,{...f,operations:[...new Set([...(old?.operations??[]),...f.operations])].sort(),
      evidence:[...evidence].sort(([a],[b])=>a.localeCompare(b,"en")).map(([,v])=>v)});
  }
  return [...merged].sort(([a],[b])=>a.localeCompare(b,"en")).map(([,v])=>v);
}
export function registerReportCollisions(log:ReplicaLog,previous:readonly ReportCollision[]=[],alerts:readonly Operation[]=[]):ReportCollision[] {
  return findReportCollisions(log,alerts).map(f=>{
    const old=previous.find(v=>v.type===f.type&&v.identity===f.identity);
    return {...f,id:old?.id??crypto.randomUUID(),status:"open"};
  });
}
export function validateReportCollisions(log:ReplicaLog,collisions:readonly ReportCollision[],alerts:readonly Operation[]) {
  if(!Array.isArray(collisions)||!Array.isArray(alerts)||alerts.length>128)invalid("Nieprawidłowy audyt kolizji.");
  for(const o of alerts) {
    validateOperation(o);
    const prior=log.operations.find(p=>p.origin===o.origin&&p.sequence===o.sequence);
    if(!(prior&&!same(prior,o)||o.origin===log.installation&&!prior))invalid("Brak dowodu niejednoznacznej repliki.");
  }
  const findings=findReportCollisions(log,alerts);
  if(new Set(collisions.map(c=>c.id)).size!==collisions.length)invalid("Powtórzony konflikt.");
  for(const c of collisions) {
    const f=findings.find(f=>f.type===c.type&&f.identity===c.identity);
    if(!f||!isReportNamespace(c.id)||c.status!=="open"||!Array.isArray(c.operations)||!c.operations.length||
      new Set(c.operations).size!==c.operations.length||c.operations.some(id=>!f.operations.includes(id))||
      !Array.isArray(c.evidence)||!c.evidence.length||c.evidence.some(v=>!f.evidence.some(p=>same(p,v))))
      invalid("Niespójny konflikt dokumentów.");
  }
}
export function operationHasReportCollision(o:Operation,collisions:readonly ReportCollision[]) {
  return collisions.some(c=>c.operations.includes(o.id)||o.changes.some(change=>{
    if(change.after===null)return false;
    if(keyParts(change.key).kind==="reportNamespaces")return c.type==="namespace"&&change.key==="reportNamespaces/"+c.identity;
    if(keyParts(change.key).kind!=="visits")return false;
    const headers=(change.after as unknown as {reportIdentities:ReportIdentityHeader[]}).reportIdentities;
    return headers.some(r=>c.type==="namespace"?parseReportNumber(r.number)?.namespace===c.identity:
      c.type==="number"?r.number===c.identity:c.type==="version"?r.number+"#"+r.version===c.identity:
      c.type==="report-id"?r.id===c.identity:false);
  }));
}
export function assertReportNamespaceSafe(log:ReplicaLog,namespace:string,alerts:readonly Operation[]=[]) {
  if(findReportCollisions(log,alerts).some(c=>c.type==="namespace"&&c.identity===namespace||
    c.type==="replica"&&c.identity===log.installation||
    c.type==="number"&&parseReportNumber(c.identity)?.namespace===namespace))
    throw new SyncError("CONFLICT","REPORT_NAMESPACE_COLLISION: Niejednoznaczna tożsamość repliki lub przestrzeni dokumentów. Wystawianie raportów wstrzymano bez zmiany wydanych numerów.");
}
