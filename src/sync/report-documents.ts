import type { Data } from "../domain";
import type { VisitReport, ReportSnapshot } from "../reports/model";
import { validateReportSnapshot } from "../reports/validation";
import { canonical, covers, same } from "./causal";
import { SyncError, type Json, type Operation, type ReplicaLog } from "./model";
import { validateReportHeader, validateReportHeaders, type ReportIdentityHeader } from "./report-registry";

export interface ReportSeal {
  format:1; jobId:string; identity:ReportIdentityHeader;
  sourceIdentity:string; sourceReport:string|null;
  snapshotSha256:string; documentSha256:string; fingerprintScheme:"visit-json-v1";
  assets:{photos:number;logo:boolean;rememberedReferences:boolean;hashes:string[]};
}
/** Created ONLY by local WebCrypto verification, never deserialized from wire. */
export interface ReportCheck {
  operationId:string; key:string; documentSha256:string; snapshotSha256:string; fingerprintMatches:boolean;
}
export interface ReportAvailability {
  reportId:string; jobId:string; identity:ReportIdentityHeader;
  proofOperation:string|null; sourceOperations:string[];
  status:"pending"|"portable"|"source-only"|"conflict"; reason:string;
  documentSha256:string|null; snapshotSha256:string|null; assets:ReportSeal["assets"]|null;
}
type Obj = {[key:string]:Json};
const object=(v:unknown):v is Obj=>!!v&&typeof v==="object"&&!Array.isArray(v);
function exact(v:unknown,keys:string[]):asserts v is Obj {
  if(!object(v)||Object.keys(v).sort().join("|")!==[...keys].sort().join("|"))invalid("Nieprawidłowa struktura dokumentu.");
}
function invalid(text:string):never {throw new SyncError("INVALID","REPORT_DOCUMENT: "+text);}
const hash=(v:unknown):v is string=>typeof v==="string"&&/^[a-f0-9]{64}$/.test(v);
const uuid=(v:unknown):v is string=>typeof v==="string"&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
export const reportKey=(jobId:string,id:string)=>"reports/"+encodeURIComponent(jobId+"/"+id);
export const sealKey=(id:string)=>"reportDocuments/"+encodeURIComponent(id);
export function reportIdentity(r:VisitReport):ReportIdentityHeader {
  return {id:r.id,number:r.number,version:r.version,generatedAt:r.generatedAt,fingerprint:r.fingerprint,
    requiresAssets:!!(r.snapshot.photos.length||r.snapshot.logo||r.options.photoIds.length||r.options.logoPhotoId)};
}
export function validatePortableReport(key:string,value:Json):asserts value is Json & {jobId:string;report:VisitReport} {
  exact(value,["jobId","report"]);exact(value.report,["id","number","version","generatedAt","rendererVersion","fingerprint","options","snapshot"]);
  const v=value as unknown as {jobId:string;report:VisitReport},r=v.report;
  if(typeof v.jobId!=="string"||!v.jobId.trim()||v.jobId.length>2000||reportKey(v.jobId,r.id)!==key||r.rendererVersion!==1)
    invalid("Dokument nie odpowiada kluczowi i wizycie.");
  try{validateReportSnapshot(r.snapshot,r.options);validateReportHeader(reportIdentity(r));}
  catch(e){invalid((e as Error).message);}
  if(reportIdentity(r).requiresAssets)invalid("Pełny dokument zależny od plików pozostaje lokalny.");
}
export function validateSeal(key:string,value:Json):asserts value is Json & ReportSeal {
  exact(value,["format","jobId","identity","sourceIdentity","sourceReport","snapshotSha256","documentSha256","fingerprintScheme","assets"]);
  const v=value as unknown as ReportSeal;validateReportHeader(v.identity);
  exact(v.assets,["photos","logo","rememberedReferences","hashes"]);
  if(v.format!==1||typeof v.jobId!=="string"||!v.jobId.trim()||v.jobId.length>2000||key!==sealKey(v.identity.id)||
    !uuid(v.sourceIdentity)||!(v.sourceReport===null||uuid(v.sourceReport))||
    !hash(v.snapshotSha256)||!hash(v.documentSha256)||v.fingerprintScheme!=="visit-json-v1"||
    !Number.isInteger(v.assets.photos)||v.assets.photos<0||v.assets.photos>6||
    typeof v.assets.logo!=="boolean"||typeof v.assets.rememberedReferences!=="boolean"||
    !Array.isArray(v.assets.hashes)||v.assets.hashes.length!==v.assets.photos+Number(v.assets.logo)||!v.assets.hashes.every(hash)||
    v.identity.requiresAssets!==!!(v.assets.photos||v.assets.logo||v.assets.rememberedReferences)||
    (v.identity.requiresAssets?v.sourceReport!==null:v.sourceReport===null))
    invalid("Nieprawidłowy dowód wystawienia lub wymaganych zasobów.");
}
export function validateReportDocumentValue(key:string,value:Json) {
  if(value===null)return;
  if(key.startsWith("reports/"))validatePortableReport(key,value);
  if(key.startsWith("reportDocuments/"))validateSeal(key,value);
}
/** Existing fingerprint is SHA256(JSON.stringify(builder snapshot)), not the
 * canonical document hash and not reportSourceSignature (plain JSON CAS).
 * Restore the documented builder field order after canonical wire decoding. */
