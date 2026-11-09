import { registerPlugin } from "@capacitor/core";
import { isAndroid } from "./files";

const native = registerPlugin<{
  readNavigation(): Promise<{ address?: string }>;
  saveNavigation(options: { address: string }): Promise<void>;
}>("GardenFiles");
export const validNativeAddress = (address: unknown): address is string =>
  typeof address === "string" &&
  address.startsWith("#") &&
  address.length <= 16000 &&
  !/[\u0000-\u001f]/.test(address);
/** UI bookmark only. No user records, drafts or business commands. */
export async function restoreNativeNavigation() {
  if (!isAndroid() || location.hash) return;
  try {
    const { address } = await native.readNavigation();
    if (validNativeAddress(address)) history.replaceState(null, "", address);
  } catch {
    /* A missing UI bookmark must never prevent opening the data. */
  }
}
export async function saveNativeNavigation(address: string) {
  if (isAndroid() && validNativeAddress(address))
    await native.saveNavigation({ address });
}
