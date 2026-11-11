import { useSyncExternalStore } from "react";
import { reconnect } from "../../client.ts";
import { getState } from "../../store.ts";

/**
 * VPNGo routes: which annoy-server connections go through which VPNGo profile.
 * Kept on this computer only (profiles are local files of VPNGo). The main
 * process starts the proxies and sends only the chosen hosts through them.
 */
const KEY = "annoy.vpngoRoutes";
export type VpngoStatus = Awaited<ReturnType<NonNullable<Window["annoy"]>["vpngo"]["status"]>>;
interface RoutesState {
  routes: Record<string, string>;
  failed: Record<string, string>;
}

function saved(): Record<string, string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    if (!value || typeof value !== "object") return {};
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch {
    return {};
  }
}

let state: RoutesState = { routes: saved(), failed: {} };
const listeners = new Set<() => void>();
const set = (next: RoutesState) => {
  state = next;
  for (const listener of listeners) listener();
};
export const useVpngoRoutes = () => useSyncExternalStore((listener) => (listeners.add(listener), () => listeners.delete(listener)), () => state);

export const vpngoAvailable = () => !!window.annoy?.vpngo;
export const hostOf = (serverUrl: string): string | null => {
  try {
    return new URL(serverUrl).host.toLowerCase();
  } catch {
    return null;
  }
};
/** The profile an annoy-server connection uses, if any. */
export const vpngoProfileOf = (serverUrl: string): string | null => state.routes[hostOf(serverUrl) ?? ""] ?? null;

let voiceHost: string | null = null;

async function apply(routes: Record<string, string>, changed: string[]): Promise<void> {
  const bridge = window.annoy?.vpngo;
  if (!bridge) return;
  const result = await bridge.apply({ routes, voiceHost });
  set({ routes, failed: result.failed });
  // The connections of the hosts that changed are opened again, on the new path.
  for (const account of getState().accounts) if (changed.includes(hostOf(account.url) ?? "")) reconnect(account.id);
}

/** At start: bring the saved routes up before the first connection. */
export function initVpngoRoutes(): Promise<void> {
  if (!vpngoAvailable() || !Object.keys(state.routes).length) return Promise.resolve();
  return apply(state.routes, []).catch(() => undefined);
}

export function setVpngoRoute(host: string, profile: string | null): Promise<void> {
  const routes = { ...state.routes };
  if (profile) routes[host] = profile;
  else delete routes[host];
  try {
    localStorage.setItem(KEY, JSON.stringify(routes));
  } catch {
    /* kept for this run */
  }
  return apply(routes, [host]);
}

/** Disconnecting the VPNGo integration ends every route. */
export function clearVpngoRoutes(): Promise<void> {
  const hosts = Object.keys(state.routes);
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing saved */
  }
  return hosts.length ? apply({}, hosts) : Promise.resolve();
}

/** A voice call of a routed server may only use the VPN: tell the main process before it connects, and when it ends. */
export async function vpngoVoice(serverUrl: string | null): Promise<void> {
  const host = serverUrl ? hostOf(serverUrl) : null;
  voiceHost = host && state.routes[host] ? host : null;
  await window.annoy?.vpngo?.voice(voiceHost).catch(() => undefined);
}
