import type { Expense, ExpenseData, ExpenseImport } from "../expenses/model";

/** Risk detection, NEVER an equivalence relation or an automatic merge.
 * Profiles are namespaces, not verified account identities. No name/date/amount
 * heuristic can authorize combining them. No clock is involved. */
export function bankRisk(before:ExpenseData, added:Expense[], imports:ExpenseImport[], remote=true):string|null {
  const statements=new Map([...before.expenseImports,...imports].map(i=>[i.id,i]));
  const seen=before.expenses.filter(e=>e.source==="csv" && e.origin);
  for(const expense of added) {
    const a=expense.origin!;
    for(const other of seen) {
      if(other.id===expense.id) continue;
      const b=other.origin!;
      if(a.profileId!==b.profileId)
        return "CSV_PROFILE_SCOPE: Nieuzgodnione profile rachunków. Wymagane jawne uzgodnienie przed dodaniem kosztu.";
      if(a.identity===b.identity)
        return "CSV_DUPLICATE_IDENTITY: Ta tożsamość transakcji istnieje pod innym ID. Nie dodano drugiego wydatku.";
      const first=statements.get(a.importId), prior=statements.get(b.importId);
      if(first && prior && first.id!==prior.id && first.fileHash===prior.fileHash && a.line===b.line)
        return "CSV_FILE_ROW: Ten sam plik i wiersz mają różne tożsamości transakcji. Wymagana weryfikacja.";
      // No bank ID: match alone is NOT an identity. It can only hold a doubtful
      // new entry for review. Distinct occurrences within one statement remain
      // distinct. The source UI already has an explicit separate-row decision.
      if((remote || !!a.transactionId) && (!a.transactionId || !b.transactionId) && a.match===b.match &&
        (a.statementKey!==b.statementKey || !!a.transactionId!==!!b.transactionId))
        return "CSV_AMBIGUOUS_ROW: Podobny wiersz bez ID bankowego w innym wyciągu. Nie utożsamiono ani nie dodano kosztu.";
    }
    seen.push(expense);
  }
  return null;
}
