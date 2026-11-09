import { describe, expect, it, vi } from "vitest";
import {
  CameraCoordinator,
  type CameraPort,
  type MediaOperation,
} from "./camera";
const scope = {
  clientId: "client-1",
  gardenId: "garden-1",
  jobId: "job-1",
  zoneId: null,
};
function setup() {
  let current: MediaOperation | null = null;
  let deliver!: (op: MediaOperation) => void;
  const port: CameraPort = {
    acquire: vi.fn(async ({ operation }) => {
      current = { ...operation, status: "launching" };
      return new Promise<MediaOperation>((r) => {
        deliver = r;
      });
    }),
    readPending: vi.fn(async () => ({ operation: current })),
    acknowledge: vi.fn(async ({ id }) => {
      if (current?.id === id) current = null;
    }),
  };
  const read = vi.fn(async () => new Blob(["jpeg"], { type: "image/jpeg" }));
  const coordinator = new CameraCoordinator(port, read);
  const ready = (status: MediaOperation["status"] = "ready") => {
    current = {
      ...current!,
      status,
      files: [
        {
          uri: `file:///data/user/0/app/files/pending-media/${current!.id}/capture.jpg`,
          name: "zdjecie.jpg",
          mime: "image/jpeg",
          size: 4,
        },
      ],
    };
    return current;
  };
  return {
    port,
    read,
    coordinator,
    ready,
    deliver: () => deliver(current!),
    get: () => current,
    set: (op: MediaOperation) => {
      current = op;
    },
  };
}
describe("camera coordinator (mock bridge, not native hardware)", () => {
  it("persists context before delivery; normal result preserves scope and waits for explicit acknowledgement", async () => {
    const f = setup(),
      selected = f.coordinator.select("camera", scope, "during");
    expect(f.get()).toMatchObject({
      scope,
      source: "camera",
      category: "during",
    });
    f.ready();
    f.deliver();
    const result = await selected;
    expect(result?.files).toHaveLength(1);
    expect(result?.operation.scope).toEqual(scope);
    expect(f.port.acknowledge).not.toHaveBeenCalled();
    await f.coordinator.finish(result!.operation.id);
    expect(f.get()).toBeNull();
  });
  it("deduplicates restored event vs normal promise in either order", async () => {
    for (const eventFirst of [true, false]) {
      const f = setup(),
        selected = f.coordinator.select("camera", scope, "before");
      f.ready();
      if (eventFirst)
        await f.coordinator.restore({
          pluginId: "GardenCamera",
          methodName: "acquire",
          success: true,
        });
      f.deliver();
      await selected;
      await f.coordinator.restore({
        pluginId: "GardenCamera",
        methodName: "acquire",
        success: true,
      });
      expect(f.read).toHaveBeenCalledTimes(1);
      expect(f.coordinator.recovery).toBeNull();
    }
  });
  it("recovers after a new JS process or reload exactly once without business writes", async () => {
    const f = setup();
    void f.coordinator.select("gallery", scope, "other");
    f.ready();
    const restored = new CameraCoordinator(f.port, f.read);
    await Promise.all([
      restored.restore(),
      restored.restore({
        pluginId: "GardenCamera",
        methodName: "acquire",
        success: true,
      }),
    ]);
    expect(restored.recovery?.operation.scope).toEqual(scope);
    expect(restored.recovery?.files).toHaveLength(1);
    expect(f.read).toHaveBeenCalledTimes(1);
    await restored.finish(restored.recovery!.operation.id);
    await restored.restore();
    expect(restored.recovery).toBeNull();
  });
  it("ignores unrelated plugin results, wrong operation ids and repeated handled events", async () => {
    const f = setup();
    void f.coordinator.select("camera", scope, "other");
    const op = f.ready();
    await f.coordinator.restore({
      pluginId: "GardenFiles",
      methodName: "pickBackup",
      success: true,
    });
    await f.coordinator.accept({ ...op, id: crypto.randomUUID() });
    expect(f.read).not.toHaveBeenCalled();
    await f.coordinator.finish(op.id);
    await f.coordinator.accept(op);
    expect(f.read).not.toHaveBeenCalled();
  });
  it("cancellation resolves with no files and clears the operation", async () => {
    const f = setup(),
      selected = f.coordinator.select("camera", scope, "other");
    f.ready("cancelled");
    f.deliver();
    expect(await selected).toBeNull();
    expect(f.get()).toBeNull();
  });
  it.each(["Brak uprawnienia do aparatu.", "Brak miejsca na zdjęcie."])(
    "reports genuine native errors: %s",
    async (message) => {
      const f = setup(),
        selected = f.coordinator.select("camera", scope, "other");
      f.set({ ...f.ready("error"), message });
      f.deliver();
      await expect(selected).rejects.toThrow(message);
      expect(f.get()).toBeNull();
    },
  );
  it("rejects expired context without guessing its target", async () => {
    const f = setup();
    void f.coordinator.select("camera", scope, "other");
    f.set({ ...f.ready(), startedAt: Date.now() - 25 * 3600000 });
    const restarted = new CameraCoordinator(f.port, f.read);
    await restarted.restore();
    expect(restarted.error).toContain("wygasł");
    expect(restarted.recovery).toBeNull();
    expect(f.read).not.toHaveBeenCalled();
  });
  it("bounds multiple gallery files and raw size before fetching", async () => {
    const f = setup(),
      selected = f.coordinator.select("gallery", scope, "other");
    const op = f.ready();
    f.set({ ...op, files: Array.from({ length: 21 }, () => op.files![0]) });
    f.deliver();
    await expect(selected).rejects.toThrow("20");
    expect(f.read).not.toHaveBeenCalled();
    const g = setup(),
      large = g.coordinator.select("camera", scope, "other");
    const item = g.ready();
    g.set({ ...item, files: [{ ...item.files![0], size: 26 * 1024 * 1024 }] });
    g.deliver();
    await expect(large).rejects.toThrow("25 MB");
    expect(g.read).not.toHaveBeenCalled();
  });
  it("keeps recovery retryable when a temporary file cannot be read, without creating a photo", async () => {
    const f = setup(),
      selected = f.coordinator.select("camera", scope, "other");
    f.read.mockRejectedValueOnce(new Error("Nie udało się odczytać zdjęcia."));
    f.ready();
    f.deliver();
    await expect(selected).rejects.toThrow("odczytać");
    expect(f.coordinator.recovery).toBeNull();
  });
});
