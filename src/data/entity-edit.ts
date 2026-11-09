/** Optimistic edit check inside the authoritative transaction, without schema revisions.
 * undefined keeps the existing programmatic command contract; UI passes an original
 * record for edits and null for creation. Only fields owned by that form are compared. */
export function assertUnchanged<T extends object>(
  current: T | undefined,
  expected: T | null | undefined,
  fields: readonly (keyof T)[],
  name: string,
) {
  if (expected === undefined) return;
  if (
    (expected === null && current !== undefined) ||
    (expected !== null &&
      (current === undefined ||
        fields.some(
          (key) =>
            JSON.stringify(current[key]) !== JSON.stringify(expected[key]),
        )))
  )
    throw new Error(
      `Dane ${name} zmieniły się lub zostały usunięte w innej karcie. Zachowano szkic. Zamknij formularz i otwórz aktualne dane przed ponowną edycją.`,
    );
}
