import RecoveredPhotos from "./RecoveredPhotos";
import { cameraCoordinator } from "./camera";
import { App } from "@capacitor/app";
import type { PluginListenerHandle } from "@capacitor/core";
import { useEffect, useRef, useState } from "react";
import { useNavigation } from "../navigation/Navigation";
import { requestLeave } from "../navigation/unsaved";
import { hasPendingWrites } from "../data/pending";
import { closeTopModal } from "../components/Modal";
import { isAndroid } from "./files";
import { address } from "../navigation/routes";
import { saveNativeNavigation } from "./navigation";

export default function AndroidLifecycle() {
  const navigation = useNavigation(),
    latest = useRef(navigation);
  latest.current = navigation;
  const [notice, setNotice] = useState("");
  useEffect(() => {
    void saveNativeNavigation(address(navigation.route)).catch(() =>
      setNotice(
        "Nie udało się zachować ostatniego widoku. Dane pozostają w IndexedDB.",
      ),
    );
  }, [navigation.route]);
  useEffect(() => {
    if (!isAndroid()) return;
    document.documentElement.classList.add("native-android");
    let disposed = false;
    const handles: PluginListenerHandle[] = [];
    const listen = async (promise: Promise<PluginListenerHandle>) => {
      try {
        const handle = await promise;
        if (disposed) await handle.remove();
        else handles.push(handle);
      } catch {
        if (!disposed)
          setNotice(
            "Nie udało się połączyć z obsługą Androida. Uruchom aplikację ponownie.",
          );
      }
    };
    void listen(
      App.addListener("backButton", () => {
        if (hasPendingWrites()) {
          setNotice("Trwa zapis. Poczekaj na jego zakończenie.");
          return;
        }
        setNotice("");
        if (closeTopModal()) return;
        if (latest.current.canGoBack) latest.current.back();
        else
          requestLeave(() => {
            if (
              window.confirm(
                "Przejść do ekranu głównego telefonu? Pomiar czasu będzie kontynuowany.",
              )
            )
              void App.minimizeApp().catch(() =>
                setNotice("Nie udało się opuścić aplikacji."),
              );
          });
      }),
    );
    void listen(
      App.addListener("appStateChange", ({ isActive }) => {
        // Existing listeners read IndexedDB and recalculate the timestamp timer.
        // Never replay a command on resume.
        if (isActive) window.dispatchEvent(new Event("focus"));
      }),
    );
    void listen(
      App.addListener("appRestoredResult", (event) => {
        void cameraCoordinator
          .restore(event)
          .catch((error) => setNotice((error as Error).message));
      }),
    );
    const recover = () => {
      void cameraCoordinator
        .restore()
        .catch((error) => setNotice((error as Error).message));
    };
    recover();
    window.addEventListener("focus", recover);
    return () => {
      disposed = true;
      window.removeEventListener("focus", recover);
      handles.forEach((h) => {
        void h.remove();
      });
    };
  }, []);
  return (
    <>
      <RecoveredPhotos />
      {notice ? (
        <div className="native-notice" role="status">
          {notice}
          <button className="button ghost" onClick={() => setNotice("")}>
            OK
          </button>
        </div>
      ) : null}
    </>
  );
}
