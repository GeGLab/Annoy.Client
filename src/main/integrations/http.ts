import { session, type IpcMain } from "electron";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

/**
 * The transport of store integrations in the app (DMs): the call leaves this
 * computer, from its own in-memory session (no cookies, no cache, never the
 * VPN routes). Public HTTPS only, no redirects, bounded answers.
 */
const blocked = new BlockList();
for (const [net, bits] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 3]] as const) blocked.addSubnet(net, bits, "ipv4");
for (const [net, bits] of [["::", 127], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["64:ff9b::", 96], ["::ffff:0:0", 96]] as const) blocked.addSubnet(net, bits, "ipv6");

const HEADERS = new Set(["content-type", "authorization", "user-agent", "x-annoy-integration"]);
const MAX_BYTES = 40 * 1024 * 1024;
const MAX_BODY = 32 * 1024 * 1024;

export interface IntegrationRequest {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
  maxBytes: number;
  timeoutMs: number;
}
export type IntegrationResponse = { ok: true; status: number; type: string; body: Uint8Array } | { ok: false };

function publicUrl(value: unknown): URL | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return null;
  if (!host.includes(".") || isIP(host) || host.startsWith("[") || /(^|\.)(localhost|local|internal|lan|home|test|invalid|onion)$/.test(host)) return null;
  return url;
}

async function request(input: IntegrationRequest): Promise<IntegrationResponse> {
  const url = publicUrl(input?.url);
  if (!url || (input.method !== "GET" && input.method !== "POST")) return { ok: false };
  if (input.body !== undefined && (typeof input.body !== "string" || input.body.length > MAX_BODY)) return { ok: false };
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.headers ?? {})) {
    if (HEADERS.has(name.toLowerCase()) && typeof value === "string" && value.length <= 4096 && !/[\r\n]/.test(value)) headers[name.toLowerCase()] = value;
  }
  const maxBytes = Math.min(MAX_BYTES, Math.max(1, Number(input.maxBytes) || 0));
  const timeout = Math.min(180_000, Math.max(1000, Number(input.timeoutMs) || 0));
  try {
    const addresses = await lookup(url.hostname, { all: true });
    if (!addresses.length || addresses.some((a) => blocked.check(a.address, a.family === 6 ? "ipv6" : "ipv4"))) return { ok: false };
    const res = await session.fromPartition("annoy-integrations", { cache: false }).fetch(url.href, {
      method: input.method, headers, body: input.method === "POST" ? input.body : undefined,
      cache: "no-store", credentials: "omit", redirect: "error", bypassCustomProtocolHandlers: true, signal: AbortSignal.timeout(timeout),
    });
    if (Number(res.headers.get("content-length") ?? 0) > maxBytes) return { ok: false };
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = res.body?.getReader();
    for (;;) {
      const part = await reader?.read();
      if (!part || part.done) break;
      size += part.value.length;
      if (size > maxBytes) {
        await reader?.cancel().catch(() => undefined);
        return { ok: false };
      }
      chunks.push(part.value);
    }
    return { ok: true, status: res.status, type: res.headers.get("content-type") ?? "", body: Buffer.concat(chunks) };
  } catch {
    return { ok: false };
  }
}

export function registerIntegrationHttp(ipcMain: IpcMain, authorized: (event: Electron.IpcMainInvokeEvent) => boolean): void {
  ipcMain.handle("integrations:request", (event, input: IntegrationRequest) => (authorized(event) ? request(input) : { ok: false }));
}
