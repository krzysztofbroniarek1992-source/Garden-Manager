/** Per-record branch ancestry is distinct from receipt causality.
 * A real owned timer transition observes the full log, but extends only parentId.
 * No stored Operation/context/UUID is rewritten. No incoming Timer is executed. */
import { SyncError, type Json, type Mutation, type Operation, type ReplicaLog } from "./model";

export interface TimerProof { jobId:string; startedAt:number; paused:boolean; remainderMs?:number }
export interface TimeBranch {
  version:1; id:string; key:string; parentId:string;
  action:"pause"|"resume"|"stop";
  before:Json; after:Json;
  timerBefore:TimerProof; timerAfter:TimerProof|null;
}
export const TIME_BRANCH_KIND="localTimeBranches";
export const timeBranchKey=(id:string)=>TIME_BRANCH_KIND+"/"+encodeURIComponent(id);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
type Obj=Record<string,any>;
function invalid():never {throw new SyncError("INVALID","TIME_BRANCH: Nieprawidłowy dowód własnej gałęzi pomiaru.");}
function shape(v:unknown,required:string[],optional:string[]=[]):asserts v is Obj {
  if(!v||typeof v!=="object"||Array.isArray(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v))||
    required.some(k=>!Object.hasOwn(v,k))||Object.keys(v).some(k=>![...required,...optional].includes(k)))invalid();
}
const integer=(v:unknown):v is number=>Number.isSafeInteger(v)&&(v as number)>=0;
const seconds=(v:unknown):v is number=>typeof v==="number"&&Number.isFinite(v)&&v>=0;
function timer(v:unknown):asserts v is TimerProof {
  shape(v,["jobId","startedAt","paused"],["remainderMs"]);
  if(typeof v.jobId!=="string"||!v.jobId||!integer(v.startedAt)||typeof v.paused!=="boolean"||
    v.remainderMs!==undefined&&(!integer(v.remainderMs)||v.remainderMs>=1000))invalid();
}
/** Strict intrinsic proof. equal is the existing canonical JSON comparator. */
export function validateTimeBranch(value:unknown,equal:(a:unknown,b:unknown)=>boolean):asserts value is TimeBranch {
  shape(value,["version","id","key","parentId","action","before","after","timerBefore","timerAfter"]);
  if(value.version!==1||typeof value.id!=="string"||!uuid.test(value.id)||
    typeof value.parentId!=="string"||!uuid.test(value.parentId)||typeof value.key!=="string"||
    !value.key.startsWith("visits/")||!["pause","resume","stop"].includes(value.action))invalid();
  let id:string;try{id=decodeURIComponent(value.key.slice(7));}catch{invalid();}
  if(!id!||"visits/"+encodeURIComponent(id!)!==value.key)invalid();
  shape(value.before,["job","payments","reportIdentities"]);
  shape(value.after,["job","payments","reportIdentities"]);
  const a=value.before.job,b=value.after.job;
  if(!a||!b||a.id!==id!||b.id!==id!||!seconds(a.seconds)||!seconds(b.seconds))invalid();
  timer(value.timerBefore);const t=value.timerBefore;
  if(t.jobId!==id!)invalid();
  const before=a.timeHistory??[],after=b.timeHistory;
  if(!Array.isArray(before)||!Array.isArray(after)||after.length!==before.length+1||
    !equal(after.slice(0,before.length),before))invalid();
  const event=after.at(-1);
  shape(event,["id","kind","at","beforeSeconds","afterSeconds","pauseDurationMs"]);
  if(event.id!==value.id||!integer(event.at))invalid();
  const last=before.at(-1);
  if(last&&(!["started","paused","resumed"].includes(last.kind)||last.at!==t.startedAt||
    (last.kind==="paused")!==t.paused))invalid();
  const elapsed=t.paused?a.seconds:a.seconds+Math.max(0,Math.floor((event.at-t.startedAt+(t.remainderMs??0))/1000));
  const expectedPause=t.paused&&value.action!=="pause"?Math.max(0,event.at-t.startedAt):null;
  if(event.beforeSeconds!==elapsed||event.afterSeconds!==elapsed||event.pauseDurationMs!==expectedPause)invalid();
  if(value.action==="stop") {
    if(event.kind!=="stopped"||b.seconds!==elapsed||value.timerAfter!==null)invalid();
  } else {
    timer(value.timerAfter);
    if(value.action==="pause") {
      const ms=Math.max(0,event.at-t.startedAt+(t.remainderMs??0));
      if(t.paused||event.kind!=="paused"||b.seconds!==elapsed||
        !equal(value.timerAfter,{...t,startedAt:event.at,paused:true,remainderMs:ms%1000}))invalid();
    } else if(!t.paused||event.kind!=="resumed"||b.seconds!==a.seconds||
      !equal(value.timerAfter,{...t,startedAt:event.at,paused:false}))invalid();
  }
  const frame=(v:Obj)=>{
    const {seconds,timeHistory,...job}=v.job;void seconds;void timeHistory;
    return {...v,job};
  };
  if(!equal(frame(value.before),frame(value.after)))invalid();
}
export function timeBranch(o:Operation,equal:(a:unknown,b:unknown)=>boolean):TimeBranch|null {
  const c=o.changes.find(c=>c.key.startsWith(TIME_BRANCH_KIND+"/"));
  if(!c)return null;
  if(o.resolution||o.changes.length!==1||c.before!==null)invalid();
  validateTimeBranch(c.after,equal);
  if(o.id!==c.after.id||c.key!==timeBranchKey(c.after.id))invalid();
  return c.after;
}
export function projectedMutations(o:Operation,equal:(a:unknown,b:unknown)=>boolean):Mutation[] {
  const b=timeBranch(o,equal);
  return b?[...o.changes,{key:b.key,before:b.before,after:b.after}]:o.changes;
}
export function validateTimeBranchLinks(log:ReplicaLog,o:Operation,equal:(a:unknown,b:unknown)=>boolean) {
  const b=timeBranch(o,equal);if(!b)return;
  const parent=log.operations.find(p=>p.id===b.parentId);
  if(!parent||parent.origin!==o.origin||parent.sequence>=o.sequence||
    (o.context[parent.origin]??0)<parent.sequence)invalid();
  const source=projectedMutations(parent,equal).find(c=>c.key===b.key);
  if(!source||!equal(source.after,b.before))invalid();
  for(const p of log.operations)if(p.origin===o.origin&&p.sequence>parent.sequence&&
    (o.context[p.origin]??0)>=p.sequence&&projectedMutations(p,equal).some(c=>c.key===b.key))invalid();
  const job=(b.before as Obj).job;
  if(!(job.timeHistory??[]).length&&source.before!==null)invalid(); // Only an original legacy baseline may lack START.
}
