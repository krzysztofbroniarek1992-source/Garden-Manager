import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  address,
  cardKey,
  openCard,
  parseAddress,
  routeKey,
  validRoute,
  type Card,
  type Page,
  type Route,
} from "./routes";
import { confirmLeave, hasUnsaved, requestLeave } from "./unsaved";
import { useGarden } from "../state";

interface Entry {
  version: 1;
  index: number;
  route: Route;
}
function readEntry(value: unknown): Entry | null {
  const e = (value as { gardenNavigation?: Entry } | null)?.gardenNavigation;
  return e?.version === 1 &&
    Number.isSafeInteger(e.index) &&
    e.index >= 0 &&
    validRoute(e.route)
    ? e
    : null;
}
interface Navigation {
  route: Route;
  invalid: boolean;
  open(card: Card): void;
  go(page: Page): void;
  back(): void;
  section(value: string): void;
  memory: Map<string, unknown>;
}
const Context = createContext<Navigation | null>(null);
export const ViewScope = createContext("root");
function readMemory(state: unknown): Map<string, unknown> {
  const values = (state as { gardenNavigationUI?: unknown } | null)
    ?.gardenNavigationUI;
  const result = new Map<string, unknown>();
  if (!Array.isArray(values) || values.length > 400) return result;
  for (const pair of values) {
    if (
      !Array.isArray(pair) ||
      pair.length !== 2 ||
      typeof pair[0] !== "string" ||
      pair[0].length > 1000
    )
      continue;
    const v = pair[1];
    if (
      (typeof v === "string" && v.length <= 5000) ||
      (typeof v === "number" && Number.isFinite(v)) ||
      typeof v === "boolean" ||
      (v instanceof Set &&
        v.size < 200 &&
        [...v].every((x) => typeof x === "string" && x.length < 100))
    )
      result.set(pair[0], v);
  }
  return result;
}
export function useNavigation() {
  const value = useContext(Context);
  if (!value) throw new Error("Brak kontrolera nawigacji.");
  return value;
}
/** Ephemeral presentation state. Deliberately excluded from localStorage/JSON/ZIP. */
export function useViewState<T>(key: string, initial: T | (() => T)) {
  const { memory } = useNavigation();
  const scope = useContext(ViewScope);
  const fullKey = `${scope}:${key}`;
  const [value, update] = useState<T>(() => {
    const fallback =
      typeof initial === "function" ? (initial as () => T)() : initial;
    const cached = memory.get(fullKey);
    return (
      fallback instanceof Set
        ? cached instanceof Set
        : typeof cached === typeof fallback
    )
      ? (cached as T)
      : fallback;
  });
  const set = (next: SetStateAction<T>) =>
    update((previous) => {
      const result =
        typeof next === "function" ? (next as (value: T) => T)(previous) : next;
      memory.set(fullKey, result);
      if (memory.size > 400) memory.delete(memory.keys().next().value!);
      return result;
    });
  return [value, set] as const;
}