function fingerprintSnapshot(s:ReportSnapshot):ReportSnapshot {
  const image=(p:NonNullable<ReportSnapshot["logo"]>)=>({photoId:p.photoId,sha256:p.sha256,width:p.width,height:p.height,size:p.size,category:p.category,date:p.date});
  return {company:s.company,clientName:s.clientName,gardenName:s.gardenName,address:s.address,zoneName:s.zoneName,
    visitDate:s.visitDate,workDescription:s.workDescription,
    time:s.time?{workSeconds:s.time.workSeconds,recordedPauseMs:s.time.recordedPauseMs,historySince:s.time.historySince,
      corrections:s.time.corrections.map(c=>({at:c.at,beforeSeconds:c.beforeSeconds,afterSeconds:c.afterSeconds}))}:null,
    materials:s.materials?.map(m=>({name:m.name,quantity:m.quantity,unit:m.unit}))??null,
    checklists:s.checklists?.map(c=>({name:c.name,items:c.items.map(i=>({title:i.title,status:i.status,completedAt:i.completedAt}))}))??null,
    remarks:s.remarks,finance:s.finance?{laborCents:s.finance.laborCents,materialsCents:s.finance.materialsCents,totalCents:s.finance.totalCents,
      paidCents:s.finance.paidCents,remainingCents:s.finance.remainingCents,billing:s.finance.billing}:null,
    photos:s.photos.map(image),logo:s.logo?image(s.logo):null};
}
/** v12 JSON callers historically use builder property order for CAS and reuse.
 * Rehydration changes no canonical content, options or fingerprint. */
export function orderedVisitReport(r:VisitReport):VisitReport {
  const o=r.options;
  return {id:r.id,number:r.number,version:r.version,generatedAt:r.generatedAt,rendererVersion:r.rendererVersion,fingerprint:r.fingerprint,
    options:{showTime:o.showTime,showFinance:o.showFinance,showMaterials:o.showMaterials,showChecklists:o.showChecklists,
      showPhotos:o.showPhotos,showRemarks:o.showRemarks,photoIds:[...o.photoIds],logoPhotoId:o.logoPhotoId},
    snapshot:fingerprintSnapshot(r.snapshot)};
}
async function digest(text:string) {
  const bytes=new TextEncoder().encode(text);
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))).map(n=>n.toString(16).padStart(2,"0")).join("");
}
export async function reportHashes(jobId:string,report:VisitReport) {
  validateReportSnapshot(report.snapshot,report.options);validateReportHeader(reportIdentity(report));
  const [documentSha256,snapshotSha256,fingerprint]=await Promise.all([
    digest(canonical({format:"gm-visit-report-v1",jobId,report})),
    digest(canonical({format:"gm-report-snapshot-v1",snapshot:report.snapshot})),
    digest(JSON.stringify(fingerprintSnapshot(report.snapshot))),
  ]);
  return {documentSha256,snapshotSha256,fingerprintMatches:fingerprint===report.fingerprint};
}
export async function checkReportOperations(operations:readonly Operation[]):Promise<ReportCheck[]> {
  const checks:ReportCheck[]=[];
  for(const o of operations)for(const c of o.changes)if(c.key.startsWith("reports/")&&c.after!==null) {
    validatePortableReport(c.key,c.after);
    checks.push({operationId:o.id,key:c.key,...await reportHashes(c.after.jobId,c.after.report)});
  }
  return checks;
}
function identityBirth(o:Operation,id:string) {
  for(const c of o.changes)if(c.key.startsWith("visits/")&&c.after!==null) {
    validateReportHeaders(c.after);
    const after=c.after as unknown as {job:{id:string};reportIdentities:ReportIdentityHeader[]};
    const old=c.before as unknown as {reportIdentities:ReportIdentityHeader[]}|null;
    const header=after.reportIdentities.find(r=>r.id===id);
    if(header&&!old?.reportIdentities.some(r=>r.id===id))return {jobId:after.job.id,header};
  }
  return null;
}
/** Explicit source preflight. Adds new evidence operations, NEVER rewrites an
 * old UUID. A relay can only forward the original source's seal. */
