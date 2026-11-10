import { useEffect, useState } from "react";
import { confirmLeave } from "../navigation/unsaved";
import { hasPendingWrites } from "../data/pending";
import { isDesktop } from "./desktop";
export default function DesktopLifecycle() {
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!isDesktop()) return;
    return window.gardenDesktop!.onCloseRequested(async (request) => {
      let allow = confirmLeave();
      if (allow) {
        (document.activeElement as HTMLElement | null)?.blur();
        await Promise.resolve();
        allow = !hasPendingWrites();
      }
      if (allow) {
        document.body.inert = true;
        await Promise.resolve();
        if (hasPendingWrites()) {
          document.body.inert = false;
          allow = false;
        }
      }
      if (!allow && hasPendingWrites())
        setNotice(
          "Trwa zapis. Poczekaj na zakończenie, a następnie zamknij program ponownie.",
        );
      window.gardenDesktop!.replyClose({ id: request.id, allow });
    });
  }, []);
  return isDesktop() ? (
    <>
      {notice && (
        <div className="native-notice" role="status">
          {notice}
          <button className="button ghost" onClick={() => setNotice("")}>
            OK
          </button>
        </div>
      )}
    </>
  ) : null;
}
