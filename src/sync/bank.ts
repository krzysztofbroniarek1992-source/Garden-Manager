import type { Data } from "../domain";
import {
  defaultOptions, rowMatch, validateExpenseData,
  type Expense, type ExpenseCategory, type ExpenseImport, type ExpenseProfile, type ExpenseRule, type ExpenseData,
} from "../expenses/model";
import { ApplyBlocked, keyParts } from "./basic";
import { same } from "./causal";
import { bankRisk } from "./bank-identity";
import { SyncError, type Json, type Mutation, type Operation } from "./model";

type Obj={ [key:string]:Json };
const obj=(v:Json):v is Obj=>v!==null && typeof v==="object" && !Array.isArray(v);
const stamp=["id","revision","createdAt","updatedAt"];
function shape(v:Json,fields:string[]) {
  if(!obj(v) || Object.keys(v).sort().join("|")!==[...fields].sort().join("|"))
    throw new SyncError("INVALID","Nieprawidłowa struktura CSV.");
  return v;
}
const cat=(id:string):ExpenseCategory=>({id,name:"Validation only",revision:1,createdAt:0,updatedAt:0,archived:false});
const profile=(id:string):ExpenseProfile=>({id,name:"Validation only",headers:[],options:defaultOptions(),archived:false,revision:1,createdAt:0,updatedAt:0});
const audit=(id:string,profileId:string):ExpenseImport=>({
  id,profileId,profileName:"Validation only",filename:"validation.csv",statementKey:"0".repeat(64),fileHash:"0".repeat(64),requestKey:"0".repeat(64),
  revision:1,createdAt:0,updatedAt:0,approved:0,excluded:0,duplicates:0,skipped:0,errors:0,rows:[],
});
const probe=():ExpenseData=>({expenses:[],expenseCategories:[cat("validation-only")],expenseProfiles:[],expenseRules:[],expenseImports:[]});
export const csvExpense=(v:Json)=>obj(v) && v.source==="csv";
export function bankMutation(c:Mutation) {
  return ["expenseProfiles","expenseRules","expenseImports"].includes(keyParts(c.key).kind) ||
    keyParts(c.key).kind==="expenses" && (csvExpense(c.before)||csvExpense(c.after));
}
/** Intrinsic validation uses temporary dependency stubs only. No stub is ever
 * written to Data; actual cyclic links are validated by applyBank. */
