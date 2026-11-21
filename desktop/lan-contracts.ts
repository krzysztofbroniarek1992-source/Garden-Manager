/** Native-only communication capabilities, deliberately unrelated to Data v12. */
export type LanKind = "json" | "binary";
export type LanSize = 1024 | 102400 | 1048576 | 10485760;
export interface LanPeer { id: string; name: string; fingerprint: string }
export interface LanResult {
  peerId: string; ok: boolean; bytes: number; kind: LanKind; sentSha256: string;
  receivedSha256: string; elapsedMs: number; at: number; error?: string;
}
export interface LanView {
  supported: boolean; platform: "windows" | "android" | "web";
  device?: LanPeer; active: boolean; connected?: LanPeer;
  interfaces: Array<{ address: string; name: string }>;
  endpoint?: { host: string; port: number };
  peers: LanPeer[]; discovered: Array<{ id: string; host: string; port: number }>;
  invitation?: { qr: string; text: string; expiresAt: number };
  pending?: LanPeer & { code: string; localConfirmed: boolean; remoteConfirmed: boolean };
  scannedInvitation?: string;
  result?: LanResult; busy: boolean; diagnostic: string;
}
export type LanCommand =
  | { action: "status" | "stop" | "invite" | "confirm" | "scan" | "copy" }
  | { action: "rename"; name: string }
  | { action: "start"; address: string }
  | { action: "pair"; invitation: string }
  | { action: "connect"; id: string; host: string; port: number }
  | { action: "forget"; id: string }
  | { action: "test"; bytes: LanSize; kind: LanKind };
export interface LanPort { command(options: LanCommand): Promise<LanView> }
