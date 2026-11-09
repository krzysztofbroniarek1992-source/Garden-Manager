import type { CapacitorConfig } from "@capacitor/cli";

// Changing these identifiers/origin requires a separate user-data migration.
const config: CapacitorConfig = {
  appId: "pl.broniarek.gardenmanager",
  appName: "Garden Manager",
  webDir: "dist",
  server: { hostname: "localhost", androidScheme: "https" },
  android: { allowMixedContent: false },
};
export default config;
