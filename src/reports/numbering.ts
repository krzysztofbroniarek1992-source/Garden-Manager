/** Portable number syntax, not the local allocator/installation identity.
 * UUID v4 uses all 122 random bits; never truncate a namespace for uniqueness. */
export const reportNamespacePattern="[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
export const isReportNamespace=(value:unknown):value is string=>
  typeof value==="string"&&new RegExp("^"+reportNamespacePattern+"$").test(value);
export interface ReportIdentity { number:string; version:number }
export interface ParsedReportNumber { year:number; namespace:string|null; sequence:number }
export function parseReportNumber(value:unknown):ParsedReportNumber|null {
  if(typeof value!=="string")return null;
  const old=/^BO\/(\d{4})\/(\d{6,16})$/.exec(value);
  const scoped=new RegExp("^BO/(\\d{4})/("+reportNamespacePattern+")/(\\d{6,16})$").exec(value);
  const sequence=Number(old?.[2]??scoped?.[3]);
  if(!old&&!scoped||!Number.isSafeInteger(sequence)||sequence<(scoped?1:0)||scoped&&scoped[3]!==String(sequence).padStart(6,"0"))return null;
  return {year:Number(old?.[1]??scoped![1]),namespace:scoped?.[2]??null,sequence};
}
export function scopedReportNumber(namespace:string,sequence:number,at:number) {
  const year=new Date(at).getFullYear();
  if(!isReportNamespace(namespace)||!Number.isSafeInteger(sequence)||sequence<1||
    !Number.isSafeInteger(at)||at<0||at>8.64e15||year<0||year>9999)
    throw Error("Nieprawidłowa przestrzeń lub licznik raportu.");
  return `BO/${String(year).padStart(4,"0")}/${namespace}/${String(sequence).padStart(6,"0")}`;
}
