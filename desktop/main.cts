import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  protocol,
  screen,
  session,
  shell,
  type IpcMainInvokeEvent,
} from "electron";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  fileError,
  APP_ID,
  ORIGIN,
  CHUNK,
  MAX_FILE,
  CSP,
  appUrl,
  entryUrl,
  assetPath,
  inside,
  payload,
  text,
  integer,
  saveOptions,
  bookmark,
  windowBounds,
  type Rect,
} from "./policy.cjs";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      codeCache: true,
    },
  },
]);
app.setName("Garden Manager");
app.setAppUserModelId(APP_ID);
const testProfile =
  process.env.GM_DESKTOP_TEST === "1"
    ? process.env.GM_DESKTOP_TEST_PROFILE
    : undefined;
if (testProfile && !path.isAbsolute(testProfile))
  throw new Error("Profil testowy wymaga ścieżki absolutnej.");
app.setPath(
  "userData",
  testProfile ?? path.join(app.getPath("appData"), "GardenManager"),
);
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let win: BrowserWindow | null = null,
    approved = false,
    request: { id: string; action: "close" | "reload" } | null = null;
  const uiFile = path.join(app.getPath("userData"), "desktop-window.json");
  let ui: { bounds?: Rect; maximized?: boolean; address?: string } = {};
  try {
    const raw = fs.readFileSync(uiFile, "utf8");
    if (raw.length < 32768) {
      const candidate = JSON.parse(raw);
      if (
        candidate &&
        typeof candidate === "object" &&
        !Array.isArray(candidate)
      )
        ui = candidate;
    }
  } catch {
    /* Missing UI preferences do not alter business data. */
  }
  function saveUI() {
    try {
      fs.mkdirSync(path.dirname(uiFile), { recursive: true });
      const tmp = uiFile + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(ui), "utf8");
      fs.renameSync(tmp, uiFile);
    } catch {
      /* Window geometry is expendable; IndexedDB is independent. */
    }
  }
  type Write = {
    handle: fsp.FileHandle;
    temporary: string;
    destination: string;
    size: number;
    offset: number;
    busy: boolean;
    mime: string;
  };
  const writes = new Map<string, Write>(),
    reads = new Map<string, { handle: fsp.FileHandle; size: number }>();
  let dialogBusy = false;
  function authorize(event: Electron.IpcMainEvent | IpcMainInvokeEvent) {
    if (
      !win ||
      event.sender !== win.webContents ||
      event.senderFrame !== win.webContents.mainFrame ||
      !event.senderFrame ||
      !entryUrl(event.senderFrame.url)
    )
      throw new Error("Niedozwolone źródło żądania.");
  }
  function ipc(channel: string, handler: (arg: unknown) => unknown) {
    ipcMain.handle(channel, async (e, arg) => {
      try {
        authorize(e);
        return await handler(arg);
      } catch (error) {
        throw new Error(fileError(error));
      }
    });
  }
  async function nativeDialog<T>(action: () => Promise<T>) {
    if (dialogBusy || writes.size + reads.size >= 4)
      throw new Error("Dokończ poprzednią operację pliku.");
    dialogBusy = true;
    try {
      return await action();
    } finally {
      dialogBusy = false;
    }
  }
  async function abort(token: string) {
    const w = writes.get(token);
    if (!w) return;
    writes.delete(token);
    await w.handle.close().catch(() => {});
    await fsp.unlink(w.temporary).catch(() => {});
  }
  async function release(token: string) {
    const r = reads.get(token);
    if (r) {
      reads.delete(token);
      await r.handle.close();
    }
  }
  function requestExit(action: "close" | "reload") {
    if (!win || request) return;
    if (writes.size || dialogBusy) {
      void dialog.showMessageBox(win, {
        type: "info",
        message: "Trwa operacja pliku. Poczekaj na jej zakończenie.",
        buttons: ["OK"],
      });
      return;
    }
    request = { id: randomUUID(), action };
    win.webContents.send("gm:close-request", request);
    const id = request.id;
    setTimeout(() => {
      if (request?.id === id) request = null;
    }, 15000).unref();
  }
  ipc("gm:save-begin", async (arg) => {
    const o = saveOptions(arg);
    return nativeDialog(async () => {
      const chosen = await dialog.showSaveDialog(win!, {
        title: "Zapisz jako…",
        defaultPath: o.name,
        filters: [{ name: o.ext.toUpperCase(), extensions: [o.ext] }],
      });
      if (chosen.canceled || !chosen.filePath) return { cancelled: true };
      const destination = chosen.filePath;
      if (path.extname(destination).toLowerCase() !== "." + o.ext)
        throw new Error("Wybrana nazwa ma niewłaściwe rozszerzenie.");
      const token = randomUUID(),
        temporary = path.join(
          path.dirname(destination),
          `.garden-manager-${token}.tmp`,
        ),
        handle = await fsp.open(temporary, "wx", 0o600);
      writes.set(token, {
        handle,
        temporary,
        destination,
        size: o.size,
        offset: 0,
        busy: false,
        mime: o.mime,
      });
      return { token };
    });
  });
  ipc("gm:save-write", async (arg) => {
    payload(arg, ["token", "offset", "bytes"]);
    text(arg.token, 100);
    const w = writes.get(arg.token);
    if (!w || w.busy)
      throw new Error("Eksport wygasł lub trwa zapis poprzedniego fragmentu.");
    const offset = integer(arg.offset, MAX_FILE);
    if (
      !(arg.bytes instanceof Uint8Array) ||
      arg.bytes.length > CHUNK ||
      !arg.bytes.length ||
      offset !== w.offset ||
      offset + arg.bytes.length > w.size
    )
      throw new Error("Nieprawidłowy fragment eksportu.");
    // Reserve the offset synchronously before the first await; replayed chunks cannot race.
    w.busy = true;
    w.offset += arg.bytes.length;
    try {
      let done = 0;
      while (done < arg.bytes.length) {
        const r = await w.handle.write(
          arg.bytes,
          done,
          arg.bytes.length - done,
          offset + done,
        );
        if (!r.bytesWritten) throw new Error("Niepełny zapis pliku.");
        done += r.bytesWritten;
      }
    } catch (error) {
      await abort(arg.token);
      throw error;
    } finally {
      w.busy = false;
    }
  });
  ipc("gm:save-finish", async (arg) => {
    payload(arg, ["token", "open"]);
    text(arg.token, 100);
    if (typeof arg.open !== "boolean")
      throw new Error("Nieprawidłowa akcja pliku.");
    const w = writes.get(arg.token);
    if (!w || w.busy || w.offset !== w.size)
      throw new Error("Eksport nie jest kompletny.");
    if (arg.open && w.mime !== "application/pdf")
      throw new Error("Otwieranie dotyczy wyłącznie PDF.");
    w.busy = true;
    try {
      if ((await w.handle.stat()).size !== w.size)
        throw new Error("Niepełny zapis eksportu.");
      await w.handle.sync();
      await w.handle.close();
      await fsp.rename(w.temporary, w.destination);
      writes.delete(arg.token);
    } catch (error) {
      await abort(arg.token);
      throw error;
    }
    if (arg.open) {
      const error = await shell.openPath(w.destination);
      if (error)
        throw new Error(
          "Plik zapisano, ale system nie otworzył czytnika PDF: " + error,
        );
    }
  });
  ipc("gm:save-abort", async (arg) => {
    payload(arg, ["token"]);
    text(arg.token, 100);
    await abort(arg.token);
  });
  ipc("gm:pick", async (arg) => {
    payload(arg, ["kind"]);
    if (arg.kind !== "csv" && arg.kind !== "zip")
      throw new Error("Nieobsługiwany typ importu.");
    const kind = arg.kind;
    return nativeDialog(async () => {
      const chosen = await dialog.showOpenDialog(win!, {
        title:
          kind === "csv" ? "Wybierz wyciąg CSV" : "Wybierz pełną kopię ZIP",
        properties: ["openFile"],
        filters: [
          {
            name: kind.toUpperCase(),
            extensions: kind === "csv" ? ["csv", "txt"] : ["zip"],
          },
        ],
      });
      if (chosen.canceled || chosen.filePaths.length !== 1)
        return { cancelled: true };
      const handle = await fsp.open(chosen.filePaths[0], "r");
      try {
        const stat = await handle.stat();
        if (
          !stat.isFile() ||
          !stat.size ||
          stat.size > (kind === "csv" ? 5 * 1024 * 1024 : MAX_FILE)
        )
          throw new Error(
            kind === "csv"
              ? "Wybierz niepusty CSV do 5 MB."
              : "Wybierz niepusty ZIP do 200 MB.",
          );
        const token = randomUUID();
        reads.set(token, { handle, size: stat.size });
        return {
          token,
          name: path.basename(chosen.filePaths[0]),
          size: stat.size,
        };
      } catch (e) {
        await handle.close();
        throw e;
      }
    });
  });
  ipc("gm:read", async (arg) => {
    payload(arg, ["token", "offset", "size"]);
    text(arg.token, 100);
    const r = reads.get(arg.token);
    if (!r) throw new Error("Import wygasł.");
    const offset = integer(arg.offset, r.size),
      size = integer(arg.size, CHUNK);
    if (!size || offset + size > r.size)
      throw new Error("Nieprawidłowy fragment importu.");
    const bytes = Buffer.alloc(size);
    const result = await r.handle.read(bytes, 0, size, offset);
    if (result.bytesRead !== size)
      throw new Error("Plik zmienił się podczas odczytu. Wybierz go ponownie.");
    return new Uint8Array(bytes);
  });
  ipc("gm:release", async (arg) => {
    payload(arg, ["token"]);
    text(arg.token, 100);
    await release(arg.token);
  });
  ipc("gm:navigation-read", () => ({
    address: typeof ui.address === "string" ? ui.address : "",
  }));
  ipc("gm:navigation-save", (arg) => {
    payload(arg, ["address"]);
    bookmark(arg.address);
    ui.address = arg.address;
    saveUI();
  });
  ipcMain.on("gm:close-reply", (event, arg: unknown) => {
    try {
      authorize(event);
      payload(arg, ["id", "allow"]);
      if (!request || arg.id !== request.id || typeof arg.allow !== "boolean")
        return;
      const action = request.action;
      request = null;
      if (!arg.allow) return;
      approved = true;
      if (action === "reload") win?.webContents.reload();
      else win?.close();
    } catch {
      /* Invalid/untrusted replies never close a window. */
    }
  });
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
  app
    .whenReady()
    .then(async () => {
      const assets = fs.realpathSync(
        path.join(app.getAppPath(), "dist-windows"),
      );
      const ses = session.defaultSession;
      ses.setPermissionRequestHandler((wc, permission, callback) =>
        callback(
          wc === win?.webContents &&
            entryUrl(wc.getURL()) &&
            permission === "clipboard-sanitized-write",
        ),
      );
      ses.setPermissionCheckHandler(
        (_wc, permission, origin) =>
          appUrl(origin) && permission === "clipboard-sanitized-write",
      );
      ses.webRequest.onBeforeRequest((details, callback) =>
        callback({
          cancel:
            !appUrl(details.url) &&
            !details.url.startsWith("blob:app://garden-manager/"),
        }),
      );
      ses.on("will-download", (event) => event.preventDefault());
      protocol.handle("app", async (request) => {
        try {
          if (!["GET", "HEAD"].includes(request.method))
            return new Response(null, { status: 405 });
          const target = fs.realpathSync(assetPath(request.url, assets));
          if (!inside(assets, target) || !fs.statSync(target).isFile())
            return new Response(null, { status: 404 });
          const ext = path.extname(target).toLowerCase(),
            mime: Record<string, string> = {
              ".html": "text/html; charset=utf-8",
              ".js": "text/javascript; charset=utf-8",
              ".css": "text/css; charset=utf-8",
              ".json": "application/json",
              ".png": "image/png",
              ".svg": "image/svg+xml",
              ".jpg": "image/jpeg",
              ".woff2": "font/woff2",
              ".ttf": "font/ttf",
              ".ico": "image/x-icon",
            };
          return new Response(
            request.method === "HEAD"
              ? null
              : new Uint8Array(await fsp.readFile(target)),
            {
              headers: {
                "Content-Type": mime[ext] ?? "application/octet-stream",
                "Content-Security-Policy": CSP,
                "X-Content-Type-Options": "nosniff",
                "Cross-Origin-Resource-Policy": "same-origin",
                "Cache-Control": "no-cache",
              },
            },
          );
        } catch {
          return new Response(null, { status: 404 });
        }
      });
      const areas = screen.getAllDisplays().map((d) => d.workArea),
        bounds = windowBounds(ui.bounds, [
          screen.getPrimaryDisplay().workArea,
          ...areas,
        ]);
      win = new BrowserWindow({
        ...bounds,
        minWidth: 360,
        minHeight: Math.min(480, bounds.height),
        show: false,
        title: "Garden Manager",
        icon: path.join(__dirname, "../assets/icon.png"),
        backgroundColor: "#f6f7f5",
        webPreferences: {
          preload: path.join(__dirname, "preload.cjs"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true,
          allowRunningInsecureContent: false,
          plugins: true,
          webviewTag: false,
          devTools: !app.isPackaged,
        },
      });
      win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      win.webContents.on("will-navigate", (event, url) => {
        if (!entryUrl(url)) event.preventDefault();
      });
      win.webContents.on("will-redirect", (event, url) => {
        if (!entryUrl(url)) event.preventDefault();
      });
      win.webContents.on("will-attach-webview", (event) =>
        event.preventDefault(),
      );
      win.webContents.on("will-prevent-unload", (event) => {
        if (approved) event.preventDefault();
      });
      win.webContents.on("did-finish-load", () => {
        approved = false;
      });
      win.once("ready-to-show", () => {
        if (ui.maximized) win?.maximize();
        win?.show();
      });
      win.on("close", (event) => {
        if (!approved) {
          event.preventDefault();
          requestExit("close");
          return;
        }
        if (win) {
          ui.bounds = win.getNormalBounds();
          ui.maximized = win.isMaximized();
          saveUI();
        }
      });
      win.on("query-session-end", (event) => {
        event.preventDefault();
        requestExit("close");
      });
      win.on("closed", () => {
        win = null;
        for (const token of writes.keys()) void abort(token);
        for (const token of reads.keys()) void release(token);
      });
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          {
            label: "Plik",
            submenu: [
              {
                label: "Odśwież widok",
                accelerator: "CmdOrCtrl+R",
                click: () => requestExit("reload"),
              },
              {
                label: "Odśwież",
                accelerator: "F5",
                visible: false,
                click: () => requestExit("reload"),
              },
              { type: "separator" },
              {
                label: "Zamknij",
                accelerator: "Alt+F4",
                click: () => requestExit("close"),
              },
            ],
          },
          {
            label: "Edycja",
            submenu: [
              { role: "undo", label: "Cofnij" },
              { role: "redo", label: "Ponów" },
              { type: "separator" },
              { role: "cut", label: "Wytnij" },
              { role: "copy", label: "Kopiuj" },
              { role: "paste", label: "Wklej" },
              { role: "selectAll", label: "Zaznacz wszystko" },
            ],
          },
          {
            label: "Widok",
            submenu: [
              { role: "resetZoom", label: "Skala 100%" },
              { role: "zoomIn", label: "Powiększ" },
              { role: "zoomOut", label: "Pomniejsz" },
              { role: "togglefullscreen", label: "Pełny ekran" },
            ],
          },
        ]),
      );
      await win.loadURL(ORIGIN);
    })
    .catch((error) => {
      dialog.showErrorBox("Garden Manager — błąd uruchomienia", String(error));
      app.exit(1);
    });
  app.on("window-all-closed", () => app.quit());
}
