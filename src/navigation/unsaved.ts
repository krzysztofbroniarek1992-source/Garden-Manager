import { useEffect, useRef } from "react";

const message = "Masz niezapisane zmiany. Odrzucić je i opuścić formularz?";
interface Guard {
  element: HTMLElement | null;
  dirty: boolean;
  allowed: boolean;
}
const guards = new Set<Guard>();
let suppressed = 0;
function visible(g: Guard) {
  return !!g.element?.isConnected && !g.element.closest("[hidden], [inert]");
}
export function hasUnsaved(root?: HTMLElement | null) {
  if (suppressed) return false;
  return [...guards].some(
    (g) =>
      visible(g) &&
      g.dirty &&
      !g.allowed &&
      (!root || root.contains(g.element)),
  );
}
export function confirmLeave(root?: HTMLElement | null) {
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
    save<TValue>(action: () => TValue): TValue {
      guard.current.allowed = true;
      try {
        return action();
      } catch (error) {
        guard.current.allowed = false;
        throw error;
      }
    },
  };
}