export async function prepareReportSeals(data:Data,log:ReplicaLog):Promise<ReportSeal[]> {
  const result:ReportSeal[]=[];
  for(const job of data.jobs)for(const report of job.reports??[]) {
    if(log.operations.some(o=>o.changes.some(c=>c.key===sealKey(report.id))))continue;
    const births=log.operations.flatMap(o=>{const birth=identityBirth(o,report.id);return birth?[{o,...birth}]:[];});
    const birth=births.find(b=>b.o.origin===log.installation&&b.jobId===job.id&&same(b.header,reportIdentity(report)));
    if(!birth)continue; // Received/copied documents never gain local issuance rights.
    const full=log.operations.find(o=>o.origin===log.installation&&o.changes.some(c=>
      c.key===reportKey(job.id,report.id)&&c.before===null&&same(c.after,{jobId:job.id,report})));
    if(!birth.header.requiresAssets&&!full)invalid("Brak niezmiennego oryginału dokumentu.");
    const hashes=await reportHashes(job.id,report);
    if(!hashes.fingerprintMatches)invalid("Fingerprint nie odpowiada historycznemu algorytmowi snapshotu.");
    result.push({format:1,jobId:job.id,identity:birth.header,sourceIdentity:birth.o.id,sourceReport:full?.id??null,
      documentSha256:hashes.documentSha256,snapshotSha256:hashes.snapshotSha256,fingerprintScheme:"visit-json-v1",
      assets:{photos:report.snapshot.photos.length,logo:report.snapshot.logo!==null,
        rememberedReferences:!!(report.options.photoIds.length||report.options.logoPhotoId),
        hashes:[...report.snapshot.photos,...(report.snapshot.logo?[report.snapshot.logo]:[])].map(p=>p.sha256)}});
  }
  return result;
}
export function validateChecks(checks:readonly ReportCheck[],operations:readonly Operation[]) {
  if(!Array.isArray(checks)||new Set(checks.map(c=>c.operationId+"/"+c.key)).size!==checks.length)invalid("Powtórzona weryfikacja.");
  for(const c of checks) {
    const change=operations.find(o=>o.id===c.operationId)?.changes.find(v=>v.key===c.key);
    if(!change?.after||!c.key.startsWith("reports/")||!hash(c.documentSha256)||!hash(c.snapshotSha256)||typeof c.fingerprintMatches!=="boolean")
      invalid("Weryfikacja nie odpowiada oryginalnej operacji.");
  }
}
export function documentRegistry(log:ReplicaLog,checks:readonly ReportCheck[]):ReportAvailability[] {
  const result:ReportAvailability[]=[];
  const docOps=log.operations.flatMap(o=>o.changes.filter(c=>c.key.startsWith("reports/")).map(c=>({o,c})));
  const identities=new Map<string,{identity:ReportIdentityHeader;jobId:string;operations:string[]}>();
  for(const o of log.operations)for(const c of o.changes)if(c.key.startsWith("visits/")&&c.after!==null) {
    try{validateReportHeaders(c.after);}catch{continue;}
    const v=c.after as unknown as {job:{id:string};reportIdentities:ReportIdentityHeader[]};
    for(const h of v.reportIdentities) {
      const prior=(c.before as unknown as {reportIdentities?:ReportIdentityHeader[]}|null)?.reportIdentities?.find(p=>p.id===h.id);
      if(prior&&same(prior,h))continue;
      const key=canonical([v.job.id,h]),old=identities.get(key);
      identities.set(key,{identity:h,jobId:v.job.id,operations:[...new Set([...(old?.operations??[]),o.id])]});
    }
  }
  // Full documents without any header are retained as conflicts, never applied.
  for(const {o,c} of docOps)if(c.after!==null) {
    try {
      validatePortableReport(c.key,c.after);const v=c.after;
      const key=canonical([v.jobId,reportIdentity(v.report)]);
      if(!identities.has(key))identities.set(key,{identity:reportIdentity(v.report),jobId:v.jobId,operations:[o.id]});
    }catch{continue;}
  }
  for(const row of identities.values()) {
    const {identity:h,jobId}=row;
    const seals=log.operations.flatMap(o=>o.changes.filter(c=>c.key===sealKey(h.id)).map(c=>({o,c})));
    const entry:ReportAvailability={reportId:h.id,jobId,identity:h,sourceOperations:row.operations,proofOperation:null,
      status:"conflict",reason:"REPORT_PROOF_MISSING: Brak oryginalnego dowodu dokumentu.",documentSha256:null,snapshotSha256:null,assets:null};
    if(seals.length===1) {
      const {o,c}=seals[0];
      try {
        validateSeal(c.key,c.after);const seal=c.after;
        const source=log.operations.find(p=>p.id===seal.sourceIdentity),birth=source&&identityBirth(source,h.id);
        if(c.before!==null||o.resolution||!source||!birth||birth.jobId!==jobId||!same(birth.header,h)||
          o.origin!==source.origin||!covers(o.context,source)||seal.jobId!==jobId||!same(seal.identity,h))invalid("Dowód nie odpowiada oryginalnemu wystawieniu.");
        entry.proofOperation=o.id;entry.sourceOperations=[...new Set([...row.operations,source.id,o.id])];
        entry.documentSha256=seal.documentSha256;entry.snapshotSha256=seal.snapshotSha256;entry.assets=seal.assets;
        if(h.requiresAssets) {
          entry.status="source-only";entry.reason="Raport istnieje, ale jego pełna zawartość jest dostępna tylko na urządzeniu posiadającym oryginalne pliki.";
        } else {
          const original=log.operations.find(p=>p.id===seal.sourceReport);
          const change=original?.changes.find(p=>p.key===reportKey(jobId,h.id)),check=checks.find(p=>p.operationId===original?.id&&p.key===change?.key);
          if(!original||!change||change.before!==null||!change.after||original.origin!==source.origin||!covers(o.context,original))
            invalid("Brak oryginalnej operacji snapshotu.");
          validatePortableReport(change.key,change.after);
          if(change.after.jobId!==jobId||!same(reportIdentity(change.after.report),h))invalid("Snapshot nie odpowiada tożsamości.");
          const mutations=docOps.filter(p=>p.c.key===change.key);
          if(mutations.length!==1)invalid("Próba zmiany wydanego snapshotu.");
          entry.sourceOperations=[...new Set([...entry.sourceOperations,original.id])];
          if(!check){entry.status="pending";entry.reason="Oczekuje na lokalną weryfikację SHA256.";}
          else if(!check.fingerprintMatches||check.documentSha256!==seal.documentSha256||check.snapshotSha256!==seal.snapshotSha256)
            invalid("Niezgodna suma dokumentu, snapshotu lub fingerprint.");
          else {
            entry.status="portable";entry.reason="Pełna przenośna treść zweryfikowana; zastosowanie określa osobny trwały receipt.";
          }
        }
      }catch(e){entry.status="conflict";entry.reason=(e as Error).message;}
    } else if(seals.length>1)entry.reason="REPORT_PROOF_COLLISION: Rozbieżne lub powtórzone deklaracje dokumentu.";
    result.push(entry);
  }
  return result.sort((a,b)=>canonical([a.jobId,a.identity]).localeCompare(canonical([b.jobId,b.identity]),"en"));
}

export function validateAvailability(entries:readonly ReportAvailability[],log:ReplicaLog,checks:readonly ReportCheck[]) {
  if(!Array.isArray(entries)||entries.length>20000)invalid("Nieprawidłowy rejestr dostępności.");
  const current=documentRegistry(log,checks);
  for(const e of entries) {
    validateReportHeader(e.identity);
    const actual=current.find(v=>v.jobId===e.jobId&&same(v.identity,e.identity));
    if(!actual||e.reportId!==e.identity.id||!["pending","portable","source-only","conflict"].includes(e.status)||
      typeof e.reason!=="string"||e.reason.length>4000||!Array.isArray(e.sourceOperations)||
      e.sourceOperations.some((id:string)=>!log.operations.some(o=>o.id===id))||
      !(e.proofOperation===null||log.operations.some(o=>o.id===e.proofOperation&&o.changes.some(c=>c.key===sealKey(e.reportId))))||
      !(e.documentSha256===null||hash(e.documentSha256))||!(e.snapshotSha256===null||hash(e.snapshotSha256)))
      invalid("Dostępność nie odpowiada niezmiennej historii.");
  }
}
