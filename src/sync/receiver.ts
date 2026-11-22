import type { Data } from "../domain";
import {
  appendLocal, canonical, covers, dominates, dotId, receive, recordView, same, validateOperation,
} from "./causal";
import { type JournalState, validateJournal } from "./journal";
import { SyncError, syncLimits, type Json, type Operation, type ReplicaLog, type Vector } from "./model";
import { businessRecords } from "./records";
import { ApplyBlocked, applyBasic, eligibility, keyParts, validateBasicValue } from "./basic";
import {
  newReceiver, type ReceiverState, type Receipt,
  type SyncPlan, type CommitReceipt, type PlanSummary, type ConflictDecision,
} from "./receiver-model";

export interface ReceiverContext { data: Data; revision: number; journal: JournalState; receiver: ReceiverState }
function fail(message: string): never { throw new SyncError("PRECONDITION", message); }
const stages = ["received","waiting-dependencies","verified","planned","waiting-records","conflict","blocked","applied","resolved","rejected"];
const settled = (r: Receipt) => r.stage === "applied" || r.stage === "resolved";
const opMap = (j: JournalState) => new Map(j.log.operations.map(o => [dotId(o), o]));
function requireActive(c: ReceiverContext) {
  if (c.journal.mode !== "active") fail("Po przywróceniu kopii najpierw uzgodnij historię. Odbiór i stosowanie są wstrzymane.");
  if (c.revision !== c.journal.lastRevision) fail("Wykryto zapis pomijający dziennik. Nie zmieniono danych.");
}
export function initialReceiver(j: JournalState) {
  if (j.log.waiting.length || j.log.operations.some(o => o.origin !== j.log.installation))
    fail("Brak rejestru odbioru dla istniejącej obcej historii. Wymagane jawne uzgodnienie.");
  return newReceiver();
}
/** Metadata is local-only. It is never deserialized from a wire bundle. */
export function validateReceiver(r: ReceiverState, j: JournalState) {
  validateJournal(j);
  if (!r || r.version !== 1 || !Number.isSafeInteger(r.revision) || r.revision < 0 ||
    !Array.isArray(r.receipts) || !Array.isArray(r.conflicts) || !Array.isArray(r.rejections) ||
    !Array.isArray(r.commits) || r.receipts.length > syncLimits.operations || r.rejections.length > 128 ||
    r.commits.length > syncLimits.operations ||
    r.receipts.filter(v=>v.stage==="received" || v.stage==="waiting-dependencies").length > syncLimits.waiting) throw new SyncError("INVALID", "Nieprawidłowy rejestr odbioru.");
  const known = opMap(j), byDot = new Map<string, Receipt>(), ids = new Set<string>();
  for (const row of r.receipts) {
    validateOperation(row.operation);
    const o = row.operation, key = dotId(o), prior = known.get(key);
    if (o.origin === j.log.installation || byDot.has(key) || ids.has(o.id) || !stages.includes(row.stage) ||
      typeof row.reason !== "string" || row.reason.length > 2000 ||
      !(row.appliedRevision === null || Number.isSafeInteger(row.appliedRevision) && row.appliedRevision >= 0 && row.appliedRevision <= j.lastRevision) ||
      !(row.resolvedBy === null || typeof row.resolvedBy === "string") ||
      (row.stage === "applied") !== (row.appliedRevision !== null) ||
      row.stage === "resolved" && !j.log.operations.some(p => p.id === row.resolvedBy && p.resolution && covers(p.context,o)) ||
      prior && !same(prior,o) ||
      !["received","waiting-dependencies","rejected"].includes(row.stage) && !prior)
      throw new SyncError("INVALID", "Niespójny wynik odebranej operacji.");
    byDot.set(key,row); ids.add(o.id);
  }
  for (const o of [...j.log.operations,...j.log.waiting])
    if (o.origin !== j.log.installation && !byDot.has(dotId(o)))
      throw new SyncError("INVALID", "Znana operacja nie ma trwałego rejestru odbioru.");
  const conflicts = new Set<string>();
  for (const v of r.conflicts) {
    if (!v || typeof v.id !== "string" || conflicts.has(v.id) || typeof v.key !== "string" ||
      typeof v.kind !== "string" || typeof v.token !== "string" || typeof v.reason !== "string" ||
      !Array.isArray(v.operations) || !Array.isArray(v.remote) || !Array.isArray(v.fields) ||
      typeof v.baseAvailable !== "boolean" || !["open","resolved","superseded"].includes(v.status) ||
      !(v.resolvedBy === null || j.log.operations.some(o => o.id === v.resolvedBy && o.resolution)))
      throw new SyncError("INVALID", "Nieprawidłowy rejestr konfliktów.");
    const heads=v.operations.map(id=>j.log.operations.find(o=>o.id===id));
    if(!heads.length || heads.some(o=>!o || !o.changes.some(x=>x.key===v.key)) ||
      canonical(heads.map(o=>({origin:o!.origin,sequence:o!.sequence})))!==v.token ||
      v.remote.length!==heads.length || new Set(v.remote.map(x=>x.operationId)).size!==heads.length ||
      v.remote.some(remote=>{
        const source=heads.find(o=>o?.id===remote.operationId)?.changes.find(x=>x.key===v.key);
        return !source || !same(source.after,remote.value);
      }) || v.status==="resolved" && !j.log.operations.some(o=>o.id===v.resolvedBy && o.resolution &&
        o.changes.some(x=>x.key===v.key) && heads.every(h=>covers(o.context,h!))))
      throw new SyncError("INVALID","Konflikt nie odpowiada niezmiennej historii operacji.");
    conflicts.add(v.id);
  }
  if (r.plan && (typeof r.plan.id !== "string" || !Number.isSafeInteger(r.plan.stateRevision) ||
    !Number.isSafeInteger(r.plan.receiverRevision) || typeof r.plan.knowledge !== "string" ||
    !Array.isArray(r.plan.operations) || new Set(r.plan.operations).size !== r.plan.operations.length))
    throw new SyncError("INVALID", "Nieprawidłowy plan zastosowania.");
  const commits = new Set<string>();
  for (const v of r.commits) {
    if (!v || typeof v.planId !== "string" || commits.has(v.planId) || !Number.isSafeInteger(v.stateRevision) ||
      v.stateRevision > j.lastRevision || !Array.isArray(v.operations) || !Array.isArray(v.resolved) ||
      v.operations.some(id => byDot.get(id)?.stage !== "applied") ||
      v.resolved.some(id => !byDot.has(id) || !settled(byDot.get(id)!)))
      throw new SyncError("INVALID", "Nieprawidłowe trwałe potwierdzenie.");
    commits.add(v.planId);
  }
  if (new TextEncoder().encode(canonical({ journal:j, receiver:r })).byteLength > syncLimits.historyBytes)
    throw new SyncError("LIMIT", "Rejestry synchronizacji osiągnęły limit. Nie usunięto historii.");
}
function touch(r: ReceiverState) {
  r.revision++;
  if (!Number.isSafeInteger(r.revision)) throw new SyncError("LIMIT", "Wyczerpano licznik rejestru odbioru.");
}
const reason = (e: unknown) => (e instanceof Error ? e.message : "Odrzucono operację.").slice(0,2000);
function rejectAttempt(r: ReceiverState, value: unknown, code: string) {
  const id = crypto.randomUUID(), candidate = (value as { id?: unknown } | null)?.id;
  r.rejections.push({ id, operationId: typeof candidate === "string" && candidate.length <= 100 ? candidate : null, code });
  // Only invalid-attempt diagnostics are bounded here, never accepted operations.
  r.rejections = r.rejections.slice(-128);
  return id;
}
/** Receipt and causal verification only. Canonical business Data is untouched.
 * Raw gaps live in the inbox so one invalid delayed predecessor cannot poison
 * all other valid receipts when its missing parent finally arrives. */
