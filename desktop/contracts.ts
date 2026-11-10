/** Closed capability surface; paths and ipcRenderer never cross into the page. */
export type DesktopKind = "zip" | "csv";
export type DesktopMime =
  | "application/pdf"
  | "application/json"
  | "application/zip";
export interface DesktopBridge {
  readonly platform: "windows";
  readonly security: { sandboxed: boolean; isolated: boolean };
  beginSave(options: {
    name: string;
    mime: DesktopMime;
    size: number;
  }): Promise<{ cancelled?: boolean; token?: string }>;
  write(options: {
    token: string;
    offset: number;
    bytes: Uint8Array;
  }): Promise<void>;
  finish(options: { token: string; open: boolean }): Promise<void>;
  abort(options: { token: string }): Promise<void>;
  pick(options: { kind: DesktopKind }): Promise<{
    cancelled?: boolean;
    token?: string;
    name?: string;
    size?: number;
  }>;
  read(options: {
    token: string;
    offset: number;
    size: number;
  }): Promise<Uint8Array>;
  release(options: { token: string }): Promise<void>;
  readNavigation(): Promise<{ address?: string }>;
  saveNavigation(options: { address: string }): Promise<void>;
  onHistoryRequested(
    callback: (direction: "back" | "forward") => void,
  ): () => void;
  onCloseRequested(
    callback: (request: { id: string; action: "close" | "reload" }) => void,
  ): () => void;
  replyClose(options: { id: string; allow: boolean }): void;
}
declare global {
  interface Window {
    gardenDesktop?: DesktopBridge;
  }
}
