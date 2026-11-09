import { Capacitor, registerPlugin } from "@capacitor/core";
import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";

const filesPort = registerPlugin<{
  releasePhoto(options: { uri: string }): Promise<void>;
}>("GardenFiles");

/** Selection only: the existing photo service validates, compresses and commits. */
export async function selectPhotos(
  source: "camera" | "gallery",
): Promise<File[] | null> {
  try {
    const selected =
      source === "camera"
        ? [
            await Camera.getPhoto({
              source: CameraSource.Camera,
              resultType: CameraResultType.Uri,
              quality: 90,
              correctOrientation: true,
              saveToGallery: false,
            }),
          ]
        : (
            await Camera.pickImages({
              limit: 20,
              quality: 90,
              correctOrientation: true,
            })
          ).photos;
    if (selected.length > 20)
      throw new Error("Można wybrać najwyżej 20 zdjęć.");
    if (!selected.length) return null;
    const files: File[] = [];
    for (const photo of selected) {
      const path = photo.webPath;
      if (!path) throw new Error("Aparat nie zwrócił pliku zdjęcia.");
      try {
        const response = await fetch(path);
        if (!response.ok) throw new Error("Nie udało się odczytać zdjęcia.");
        const blob = await response.blob();
        if (blob.size > 25 * 1024 * 1024)
          throw new Error("Zdjęcie przekracza limit 25 MB.");
        const ext = blob.type.includes("png")
          ? "png"
          : blob.type.includes("webp")
            ? "webp"
            : "jpg";
        files.push(
          new File([blob], `zdjecie-${Date.now()}-${files.length + 1}.${ext}`, {
            type: blob.type || "image/jpeg",
          }),
        );
      } finally {
        if (photo.path && Capacitor.getPlatform() === "android")
          await filesPort.releasePhoto({ uri: photo.path }).catch(() => {});
      }
    }
    return files;
  } catch (error) {
    const message = (error as Error).message || "";
    if (/cancel|canceled|cancelled|no images|no image picked/i.test(message))
      return null;
    throw new Error(
      /permission|denied|access/i.test(message)
        ? "Brak uprawnienia do aparatu lub wybranych zdjęć. Sprawdź ustawienia Androida i spróbuj ponownie."
        : `Nie udało się wybrać zdjęć: ${message}`,
    );
  }
}
