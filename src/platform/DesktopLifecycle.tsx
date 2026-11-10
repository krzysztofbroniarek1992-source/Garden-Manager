import { useEffect, useRef, useState } from "react";
import { useNavigation } from "../navigation/Navigation";
import { confirmLeave } from "../navigation/unsaved";
import { hasPendingWrites } from "../data/pending";
import { isDesktop } from "./desktop";
export default function DesktopLifecycle() {
  const navigation = useNavigation(),
    latest = useRef(navigation);
  latest.current = navigation;
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (!isDesktop()) return;
    return window.gardenDesktop!.onHistoryRequested((direction) => {
      if (direction === "back") latest.current.back();
      else window.history.forward();
    });
  }, []);
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
