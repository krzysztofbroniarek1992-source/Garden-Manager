/** Controlled 5c2c adapter. This is not exposed through LAN or Electron IPC. */
import type { Data, Job, Payment } from "../domain";
import type { Expense } from "../expenses/model";
import { validateData } from "../data/repository";
import { checkJobAvailability } from "../availability/commands";
import { applyBank } from "./bank";
import { ApplyBlocked, keyParts } from "./basic";
import { covers, same } from "./causal";
import { validateFinanceValue } from "./finance";
import type { Json, Operation, ReplicaLog } from "./model";
import { SyncError } from "./model";
import { validateTimeAudit, validateSourceApprovalTransition, type VisitUnit } from "./visits";
import { isDecisionKey, verifyFinancialEvidence, type FinancialEvidence } from "./resolution-model";

export const hasFinancialDecision = (o:Operation) => o.changes.some(c=>isDecisionKey(c.key));
function hold(code:string, message:string):never {
  throw new ApplyBlocked("domain","FINANCIAL_"+code+": "+message);
}
const json=(v:unknown):Json=>JSON.parse(JSON.stringify(v));
const open=(j:Omit<Job,"reports">)=>["started","paused","resumed"].includes(j.timeHistory?.at(-1)?.kind??"");
function chosen(e:FinancialEvidence) {
  const source=e.sources.find(s=>s.operationId===e.intent.basisOperationId);
  if(!source)throw new SyncError("INVALID","Brak wybranego źródła decyzji.");
  return source;
}
/** No arbitrary target is trusted. Every receiver rebuilds the result from the
 * same bounded intent and immutable source evidence, without running commands. */
export function reconstructFinancialResult(data:Data,e:FinancialEvidence):Json {
  if(!e.baseAvailable || e.base===null || e.sources.some(s=>s.after===null))
    hold("ANCESTRY","Niezależne korzenie lub usunięcie wymagają uzgodnienia historii.");
  for(const s of e.sources)validateFinanceValue(data,e.key,s.after);
  validateFinanceValue(data,e.key,e.base);
  const basis=chosen(e);
  if(e.intent.kind==="visit") {
    const intent=e.intent, values=e.sources.map(s=>s.after as unknown as VisitUnit),
      value=structuredClone(basis.after as unknown as VisitUnit);
    const frame=(v:VisitUnit)=>{
      const {seconds,timeHistory,settlement,...job}=v.job;
      void seconds;void timeHistory;void settlement;
      return {job,reportIdentities:v.reportIdentities};
    };
    for(const source of e.sources)validateSourceApprovalTransition(
      source.before as unknown as VisitUnit|null,source.after as unknown as VisitUnit);
    if(values.some(v=>!same(frame(v),frame(value))) || value.job.taskOccurrenceId)
      hold("SCOPE","Rozbieżne dane niefinansowe, dokumenty lub harmonogram wymagają osobnego uzgodnienia.");
    if(values.some(v=>open(v.job)))hold("OPEN_TIME","Najpierw odbierz zakończenie źródłowego pomiaru.");
    const base=e.base as unknown as VisitUnit, prefix=base.job.timeHistory??[];
    if(values.some(v=>(v.job.timeHistory??[]).length<prefix.length ||
      !same((v.job.timeHistory??[]).slice(0,prefix.length),prefix)))
      hold("TIME_BASE","Alternatywy nie zachowują udowodnionej historii czasu.");
    const events=new Map<string,Json>();
    for(const v of values)for(const event of v.job.timeHistory??[]) {
      const previous=events.get(event.id);
      if(previous&&!same(previous,event))hold("EVENT_ID","To samo zdarzenie czasu ma różną treść.");
      events.set(event.id,json(event));
    }
    if(intent.labor.kind==="amount") {
      if(!value.job.settlement)hold("APPROVAL","Wybierz źródło zawierające prawidłowe zatwierdzenie.");
      value.job.settlement={...value.job.settlement,finalLaborCents:intent.labor.cents,source:"manual",approvedAt:e.at};
    }
    if(intent.time.kind==="seconds") {
      if(events.has(e.id))hold("EVENT_ID","UUID decyzji zajmuje istniejące zdarzenie.");
      const beforeSeconds=value.job.seconds;
      value.job.seconds=intent.time.seconds;
      value.job.timeHistory=[...(value.job.timeHistory??[]),{
        id:e.id,kind:"corrected",at:e.at,beforeSeconds,afterSeconds:intent.time.seconds,pauseDurationMs:null,
      }];
    }
    // Every original ID needs an explicit disposition, including cancellation.
    // Equal amounts never identify payments. No new payment IDs are accepted.
    const paymentIds=[...new Set(values.flatMap(v=>v.payments.map(p=>p.id)))].sort();
    if(!same(paymentIds,intent.payments.map(p=>p.id).sort()))
      hold("PAYMENT_COVERAGE","Zdecyduj jawnie o każdej oryginalnej wpłacie.");
    const payments:Payment[]=[];
    for(const d of intent.payments) {
      const source=e.sources.find(s=>s.operationId===d.sourceOperationId);
      const p=(source?.after as unknown as VisitUnit)?.payments.find(p=>p.id===d.id);
      if(!p)hold("PAYMENT_SOURCE","Brak oryginalnej wpłaty we wskazanym wariancie.");
      if(d.action==="keep")payments.push(structuredClone(p));
      if(d.action==="correct")payments.push({...p,amountCents:d.amountCents!,
        receivedDate:d.receivedDate!,method:d.method!,note:d.note!});
    }
    value.payments=payments.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
    validateTimeAudit(value.job);
    validateFinanceValue(data,e.key,json(value));
    return json(value);
  }
  const value=structuredClone(basis.after as unknown as Expense),intent=e.intent,
    values=e.sources.map(s=>s.after as unknown as Expense),base=e.base as unknown as Expense;
  const frame=(v:Expense)=>{
    const {revision,updatedAt,amountCents,categoryId,status,history,...immutable}=v;
    void revision;void updatedAt;void amountCents;void categoryId;void status;void history;
    return immutable;
  };
  if(values.some(v=>!same(frame(v),frame(value))))
    hold("EXPENSE_SCOPE","Nie wolno uzgadniać innych źródeł, transakcji, profili ani powiązań po podobieństwie.");
  if(values.some(v=>v.history.length<base.history.length ||
    !same(v.history.slice(0,base.history.length),base.history)))
    hold("EXPENSE_HISTORY","Brak wspólnego niezmiennego audytu wydatku.");
  value.amountCents=intent.amountCents;value.categoryId=intent.categoryId;value.status=intent.status;
  value.revision=Math.max(...values.map(v=>v.revision))+1;value.updatedAt=e.at;
  if(!Number.isSafeInteger(value.revision))hold("LIMIT","Wyczerpano rewizję wydatku.");
  value.history.push({at:e.at,amountCents:value.amountCents,categoryId:value.categoryId,
    status:value.status,reason:e.rationale});
  validateFinanceValue(data,e.key,json(value));
  return json(value);
}
/** Acknowledging a decision never splits an older business multi-record unit.
 * A previous decision's other record is only its immutable technical evidence,
 * which stays in the log even when its proposed business result is superseded. */