export function validateBankValue(key:string,value:Json) {
  if(value===null)return;
  const {kind}=keyParts(key);
  if(!["expenseProfiles","expenseRules","expenseImports"].includes(kind) && !(kind==="expenses"&&csvExpense(value)))return;
  const p=probe();
  try {
    if(kind==="expenseProfiles") {
      const v=shape(value,[...stamp,"name","headers","options","archived"]);
      const o=shape(v.options,["delimiter","encoding","headerRow","mode","positiveIsExpense","decimal","dateFormat","mapping"]);
      shape(o.mapping,["date","amount","debit","credit","counterparty","description","transactionId","currency"]);
      p.expenseProfiles=[v as unknown as ExpenseProfile];
    } else if(kind==="expenseRules") {
      const v=shape(value,[...stamp,"name","field","pattern","categoryId","action","enabled","priority"]);
      p.expenseCategories=[cat(v.categoryId as string)];p.expenseRules=[v as unknown as ExpenseRule];
    } else if(kind==="expenseImports") {
      const v=shape(value,[...stamp,"profileId","profileName","filename","statementKey","fileHash","requestKey","approved","excluded","duplicates","skipped","errors","rows"]);
      if(!Array.isArray(v.rows))throw Error("Brak wierszy importu.");
      for(const row of v.rows)shape(row,["line","date","signedCents","counterparty","description","decision","expenseId","reason"]);
      const i=v as unknown as ExpenseImport;p.expenseProfiles=[profile(i.profileId)];p.expenseImports=[i];
      const ids=[...new Set(i.rows.flatMap(r=>r.expenseId===null?[]:[r.expenseId]))];
      p.expenses=ids.map(id=>({id,revision:1,createdAt:0,updatedAt:0,date:"2000-01-01",amountCents:1,direction:"outgoing",
        counterparty:"",description:"",categoryId:"validation-only",source:"manual",origin:null,status:"excluded",note:"",history:[]}));
    } else {
      const e=value as unknown as Expense;
      if(!e.origin)throw Error("Brak pochodzenia bankowego.");
      p.expenseCategories=[...new Set([e.categoryId,...e.history.map(h=>h.categoryId)])].map(cat);
      p.expenseProfiles=[profile(e.origin.profileId)];p.expenseImports=[audit(e.origin.importId,e.origin.profileId)];p.expenses=[e];
    }
    validateExpenseData(p);
  } catch(e) {
    if(e instanceof SyncError)throw e;
    throw new SyncError("INVALID","Nieprawidłowe dane CSV, mapowanie lub tożsamość bankowa.");
  }
}
function blocked(message:string):never {throw new ApplyBlocked("domain",message);}
export function bankEligibility(o:Operation) {
  for(const c of o.changes.filter(bankMutation)) {
    if(c.after===null)throw new ApplyBlocked("unsupported","Usunięcie historii CSV, profilu lub reguły wymaga osobnego uzgodnienia.");
    if(keyParts(c.key).kind==="expenseImports" && c.before!==null && !same(c.before,c.after))
      blocked("CSV_AUDIT_IMMUTABLE: Historia importu jest niezmienna; bieżąca decyzja wydatku ma własną historię.");
    if(keyParts(c.key).kind==="expenses" && c.before===null) {
      const e=c.after as unknown as Expense;
      const paired=o.changes.find(x=>x.key==="expenseImports/"+encodeURIComponent(e.origin!.importId) && x.before===null && x.after!==null);
      if(!paired)throw new ApplyBlocked("unsupported","CSV_ATOMIC_GROUP: Nowy wydatek wymaga źródłowego importu w tej samej operacji. Starszy rozdzielony bootstrap wymaga onboardingu.");
    }
  }
}
function version(before:{revision:number;createdAt:number}|null,after:{revision:number;createdAt:number}) {
  if(before && (after.createdAt!==before.createdAt || after.revision<=before.revision))
    blocked("CSV_VERSION: Utrata tożsamości lub rewizji rekordu.");
}
function linked(i:ExpenseImport,e:Expense,duplicate=false) {
  const origin=e.origin;
  if(!origin || origin.profileId!==i.profileId)blocked("CSV_LINK: Wiersz wskazuje wydatek innego profilu lub bez źródła.");
  return (row:ExpenseImport["rows"][number])=>{
    if(row.date===null || row.signedCents===null || !row.signedCents ||
      rowMatch({line:row.line,date:row.date,signedCents:row.signedCents,counterparty:row.counterparty,
        description:row.description,transactionId:origin.transactionId,occurrence:origin.occurrence})!==origin.match)
      blocked("CSV_LINK: Treść wiersza nie odpowiada oryginalnej transakcji.");
    if(!duplicate) {
      if(row.signedCents>0 && row.decision!=="excluded")
        blocked("CSV_LINK: Wpływ bankowy nie może mieć zatwierdzonego kosztu w historii importu.");
      const occurrence=i.rows.filter(r=>r.line<=row.line && r.date!==null && r.signedCents!==null && r.signedCents!==0 &&
        rowMatch({line:r.line,date:r.date!,signedCents:r.signedCents!,counterparty:r.counterparty,description:r.description,
          transactionId:null,occurrence:1})===origin.match).length;
      if(origin.occurrence!==occurrence)blocked("CSV_OCCURRENCE: Kolejność wystąpienia nie odpowiada wierszom źródłowego importu.");
    }
    if(!duplicate && (origin.importId!==i.id || origin.statementKey!==i.statementKey || origin.line!==row.line ||
      !e.history.length || e.createdAt!==i.createdAt || e.history[0].at!==i.createdAt ||
      e.history[0].status!==row.decision || e.history[0].amountCents!==Math.abs(row.signedCents)))
      blocked("CSV_LINK: Brak spójnego źródła lub początkowej decyzji importu.");
    if(duplicate && !origin.transactionId && origin.statementKey!==i.statementKey)
      blocked("CSV_LINK: Brak dowodu tożsamości powtórzenia bez ID bankowego.");
  };
}
/** Does not create expenses from import rows or re-run classification rules.
 * Only original records in the approved operation may enter the candidate. */
