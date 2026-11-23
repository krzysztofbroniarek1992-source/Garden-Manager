import type { Data } from "../domain";
import type { VisitReport } from "../reports/model";
import { parseReportNumber } from "../reports/numbering";
import { validateData } from "../data/repository";
import { ApplyBlocked, keyParts } from "./basic";
import { canonical, covers, dotId, recordView, same } from "./causal";
import { businessRecords } from "./records";
import { applyUnits, eligibilityUnits } from "./units";
import { operationHasReportCollision, type ReportCollision, type ReportIdentityHeader } from "./report-registry";
import { reportIdentity, reportKey, validatePortableReport, type ReportAvailability, type ReportSeal } from "./report-documents";
import type { Json, Operation, ReplicaLog } from "./model";

const headers=(v:Json)=>(v as unknown as {reportIdentities:ReportIdentityHeader[]}|null)?.reportIdentities??[];
const reportConcern=(o:Operation)=>o.changes.some(c=>c.key.startsWith("reports/")||c.key.startsWith("reportDocuments/")||
  c.key.startsWith("visits/")&&!same(headers(c.before),headers(c.after)));
const technical=(key:string)=>key.startsWith("reportDocuments/")||key.startsWith("reportNamespaces/")||key==="counters/reportSequence";
function hold(text:string,dependency=false):never {throw new ApplyBlocked(dependency?"dependency":"domain",text);}
export interface ReportCohort { data:Data; operations:Operation[] }
/** A group contains complete original operations, including legacy split
 * bootstrap operations. It never rewrites UUIDs or acknowledges a fragment.
 * The caller only records applied after the enclosing IDB transaction commits. */
