import type { Data } from "../domain";
import { businessRecords, recordChanges } from "./records";
import { SyncError, type Mutation } from "./model";

/** Only NEW activation logs. Existing operation UUIDs/groups are never rewritten.
 * An import and its owned CSV expenses form one cyclic business unit. Duplicate
 * audit rows may depend on an earlier import; order those groups topologically,
 * without using timestamps or splitting any source operation. */
export function bootstrapGroups(data:Data):Mutation[][] {
  const all=recordChanges(new Map(),businessRecords(data));
  const csv=new Map(data.expenses.filter(e=>e.source==="csv"&&e.origin).map(e=>[e.id,e.origin!.importId]));
  const imports=new Map(data.expenseImports.map(i=>[i.id,i]));
  const groups=new Map<string,Mutation[]>(), ordinary:Mutation[][]=[], shopping:Mutation[][]=[];
  for(const [id] of imports)groups.set(id,[]);
  for(const change of all) {
    const slash=change.key.indexOf("/"), kind=change.key.slice(0,slash), id=decodeURIComponent(change.key.slice(slash+1));
    const owner=kind==="expenseImports"?id:kind==="expenses"?csv.get(id):undefined;
    if(owner!==undefined) {
      const group=groups.get(owner);
      if(!group)throw new SyncError("PRECONDITION","CSV_BOOTSTRAP: Brak źródła wydatku.");
      group.push(change);
    } else (kind==="shoppingItems"?shopping:ordinary).push([change]);
  }
  const done=new Set<string>(), pending=[...imports.keys()].sort(), ordered:Mutation[][]=[];
  while(pending.length) {
    const ready=pending.find(id=>imports.get(id)!.rows.every(row=>{
      const owner=row.expenseId===null?undefined:csv.get(row.expenseId);
      return owner===undefined || owner===id || done.has(owner);
    }));
    if(ready===undefined)throw new SyncError("PRECONDITION","CSV_BOOTSTRAP: Cykl zależności różnych importów wymaga uzgodnienia.");
    ordered.push(groups.get(ready)!);done.add(ready);pending.splice(pending.indexOf(ready),1);
  }
  return [...ordinary,...ordered,...shopping];
}
