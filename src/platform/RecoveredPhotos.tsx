import { useEffect, useReducer } from "react";
import Modal from "../components/Modal";
import PhotoGallery from "../photos/PhotoGallery";
import { useGarden } from "../state";
import { resolvePhotoScope, type PhotoScope } from "../photos/model";
import { cameraCoordinator, selectionPhotoId } from "./camera";
import { isAndroid } from "./files";

export default function RecoveredPhotos() {
  const { data } = useGarden();
  const [, refresh] = useReducer((n) => n + 1, 0);
  useEffect(() => cameraCoordinator.subscribe(refresh), []);
  const selection = cameraCoordinator.recovery;
  // Ack a previous explicit save whose native acknowledgement was interrupted.
  const committed =
    !!selection &&
    selection.files.every((_, i) =>
      data.photos.some(
        (p) => p.id === selectionPhotoId(selection.operation.id, i),
      ),
    );
  useEffect(() => {
    if (committed && selection)
      void cameraCoordinator.finish(selection.operation.id).catch(() => {});
  }, [committed, selection]);
  if (!isAndroid()) return null;
  if (cameraCoordinator.error || cameraCoordinator.interrupted)
    return (
      <div className="native-notice" role="alert">
        {cameraCoordinator.error ||
          "Oczekiwanie na wynik wyboru zdjęć. Jeżeli wybór został przerwany, możesz go anulować."}
        {cameraCoordinator.interrupted ? (
          <>
            <button
              className="button secondary"
              onClick={() => {
                void cameraCoordinator.restore().catch(() => {});
              }}
            >
              Ponów odczyt
            </button>
            <button
              className="button secondary"
              onClick={() => {
                const op = cameraCoordinator.interrupted;
                if (op && window.confirm("Odrzucić niezapisany wybór zdjęć?"))
                  void cameraCoordinator.finish(op.id).catch(() => {});
              }}
            >
              Odrzuć wybór
            </button>
          </>
        ) : (
          <button
            className="button secondary"
            onClick={() => cameraCoordinator.dismissError()}
          >
            OK
          </button>
        )}
      </div>
    );
  if (!selection || committed) return null;
  let scope: PhotoScope = selection.operation.scope,
    stale = false;
  try {
    const resolved = resolvePhotoScope(data, scope);
    if (
      (["clientId", "gardenId", "zoneId", "jobId"] as const).some(
        (key) => resolved[key] !== scope[key],
      )
    )
      throw new Error();
  } catch {
    scope = { clientId: null, gardenId: null, zoneId: null, jobId: null };
    stale = true;
  }
  const close = () => {
    void cameraCoordinator.finish(selection.operation.id).catch(() => {});
  };
  return (
    <Modal title="Wybrane zdjęcia" onClose={close} wide>
      <p>Odzyskano wybór zdjęć. Sprawdź powiązania i zatwierdź zapis.</p>
      {stale && (
        <p role="alert" className="gm-form-error">
          Poprzedni cel nie jest już dostępny lub jego powiązania się zmieniły.
          Wybierz właściwego klienta, ogród i zlecenie.
        </p>
      )}
      <PhotoGallery
        key={selection.operation.id}
        scope={scope}
        initialSelection={selection}
        uploadOnly
        onFinish={close}
      />
    </Modal>
  );
}
