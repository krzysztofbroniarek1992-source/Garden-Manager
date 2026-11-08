import { frameScope, type useNavigation } from "../navigation/Navigation";
import { requestLeave } from "../navigation/unsaved";
import type { FinanceFilter } from "../navigation/routes";
import type { FinanceOwner } from "./model";
/** A summary amount explains the whole scope. Reset only history search fields,
 * after the existing guard accepts leaving; Back still restores its own context. */
export function openFinance(
  navigation: ReturnType<typeof useNavigation>,
  owner: FinanceOwner,
  id: string,
  filter: FinanceFilter,
) {
  requestLeave(() => {
    const card = { kind: "finance" as const, owner, id, filter };
    const scope = frameScope(navigation.route.page, card);
    for (const key of ["from", "to", "garden", "status", "search"])
      navigation.memory.set(`${scope}:finance-${key}`, "");
    navigation.open(card);
  });
}