export function receiveDurably(c: ReceiverContext, incoming: readonly unknown[]) {
  requireActive(c); validateReceiver(c.receiver,c.journal);
  if (!Array.isArray(incoming) || incoming.length > syncLimits.waiting)
    throw new SyncError("LIMIT","Za dużo operacji w jednej paczce odbioru.");
  const received: string[] = [], duplicates: string[] = [], rejected: string[] = [];
  const dots = new Map(c.receiver.receipts.map(r=>[dotId(r.operation),r]));
  const known = opMap(c.journal), ids = new Map<string,Operation>();
  for (const o of [...c.journal.log.operations,...c.receiver.receipts.map(r=>r.operation)]) ids.set(o.id,o);
  for (const input of incoming) {
    try {
      validateOperation(input);
      const o = input, key = dotId(o), previous = known.get(key) ?? dots.get(key)?.operation;
      if (previous) {
        if (!same(previous,o)) throw new SyncError("EQUIVOCATION","Ta sama tożsamość operacji ma różną treść.");
        duplicates.push(key); continue;
      }
      if (ids.has(o.id)) throw new SyncError("EQUIVOCATION","UUID operacji wskazuje inne pochodzenie.");
      if (o.origin === c.journal.log.installation ||
        (o.context[c.journal.log.installation] ?? 0) > (c.journal.log.known[c.journal.log.installation] ?? 0))
        throw new SyncError("ORIGIN","Odebrana wiadomość przewiduje operacje własnej instalacji.");
      const row: Receipt = { operation: structuredClone(o), stage:"received", reason:"", appliedRevision:null, resolvedBy:null };
      c.receiver.receipts.push(row); dots.set(key,row); ids.set(o.id,row.operation); received.push(key);
      try {
        for (const change of o.changes) {
          validateBasicValue(c.data,change.key,change.before); validateBasicValue(c.data,change.key,change.after);
        }
      } catch(e) {
        if (!(e instanceof SyncError)) throw e;
        row.stage="rejected"; row.reason=reason(e); rejected.push(key);
      }
    } catch(e) {
      if (!(e instanceof SyncError)) throw e;
      rejected.push(rejectAttempt(c.receiver,input,e.code));
    }
  }
  let progress = true;
  while (progress) {
    progress = false;
    for (const row of c.receiver.receipts) {
      if (row.stage !== "received" && row.stage !== "waiting-dependencies") continue;
      const o = row.operation, n = c.journal.log.known[o.origin] ?? 0;
      if (!dominates(c.journal.log.known,o.context) || n !== o.sequence-1) {
        row.stage="waiting-dependencies"; row.reason="Brak poprzedników przyczynowych."; continue;
      }
      try {
        c.journal.log=receive(c.journal.log,[o]); row.stage="verified"; row.reason="";
      } catch(e) {
        if (!(e instanceof SyncError)) throw e;
        row.stage="rejected"; row.reason=reason(e); rejected.push(dotId(o));
      }
      progress=true;
    }
  }
  if (received.length || rejected.length) touch(c.receiver);
  validateReceiver(c.receiver,c.journal);
  return { received, duplicates, rejected, known:structuredClone(c.journal.log.known) };
}
const signature = (log: ReplicaLog, key: string) => canonical(recordView(log,key).heads);
function registerConflicts(c: ReceiverContext) {
  const keys = new Set(c.receiver.receipts.flatMap(r=>r.operation.changes.map(x=>x.key)));
  const local = businessRecords(c.data);
  for (const key of keys) {
    const view=recordView(c.journal.log,key);
    if (view.status!=="conflict") continue;
    const token=signature(c.journal.log,key), open=c.receiver.conflicts.find(v=>v.key===key && v.status==="open");
    if (open?.token===token) continue;
    if (open) open.status="superseded";
    const heads=view.heads.map(h=>c.journal.log.operations.find(o=>dotId(o)===dotId(h))!);
    const context: Vector={};
    for (const [origin,n] of Object.entries(heads[0].context)) {
      const shared=Math.min(n,...heads.slice(1).map(o=>o.context[origin]??0));
      if (shared) context[origin]=shared;
    }
    const base=recordView(c.journal.log,key,context);
    c.receiver.conflicts.push({
      id:crypto.randomUUID(),key,kind:keyParts(key).kind,token,operations:heads.map(o=>o.id),
      baseAvailable:base.status==="value" || base.status==="deleted",base:base.status==="value" || base.status==="deleted" ? base.value : null,
      local:structuredClone(local.get(key)??null),
      remote:heads.map(o=>({operationId:o.id,value:structuredClone(o.changes.find(x=>x.key===key)!.after)})),
      fields:structuredClone(view.conflicts),reason:view.reason!,status:"open",resolvedBy:null,
    });
  }
}
function applied(c: ReceiverContext) {
  return new Set([...c.journal.appliedLocal,...c.receiver.receipts.filter(settled).map(r=>dotId(r.operation))]);
}
function materialized(c: ReceiverContext, ids: Set<string>): ReplicaLog {
  const actual = new Set([...c.journal.appliedLocal,...c.receiver.receipts.filter(r=>r.stage==="applied").map(r=>dotId(r.operation))]);
  return { ...c.journal.log, waiting:[], operations:c.journal.log.operations.filter(o=>
    ids.has(dotId(o)) && (actual.has(dotId(o)) || c.receiver.receipts.find(r=>dotId(r.operation)===dotId(o))?.stage!=="resolved")) };
}
function pendingAncestors(c: ReceiverContext, o: Operation, ids: Set<string>) {
  const keys=new Set(o.changes.map(x=>x.key));
  return c.journal.log.operations.filter(p=>covers(o.context,p) && !ids.has(dotId(p)) && p.changes.some(x=>keys.has(x.key)));
}
function checkParents(c:ReceiverContext,o:Operation,ids:Set<string>) {
  for (const change of o.changes) {
    const {kind}=keyParts(change.key);
    if(kind!=="gardens" || change.after===null) continue;
    const garden=change.after as {[key:string]:Json}, parent="clients/"+encodeURIComponent(garden.clientId as string);
    const inOperation=o.changes.find(x=>x.key===parent && x.after!==null);
    const source=recordView(c.journal.log,parent,o.context), present=recordView(c.journal.log,parent);
    if(!inOperation && (source.status!=="value" || present.status!=="value" ||
      c.journal.log.operations.some(p=>covers(o.context,p) && !ids.has(dotId(p)) && p.changes.some(x=>x.key===parent))))
      throw new ApplyBlocked("dependency","Rodzic ogrodu jest brakujący, usunięty, niezastosowany lub w konflikcie.");
  }
}
function resolutionAncestors(c: ReceiverContext, o: Operation, ids: Set<string>) {
  const ancestors=pendingAncestors(c,o,ids), keys=new Set(o.changes.map(x=>x.key));
  for (const p of ancestors) {
    if (p.changes.some(x=>!keys.has(x.key)))
      throw new ApplyBlocked("dependency","Rozstrzygnięcie wymaga całej wcześniejszej operacji atomowej.");
    eligibility(c.data,p.changes);
  }
  return ancestors;
}
function closeConflicts(c: ReceiverContext, o: Operation) {
  const keys=new Set(o.changes.map(x=>x.key));
  for (const v of c.receiver.conflicts) {
    if (!keys.has(v.key) || v.status==="resolved") continue;
    const heads=v.operations.map(id=>c.journal.log.operations.find(p=>p.id===id));
    if (heads.every(p=>p && covers(o.context,p))) { v.status="resolved"; v.resolvedBy=o.id; }
  }
}
/** Pure simulation on detached objects. Each operation is validated as a whole;
 * the returned Data is written only by the explicit commit transaction. */
