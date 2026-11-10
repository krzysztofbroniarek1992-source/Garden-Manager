import { contextBridge, ipcRenderer } from "electron";
import type { DesktopBridge } from "./contracts.js" with { "resolution-mode": "import" };
const bridge: DesktopBridge = {
  platform: "windows",
  security: {
    sandboxed: process.sandboxed === true,
    isolated: process.contextIsolated === true,
  },
  beginSave: (o) => ipcRenderer.invoke("gm:save-begin", o),
  write: (o) => ipcRenderer.invoke("gm:save-write", o),
  finish: (o) => ipcRenderer.invoke("gm:save-finish", o),
  abort: (o) => ipcRenderer.invoke("gm:save-abort", o),
  pick: (o) => ipcRenderer.invoke("gm:pick", o),
  read: (o) => ipcRenderer.invoke("gm:read", o),
  release: (o) => ipcRenderer.invoke("gm:release", o),
  readNavigation: () => ipcRenderer.invoke("gm:navigation-read"),
  saveNavigation: (o) => ipcRenderer.invoke("gm:navigation-save", o),
  onHistoryRequested: (callback) => {
    const listener = (
      _e: Electron.IpcRendererEvent,
      direction: "back" | "forward",
    ) => {
      if (direction === "back" || direction === "forward") callback(direction);
    };
    ipcRenderer.on("gm:history-request", listener);
    return () => ipcRenderer.removeListener("gm:history-request", listener);
  },
  onCloseRequested: (callback) => {
    const listener = (
      _e: Electron.IpcRendererEvent,
      request: { id: string; action: "close" | "reload" },
    ) => callback(request);
    ipcRenderer.on("gm:close-request", listener);
    return () => ipcRenderer.removeListener("gm:close-request", listener);
  },
  replyClose: (o) => ipcRenderer.send("gm:close-reply", o),
};
contextBridge.exposeInMainWorld("gardenDesktop", Object.freeze(bridge));
