import { Capacitor, registerPlugin } from "@capacitor/core";
import type { LanPort } from "../../desktop/lan-contracts";
export type { LanView, LanCommand, LanPeer, LanResult, LanKind, LanSize } from "../../desktop/lan-contracts";
const android=registerPlugin<LanPort>("GardenLan");
export function lanPort():LanPort|null{
  if(window.gardenDesktop?.platform==="windows")return window.gardenDesktop.lan??null;
  return Capacitor.getPlatform()==="android"&&Capacitor.isPluginAvailable("GardenLan")?android:null;
}
