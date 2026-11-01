let count = 0;
export const hasPendingWrites = () => count > 0;
const unload = (event: BeforeUnloadEvent) => {
  if (!count) return;
  event.preventDefault();
  event.returnValue = "";
};
export async function pendingWrite<T>(action: () => Promise<T>): Promise<T> {
  if (++count === 1 && typeof window !== "undefined") {
    window.addEventListener("beforeunload", unload);
    document.documentElement.setAttribute("aria-busy", "true");
  }
  try {
    return await action();
  } finally {
    if (--count === 0 && typeof window !== "undefined") {
      window.removeEventListener("beforeunload", unload);
      document.documentElement.removeAttribute("aria-busy");
    }
  }
}
