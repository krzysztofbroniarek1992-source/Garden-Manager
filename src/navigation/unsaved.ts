import { hasPendingWrites } from "../data/pending";
import { useEffect, useRef } from "react";

const message = "Masz niezapisane zmiany. Opuścić formularz bez zapisywania?";
interface Guard {
  element: HTMLElement | null;
  dirty: boolean;
  allowed: boolean;
}
const guards = new Set<Guard>();
let suppressed = 0;
function visible(g: Guard) {
  return !!g.element?.isConnected && !g.element.closest("[hidden], [inert]:not([data-modal-covered])");
}
export function hasUnsaved(root?: HTMLElement | null) {
  if (suppressed) return false;
  if (hasPendingWrites()) return true;
  return [...guards].some(
    (g) =>
      visible(g) &&
      g.dirty &&
      !g.allowed &&
      (!root || root.contains(g.element)),
  );
}
export function confirmLeave(root?: HTMLElement | null) {
  if (hasPendingWrites()) return false;
  return !hasUnsaved(root) || window.confirm(message);
}
export function requestLeave(action: () => void, root?: HTMLElement | null) {
  if (!confirmLeave(root)) return;
  suppressed++;
  try {
    action();
  } finally {
    suppressed--;
  }
}

/** A guard is scoped to an actual mounted form; hidden cards cannot block navigation. */
export function useUnsavedChanges<T extends HTMLElement = HTMLFormElement>(
  dirty: boolean,
) {
  const ref = useRef<T>(null);
  const guard = useRef<Guard>({ element: null, dirty, allowed: false });
  guard.current.dirty = dirty;
  if (!dirty) guard.current.allowed = false;
  useEffect(() => {
    const g = guard.current;
    g.element = ref.current;
    guards.add(g);
    return () => {
      guards.delete(g);
    };
  });
  return {
    ref,
    confirm(action: () => void) {
      requestLeave(action, ref.current);
    },
    async save<TValue>(
      action: () => TValue | Promise<TValue>,
    ): Promise<TValue> {
      guard.current.allowed = true;
      const focus =
        typeof document !== "undefined"
          ? (document.activeElement as HTMLElement | null)
          : null;
      // Lock the submitted form only; autosave fields retain their own drafts.
      const element = ref.current ?? focus?.closest<HTMLElement>("form");
      const previousInert = element?.inert ?? false;
      const previousDisabled = element?.getAttribute("aria-disabled");
      if (element) {
        element.inert = true;
        element.setAttribute("aria-disabled", "true");
      }
      try {
        return await action();
      } catch (error) {
        guard.current.allowed = false;
        throw error;
      } finally {
        if (element) {
          element.inert = previousInert;
          if (previousDisabled == null)
            element.removeAttribute("aria-disabled");
          else element.setAttribute("aria-disabled", previousDisabled);
          if (
            focus?.isConnected &&
            !element.closest("[hidden], [inert]") &&
            document.activeElement === document.body
          )
            focus.focus({ preventScroll: true });
        }
      }
    },
  };
}
