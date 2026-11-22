import type { Data, Payment } from "../domain";
import type { Expense, ExpenseCategory, Versioned } from "../expenses/model";
import { validateExpenseData } from "../expenses/model";
import { validateShopping, type ShoppingItem } from "../shopping/model";
import { GardenStore } from "../data/store";
import { validateData } from "../data/repository";
import { same } from "./causal";
import { businessRecords, validateWireProjection } from "./records";
import { ApplyBlocked, keyParts } from "./basic";
import { SyncError, type Json, type Operation } from "./model";
import { applyBank, bankEligibility, bankParents, csvExpense, validateBankValue } from "./bank";

/** Deliberately bounded checkpoint. Financial records are indivisible; there
 * is no field merge, financial resolution API or job replacement. CSV uses a separate atomic adapter. */
export const financeKinds = ["expenses","expenseCategories","expenseRules","expenseProfiles","expenseImports","shoppingItems","visits"] as const;
export const isFinance = (key:string) => (financeKinds as readonly string[]).includes(keyParts(key).kind);
type Obj = { [key:string]:Json };
const obj = (v:Json):v is Obj => v!==null && typeof v==="object" && !Array.isArray(v);
function shape(v:Json, fields:string[]):Obj {
  if(!obj(v) || Object.keys(v).sort().join("|")!==[...fields].sort().join("|"))
    throw new SyncError("INVALID","Nieprawidłowa struktura jednostki finansowej.");
  return v;
}
const stamps=["id","revision","createdAt","updatedAt"];
const expenseFields=[...stamps,"date","amountCents","direction","counterparty","description","categoryId","source","origin","status","note","history"];
const shoppingFields=[...stamps,"deletedAt","name","quantityMilli","unit","category","status","priority","plannedPrice","actualPrice","vendor","url","notes","jobId","jobTitle","purchasedOn","archivedAt","expenseId"];
function category(id:string):ExpenseCategory {
  return {id,name:"Validation only",revision:1,createdAt:0,updatedAt:0,archived:false};
}
/** Shape/intrinsic checks do not turn invented probe dependencies into Data.
 * Actual references and causal parent versions are checked before commit. */
