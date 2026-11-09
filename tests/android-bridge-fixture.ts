import type { Page } from "@playwright/test";
import { fieldData } from "./field-fixture";
/** Simulates the JS/native contract only. No Android hardware claims. */
export async function mockAndroid(page: Page, data = fieldData()) {
  await page.addInitScript((data) => {
    const win = window as any;
    if (!localStorage.getItem("garden-manager:v1"))
      localStorage.setItem(
        "garden-manager:v1",
        JSON.stringify({ version: 10, data }),
      );
    win.androidBridge = {};
    win.gmNative = {
      listeners: {},
      files: {},
      calls: [],
      failOpen: false,
      cancelCamera: false,
      deniedCamera: false,
      cancelledSave: false,
      minimized: 0,
    };
    const state = win.gmNative;
    win.Capacitor = {
      PluginHeaders: [
        {
          name: "App",
          methods: ["minimizeApp", "removeListener"]
            .map((name) => ({ name, rtype: "promise" }))
            .concat([{ name: "addListener", rtype: "callback" }]),
        },
        {
          name: "GardenFiles",
          methods: [
            "begin",
            "append",
            "finish",
            "discard",
            "pickBackup",
            "readNavigation",
            "saveNavigation",
            "releasePhoto",
          ].map((name) => ({ name, rtype: "promise" })),
        },
        {
          name: "Camera",
          methods: ["getPhoto", "pickImages"].map((name) => ({
            name,
            rtype: "promise",
          })),
        },
      ],
      convertFileSrc: (uri: string) => uri,
      nativeCallback: (
        _plugin: string,
        _method: string,
        args: any,
        callback: any,
      ) => {
        const id = crypto.randomUUID();
        state.listeners[id] = { event: args.eventName, callback };
        return Promise.resolve(id);
      },
      nativePromise: async (plugin: string, method: string, args: any) => {
        state.calls.push({ plugin, method, args });
        if (plugin === "App") {
          if (method === "minimizeApp") state.minimized++;
          if (method === "removeListener")
            delete state.listeners[args.callbackId];
          return {};
        }
        if (plugin === "Camera") {
          if (state.deniedCamera) throw new Error("Camera permission denied");
          if (state.cancelCamera) throw new Error("User cancelled photos app");
          return method === "getPhoto"
            ? { webPath: "/src/reports/fixtures/garden.jpg" }
            : { photos: [{ webPath: "/src/reports/fixtures/garden.jpg" }] };
        }
        if (method === "readNavigation")
          return {
            address: sessionStorage.getItem("mock-native-bookmark") || "",
          };
        if (method === "saveNavigation") {
          sessionStorage.setItem("mock-native-bookmark", args.address);
          return {};
        }
        if (method === "begin") {
          const token = crypto.randomUUID();
          state.files[token] = { ...args, chunks: [] };
          return { token };
        }
        if (method === "append") {
          state.files[args.token].chunks.push(args);
          return {};
        }
        if (method === "finish") {
          if (args.action === "open" && state.failOpen)
            throw new Error("Brak aplikacji do otwarcia PDF");
          state.lastFile = state.files[args.token];
          state.lastFile.action = args.action;
          return { cancelled: args.action === "save" && state.cancelledSave };
        }
        if (method === "discard") {
          delete state.files[args.token];
          return {};
        }
        if (method === "pickBackup")
          return state.backupURI
            ? { uri: state.backupURI, name: "kopia.zip", token: "picked" }
            : { cancelled: true };
        throw new Error("Unexpected bridge operation: " + method);
      },
    };
    win.gmEmit = (event: string, data: unknown = {}) =>
      Object.values(state.listeners).forEach((l: any) => {
        if (l.event === event) l.callback(data);
      });
  }, data);
}
export async function androidBack(page: Page) {
  await page.waitForFunction(() =>
    Object.values((window as any).gmNative.listeners).some(
      (l: any) => l.event === "backButton",
    ),
  );
  await page.evaluate(() => (window as any).gmEmit("backButton"));
}
