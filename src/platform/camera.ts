import { Capacitor, registerPlugin } from "@capacitor/core";
import type { PhotoCategory, PhotoScope } from "../photos/model";
import { photoLimits } from "../photos/model";

export interface MediaOperation {
  id: string;
  source: "camera" | "gallery";
  startedAt: number;
  scope: PhotoScope;
  category: PhotoCategory;
  status?: "launching" | "ready" | "cancelled" | "error";
  files?: { uri: string; name: string; mime: string; size: number }[];
  message?: string;
}
export interface MediaSelection {
  operation: MediaOperation;
  files: File[];
}
export interface CameraPort {
  acquire(options: { operation: MediaOperation }): Promise<MediaOperation>;
  readPending(): Promise<{ operation?: MediaOperation | null }>;
  acknowledge(options: { id: string }): Promise<void>;
}
export const gardenCamera = registerPlugin<CameraPort>("GardenCamera");
const TTL = 24 * 60 * 60 * 1000;
export const selectionPhotoId = (id: string, index: number) => `${id}_${index}`;

/** Both callback channels use the same persisted operation. No business writes here. */
export class CameraCoordinator {
  private waiting = new Map<
    string,
    { resolve: (s: MediaSelection | null) => void; reject: (e: Error) => void }
  >();
  private delivered = new Set<string>();
  private loading = new Map<string, Promise<MediaSelection>>();
  private listeners = new Set<() => void>();
  recovery: MediaSelection | null = null;
  error = "";
  interrupted: MediaOperation | null = null;
  constructor(
    private port: CameraPort,
    private readFile: (uri: string) => Promise<Blob> = async (uri) => {
      const response = await fetch(Capacitor.convertFileSrc(uri));
      if (!response.ok) throw new Error("Nie udało się odczytać zdjęcia.");
      return response.blob();
    },
    private clock = Date.now,
  ) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private changed() {
    this.listeners.forEach((f) => f());
  }
  private validate(op: MediaOperation) {
    if (
      !op ||
      !/^[a-f0-9-]{36}$/.test(op.id) ||
      !["camera", "gallery"].includes(op.source) ||
      !Number.isSafeInteger(op.startedAt) ||
      op.startedAt > this.clock() + 60000 ||
      this.clock() - op.startedAt > TTL ||
      !op.scope ||
      !["before", "during", "after", "problem", "other"].includes(
        op.category,
      ) ||
      !(["clientId", "gardenId", "zoneId", "jobId"] as const).every((key) =>
        Object.hasOwn(op.scope, key),
      ) ||
      !Object.values(op.scope).every(
        (v) =>
          v === null ||
          (typeof v === "string" && v.length > 0 && v.length <= 100),
      )
    )
      throw new Error(
        "Kontekst wyboru zdjęcia wygasł lub jest nieprawidłowy. Wybierz zdjęcie ponownie.",
      );
  }
  private hydrate(op: MediaOperation): Promise<MediaSelection> {
    let load = this.loading.get(op.id);
    if (!load) {
      load = (async () => {
        if (!op.files?.length || op.files.length > photoLimits.batch)
          throw new Error("Wybierz od 1 do 20 zdjęć.");
        const files: File[] = [];
        for (const file of op.files) {
          if (
            !file.uri.startsWith("file://") ||
            !file.uri.includes(`/pending-media/${op.id}/`) ||
            file.size <= 0 ||
            file.size > photoLimits.inputBytes
          )
            throw new Error(
              "Nieprawidłowy plik lub zdjęcie przekracza limit 25 MB.",
            );
          const blob = await this.readFile(file.uri);
          if (!blob.size || blob.size > photoLimits.inputBytes)
            throw new Error(
              "Nieprawidłowy plik lub zdjęcie przekracza limit 25 MB.",
            );
          files.push(new File([blob], file.name, { type: file.mime }));
        }
        return { operation: op, files };
      })();
      this.loading.set(op.id, load);
      void load.catch(() => this.loading.delete(op.id));
    }
    return load;
  }
  async accept(candidate: MediaOperation) {
    // Reject stale/replayed/mismatched events against native storage, not current UI.
    const { operation: op } = await this.port.readPending();
    if (!op || op.id !== candidate?.id || this.delivered.has(op.id)) return;
    try {
      this.validate(op);
      if (op.status === "launching") {
        if (!this.waiting.has(op.id)) {
          this.interrupted = op;
          this.changed();
        }
        return;
      }
      this.interrupted = null;
      if (op.status === "cancelled") {
        await this.finish(op.id);
        this.waiting.get(op.id)?.resolve(null);
        this.waiting.delete(op.id);
        return;
      }
      if (op.status === "error")
        throw new Error(
          op.message ||
            "Nie udało się wybrać zdjęć. Sprawdź uprawnienia aparatu i pamięć urządzenia.",
        );
      if (op.status !== "ready")
        throw new Error("Nieprawidłowy status wyboru zdjęcia.");
      const selection = await this.hydrate(op);
      this.error = "";
      if (this.delivered.has(op.id)) return;
      this.delivered.add(op.id);
      const pending = this.waiting.get(op.id);
      if (pending) {
        this.waiting.delete(op.id);
        pending.resolve(selection);
      } else {
        this.recovery = selection;
        this.changed();
      }
    } catch (cause) {
      const error =
        cause instanceof Error
          ? cause
          : new Error("Nie udało się odzyskać zdjęcia.");
      const pending = this.waiting.get(op.id);
      this.waiting.delete(op.id);
      if (op.status !== "ready") await this.finish(op.id).catch(() => {});
      else {
        this.interrupted = op;
        this.error = error.message;
        this.changed();
      }
      if (pending) pending.reject(error);
      else {
        this.error = error.message;
        this.changed();
      }
    }
  }
  async select(
    source: MediaOperation["source"],
    scope: PhotoScope,
    category: PhotoCategory,
  ): Promise<MediaSelection | null> {
    const operation: MediaOperation = {
      id: crypto.randomUUID(),
      source,
      scope: { ...scope },
      category,
      startedAt: this.clock(),
    };
    this.error = "";
    this.changed();
    return new Promise((resolve, reject) => {
      this.waiting.set(operation.id, { resolve, reject });
      void this.port
        .acquire({ operation })
        .then((result) => this.accept(result))
        .catch((cause) => {
          const waiting = this.waiting.get(operation.id);
          if (waiting) {
            this.waiting.delete(operation.id);
            waiting.reject(
              new Error(
                `Nie udało się wybrać zdjęć: ${(cause as Error).message}`,
              ),
            );
          }
        });
    });
  }
  async restore(event?: {
    pluginId: string;
    methodName: string;
    success: boolean;
    data?: unknown;
    error?: unknown;
  }) {
    if (
      event &&
      (event.pluginId !== "GardenCamera" || event.methodName !== "acquire")
    )
      return;
    // Even a failed bridge delivery can have a durable ready result. Trust only that record.
    const { operation } = await this.port.readPending();
    if (event?.data && typeof event.data === "object" && "id" in event.data && event.data.id !== operation?.id) return;
    if (operation) await this.accept(operation);
  }
  returnToRecovery(selection: MediaSelection) {
    this.recovery = selection;
    this.changed();
  }
  async finish(id: string) {
    await this.port.acknowledge({ id });
    this.loading.delete(id);
    this.delivered.add(id);
    if (this.recovery?.operation.id === id) this.recovery = null;
    if (this.interrupted?.id === id) {
      this.interrupted = null;
      this.error = "";
    }
    this.changed();
  }
  dismissError() {
    this.error = "";
    this.changed();
  }
}
export const cameraCoordinator = new CameraCoordinator(gardenCamera);
export const selectPhotos = (
  source: MediaOperation["source"],
  scope: PhotoScope,
  category: PhotoCategory = "other",
) => cameraCoordinator.select(source, scope, category);
