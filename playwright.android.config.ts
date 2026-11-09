import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
const executablePath =
  process.env.CHROMIUM_PATH ||
  (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
/** Packaged-asset simulation; deliberately has no HTTP/Vite server. Not an APK/device test. */
export default defineConfig({
  testDir: "./android-web-tests",
  workers: 1,
  timeout: 45_000,
  outputDir: "test-results-android",
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4197",
    serviceWorkers: "block",
    launchOptions: { executablePath },
  },
});