export function validateFinanceValue(data:Data,key:string,value:Json) {
  validateWireProjection(key,value);
  const {kind,id}=keyParts(key);
  if(!isFinance(key) || value===null) return;
  if(!obj(value) || (kind==="visits" ? !obj(value.job) || value.job.id!==id : value.id!==id))
    throw new SyncError("INVALID","Identyfikator jednostki finansowej nie odpowiada kluczowi.");
  try {
    validateBankValue(key,value);
    if(kind==="expenseCategories") {
      shape(value,[...stamps,"name","archived"]);
      const v=value as unknown as ExpenseCategory;
      const spare=category(id==="validation-active"?"validation-active-2":"validation-active");
      validateExpenseData({expenses:[],expenseImports:[],expenseProfiles:[],expenseRules:[],expenseCategories:[v,spare]});
    } else if(kind==="expenses") {
      shape(value,expenseFields);
      if(!Array.isArray(value.history)) throw Error("Brak historii wydatku.");
      for(const h of value.history) shape(h,["at","status","categoryId","amountCents","reason"]);
      if(value.origin!==null) shape(value.origin,["profileId","transactionId","statementKey","identity","match","occurrence","importId","line"]);
      // CSV origins are intrinsically validated by the bank adapter above;
      // actual import/profile/row dependencies are checked on the full candidate.
      if(value.source==="manual") {
        const e=value as unknown as Expense;
        const ids=[...new Set([e.categoryId,...e.history.map(h=>h.categoryId)])];
        if(ids.some(x=>typeof x!=="string" || !x.trim())) throw Error("Brak kategorii.");
        validateExpenseData({expenses:[e],expenseCategories:ids.map(category),expenseRules:[],expenseProfiles:[],expenseImports:[]});
      } else if(value.source!=="csv") throw Error("Nieprawidłowe pochodzenie.");
    } else if(kind==="shoppingItems") {
      shape(value,shoppingFields);
      for(const p of [value.plannedPrice,value.actualPrice]) if(p!==null) shape(p,["amountCents","basis"]);
      const p=value as unknown as ShoppingItem;
      // The intrinsic validator only needs an expense ID/direction here;
      // real expense identity, content and causal dependencies are checked below.
      const dependencies=p.expenseId ? [{id:p.expenseId,direction:"outgoing"} as Expense] : [];
      validateShopping({...data,shoppingItems:[p],expenses:dependencies});
    } else if(kind==="visits") {
      if(!Array.isArray(value.payments)) throw Error("Brak rejestru płatności.");
      for(const p of value.payments) {
        const v=shape(p,["id","jobId","amountCents","receivedDate","method","note"]);
        if(v.jobId!==id) throw Error("Płatność innego zlecenia.");
      }
    }
  } catch(e) {
    if(e instanceof SyncError) throw e;
    throw new SyncError("INVALID","Nieprawidłowe dane jednostki finansowej.");
  }
}
export function financeEligibility(data:Data,o:Operation) {
  const present=businessRecords(data);
  for(const c of o.changes.filter(x=>isFinance(x.key))) {
    for(const v of [c.before,c.after]) {
      try {validateFinanceValue(data,c.key,v);}
      catch(e) {
        // A 5a inbox may already KNOW a formerly opaque bank record. New strict
        // validation must quarantine it without aborting unrelated valid plans.
        // Fresh incoming records still use validateFinanceValue directly.
        if(e instanceof SyncError && e.code==="INVALID")
          throw new ApplyBlocked("domain","FINANCE_INVALID: Wcześniej odebrany rekord wymaga naprawy/uzgodnienia; nie zastosowano go.");
        throw e;
      }
    }
    if(o.resolution) throw new ApplyBlocked("unsupported","Nieobsługiwana decyzja finansowa; wymagane uzgodnienie całej historii.");
    const {kind,id}=keyParts(c.key);
    if(kind==="visits" && data.timer?.jobId===id)
      throw new ApplyBlocked("domain","Aktywny stoper chroni tę wizytę; zakończ pomiar przed uzgodnieniem jej danych.");
    // Identical existing records may acknowledge a foreign baseline, never
    // silently change it or assert a common dataset ancestor.
    if(same(present.get(c.key)??null,c.after)) continue;
    if(c.after===null) throw new ApplyBlocked("unsupported","Fizyczne usunięcie finansów jest zablokowane; zachowaj historię.");
    if(kind==="expenses" && !csvExpense(c.after) && [c.before,c.after].some(v=>obj(v) &&
      (v.source!=="manual" || v.origin!==null || v.direction!=="outgoing")))
      throw new ApplyBlocked("unsupported","Ręczne wydatki muszą zachować pochodzenie outgoing.");
    if(kind==="shoppingItems" && [c.before,c.after].some(v=>obj(v) && v.jobId!==null))
      throw new ApplyBlocked("unsupported","Zakup powiązany ze zleceniem oczekuje na adapter zleceń.");
  }
  bankEligibility({...o,changes:o.changes.filter(c=>!same(present.get(c.key)??null,c.after))});
}
function version(before:Versioned|undefined,after:Versioned) {
  if(before && (after.createdAt!==before.createdAt || after.revision<=before.revision))
    throw new ApplyBlocked("domain","Zmiana utraciłaby tożsamość lub rewizję rekordu.");
}
export function applyFinance(data:Data,values:Map<string,Json>,o:Operation):Data {
  financeEligibility(data,o);
  let next=structuredClone(data);
  const current=businessRecords(data);
  const changes=o.changes.filter(c=>values.has(c.key) && !same(current.get(c.key)??null,values.get(c.key)));
  const put=<T extends {id:string}>(rows:T[],v:T)=>rows.some(x=>x.id===v.id)?rows.map(x=>x.id===v.id?v:x):[...rows,v];
  for(const c of changes) {
    if(!same(current.get(c.key)??null,c.before) || !same(c.after,values.get(c.key)))
      throw new ApplyBlocked("domain","Finansowa wersja bazowa nie odpowiada zatwierdzonej historii.");
    const {kind}=keyParts(c.key);
    if(kind==="expenseCategories") {
      const value=c.after as unknown as ExpenseCategory, old=c.before as unknown as ExpenseCategory|undefined;
      version(old??undefined,value); next.expenseCategories=put(next.expenseCategories,value);
    }
  }
  next=applyBank(next,changes);
  for(const c of changes) {
    const {kind,id}=keyParts(c.key);
    if(kind==="expenses" && !csvExpense(c.after)) {
      const value=c.after as unknown as Expense, old=c.before as unknown as Expense|null;
      version(old??undefined,value);
      if(old && (!same(old.origin,value.origin) || old.source!==value.source || old.direction!==value.direction ||
        value.history.length<=old.history.length || !same(value.history.slice(0,old.history.length),old.history)))
        throw new ApplyBlocked("domain","Zmiana utraciłaby pochodzenie lub historię korekt wydatku.");
      const last=value.history.at(-1);
      if(!last || last.amountCents!==value.amountCents || last.categoryId!==value.categoryId || last.status!==value.status ||
        last.at!==value.updatedAt || !next.expenseCategories.some(cat=>cat.id===value.categoryId && (!cat.archived || old?.categoryId===cat.id)))
        throw new ApplyBlocked("domain","Wydatek wymaga spójnej historii i aktywnej kategorii.");
      next.expenses=put(next.expenses,value);
    } else if(kind==="shoppingItems") {
      const value=c.after as unknown as ShoppingItem, old=c.before as unknown as ShoppingItem|null;
      version(old??undefined,value);
      if(old && (old.expenseId!==null && old.expenseId!==value.expenseId || old.deletedAt!==null && !same(old,value)))
        throw new ApplyBlocked("domain","Nie wolno utracić powiązania wydatku ani odtworzyć usuniętego zakupu.");
      next.shoppingItems=put(next.shoppingItems,value);
    } else if(kind==="visits") {
      const old=c.before as Obj|null, value=c.after as Obj;
      if(!old || !same(old.job,value.job) || !same(old.reportIdentities,value.reportIdentities))
        throw new ApplyBlocked("unsupported","Zmiany zlecenia, czasu, rozliczenia lub raportów wymagają kolejnego adaptera.");
      const job=next.jobs.find(j=>j.id===id);
      if(!job || job.status!=="completed" || !job.settlement)
        throw new ApplyBlocked("domain","Płatności można dopisywać wyłącznie do istniejącej zatwierdzonej wizyty.");
      const previous=old.payments as unknown as Payment[], payments=value.payments as unknown as Payment[];
      if(new Set(payments.map(p=>p.id)).size!==payments.length || previous.some(p=>!payments.some(n=>n.id===p.id && same(n,p))))
        throw new ApplyBlocked("domain","Edycja lub usunięcie istniejącej płatności wymaga osobnego uzgodnienia.");
      let probe=structuredClone(next);
      const store=new GardenStore({load:()=>probe,save:v=>{probe=v;}},()=>0);
      try {
        for(const p of payments.filter(p=>!previous.some(old=>old.id===p.id))) {
          if(probe.payments.some(x=>x.id===p.id)) throw Error("ID płatności jest już używane.");
          store.savePayment(p,null);
          if(!same(probe.payments.find(x=>x.id===p.id),p)) throw Error("Nieprawidłowy zapis płatności.");
        }
      } catch(e) {throw new ApplyBlocked("domain",(e as Error).message);}
      next.payments=probe.payments;
    }
  }
  try {validateData(next);} catch(e) {throw new ApplyBlocked("domain",(e as Error).message);}
  for(const k of Object.keys(data) as (keyof Data)[])
    if(!["expenseCategories","expenseProfiles","expenseRules","expenseImports","expenses","shoppingItems","payments"].includes(k) && !same(data[k],next[k]))
      throw new SyncError("INVALID","Adapter finansowy próbował zmienić chronione dane.");
  return next;
}
/** Source-context parents must already be materialized (or created in the same
 * operation), not merely exist as an unrelated record with the same ID. */
export function financeParents(data:Data,o:Operation):string[] {
  const present=businessRecords(data), result=new Set<string>();
  const add=(kind:string,id:string)=>result.add(kind+"/"+encodeURIComponent(id));
  for(const c of o.changes.filter(x=>isFinance(x.key))) {
    if(c.after===null || same(present.get(c.key)??null,c.after)) continue;
    for(const parent of bankParents(c))result.add(parent);
    const {kind,id}=keyParts(c.key), value=c.after as Obj;
    if(kind==="expenses") {
      add("expenseCategories",value.categoryId as string);
      for(const h of value.history as Obj[]) add("expenseCategories",h.categoryId as string);
    } else if(kind==="shoppingItems" && value.expenseId!==null) add("expenses",value.expenseId as string);
    else if(kind==="visits") {
      const job=data.jobs.find(j=>j.id===id), garden=data.gardens.find(g=>g.id===job?.gardenId);
      if(job) add("gardens",job.gardenId);
      if(garden) add("clients",garden.clientId);
    }
  }
  return [...result];
}
