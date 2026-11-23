import type { Data, Job, Payment } from "../domain";
import { calculatedLaborCents, materialsTotalCents, paidCents, roundLaborTo50Cents } from "../domain";
import { checkJobAvailability } from "../availability/commands";
import { validateData } from "../data/repository";
import { same } from "./causal";
import { ApplyBlocked, keyParts } from "./basic";
import { SyncError, type Json } from "./model";

type Obj = { [key:string]:Json };
export interface VisitUnit { job:Omit<Job,"reports">; payments:Payment[]; reportIdentities:Json[] }
const object=(v:unknown):v is Obj=>v!==null&&typeof v==="object"&&!Array.isArray(v);
function fields(value:unknown, required:string[], optional:string[]=[]):asserts value is Obj {
  if(!object(value)||required.some(k=>!Object.hasOwn(value,k))||
    Object.keys(value).some(k=>![...required,...optional].includes(k)))
    throw new SyncError("INVALID","VISIT_SHAPE: Nieprawidłowa struktura wizyty.");
}
const jobFields=["id","gardenId","title","date","time","status","billing","rate","fixedPrice","seconds","materials","notes","activities","settlement"];
const jobOptional=["visitDetails","timeHistory","taskOccurrenceId"];
function hold(code:string,message:string):never {throw new ApplyBlocked("domain",code+": "+message);}

/** The array order is the audit order, NOT a wall-clock winner. Old v12 jobs
 * may have no audit (or begin mid-measurement after an upgrade). Their baseline
 * is preserved; subsequent events must still form a valid state machine.
 * An open remote audit never starts a local Timer. */
export function validateTimeAudit(job:Omit<Job,"reports">) {
  const events=job.timeHistory??[];
  let mode:"unknown"|"idle"|"running"|"paused"="unknown";
  let seconds:number|undefined;
  for(const e of events) {
    if(seconds!==undefined) {
      const accruing=mode==="running"&&["paused","stopped","completed"].includes(e.kind);
      if(accruing ? e.beforeSeconds<seconds : e.beforeSeconds!==seconds)
        hold("VISIT_TIME_CHAIN","Historia czasu nie jest ciągła.");
    }
    if(e.kind!=="corrected" && e.beforeSeconds!==e.afterSeconds)
      hold("VISIT_TIME_EVENT","Pomiar nie może zmienić czasu poza zatwierdzonym segmentem.");
    if(mode==="paused"&&["resumed","stopped","completed"].includes(e.kind)&&e.pauseDurationMs===null)
      hold("VISIT_PAUSE","Brak audytu czasu przerwy.");
    if(e.pauseDurationMs!==null && (!["resumed","stopped","completed"].includes(e.kind) ||
      mode!=="paused"&&mode!=="unknown"))
      hold("VISIT_PAUSE","Nieprawidłowy kontekst przerwy.");
    if(e.kind==="started") {
      if(mode!=="idle"&&mode!=="unknown")hold("VISIT_TIME_STATE","Ponowny start otwartego pomiaru.");
      mode="running";
    } else if(e.kind==="paused") {
      if(mode!=="running"&&mode!=="unknown")hold("VISIT_TIME_STATE","Pauza bez otwartego pomiaru.");
      mode="paused";
    } else if(e.kind==="resumed") {
      if(mode!=="paused"&&mode!=="unknown")hold("VISIT_TIME_STATE","Wznowienie bez pauzy.");
      mode="running";
    } else if(e.kind==="corrected") {
      if(mode==="running"||mode==="paused")hold("VISIT_TIME_STATE","Korekta otwartego pomiaru.");
      mode="idle";
    } else {
      if(e.kind==="stopped" && mode==="idle")hold("VISIT_TIME_STATE","Powtórny STOP bez startu.");
      mode="idle";
    }
    seconds=e.afterSeconds;
  }
  if(seconds!==undefined && job.seconds!==seconds)
    hold("VISIT_SECONDS","Zapisany czas nie odpowiada ostatniemu zdarzeniu.");
  if(job.status!=="in-progress" && (mode==="running"||mode==="paused"))
    hold("VISIT_TIME_OPEN","Zakończona wizyta ma niezakończony audyt pomiaru.");
}

