import { describe,expect,it } from "vitest";
import { createDemoData } from "../data/demo";
import { GardenStore } from "../data/store";
import { appendLocal,canonical,covers,newLog,receive,recordMutations,recordView,same } from "./causal";
import { timeBranch,timeBranchKey,type TimeBranch } from "./time-branch-model";
import { businessRecords } from "./records";
import type { Json } from "./model";
const origins=["11111111-1111-4111-8111-111111111111","22222222-2222-4222-8222-222222222222","33333333-3333-4333-8333-333333333333"];
function fixture(paused=false) {
  let data=createDemoData(new Date("2026-11-23T12:00:00Z"));data.timer=null;
  data.jobs=[{...data.jobs[0],id:"visit",status:"planned",seconds:3600,settlement:null}];data.payments=[];
  let now=1000;
  const store=new GardenStore({load:()=>data,save:d=>{data=d;}},()=>now),key="visits/visit";
  const value=()=>businessRecords(data).get(key)!;
  const root=appendLocal(newLog(origins[0]),[{key,before:null,after:value()}]);
  const before=value();store.startTimer("visit");
  let local=appendLocal(root.log,[{key,before,after:value()}]),parent=local.operation!;
  if(paused) {
    const before=value();now=4100;store.pauseTimer();
    local=appendLocal(local.log,[{key,before,after:value()}]);parent=local.operation!;
  }
  const remoteValue=JSON.parse(JSON.stringify(before));
  remoteValue.job.seconds=9000;
  remoteValue.job.timeHistory=[{id:crypto.randomUUID(),kind:"corrected",at:1,beforeSeconds:3600,afterSeconds:9000,pauseDurationMs:null}];
  const remote=appendLocal(receive(newLog(origins[1]),root.log.operations),[{key,before,after:remoteValue}]).operation!;
  const log=receive(local.log,[remote]),old=value(),timer=structuredClone(data.timer!);
  now=7200;store.stopTimer();
  const event=data.jobs[0].timeHistory!.at(-1)!;
  const branch:TimeBranch={version:1,id:event.id,key,parentId:parent.id,action:"stop",
    before:old,after:value(),timerBefore:timer,timerAfter:null};
  const result=appendLocal(log,[{key:timeBranchKey(branch.id),before:null,after:branch as unknown as Json}],{id:branch.id});
  return {log,result,branch,parent,remote,root};
}
describe("owned time branches: receipt context does not silently resolve record alternatives",()=>{
  it.each([false,true])("keeps the foreign closed history after actual running/paused STOP (%s)",paused=>{
    const {log,result,branch,remote,parent}=fixture(paused),op=result.operation!,view=recordView(result.log,branch.key);
    expect(covers(op.context,remote)).toBe(true);
    expect(op.resolution).toBe(false);
    expect(op.id).toBe((branch.after as any).job.timeHistory.at(-1).id);
    expect(view.status).toBe("conflict");
    expect(view.heads.map(h=>h.origin+":"+h.sequence).sort()).toEqual([op,remote].map(o=>o.origin+":"+o.sequence).sort());
    expect(view.conflicts[0].alternatives.map(v=>(v.value as any).job.seconds).sort()).toEqual(paused?[3603,9000]:[3606,9000]);
    expect(result.log.operations.find(o=>o.id===remote.id)).toEqual(remote);
    expect(result.log.operations.find(o=>o.id===parent.id)).toEqual(parent);
    expect(log.operations).toHaveLength(result.log.operations.length-1);
  });
  it("forwards the original branch through B to C, waits for predecessors and safely deduplicates",()=>{
    const {result,branch}=fixture(),op=result.operation!;
    let b=receive(newLog(origins[1]),result.log.operations.filter(o=>o.origin!==origins[1]));
    const before=canonical(b);b=receive(b,[op]);expect(canonical(b)).toBe(before);
    let c=receive(newLog(origins[2]),[op]);expect(c.waiting).toHaveLength(1);
    c=receive(c,[...result.log.operations].reverse());
    expect(c.waiting).toEqual([]);
    expect(c.operations.find(o=>o.id===op.id)).toEqual(op);
    expect(recordView(c,branch.key)).toEqual(recordView(result.log,branch.key));
  });
  it("requires a separate explicit decision; ordinary record commands still see the conflict",()=>{
    const {result,branch,remote}=fixture();
    expect(()=>appendLocal(result.log,[{key:branch.key,before:branch.after,after:remote.changes[0].after}])).toThrow(/konflikt/);
    const chosen=appendLocal(result.log,[{key:branch.key,before:branch.after,after:remote.changes[0].after}],{resolution:true});
    expect(recordView(chosen.log,branch.key).value).toEqual(remote.changes[0].after);
    expect(recordView(chosen.log,branch.key).heads).toHaveLength(1);
    expect(timeBranch(result.operation!,same)).toEqual(branch);
  });
  it.each(["foreign-parent","seconds","payment","new-start","parent-reuse"] as const)("rejects forged branch evidence (%s)",variant=>{
    const {log,result,branch,remote}=fixture(),copy=structuredClone(branch);
    if(variant==="foreign-parent")copy.parentId=remote.id;
    if(variant==="seconds")(copy.after as any).job.seconds++;
    if(variant==="payment")(copy.after as any).payments.push({id:"fake"});
    if(variant==="new-start")(copy.after as any).job.timeHistory.at(-1).kind="started";
    if(variant==="parent-reuse") {
      copy.id=crypto.randomUUID();(copy.after as any).job.timeHistory.at(-1).id=copy.id;
    }
    expect(()=>appendLocal(variant==="parent-reuse"?result.log:log,
      [{key:timeBranchKey(copy.id),before:null,after:copy as unknown as Json}],{id:copy.id})).toThrow();
  });
  it("exposes effective writes without changing the stored wire mutation",()=>{
    const {result,branch}=fixture(),op=result.operation!,wire=canonical(op);
    expect(recordMutations(op).map(c=>c.key)).toEqual([timeBranchKey(branch.id),branch.key]);
    expect(canonical(op)).toBe(wire);expect(op.changes).toHaveLength(1);
  });
});
