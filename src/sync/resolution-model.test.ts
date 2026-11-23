import { describe, expect, it } from "vitest";
import { appendLocal, canonical, newLog, receive, same } from "./causal";
import type { Json } from "./model";
import {
  decisionKey, financialSources, validateDecisionRequest, validateFinancialEvidence,
  verifyFinancialEvidence, type FinancialEvidence, type FinancialIntent,
} from "./resolution-model";

const a="11111111-1111-4111-8111-111111111111", b="22222222-2222-4222-8222-222222222222";
const id="33333333-3333-4333-8333-333333333333", key="visits/synthetic";
function fixture() {
  const root=appendLocal(newLog(a),[{key,before:null,after:{amount:100}}]).log;
  const l=appendLocal(root,[{key,before:{amount:100},after:{amount:250}}]);
  const r=appendLocal(receive(newLog(b),root.operations),[{key,before:{amount:100},after:{amount:300}}]);
  const log=receive(l.log,[r.operation!]), proof=financialSources(log,key);
  const intent:FinancialIntent={kind:"visit",basisOperationId:l.operation!.id,
    labor:{kind:"amount",cents:27500},time:{kind:"source"},payments:[]};
  const evidence:FinancialEvidence={version:1,id,key,...proof,intent,rationale:"Synthetic explicit choice",at:1000,result:{amount:275}};
  const operation=appendLocal(log,[
    {key,before:{amount:250},after:evidence.result},
    {key:decisionKey(id),before:null,after:evidence as unknown as Json},
  ],{id,resolution:true}).operation!;
  return {log,evidence,operation};
}
describe("5c2c-A immutable financial decision evidence (no business application)",()=>{
  it("proves the exact causal heads, source UUIDs, original values and shared base",()=>{
    const {log,evidence,operation}=fixture();
    expect(evidence.sources.map(s=>s.after)).toEqual([{amount:250},{amount:300}]);
    expect(evidence.base).toEqual({amount:100});
    expect(evidence.baseAvailable).toBe(true);
    expect(verifyFinancialEvidence(log,operation)).toEqual(evidence);
    const before=canonical(log);verifyFinancialEvidence(log,operation);
    expect(canonical(log)).toBe(before);
  });
  it("validates a local request without allowing a raw arbitrary result",()=>{
    const {evidence}=fixture();
    const request={id,conflictId:"local-conflict",token:evidence.token,rationale:"Explicit choice",intent:evidence.intent};
    expect(()=>validateDecisionRequest(request)).not.toThrow();
    expect(()=>validateDecisionRequest({...request,result:{amount:1}})).toThrow();
    expect(()=>validateDecisionRequest({...request,rationale:" "})).toThrow();
    expect(()=>validateDecisionRequest({...request,intent:{...evidence.intent,runCommand:"stop"}})).toThrow();
  });
  it.each(["id","key","token","base","sources","result","intent"] as const)("rejects tampered %s evidence",field=>{
    const {log,operation}=fixture(), copy=structuredClone(operation), evidence=copy.changes[1].after as unknown as FinancialEvidence;
    if(field==="id")evidence.id=crypto.randomUUID();
    if(field==="key")evidence.key="visits/other";
    if(field==="token")evidence.token="forged";
    if(field==="base")evidence.base={amount:999};
    if(field==="sources")evidence.sources[0].after={amount:999};
    if(field==="result")evidence.result={amount:999};
    if(field==="intent")evidence.intent={kind:"expense",basisOperationId:evidence.sources[0].operationId,
      amountCents:1,categoryId:"synthetic",status:"approved"};
    expect(()=>verifyFinancialEvidence(log,copy)).toThrow();
  });
  it("rejects a stale causal conflict token",()=>{
    const {log,operation}=fixture();
    const proof=financialSources(log,key);
    const amended=appendLocal(log,[{key,before:{amount:250},after:{amount:400}}],{resolution:true});
    expect(()=>financialSources(amended.log,key)).toThrow(/zmieniony|rozstrzygnięty/);
    expect(verifyFinancialEvidence(log,operation).token).toBe(proof.token);
  });
  it("rejects extra mutations and a decision whose id differs from the operation",()=>{
    const {log,operation}=fixture();
    expect(()=>verifyFinancialEvidence(log,{...operation,id:crypto.randomUUID()})).toThrow();
    expect(()=>verifyFinancialEvidence(log,{...operation,changes:[...operation.changes,{key:"clients/x",before:null,after:{}}]})).toThrow();
    expect(()=>verifyFinancialEvidence(log,{...operation,resolution:false})).toThrow();
  });
  it("requires distinct source identities and a complete payments disposition",()=>{
    const {evidence}=fixture(), copy=structuredClone(evidence);
    copy.sources.push(copy.sources[0]);
    expect(()=>validateFinancialEvidence(copy)).toThrow();
    const intent={...evidence.intent,kind:"visit",payments:[
      {id:"payment",action:"keep",sourceOperationId:evidence.sources[0].operationId},
      {id:"payment",action:"cancel",sourceOperationId:evidence.sources[1].operationId},
    ]};
    expect(()=>validateFinancialEvidence({...evidence,intent})).toThrow();
  });
  it("keeps the proof unchanged through canonical JSON roundtrip and excludes receipt flags",()=>{
    const {log,evidence,operation}=fixture();
    const copy=JSON.parse(canonical(operation));
    expect(same(verifyFinancialEvidence(log,copy),evidence)).toBe(true);
    (copy.changes[1].after as any).applied=true;
    expect(()=>verifyFinancialEvidence(log,copy)).toThrow();
  });
});
