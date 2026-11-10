import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./desktop-tests",
  testMatch: process.env.GM_UPGRADE_PHASE ? "upgrade.spec.ts" : "app.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  reporter: "list",
  outputDir: "test-results-desktop",
  use: { trace: "retain-on-failure", screenshot: "only-on-failure" },
});
