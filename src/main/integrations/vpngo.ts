import { session, type BrowserWindow, type IpcMain } from "electron";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * VPNGo integration: connections to chosen annoy-servers go through a VPNGo
 * profile instead of the usual network. `vpngo proxy start <profile>` gives a
 * SOCKS5 listener on loopback for that WireGuard profile; a PAC script sends
 * only the chosen hosts to it. A host with a route never falls back to the
 * usual network: when its proxy is down the connection fails.
 */
export interface VpngoStatus {
  installed: boolean;
  version: string | null;
  profiles: string[];
  /** Why `vpngo proxy` can't run (missing Mihomo, old vpngo…), in vpngo's own words. */
  problem: string | null;
}
export interface VpngoRoutes {
  /** host[:port] of an annoy-server → profile */
  routes: Record<string, string>;
  /** Hosts whose voice call is active: WebRTC may only use the proxy while one is set. */
  voiceHost: string | null;
}
export interface VpngoApplied {
  /** Hosts that go through a running proxy. */
  active: string[];
  /** Hosts with a route whose proxy did not start; their connections fail instead of leaking. */
  failed: Record<string, string>;
}

const PROFILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const HOST = /^[a-z0-9.-]{1,253}(:\d{1,5})?$/;
const SESSIONS = ["annoy-native-api"];

function command(): string | null {
  const name = process.platform === "win32" ? "vpngo.cmd" : "vpngo";
  const candidates = [process.env.VPNGO_BIN, join(homedir(), process.platform === "win32" ? "bin" : ".local/bin", name), `/usr/bin/${name}`, `/usr/local/bin/${name}`, `/opt/homebrew/bin/${name}`];
  return candidates.find((path): path is string => !!path && existsSync(path)) ?? null;
}

function run(args: string[], timeout = 30_000): Promise<{ code: number; stdout: string; stderr: string }> {
  const bin = command();
  if (!bin) return Promise.resolve({ code: 127, stdout: "", stderr: "" });
  return new Promise((resolve) => {
    execFile(bin, args, { encoding: "utf8", timeout, maxBuffer: 1024 * 1024, windowsHide: true, shell: process.platform === "win32" }, (error, stdout, stderr) =>
      resolve({ code: error ? (typeof (error as { code?: unknown }).code === "number" ? ((error as { code: number }).code) : 1) : 0, stdout, stderr }),
    );
  });
}

const firstLine = (text: string) => text.trim().split("\n").filter(Boolean).at(-1)?.slice(0, 300) ?? null;

export async function vpngoStatus(): Promise<VpngoStatus> {
  if (!command()) return { installed: false, version: null, profiles: [], problem: null };
  const res = await run(["proxy", "list", "--json"], 10_000);
  try {
    const data = JSON.parse(res.stdout) as { version?: unknown; profiles?: unknown; problem?: unknown };
    return {
      installed: true,
      version: typeof data.version === "string" ? data.version : null,
      profiles: Array.isArray(data.profiles) ? data.profiles.filter((p): p is string => typeof p === "string" && PROFILE.test(p)) : [],
      problem: typeof data.problem === "string" && data.problem ? data.problem.slice(0, 300) : null,
    };
  } catch {
    return { installed: true, version: null, profiles: [], problem: firstLine(res.stderr) ?? firstLine(res.stdout) ?? "vpngo proxy" };
  }
}

async function startProxy(profile: string): Promise<{ port: number } | { error: string }> {
  const res = await run(["proxy", "start", profile, "--json"], 60_000);
  try {
    const data = JSON.parse(res.stdout) as { port?: unknown; error?: unknown };
    if (Number.isInteger(data.port) && (data.port as number) > 0 && (data.port as number) < 65536) return { port: data.port as number };
    return { error: typeof data.error === "string" ? data.error.slice(0, 300) : (firstLine(res.stderr) ?? "vpngo proxy start") };
  } catch {
    return { error: firstLine(res.stderr) ?? firstLine(res.stdout) ?? "vpngo proxy start" };
  }
}