export function applyReportCohort(
  data:Data,original:Operation,known:ReplicaLog,materialized:ReplicaLog,applied:Set<string>,
  availability:readonly ReportAvailability[],collisions:readonly ReportCollision[],
  checkParents:(o:Operation,ids:Set<string>,data:Data)=>void,
):ReportCohort|null {
  if(!reportConcern(original))return null;
  const included=new Set([original.id]), wanted=new Map<string,{jobId:string;identity:ReportIdentityHeader}>();
  const want=(jobId:string,identity:ReportIdentityHeader)=>wanted.set(canonical([jobId,identity]),{jobId,identity});
  let changed=true;
  while(changed) {
    const size=included.size+wanted.size;
    for(const o of known.operations.filter(o=>included.has(o.id)))for(const c of o.changes) {
      if(c.key.startsWith("visits/"))for(const h of headers(c.after)) {
        const v=c.after as unknown as {job:{id:string}};
        want(v.job.id,h);
      }
      if(c.key.startsWith("reports/")&&c.after!==null) {
        validatePortableReport(c.key,c.after);want(c.after.jobId,reportIdentity(c.after.report));
      }
      if(c.key.startsWith("reportDocuments/")&&c.after!==null) {
        const seal=c.after as unknown as ReportSeal;want(seal.jobId,seal.identity);
      }
      // All earlier unmaterialized versions of any touched key must accompany
      // the group. Source operations already materialized remain untouched.
      for(const p of known.operations)if(!applied.has(dotId(p))&&covers(o.context,p)&&p.changes.some(v=>v.key===c.key))included.add(p.id);
    }
    for(const w of wanted.values()) {
      const entry=availability.find(v=>v.jobId===w.jobId&&same(v.identity,w.identity));
      if(!entry||entry.status==="pending")hold("REPORT_PROOF_WAIT: Brak zweryfikowanego dowodu dokumentu.",true);
      if(entry.status==="conflict")hold("REPORT_DOCUMENT_CONFLICT: "+entry.reason);
      if(entry.status==="source-only")throw new ApplyBlocked("photos",entry.reason);
      for(const id of entry.sourceOperations) {
        const o=known.operations.find(p=>p.id===id);
        if(!o)hold("REPORT_SOURCE_WAIT: Brak oryginalnej operacji.",true);
        if(!applied.has(dotId(o)))included.add(id);
      }
    }
    changed=size!==included.size+wanted.size;
  }
  const operations=known.operations.filter(o=>included.has(o.id)&&!applied.has(dotId(o)));
  if(!operations.length)return null;
  const ids=new Set(applied),log={...materialized,operations:[...materialized.operations]},virtual=businessRecords(data);
  let next=data;
  for(const o of operations) {
    if(o.resolution)hold("REPORT_RESOLUTION: Decyzje zachowujące oba audyty wymagają 5c2c.");
    if(operationHasReportCollision(o,collisions))hold("REPORT_DOCUMENT_CONFLICT: Kolizja numeru lub przestrzeni.");
    checkParents(o,ids,next);
    for(const c of o.changes) {
      if(c.key.startsWith("reports/")&&(c.before!==null||c.after===null))
        hold("REPORT_DOCUMENT_CONFLICT: Wydany snapshot jest niezmienny.");
      if(c.key.startsWith("reportDocuments/")&&(c.before!==null||c.after===null))
        hold("REPORT_DOCUMENT_CONFLICT: Źródłowy dowód jest niezmienny.");
      if(c.key==="counters/reportSequence" && (typeof c.after!=="number"||!Number.isSafeInteger(c.after)||c.after<0))
        hold("REPORT_COUNTER: Nieprawidłowy historyczny znacznik.");
      if(technical(c.key))continue;
      if(recordView(known,c.key).status==="conflict")hold("REPORT_DOCUMENT_CONFLICT: Konflikt wymaganej jednostki.");
      const current=recordView(log,c.key);
      if(current.status==="conflict"||!same(current.value,virtual.get(c.key)??null))
        hold("REPORT_DOCUMENT_CONFLICT: Lokalna treść nie odpowiada udowodnionej historii.");
      if(known.operations.some(p=>!ids.has(dotId(p))&&!included.has(p.id)&&covers(o.context,p)&&p.changes.some(x=>x.key===c.key)))
        hold("REPORT_PREDECESSOR: Nie zastosowano całego poprzednika.",true);
    }
    const proposed={...log,operations:[...log.operations,o]},values=new Map<string,Json>();
    for(const c of o.changes) {
      if(technical(c.key)){virtual.set(c.key,c.after);continue;}
      const view=recordView(proposed,c.key);
      if(view.status==="conflict")hold("REPORT_DOCUMENT_CONFLICT: Sprzeczne wersje w grupie.");
      values.set(c.key,view.value);
    }
    // Adapter-only view: job/payments still pass the exact existing 5c1
    // transition checks. Only the report identity guard is deferred until the
    // complete immutable family is validated below. Nothing is re-journaled.
    const normalize=(key:string,value:Json):Json=>{
      if(!key.startsWith("visits/")||value===null)return value;
      const local=businessRecords(next).get(key);
      return {...(value as object),reportIdentities:headers(local??null)} as unknown as Json;
    };
    const ordinary=o.changes.filter(c=>!technical(c.key)&&!c.key.startsWith("reports/"));
    const adapter={...o,changes:ordinary.map(c=>({key:c.key,before:normalize(c.key,c.before),after:normalize(c.key,c.after)}))};
    if(adapter.changes.length) {
      const adapterValues=new Map(adapter.changes.map(c=>[c.key,normalize(c.key,values.get(c.key)??null)]));
      eligibilityUnits(next,adapter);next=applyUnits(next,adapterValues,adapter);
    }
    for(const [key,value] of values)virtual.set(key,value);
    log.operations.push(o);ids.add(dotId(o));
  }
  const jobs=new Set([...wanted.values()].map(w=>w.jobId));
  for(const jobId of jobs) {
    if(next.timer?.jobId===jobId)hold("VISIT_TIMER: Aktywny lokalny stoper chroni tę wizytę.");
    const key="visits/"+encodeURIComponent(jobId),unit=virtual.get(key);
    const job=next.jobs.find(j=>j.id===jobId);
    if(!job||!unit)hold("REPORT_PARENT: Brak materializowanej wizyty.",true);
    const hs=headers(unit),reports:VisitReport[]=[];
    for(const h of hs) {
      const entry=availability.find(v=>v.jobId===jobId&&same(v.identity,h));
      if(entry?.status!=="portable")hold("REPORT_DOCUMENT_CONFLICT: Niekompletna lub sprzeczna rodzina dokumentów.");
      const reportValue=virtual.get(reportKey(jobId,h.id));
      if(!reportValue)hold("REPORT_PARENT: Brak pełnego oryginału snapshotu.",true);
      validatePortableReport(reportKey(jobId,h.id),reportValue);
      if(!same(reportIdentity(reportValue.report),h))hold("REPORT_DOCUMENT_CONFLICT: Niezgodna tożsamość snapshotu.");
      reports.push(structuredClone(reportValue.report));
    }
    if((job.reports??[]).some((r,i)=>!same(reports[i]??null,r)))
      hold("REPORT_DOCUMENT_CONFLICT: Nie wolno nadpisać istniejącego dokumentu.");
    next={...next,jobs:next.jobs.map(j=>j.id===jobId?{...j,reports}:j)};
  }
  // A foreign sequence is NOT a reservation. Only already issued legacy
  // documents impose the existing v12 validation lower bound.
  let sequence=next.reportSequence;
  for(const j of next.jobs)for(const r of j.reports??[]) {
    const p=parseReportNumber(r.number);
    if(p?.namespace===null)sequence=Math.max(sequence,p.sequence);
  }
  next={...next,reportSequence:sequence};
  try{validateData(next);}catch(e){hold("REPORT_DOMAIN: "+(e as Error).message);}
  // Data's portable business projection must match the simulated immutable
  // histories, except for technical keys and the local compatibility marker.
  const final=businessRecords(next);
  for(const o of operations)for(const c of o.changes)if(!technical(c.key)&&!same(final.get(c.key)??null,virtual.get(c.key)??null))
    hold("REPORT_DOCUMENT_CONFLICT: Jednostka nie zachowała pełnej projekcji.");
  return {data:next,operations};
}
