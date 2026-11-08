import { useEffect, useState } from "react";
/** Present the existing write lock without changing persistence or navigation rules. */
export default function PendingStatus() {
  const [pending, setPending] = useState(false);
  useEffect(() => {
    const update = () =>
      setPending(document.documentElement.getAttribute("aria-busy") === "true");
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["aria-busy"],
    });
    update();
    return () => observer.disconnect();
  }, []);
  return (
    <div
      className="pending-write-status"
      role="status"
      aria-live="polite"
      hidden={!pending}
    >
      {pending && <span>Zapisywanie zmian… Poczekaj na zakończenie.</span>}
    </div>
  );
}