function simulate(c: ReceiverContext) {
  registerConflicts(c);
  let data=c.data;
  const ids=applied(c), log=materialized(c,ids), actions:string[]=[];
  const resolved=new Map<string,string>();
  let progress=true;
  while(progress) {
    progress=false;
    for (const o of c.journal.log.operations) {
      const id=dotId(o), row=c.receiver.receipts.find(r=>dotId(r.operation)===id);
      if (!row || settled(row) || row.stage==="rejected" || ids.has(id)) continue;
      try {
        eligibility(data,o.changes);
        if (o.changes.some(x=>recordView(c.journal.log,x.key).status==="conflict")) {
          row.stage="conflict"; row.reason="Rekord wymaga jawnego rozstrzygnięcia."; continue;
        }
        if (!o.resolution && c.journal.log.operations.some(p=>p.resolution && !ids.has(dotId(p)) && covers(p.context,o) &&
          p.changes.some(x=>o.changes.some(y=>y.key===x.key)))) {
          row.stage="conflict"; row.reason="Oczekuje na zastosowanie odebranego rozstrzygnięcia."; continue;
        }
        checkParents(c,o,ids);
        const ancestors=pendingAncestors(c,o,ids);
        if (!o.resolution && ancestors.length) {
          row.stage="waiting-records"; row.reason="Poprzednia wersja tego rekordu nie została zastosowana."; continue;
        }
        if (o.resolution) resolutionAncestors(c,o,ids);
        const before=businessRecords(data);
        for (const change of o.changes) {
          const current=recordView(log,change.key);
          if (current.status==="conflict" || !same(current.value,before.get(change.key)??null))
            fail("Baza i potwierdzona historia rekordu są niespójne. Nie zastosowano planu.");
        }
        const proposed={...log,operations:[...log.operations,o]};
        const values=new Map<string,Json>();
        for (const change of o.changes) {
          const view=recordView(proposed,change.key);
          if (view.status==="conflict") throw new ApplyBlocked("dependency","Brak rozstrzygnięcia poprzedniej wersji.");
          values.set(change.key,view.value);
        }
        data=applyBasic(data,values); log.operations.push(o); ids.add(id); actions.push(id);
        row.stage="planned"; row.reason="";
        if (o.resolution) for (const p of ancestors) {
          const key=dotId(p); ids.add(key); resolved.set(key,o.id);
        }
        progress=true;
      } catch(e) {
        if (e instanceof ApplyBlocked) { row.stage=e.code==="dependency"?"waiting-records":"blocked"; row.reason=reason(e); }
        else throw e;
      }
    }
  }
  return {data,actions,resolved};
}
export function planReceived(c: ReceiverContext): PlanSummary {
  requireActive(c); validateReceiver(c.receiver,c.journal);
  const proposed=simulate(c);
  touch(c.receiver);
  const plan:SyncPlan|null=proposed.actions.length ? {id:crypto.randomUUID(),stateRevision:c.revision,
    receiverRevision:c.receiver.revision,knowledge:canonical(c.journal.log.known),operations:proposed.actions} : null;
  c.receiver.plan=plan;
  validateReceiver(c.receiver,c.journal);
  return {plan,planned:proposed.actions.length,conflicts:c.receiver.conflicts.filter(v=>v.status==="open").length,
    blocked:c.receiver.receipts.filter(r=>r.stage==="blocked").length,
    dependencies:c.receiver.receipts.filter(r=>r.stage==="waiting-records" || r.stage==="waiting-dependencies").length,
    rejected:c.receiver.receipts.filter(r=>r.stage==="rejected").length};
}
export function commitReceived(c: ReceiverContext, planId:string): CommitReceipt {
  requireActive(c); validateReceiver(c.receiver,c.journal);
  const old=c.receiver.commits.find(v=>v.planId===planId);
  if(old) return structuredClone(old); // Lost confirmation: return the original durable result.
  const p=c.receiver.plan;
  if(!p || p.id!==planId || p.stateRevision!==c.revision || p.receiverRevision!==c.receiver.revision ||
    p.knowledge!==canonical(c.journal.log.known)) fail("Plan jest nieaktualny. Sprawdź zmiany ponownie.");
  const proposed=simulate(c);
  if(!same(proposed.actions,p.operations)) fail("Wynik planu zmienił się. Nie zapisano danych.");
  c.data=proposed.data; c.revision++; c.journal.lastRevision=c.revision;
  for (const id of proposed.actions) {
    const row=c.receiver.receipts.find(r=>dotId(r.operation)===id)!;
    row.stage="applied"; row.reason=""; row.appliedRevision=c.revision;
    if(row.operation.resolution) closeConflicts(c,row.operation);
  }
  for (const [id,resolutionId] of proposed.resolved) {
    const row=c.receiver.receipts.find(r=>dotId(r.operation)===id)!;
    if(row.stage!=="applied") { row.stage="resolved"; row.reason="Zastąpiono jawnym rozstrzygnięciem."; row.resolvedBy=resolutionId; }
  }
  const result:CommitReceipt={planId,stateRevision:c.revision,operations:proposed.actions,resolved:[...proposed.resolved.keys()]};
  c.receiver.commits.push(result); c.receiver.plan=null; touch(c.receiver);
  validateReceiver(c.receiver,c.journal); return structuredClone(result);
}
export function decideConflict(c: ReceiverContext, decision:ConflictDecision) {
  requireActive(c); validateReceiver(c.receiver,c.journal); canonical(decision);
  if(!decision || Object.keys(decision).sort().join("|")!=="choice|conflictId|token" ||
    !decision.choice || !["local","remote","custom"].includes(decision.choice.kind))
    throw new SyncError("INVALID","Nieprawidłowa decyzja konfliktu.");
  const conflict=c.receiver.conflicts.find(v=>v.id===decision.conflictId && v.status==="open");
  if(!conflict || conflict.token!==decision.token || signature(c.journal.log,conflict.key)!==conflict.token)
    fail("Konflikt zmienił się. Odczytaj aktualne warianty.");
  const view=recordView(c.journal.log,conflict.key);
  if(view.status!=="conflict") fail("Odebrano już nowsze rozstrzygnięcie. Sprawdź plan.");
  const current=businessRecords(c.data), local=current.get(conflict.key)??null;
  let value:Json;
  const choice=decision.choice;
  if(choice.kind==="custom") {
    if(Object.keys(choice).sort().join("|")!=="kind|value") throw new SyncError("INVALID","Nieprawidłowa decyzja.");
    value=structuredClone(choice.value);
  } else {
    if(Object.keys(choice).sort().join("|")!==(choice.kind==="local"?"kind":"kind|operationId"))
      throw new SyncError("INVALID","Nieprawidłowa decyzja.");
    if(choice.kind==="local") {
      if(!same(local,conflict.local)) fail("Lokalna wersja zmieniła się od wyświetlenia konfliktu.");
      value=structuredClone(local);
    } else {
      const remote=conflict.remote.find(v=>v.operationId===choice.operationId);
      if(!remote) fail("Wybrany wariant nie należy do aktualnego konfliktu.");
      const source=c.journal.log.operations.find(o=>o.id===remote.operationId)?.changes.find(x=>x.key===conflict.key);
      if(!source || !same(source.after,remote.value)) throw new SyncError("INVALID","Wariant nie odpowiada oryginalnej operacji.");
      value=structuredClone(source.after);
    }
    if(view.reason==="fields" && value && typeof value==="object" && !Array.isArray(value)) {
      const merged={...(view.value as {[key:string]:Json})};
      for(const field of view.conflicts) {
        if(Object.hasOwn(value,field.field)) merged[field.field]=(value as {[key:string]:Json})[field.field];
        else delete merged[field.field];
      }
      value=merged;
    }
  }
  const {kind,id}=keyParts(conflict.key);
  if((kind==="notes" || kind==="todos") && value!==null) {
    const alternatives=[local,...conflict.remote.map(v=>v.value)].filter(v=>v!==null) as {[key:string]:Json}[];
    value={...(value as object),revision:Math.max(...alternatives.map(v=>v.revision as number))+1,updatedAt:Date.now()} as Json;
  }
  const changes=[{key:conflict.key,before:local,after:value}];
  if(kind==="notes" || kind==="todos") {
    const recordKind=kind==="notes"?"note":"todo", tombKey="deskTombstones/"+encodeURIComponent(recordKind+"/"+id);
    const old=recordView(c.journal.log,tombKey);
    if(old.status==="conflict") fail("Powiązany tombstone ma osobny konflikt. Wymaga uzgodnienia całej grupy.");
    const revisions=[local,...conflict.remote.map(v=>v.value)].filter(v=>v!==null) as {[key:string]:Json}[];
    const tomb=value===null ? old.value ?? {kind:recordKind,id,deletedAt:Date.now(),
      revision:Math.max(...revisions.map(v=>v.revision as number))+1} : null;
    changes.push({key:tombKey,before:old.value,after:tomb});
  }
  eligibility(c.data,changes);
  const appended=appendLocal(c.journal.log,changes,{resolution:true}), o=appended.operation!;
  checkParents(c,o,applied(c));
  const ancestors=resolutionAncestors(c,o,applied(c));
  const next=applyBasic(c.data,new Map(changes.map(x=>[x.key,x.after])));
  c.journal.log=appended.log; c.journal.appliedLocal.push(dotId(o));
  c.data=next; c.revision++; c.journal.lastRevision=c.revision;
  for(const p of ancestors) {
    const row=c.receiver.receipts.find(r=>dotId(r.operation)===dotId(p));
    if(row && row.stage!=="applied") { row.stage="resolved"; row.resolvedBy=o.id; row.reason="Zastąpiono jawnym rozstrzygnięciem."; }
  }
  closeConflicts(c,o); c.receiver.plan=null; touch(c.receiver);
  validateReceiver(c.receiver,c.journal);
  return {operationId:o.id,dot:dotId(o),stateRevision:c.revision};
}
