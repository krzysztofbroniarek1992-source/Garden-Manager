import type { Data } from "../domain";
import type { VisitReport } from "../reports/model";
import { reportSourceSignature } from "../reports/model";
import { nextReportIdentity } from "../reports/commands";
import { parseReportNumber, scopedReportNumber, type ReportIdentity } from "../reports/numbering";
import { appendLocal, canonical, dotId, same } from "./causal";
import { type JournalState, validateJournal } from "./journal";
import { SyncError } from "./model";
import { assertReportNamespaceSafe, findReportCollisions, validateNamespaceClaim, type ReportNamespaceClaim } from "./report-registry";
import type { ReceiverState } from "./receiver-model";

export const REPORT_NUMBER_KEY="report-numbering-v1";
export const REPORT_NUMBER_SOURCE="before-report-numbering-v1";
export interface Reservation extends ReportIdentity {
  reportId:string;jobId:string;generatedAt:number;fingerprint:string;source:string;
}
export interface ReportNumberState {
  version:1;claim:ReportNamespaceClaim;nextSequence:number;pending:Reservation[];
}
const stop=(message:string):never=>{throw new SyncError("PRECONDITION","REPORT_NUMBERING: "+message);};
export function validateNumberState(value:unknown,j:JournalState):asserts value is ReportNumberState {
  if(!value||typeof value!=="object")stop("Brak trwałego licznika.");
  const n=value as ReportNumberState;
  if(Object.keys(n).sort().join("|")!=="claim|nextSequence|pending|version"||n.version!==1)stop("Nieprawidłowy format licznika.");
  validateNamespaceClaim(n.claim,"reportNamespaces/"+n.claim?.namespace);
  if(j.version!==2||n.claim.owner!==j.log.installation||!Number.isSafeInteger(n.nextSequence)||n.nextSequence<1||
    !Array.isArray(n.pending)||n.pending.length>1000||new TextEncoder().encode(canonical(n)).byteLength>8*1024**2)
    stop("Niespójny lub pełny rejestr rezerwacji. Zachowano numery.");
  const claim=j.log.operations.find(o=>o.origin===j.log.installation&&o.changes.some(c=>
    c.key==="reportNamespaces/"+n.claim.namespace&&c.before===null&&same(c.after,n.claim)));
  if(!claim||!j.appliedLocal.includes(dotId(claim)))stop("Brak oryginalnej deklaracji przestrzeni.");
  const ids=new Set<string>(),fresh=new Set<number>();
  for(const p of n.pending) {
    const parsed=parseReportNumber(p.number);
    if(Object.keys(p).sort().join("|")!=="fingerprint|generatedAt|jobId|number|reportId|source|version"||
      !/^[A-Za-z0-9_-]{1,100}$/.test(p.reportId)||typeof p.jobId!=="string"||!p.jobId.trim()||
      ids.has(p.reportId)||!parsed||parsed.namespace!==n.claim.namespace||parsed.sequence>=n.nextSequence||
      !Number.isSafeInteger(p.version)||p.version<1||!Number.isSafeInteger(p.generatedAt)||p.generatedAt<0||p.generatedAt>8.64e15||
      typeof p.fingerprint!=="string"||!/^[a-f0-9]{64}$/.test(p.fingerprint)||
      typeof p.source!=="string"||p.source.length>1024**2)
      stop("Nieprawidłowa rezerwacja.");
    if(p.version===1){if(fresh.has(parsed.sequence))stop("Powtórzony numer rodziny.");fresh.add(parsed.sequence);}
    ids.add(p.reportId);
  }
}
export function beginNumberState(j:JournalState):{numbering:ReportNumberState;journal:JournalState} {
  if(j.mode!=="active")stop("Po odtworzeniu kopii najpierw uzgodnij historię.");
  if(j.log.operations.some(o=>o.origin===j.log.installation&&o.changes.some(c=>c.key.startsWith("reportNamespaces/"))))
    stop("Zaginął lokalny rejestr istniejącej przestrzeni; nie wolno utworzyć zastępczego licznika.");
  const namespace=crypto.randomUUID();
  if(j.log.operations.some(o=>o.changes.some(c=>c.key==="reportNamespaces/"+namespace))||
    findReportCollisions(j.log).some(c=>c.type==="namespace"&&c.identity===namespace))
    throw new SyncError("CONFLICT","REPORT_NAMESPACE_COLLISION: Wylosowana przestrzeń jest już znana. Nie przydzielono numeru.");
  const claim:ReportNamespaceClaim={format:1,namespace,owner:j.log.installation,claimId:crypto.randomUUID()};
  const appended=appendLocal(j.log,[{key:"reportNamespaces/"+namespace,before:null,after:claim as unknown as import("./model").Json}]);
  const journal:JournalState={...j,version:2,log:appended.log,appliedLocal:[...j.appliedLocal,dotId(appended.operation!)]};
  const numbering:ReportNumberState={version:1,claim,nextSequence:1,pending:[]};
  validateJournal(journal);validateNumberState(numbering,journal);return{numbering,journal};
}
export function reserveNumber(data:Data,j:JournalState,n:ReportNumberState,r:ReceiverState,
  jobId:string,reportId:string,generatedAt:number,source:string,fingerprint:string):ReportIdentity {
  validateNumberState(n,j);
  if(j.mode!=="active")stop("Po odtworzeniu kopii najpierw uzgodnij historię.");
  assertReportNamespaceSafe(j.log,n.claim.namespace,r.identityAlerts??[]);
  const job=data.jobs.find(job=>job.id===jobId);
  if(!job||reportSourceSignature(data,jobId,JSON.parse(source).options)!==source)
    stop("Dane podglądu zmieniły się. Przygotuj aktualny raport.");
  const existing=job.reports?.find(p=>p.id===reportId);
  if(existing)stop("Identyfikator dokumentu został już wydany.");
  const old=n.pending.find(p=>p.reportId===reportId);
  if(old) {
    if(old.jobId!==jobId||old.generatedAt!==generatedAt||old.source!==source||old.fingerprint!==fingerprint)
      stop("Inna treść pod istniejącą rezerwacją.");
    return{number:old.number,version:old.version};
  }
  const latest=job.reports?.at(-1),version=(latest?.version??0)+1;
  if(latest&&parseReportNumber(latest.number)?.namespace!==n.claim.namespace)
    stop("Nowa wersja obcej lub historycznej rodziny wymaga uzgodnienia jej właściciela. Oryginał pozostaje dostępny.");
  if(n.pending.length>=1000||source.length>1024**2)stop("Limit oczekujących podglądów. Żaden numer nie został ponownie użyty.");
  const number=latest?.number??scopedReportNumber(n.claim.namespace,n.nextSequence,generatedAt);
  if(!latest)n.nextSequence++;
  if(!Number.isSafeInteger(n.nextSequence))stop("Wyczerpano bezpieczny licznik.");
  n.pending.push({reportId,jobId,generatedAt,source,fingerprint,number,version});
  validateNumberState(n,j);return{number,version};
}
export interface ReportWrite { jobId:string;report:VisitReport;expected:string }
export function checkReportWrites(data:Data,j:JournalState|undefined,n:ReportNumberState|undefined,r:ReceiverState|undefined,writes:ReportWrite[]) {
  if(!writes.length)return;
  if(!j) {
    if(n||writes.some(w=>parseReportNumber(w.report.number)?.namespace))
      stop("Raport z przestrzenią instalacji wymaga jej oryginalnego trwałego rejestru.");
    return;
  }
  if(!n)stop("Najpierw zarezerwuj numer raportu w aktywowanej przestrzeni.");
  validateNumberState(n,j);
  if(j.mode!=="active")stop("Wystawianie po restore jest wstrzymane do uzgodnienia historii.");
  assertReportNamespaceSafe(j.log,n.claim.namespace,r?.identityAlerts??[]);
  for(const {jobId,report,expected} of writes) {
    const reservation=n.pending.find(p=>p.reportId===report.id);
    if(!reservation||reservation.jobId!==jobId||reservation.number!==report.number||
      reservation.version!==report.version||reservation.generatedAt!==report.generatedAt||
      reservation.source!==expected||reservation.fingerprint!==report.fingerprint)
      stop("Brak zgodnej rezerwacji; nie zapisano dokumentu.");
    const job=data.jobs.find(j=>j.id===jobId),original=job?.reports?.find(p=>p.id===report.id);
    if(!original||!same(original,report))stop("Zapis dokumentu nie odpowiada rezerwacji.");
    n.pending=n.pending.filter(p=>p.reportId!==report.id);
  }
  validateNumberState(n,j);
}
/** Inactive installations retain the original preview/commit allocation. */
export function legacyReservation(data:Data,jobId:string,source:string,at:number):ReportIdentity {
  const job=data.jobs.find(j=>j.id===jobId);
  if(!job||reportSourceSignature(data,jobId,JSON.parse(source).options)!==source)stop("Dane podglądu zmieniły się.");
  return nextReportIdentity(data,job,at);
}