export function financialAncestors(log:ReplicaLog,o:Operation,settled:Set<string>) {
  const e=verifyFinancialEvidence(log,o),pending=log.operations.filter(p=>covers(o.context,p)&&
    !settled.has(p.origin+":"+p.sequence)&&p.changes.some(c=>c.key===e.key));
  for(const p of pending) {
    if(p.changes.length===1&&p.changes[0].key===e.key)continue;
    if(hasFinancialDecision(p)) {
      const prior=verifyFinancialEvidence(log,p);
      if(prior.key===e.key)continue;
    }
    hold("ATOMIC_GROUP","Decyzja wymaga całej starszej wielorekordowej jednostki; nie podzielono operacji.");
  }
  return pending;
}
export function applyFinancialDecision(data:Data,log:ReplicaLog,o:Operation):Data {
  const e=verifyFinancialEvidence(log,o),result=reconstructFinancialResult(data,e);
  if(!same(result,e.result))throw new SyncError("INVALID","Wynik decyzji nie wynika ze zweryfikowanej intencji.");
  const {id,kind}=keyParts(e.key);
  let next=structuredClone(data);
  if(kind==="visits") {
    const value=result as unknown as VisitUnit,existing=data.jobs.find(j=>j.id===id);
    if(data.timer?.jobId===id)hold("TIMER","Lokalny aktywny stoper chroni tę wizytę.");
    if(!existing)throw new ApplyBlocked("dependency","FINANCIAL_PARENT: Najpierw zastosuj wizytę nadrzędną.");
    if(open(existing))hold("OPEN_TIME","Lokalna historia ma otwarty pomiar; najpierw odbierz jego zakończenie.");
    if(existing.gardenId!==value.job.gardenId)hold("OWNER","Nie można przenieść historii do innego ogrodu.");
    // Issued reports are not part of this decision, regardless of new balances.
    const reports=(existing.reports??[]).map(r=>({id:r.id,number:r.number,version:r.version,
      generatedAt:r.generatedAt,fingerprint:r.fingerprint,
      requiresAssets:!!(r.snapshot.photos.length||r.snapshot.logo||r.options.photoIds.length||r.options.logoPhotoId)}));
    if(!same(reports,value.reportIdentities))hold("REPORTS","Tożsamości dokumentów wymagają wcześniejszego kompletnego uzgodnienia.");
    for(const p of value.payments)if(data.payments.some(v=>v.id===p.id&&v.jobId!==id))
      hold("PAYMENT_ID","Identyfikator wpłaty jest przypisany do innej wizyty.");
    checkJobAvailability(data,value.job,existing);
    const job:Job={...structuredClone(value.job),...(existing.reports?{reports:structuredClone(existing.reports)}:{})};
    next.jobs=next.jobs.map(j=>j.id===id?job:j);
    next.payments=[...next.payments.filter(p=>p.jobId!==id),...structuredClone(value.payments)];
  } else {
    const value=result as unknown as Expense,existing=data.expenses.find(v=>v.id===id);
    if(!existing)throw new ApplyBlocked("dependency","FINANCIAL_PARENT: Brak źródłowego wydatku.");
    if(!data.expenseCategories.some(c=>c.id===value.categoryId&&!c.archived))
      hold("CATEGORY","Wynik wymaga istniejącej aktywnej kategorii.");
    if(!same(existing.origin,value.origin)||existing.source!==value.source)
      hold("EXPENSE_ORIGIN","Nieuzgodnione pochodzenie CSV wymaga onboardingu.");
    if(value.source==="csv") {
      // Reuse strict original import/profile/row validation, never rerun a CSV.
      next=applyBank(next,[{key:e.key,before:chosen(e).after,after:result}]);
    } else next.expenses=next.expenses.map(v=>v.id===id?structuredClone(value):v);
  }
  try{validateData(next);}catch(error){hold("DOMAIN",(error as Error).message);}
  return next;
}