export function applyBank(data:Data,changes:Mutation[]):Data {
  const work=changes.filter(bankMutation);
  if(!work.length)return data;
  const next=structuredClone(data);
  const put=<T extends {id:string}>(rows:T[],v:T)=>rows.some(x=>x.id===v.id)?rows.map(x=>x.id===v.id?v:x):[...rows,v];
  for(const c of work) {
    const {kind}=keyParts(c.key);
    if(kind==="expenseProfiles") {
      const value=c.after as unknown as ExpenseProfile;version(c.before as unknown as ExpenseProfile|null,value);
      next.expenseProfiles=put(next.expenseProfiles,value);
    } else if(kind==="expenseRules") {
      const value=c.after as unknown as ExpenseRule;version(c.before as unknown as ExpenseRule|null,value);
      next.expenseRules=put(next.expenseRules,value);
    } else if(kind==="expenseImports")next.expenseImports=put(next.expenseImports,c.after as unknown as ExpenseImport);
    else {
      const value=c.after as unknown as Expense, old=c.before as unknown as Expense|null;
      version(old,value);
      if(value.source!=="csv" || !value.origin || old && (old.source!==value.source || old.direction!==value.direction ||
        !same(old.origin,value.origin) || value.history.length<=old.history.length || !same(value.history.slice(0,old.history.length),old.history)))
        blocked("CSV_HISTORY: Zmiana utraciłaby pochodzenie lub historię decyzji.");
      const last=value.history.at(-1);
      if(!last || last.at!==value.updatedAt || last.status!==value.status || last.categoryId!==value.categoryId || last.amountCents!==value.amountCents)
        blocked("CSV_HISTORY: Końcowa decyzja nie odpowiada aktualnemu wydatkowi.");
      next.expenses=put(next.expenses,value);
    }
  }
  for(const c of work.filter(x=>keyParts(x.key).kind==="expenseImports")) {
    const i=c.after as unknown as ExpenseImport;
    for(const row of i.rows) {
      if(row.decision==="approved" || row.decision==="excluded") {
        const e=next.expenses.find(e=>e.id===row.expenseId);
        if(!e)throw new ApplyBlocked("dependency","CSV_DEPENDENCY: Brak wydatku wymaganego przez import.");
        linked(i,e)(row);
      } else if(row.decision==="duplicate" && row.expenseId!==null) {
        const e=next.expenses.find(e=>e.id===row.expenseId);
        if(!e)throw new ApplyBlocked("dependency","CSV_DEPENDENCY: Brak oryginału powtórzonej transakcji.");
        linked(i,e,true)(row);
      } else if(row.decision!=="duplicate" && row.expenseId!==null)
        blocked("CSV_LINK: Pominięty/błędny wiersz nie może tworzyć kosztu.");
    }
  }
  for(const c of work.filter(x=>keyParts(x.key).kind==="expenses")) {
    const e=c.after as unknown as Expense, i=next.expenseImports.find(i=>i.id===e.origin!.importId);
    if(!i)throw new ApplyBlocked("dependency","CSV_DEPENDENCY: Brak źródłowej historii importu.");
    const row=i.rows.find(r=>r.line===e.origin!.line && r.expenseId===e.id && ["approved","excluded"].includes(r.decision));
    if(!row)blocked("CSV_LINK: Wydatek nie ma źródłowego wiersza i decyzji.");
    linked(i,e)(row);
  }
  const added=work.filter(c=>keyParts(c.key).kind==="expenses" && c.before===null).map(c=>c.after as unknown as Expense);
  const risk=bankRisk(data,added,work.filter(c=>keyParts(c.key).kind==="expenseImports").map(c=>c.after as unknown as ExpenseImport));
  if(risk)blocked(risk);
  return next;
}
export function bankParents(c:Mutation):string[] {
  const {kind}=keyParts(c.key), value=c.after;
  if(!obj(value))return [];
  const key=(type:string,id:string)=>type+"/"+encodeURIComponent(id);
  if(kind==="expenseRules")return [key("expenseCategories",value.categoryId as string)];
  if(kind==="expenseImports") {
    const i=value as unknown as ExpenseImport;
    return [key("expenseProfiles",i.profileId),...i.rows.flatMap(r=>r.expenseId===null?[]:[key("expenses",r.expenseId)])];
  }
  if(kind==="expenses" && csvExpense(value)) {
    const e=value as unknown as Expense;
    return [key("expenseProfiles",e.origin!.profileId),key("expenseImports",e.origin!.importId)];
  }
  return [];
}
