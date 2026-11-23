import { isDecisionKey, validateFinancialEvidence } from "./resolution-model";
import { validateReportDocumentValue } from "./report-documents";
import type { Data } from "../domain";
import { ApplyBlocked, applyBasic, basicKinds, eligibility, keyParts, validateBasicValue } from "./basic";
import { applyFinance, financeEligibility, financeParents, isFinance, validateFinanceValue } from "./finance";
import { type Json, type Operation } from "./model";
export { financeParents };
export function validateIncomingValue(data:Data,key:string,value:Json) {
  if(isDecisionKey(key)) { if(value!==null)validateFinancialEvidence(value); }
  validateReportDocumentValue(key,value);
  validateBasicValue(data,key,value);
  validateFinanceValue(data,key,value);
}
export function eligibilityUnits(data:Data,o:Operation) {
  for(const change of o.changes)
    if(!(basicKinds as readonly string[]).includes(keyParts(change.key).kind) && !isFinance(change.key))
      throw new ApplyBlocked("unsupported","Nieobsługiwana jednostka; cała operacja pozostaje zablokowana.");
  eligibility(data,o.changes.filter(c=>!isFinance(c.key)));
  financeEligibility(data,o);
}
export function applyUnits(data:Data,values:Map<string,Json>,o:Operation) {
  const basic=new Map([...values].filter(([key])=>!isFinance(key)));
  const finance=new Map([...values].filter(([key])=>isFinance(key)));
  const next=basic.size ? applyBasic(data,basic) : data;
  return finance.size ? applyFinance(next,finance,o) : next;
}