/** Intrinsic validation uses isolated dependency probes, never stored parents.
 * Real source-context references are checked by the receiver before commit. */
export function validateVisitValue(data:Data,key:string,value:Json) {
  if(keyParts(key).kind!=="visits"||value===null)return;
  fields(value,["job","payments","reportIdentities"]);
  fields(value.job,jobFields,jobOptional);
  const job=value.job as unknown as Job;
  if(job.id!==keyParts(key).id || !Array.isArray(job.materials) ||
    !Array.isArray(value.payments)||!Array.isArray(value.reportIdentities))
    throw new SyncError("INVALID","VISIT_SHAPE: Brak danych wizyty.");
  for(const m of job.materials)fields(m,["id","name","quantity","unitPrice"],["unit","purchaseUnitPrice","catalogId","zoneId","zoneName"]);
  if(job.settlement!==null)fields(job.settlement,["calculatedLaborCents","suggestedLaborCents","materialsCents","finalLaborCents","approvedAt","source"]);
  for(const p of value.payments) {
    fields(p,["id","jobId","amountCents","receivedDate","method","note"]);
    if(p.jobId!==job.id)throw new SyncError("INVALID","VISIT_PAYMENT: Płatność innej wizyty.");
  }
  const zoneId=job.visitDetails?.zoneId;
  const zones=zoneId?[{id:zoneId,name:"Validation only",type:"other",area:null,length:null,plants:"",requirements:"",treatments:""}]:[];
  const probe:Data={...data,clients:[{id:"validation-client",name:"Validation only",phone:"",email:"",notes:""}],
    gardens:[{id:job.gardenId,clientId:"validation-client",name:"Validation only",address:"",area:0,notes:"",zones}],
    jobs:[job],payments:value.payments as unknown as Payment[],timer:null,photos:[],notes:[],todos:[],deskTombstones:[],
    checklists:[],workTemplates:[],checklistTombstones:[],taskSchedules:[],taskOccurrences:[],shoppingItems:[]};
  try {validateData(probe);validateTimeAudit(job);}
  catch(e) {throw new SyncError("INVALID","VISIT_INVALID: "+(e as Error).message);}
}
function historyTransition(old:VisitUnit|null,value:VisitUnit) {
  const before=old?.job.timeHistory??[], after=value.job.timeHistory??[];
  if(after.length<before.length || !same(after.slice(0,before.length),before))
    hold("VISIT_HISTORY","Nie wolno utracić ani przepisać historii pomiarów/korekt.");
  if(old && old.job.seconds!==value.job.seconds && after.length===before.length)
    hold("VISIT_HISTORY","Zmiana sekund wymaga źródłowego zdarzenia czasu.");
  const first=after[before.length];
  if(old && first && !before.length) {
    // Legacy histories can start with STOP/PAUSE of an unrecorded old timer.
    const accrued=["paused","stopped","completed"].includes(first.kind);
    if(accrued ? first.beforeSeconds<old.job.seconds : first.beforeSeconds!==old.job.seconds)
      hold("VISIT_TIME_BASE","Pierwsze zdarzenie nie zachowuje dotychczasowego czasu.");
  }
  if(old&&old.job.status!=="completed"&&value.job.status==="completed"&&
    !after.slice(before.length).some(e=>e.kind==="completed"))
    hold("VISIT_COMPLETION","Zakończenie istniejącej wizyty wymaga źródłowego zdarzenia.");
  const oldDetails=old?.job.visitDetails, details=value.job.visitDetails;
  if(oldDetails&&(!details||!same(oldDetails,details)&&details.revision<=oldDetails.revision))
    hold("VISIT_DETAILS","Zmiana utraciłaby wersję szczegółów wizyty.");
  validateTimeAudit(value.job);
}
function firstApproval(job:Job) {
  const s=job.settlement;
  if(!s || s.source==="legacy")return; // Original imported legacy balance is an immutable baseline.
  const calculated=calculatedLaborCents(job), materials=materialsTotalCents(job);
  const suggested=job.billing==="hourly"?roundLaborTo50Cents(calculated):null;
  if(s.calculatedLaborCents!==calculated || s.materialsCents!==materials || s.suggestedLaborCents!==suggested ||
    s.source==="exact"&&s.finalLaborCents!==calculated ||
    s.source==="fixed"&&(job.billing!=="fixed"||s.finalLaborCents!==calculated))
    hold("VISIT_APPROVAL","Nowe zatwierdzenie nie odpowiada źródłowej wizycie.");
}