const started = new Set<string>();
let applied: VpngoRoutes = { routes: {}, voiceHost: null };

function pac(table: Record<string, string>): string {
  // Hosts and proxies are validated values; JSON keeps them inert inside the script.
  return `var T=${JSON.stringify(table)};function FindProxyForURL(u,h){var p=/^[a-z]+:\\/\\/[^\\/]*?:(\\d+)(\\/|$)/.exec(u);var k=p?h+":"+p[1]:h;return T[k]||T[h]||"DIRECT";}`;
}

async function apply(input: VpngoRoutes, win: BrowserWindow | null): Promise<VpngoApplied> {
  const routes: Record<string, string> = {};
  for (const [host, profile] of Object.entries(input?.routes ?? {})) if (HOST.test(host) && typeof profile === "string" && PROFILE.test(profile)) routes[host] = profile;
  const ports = new Map<string, number | string>();
  for (const profile of new Set(Object.values(routes))) {
    const result = await startProxy(profile);
    ports.set(profile, "port" in result ? result.port : result.error);
    if ("port" in result) started.add(profile);
  }
  const table: Record<string, string> = {};
  const result: VpngoApplied = { active: [], failed: {} };
  for (const [host, profile] of Object.entries(routes)) {
    const port = ports.get(profile);
    if (typeof port === "number") {
      table[host] = `SOCKS5 127.0.0.1:${port}`;
      result.active.push(host);
    } else {
      // Nothing listens on port 9 of loopback: the connection fails, it does not go out without the VPN.
      table[host] = "SOCKS5 127.0.0.1:9";
      result.failed[host] = String(port ?? "");
    }
  }
  const config = Object.keys(table).length
    ? { mode: "pac_script" as const, pacScript: `data:application/x-ns-proxy-autoconfig;base64,${Buffer.from(pac(table)).toString("base64")}` }
    : { mode: "system" as const };
  for (const target of [session.defaultSession, ...SESSIONS.map((name) => session.fromPartition(name, { cache: false }))]) {
    await target.setProxy(config);
    await target.closeAllConnections();
  }
  const voiceHost = typeof input?.voiceHost === "string" && routes[input.voiceHost] ? input.voiceHost : null;
  // With a routed call active, WebRTC may only use the proxy (TCP): no UDP leaves outside the VPN.
  win?.webContents.setWebRTCIPHandlingPolicy(voiceHost ? "disable_non_proxied_udp" : "default");
  for (const profile of [...started]) {
    if (Object.values(routes).includes(profile)) continue;
    started.delete(profile);
    void run(["proxy", "stop", profile], 15_000);
  }
  applied = { routes, voiceHost };
  return result;
}

export function registerVpngo(ipcMain: IpcMain, authorized: (event: Electron.IpcMainInvokeEvent) => boolean, window: () => BrowserWindow | null): () => void {
  let queue: Promise<unknown> = Promise.resolve();
  ipcMain.handle("vpngo:status", (event) => (authorized(event) ? vpngoStatus() : { installed: false, version: null, profiles: [], problem: null }));
  ipcMain.handle("vpngo:apply", (event, input: VpngoRoutes) => {
    if (!authorized(event)) return { active: [], failed: {} };
    const next = queue.then(() => apply(input, window()));
    queue = next.catch(() => undefined);
    return next;
  });
  ipcMain.handle("vpngo:voice", (event, host: unknown) => {
    if (!authorized(event)) return false;
    const voiceHost = typeof host === "string" && applied.routes[host] ? host : null;
    applied = { ...applied, voiceHost };
    window()?.webContents.setWebRTCIPHandlingPolicy(voiceHost ? "disable_non_proxied_udp" : "default");
    return !!voiceHost;
  });
  // The proxies this app started end with the app.
  return () => {
    for (const profile of started) void run(["proxy", "stop", profile], 5000);
    started.clear();
  };
}
