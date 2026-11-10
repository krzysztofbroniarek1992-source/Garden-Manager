import {isDesktop} from './desktop';
import { isAndroid, gardenFiles } from "./files";

export const validNativeAddress = (address: unknown): address is string =>
  typeof address === "string" &&
  address.startsWith("#") &&
  address.length <= 16000 &&
  !/[\u0000-\u001f]/.test(address);
/** UI bookmark only. No user records, drafts or business commands. */
export async function restoreNativeNavigation() {
  if ((!isAndroid()&&!isDesktop()) || location.hash) return;
  try {
    const { address } = await (isDesktop()?window.gardenDesktop!.readNavigation():gardenFiles.readNavigation());
    if (validNativeAddress(address)) history.replaceState(null, "", address);
  } catch {
    /* A missing UI bookmark must never prevent opening the data. */
  }
}
export async function saveNativeNavigation(address: string) {
  if(isDesktop()&&validNativeAddress(address)){await window.gardenDesktop!.saveNavigation({address});return;}
  if (isAndroid() && validNativeAddress(address))
    await gardenFiles.saveNavigation({ address });
}