/** Only causal, whole visit transitions. No time commands are replayed and no
 * alternative seconds/payments/settlements are silently combined. */
export function applyVisit(data:Data,key:string,before:Json,after:Json):Data {
  const id=keyParts(key).id;
  if(data.timer?.jobId===id)hold("VISIT_TIMER","Aktywny stoper chroni tę wizytę.");
  if(after===null)hold("VISIT_DELETE","Usuwanie wizyt wymaga osobnego uzgodnienia całej dokumentacji.");
  const old=before as unknown as VisitUnit|null, value=after as unknown as VisitUnit;
  if(!same(old?.reportIdentities??[],value.reportIdentities))
    throw new ApplyBlocked("unsupported","VISIT_REPORTS: Raporty wymagają punktu 5c2; nie zmieniono dokumentów.");
  if(value.job.taskOccurrenceId || old?.job.taskOccurrenceId)
    throw new ApplyBlocked("unsupported","VISIT_SCHEDULE: Powiązanie z wystąpieniem wymaga adaptera grup planowania.");
  if(old?.job.gardenId && old.job.gardenId!==value.job.gardenId)
    hold("VISIT_SCOPE","Przeniesienie wizyty wymaga uzgodnienia historii i lokalnej dokumentacji.");
  historyTransition(old,value);
  if(old?.job.settlement && !same(old.job.settlement,value.job.settlement))
    hold("VISIT_SETTLEMENT","Zmiana zatwierdzonej ceny wymaga jawnego uzgodnienia z zachowaniem historii.");
  // New snapshot adoption preserves past approvals exactly; first approval of
  // a previously materialized job must match that source transition.
  if(old&&!old.job.settlement&&value.job.settlement)firstApproval(value.job);
  const previous=old?.payments??[], payments=value.payments;
  if(previous.some(p=>!payments.some(n=>n.id===p.id&&same(n,p))))
    hold("VISIT_PAYMENTS","Korekta lub anulowanie wpłaty wymaga jawnego uzgodnienia, bez utraty wcześniejszej wersji.");
  for(const p of payments.filter(p=>!previous.some(n=>n.id===p.id))) {
    if(data.payments.some(n=>n.id===p.id&&n.jobId!==id))
      hold("VISIT_PAYMENT_ID","Identyfikator wpłaty należy już do innej wizyty.");
    if(value.job.status==="completed"&&!value.job.settlement)
      hold("VISIT_PAYMENT_APPROVAL","Zakończona wizyta wymaga zatwierdzonej ceny przed nową wpłatą.");
  }
  const garden=data.gardens.find(g=>g.id===value.job.gardenId);
  for(const material of value.job.materials)
    if(material.zoneId&&!old?.job.materials.some(m=>m.id===material.id&&m.zoneId===material.zoneId)&&
      !garden?.zones.some(z=>z.id===material.zoneId))
      hold("VISIT_ZONE","Nowy materiał wskazuje brakującą strefę.");
  const existing=data.jobs.find(j=>j.id===id);
  try {checkJobAvailability(data,value.job,existing);}
  catch(e){hold("VISIT_AVAILABILITY",(e as Error).message);}
  const job:Job={...structuredClone(value.job),...(existing?.reports?{reports:structuredClone(existing.reports)}:{})};
  const next={...data,jobs:existing?data.jobs.map(j=>j.id===id?job:j):[...data.jobs,job],
    payments:[...data.payments.filter(p=>p.jobId!==id),...structuredClone(payments)]};
  if(paidCents(id,next.payments)>0 && old && old.job.gardenId!==job.gardenId)
    hold("VISIT_SCOPE","Nie można zmienić właściciela otrzymanych wpłat.");
  try{validateData(next);}catch(e){hold("VISIT_DOMAIN",(e as Error).message);}
  return next;
}
