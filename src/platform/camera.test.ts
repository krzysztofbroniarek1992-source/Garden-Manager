import { afterEach, describe, expect, it, vi } from "vitest";
const camera = vi.hoisted(() => ({ getPhoto: vi.fn(), pickImages: vi.fn() }));
vi.mock("@capacitor/camera", () => ({
  Camera: camera,
  CameraSource: { Camera: "CAMERA" },
  CameraResultType: { Uri: "uri" },
}));
import { selectPhotos } from "./camera";
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  camera.getPhoto.mockReset();
  camera.pickImages.mockReset();
});
describe("Android camera adapter (mock bridge)", () => {
  it("passes orientation and privacy options then returns a File to the existing processor", async () => {
    camera.getPhoto.mockResolvedValue({ webPath: "local-camera" });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(new Blob(["image"], { type: "image/jpeg" })),
      ),
    );
    const files = await selectPhotos("camera");
    expect(camera.getPhoto).toHaveBeenCalledWith(
      expect.objectContaining({
        correctOrientation: true,
        saveToGallery: false,
        resultType: "uri",
      }),
    );
    expect(files?.[0].type).toBe("image/jpeg");
    expect(await files?.[0].text()).toBe("image");
  });
  it("uses bounded multi-selection for the gallery", async () => {
    camera.pickImages.mockResolvedValue({
      photos: [{ webPath: "one" }, { webPath: "two" }],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("photo")),
    );
    expect(await selectPhotos("gallery")).toHaveLength(2);
    expect(camera.pickImages).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 20 }),
    );
  });
  it("cancellation produces no empty input", async () => {
    camera.getPhoto.mockRejectedValue(new Error("User cancelled photos app"));
    expect(await selectPhotos("camera")).toBeNull();
  });
  it("permission refusal remains a visible error", async () => {
    camera.getPhoto.mockRejectedValue(new Error("Camera permission denied"));
    await expect(selectPhotos("camera")).rejects.toThrow("uprawnienia");
  });
  it("camera failure remains a visible error", async () => {
    camera.getPhoto.mockRejectedValue(new Error("No camera found"));
    await expect(selectPhotos("camera")).rejects.toThrow("No camera found");
  });
  it("rejects unreadable local photo URIs", async () => {
    camera.getPhoto.mockResolvedValue({ webPath: "missing" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 404 })),
    );
    await expect(selectPhotos("camera")).rejects.toThrow("odczytać");
  });
});