export function NavigationProvider({ children }: { children: ReactNode }) {
  const { data } = useGarden();
  const dataset = useRef(data.photoRestoreId);
  const [initial] = useState(() => {
    const parsed = parseAddress(location.href),
      saved = readEntry(history.state);
    return {
      ...parsed,
      entry:
        saved && address(saved.route) === address(parsed.route)
          ? saved
          : { version: 1 as const, index: 0, route: parsed.route },
    };
  });
  const [entry, setEntry] = useState(initial.entry);
  const [invalid, setInvalid] = useState(initial.invalid);
  const current = useRef(entry);
  const memory = useRef(readMemory(history.state));
  const positions = useRef(
    new Map<string, { y: number; focus: HTMLElement | null }>(),
  );
  const restoring = useRef<null | { target: Entry; delta: number }>(null);
  const allowedPop = useRef(false);
  const moving = useRef(false);
  const handledURL = useRef(location.href);
  const pendingCard = useRef<Card | null>(null);
  useEffect(() => {
    if (dataset.current === data.photoRestoreId) return;
    dataset.current = data.photoRestoreId;
    memory.current.clear();
    positions.current.clear();
    history.replaceState({ ...history.state, gardenNavigationUI: [] }, "");
  }, [data.photoRestoreId]);
  const capture = () =>
    positions.current.set(routeKey(current.current.route), {
      y: window.scrollY,
      focus: document.activeElement as HTMLElement | null,
    });
  const apply = (next: Entry) => {
    capture();
    current.current = next;
    setEntry(next);
    requestAnimationFrame(() => {
      const p = positions.current.get(routeKey(next.route));
      window.scrollTo({ top: p?.y ?? 0 });
      if (p?.focus?.isConnected) p.focus.focus({ preventScroll: true });
    });
  };
  const write = (next: Entry, replace = false) => {
    const presentation = [...memory.current].slice(-400);
    // Save UI state on the old entry as well, so a reload after Back can restore it.
    history.replaceState(
      { ...history.state, gardenNavigationUI: presentation },
      "",
    );
    const url = new URL(location.href);
    url.searchParams.delete("client");
    const href = `${url.pathname}${url.search}${address(next.route)}`;
    history[replace ? "replaceState" : "pushState"](
      {
        ...history.state,
        gardenNavigation: next,
        gardenNavigationUI: presentation,
      },
      "",
      href,
    );
    handledURL.current = location.href;
    setInvalid(false);
    apply(next);
  };
  const navigate = (route: Route, replace = false) => {
    if (moving.current || !confirmLeave()) return;
    if (routeKey(route) === routeKey(current.current.route)) return;
    write(
      { version: 1, index: current.current.index + (replace ? 0 : 1), route },
      replace,
    );
  };
  useEffect(() => {
    const oldRestoration = history.scrollRestoration;
    history.scrollRestoration = "manual";
    // Canonicalize legacy addresses without adding a fake previous screen.
    write(current.current, true);
    setInvalid(initial.invalid);
    const pop = () => {
      handledURL.current = location.href;
      const saved = readEntry(history.state),
        parsed = parseAddress(location.href);
      const next =
        saved && address(saved.route) === address(parsed.route)
          ? saved
          : {
              version: 1 as const,
              index: current.current.index,
              route: parsed.route,
            };
      if (restoring.current) {
        const pending = restoring.current;
        restoring.current = null;
        moving.current = false;
        if (confirmLeave()) {
          allowedPop.current = true;
          moving.current = true;
          history.go(pending.delta);
        }
        return;
      }
      const delta = next.index - current.current.index;
      if (!allowedPop.current && hasUnsaved()) {
        if (delta) {
          restoring.current = { target: next, delta };
          moving.current = true;
          history.go(-delta);
          return;
        }
        if (!confirmLeave()) {
          write(current.current, true);
          return;
        }
      }
      allowedPop.current = false;
      moving.current = false;
      if (pendingCard.current) {
        const card = pendingCard.current;
        pendingCard.current = null;
        write({ ...next, route: openCard(next.route, card) }, true);
      } else {
        setInvalid(parsed.invalid);
        apply(next);
      }
    };
    const unload = (event: BeforeUnloadEvent) => {
      history.replaceState(
        {
          ...history.state,
          gardenNavigationUI: [...memory.current].slice(-400),
        },
        "",
      );
      if (hasUnsaved()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("popstate", pop);
    // Directly edited hashes do not have our history state.
    const hash = () => {
      if (handledURL.current !== location.href) pop();
    };
    window.addEventListener("hashchange", hash);
    window.addEventListener("beforeunload", unload);
    return () => {
      window.removeEventListener("popstate", pop);
      window.removeEventListener("hashchange", hash);
      window.removeEventListener("beforeunload", unload);
      history.scrollRestoration = oldRestoration;
    };
  }, []);
  const value: Navigation = {
    route: entry.route,
    invalid,
    memory: memory.current,
    open: (input) => {
      if (moving.current) return;
      requestLeave(() => {
        const card = { ...input };
        if (card.kind === "job" && card.editBilling) {
          memory.current.set(
            `${frameScope(current.current.route.page, card)}:billing-editor`,
            true,
          );
          delete card.editBilling;
        }
        const r = current.current.route,
          index = r.cards.findIndex((c) => cardKey(c) === cardKey(card));
        const steps = index < 0 ? 0 : r.cards.length - index - 1;
        if (steps && current.current.index >= steps) {
          if (moving.current || !confirmLeave()) return;
          pendingCard.current = card;
          allowedPop.current = true;
          moving.current = true;
          history.go(-steps);
        } else navigate(openCard(r, card), index >= 0);
      });
    },
    go: (page) => {
      setInvalid(false);
      navigate({ page, cards: [] });
    },
    back: () => {
      if (moving.current || !confirmLeave()) return;
      if (current.current.index > 0) {
        allowedPop.current = true;
        moving.current = true;
        history.back();
      } else
        navigate(
          {
            ...current.current.route,
            cards: current.current.route.cards.slice(0, -1),
          },
          true,
        );
    },
    section: (section) => {
      const r = current.current.route,
        card = r.cards.at(-1);
      if (!card || card.kind === "client") return;
      const next = {
        ...r,
        cards: [...r.cards.slice(0, -1), { ...card, section }],
      };
      if (validRoute(next)) navigate(next, true);
    },
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export const frameScope = (page: Page, card: Card) =>
  `${page}:${cardKey(card)}`;
