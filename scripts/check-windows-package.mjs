import { listPackage, extractFile } from "@electron/asar";
import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
const output = process.argv[2] || "release-windows",
  archive = path.join(output, "win-unpacked/resources/app.asar");
const files = listPackage(archive).map((s) => s.replaceAll("\\", "/"));
for (const file of [
  "/desktop/build/main.cjs",
  "/desktop/build/preload.cjs",
  "/dist-windows/index.html",
  "/dist-windows/fonts/DejaVuSans.ttf",
  "/desktop/assets/icon.ico",
])
  if (!files.includes(file)) throw Error("Missing packaged file: " + file);
if (files.some((f) => /\/sw\.js$|\/registerSW\.js$|\/workbox-/.test(f)))
  throw Error("Windows must not bundle the PWA updater");
const pkg = JSON.parse(extractFile(archive, "package.json").toString());
if (
  pkg.main !== "desktop/build/main.cjs" ||
  pkg.version !== (process.env.GM_WINDOWS_VERSION || "0.5.0-test.2")
)
  throw Error("Wrong application metadata");
const installer = (await readdir(output)).find((f) => f.endsWith(".exe"));
if (!installer) throw Error("No EXE installer");
const file = path.join(output, installer),
  sha256 = createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
const metadata = {
  product: "Garden Manager",
  version: pkg.version,
  applicationId: "pl.broniarek.gardenmanager.windows",
  origin: "app://garden-manager/",
  architecture: "x64",
  dataVersion: 11,
  electron: pkg.devDependencies?.electron || "45.2.3",
  installer,
  bytes: (await stat(file)).size,
  sha256,
  signing:
    "Unsigned test installer; Windows SmartScreen may display a warning.",
  sourceCommit: process.env.GITHUB_SHA || "local",
  profile: "%APPDATA%\\GardenManager",
  updates: "Manual installation, stable origin/profile, no online updater",
};
await writeFile(
  path.join(output, "WINDOWS-METADATA.json"),
  JSON.stringify(metadata, null, 2) + "\n",
);
await writeFile(
  path.join(output, "SHA256SUMS.txt"),
  sha256 + "  " + installer + "\n",
);
console.log(JSON.stringify(metadata, null, 2));
