import { cleanSettings, parseStoreIntegration, type IntegrationSettings, type StoreIntegration } from "@annoy/protocol";
import { useSyncExternalStore } from "react";
import { unlockedKeys } from "../../auth/session.ts";
import { b64url, fromB64url } from "../../global-crypto.ts";
import { cloud, CloudError, currentCloudUrls } from "../../social/cloud.ts";

/**
 * The store catalog (devannoy, public) and what this Annoy account connected.
 * The account's part (API keys, settings, which DMs use what) is encrypted
 * here with a key derived from the account's vault key: devannoy keeps bytes
 * it can't open, and every install of the account reads the same data.
 */
export interface Connected {
  key: string | null;
  settings: IntegrationSettings;
  connectedAt: string;
}
/** One integration in one DM: who added it (Annoy ID) and whether the other person accepted. */
export interface DmLink {
  owner: string;
  status: "pending" | "active";
}
export interface AccountIntegrations {
  v: 1;
  connected: Record<string, Connected>;
  /** conversation ID → integration ID → link */
  dms: Record<string, Record<string, DmLink>>;
}
export interface IntegrationsState {
  catalog: StoreIntegration[];
  catalogStatus: "idle" | "loading" | "ready" | "error";
  account: AccountIntegrations;
  accountStatus: "off" | "loading" | "ready" | "error";
  /** Integrations this account shows on its Annoy profile. */
  panels: string[];
}

const emptyAccount = (): AccountIntegrations => ({ v: 1, connected: {}, dms: {} });
let state: IntegrationsState = { catalog: [], catalogStatus: "idle", account: emptyAccount(), accountStatus: "off", panels: [] };
const listeners = new Set<() => void>();
function set(patch: Partial<IntegrationsState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}
export const integrations = () => state;
export function useIntegrations<T>(selector: (s: IntegrationsState) => T): T {
  return useSyncExternalStore((listener) => (listeners.add(listener), () => listeners.delete(listener)), () => selector(state));
}
export const integrationById = (id: string) => state.catalog.find((i) => i.id === id);

// --- Catalog -------------------------------------------------------------------------------

let catalogLoad: Promise<void> | null = null;
let catalogAt = 0;
const CATALOG_MAX_AGE = 5 * 60_000;

export function loadCatalog(force = false): Promise<void> {
  if (!force && state.catalogStatus === "ready" && Date.now() - catalogAt < CATALOG_MAX_AGE) return Promise.resolve();
  return (catalogLoad ??= (async () => {
    if (state.catalogStatus !== "ready") set({ catalogStatus: "loading" });
    try {
      const data = await cloud<{ integrations: unknown[] }>("dev", "/v1/store/integrations");
      const catalog = (Array.isArray(data.integrations) ? data.integrations : []).flatMap((raw) => parseStoreIntegration(raw) ?? []);
      catalogAt = Date.now();
      set({ catalog, catalogStatus: "ready" });
    } catch {
      set({ catalogStatus: state.catalog.length ? "ready" : "error" });
    } finally {
      catalogLoad = null;
    }
  })());
}

// --- Account data (sealed) -----------------------------------------------------------------

const LABEL = "annoy-integrations/account/v1";
const PAD = 2048;
const enc = new TextEncoder();
let version = 0;
let generation = 0;

async function dataKey(): Promise<CryptoKey> {
  const keys = unlockedKeys();
  if (!keys) throw new Error("locked");
  const material = await crypto.subtle.importKey("raw", keys.vault as BufferSource, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: enc.encode(LABEL) }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

async function seal(value: AccountIntegrations): Promise<string> {
  const json = enc.encode(JSON.stringify(value));
  // Padded: the size says little about how many keys there are.
  const padded = new Uint8Array(Math.ceil((json.length + 4) / PAD) * PAD);
  new DataView(padded.buffer).setUint32(0, json.length);
  padded.set(json, 4);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(LABEL) }, await dataKey(), padded));
  const out = new Uint8Array(13 + body.length);
  out[0] = 1;
  out.set(iv, 1);
  out.set(body, 13);
  return b64url(out);
}

async function open(sealed: string): Promise<AccountIntegrations> {
  const bytes = fromB64url(sealed);
  if (bytes[0] !== 1) throw new Error("format");
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.subarray(1, 13), additionalData: enc.encode(LABEL) }, await dataKey(), bytes.subarray(13)));
  const length = new DataView(plain.buffer, plain.byteOffset).getUint32(0);
  return normalize(JSON.parse(new TextDecoder().decode(plain.subarray(4, 4 + length))));
}

function normalize(raw: unknown): AccountIntegrations {
  const out = emptyAccount();
  const r = raw && typeof raw === "object" ? (raw as Record<string, any>) : {};
  for (const [id, c] of Object.entries(r.connected ?? {}) as [string, any][]) {
    if (!/^[a-z][a-z0-9-]{2,31}$/.test(id) || !c || typeof c !== "object") continue;
    out.connected[id] = { key: typeof c.key === "string" && c.key ? c.key : null, settings: c.settings && typeof c.settings === "object" ? c.settings : {}, connectedAt: typeof c.connectedAt === "string" ? c.connectedAt : "" };
  }
  for (const [dm, links] of Object.entries(r.dms ?? {}) as [string, any][]) {
    for (const [id, link] of Object.entries(links ?? {}) as [string, any][]) {
      if (typeof link?.owner === "string" && (link.status === "pending" || link.status === "active")) (out.dms[dm] ??= {})[id] = { owner: link.owner, status: link.status };
    }
  }
  return out;
}

async function read(): Promise<AccountIntegrations> {
  const data = await cloud<{ version: number; data: string | null }>("dev", "/v1/me/integrations");
  version = data.version;
  return data.data ? open(data.data) : emptyAccount();
}

/** Signed in: read the catalog, the account's data and its profile panels. */
export async function startIntegrations(me: string): Promise<void> {
  const mine = ++generation;
  set({ account: emptyAccount(), accountStatus: "loading", panels: [] });
  void loadCatalog();
  try {
    const account = await read();
    if (mine !== generation) return;
    set({ account, accountStatus: "ready" });
  } catch {
    if (mine === generation) set({ accountStatus: "error" });
  }
  cloud<{ integrations: string[] }>("dev", `/v1/users/${me}/panels`).then((p) => { if (mine === generation) set({ panels: p.integrations }); }, () => undefined);
}

export function stopIntegrations(): void {
  generation++;
  version = 0;
  set({ account: emptyAccount(), accountStatus: "off", panels: [] });
}

/** Another install of the account changed something. */
export async function accountIntegrationsChanged(): Promise<void> {
  const mine = generation;
  try {
    const account = await read();
    if (mine === generation) set({ account, accountStatus: "ready" });
  } catch {
    /* the next write reads again */
  }
}

let writing: Promise<void> = Promise.resolve();
/** Applies a change on the newest copy; a concurrent change on another install is read and the change applied again. */
export function updateAccount(change: (account: AccountIntegrations) => void): Promise<void> {
  const run = async () => {
    const mine = generation;
    for (let attempt = 0; attempt < 4; attempt++) {
      let base = state.account;
      if (state.accountStatus !== "ready" || attempt > 0) base = await read();
      const next = structuredClone(base);
      change(next);
      for (const [dm, links] of Object.entries(next.dms)) if (!Object.keys(links).length) delete next.dms[dm];
      if (JSON.stringify(next) === JSON.stringify(base)) {
        if (mine === generation) set({ account: base, accountStatus: "ready" });
        return;
      }
      try {
        const saved = await cloud<{ version: number }>("dev", "/v1/me/integrations", { method: "PUT", body: { data: await seal(next), baseVersion: version } });
        if (mine !== generation) return;
        version = saved.version;
        set({ account: next, accountStatus: "ready" });
        return;
      } catch (err) {
        if (!(err instanceof CloudError) || err.status !== 409) throw err;
      }
    }
    throw new Error("conflict");
  };
  const result = writing.then(run);
  writing = result.catch(() => undefined);
  return result;
}

export function connectIntegration(integration: StoreIntegration, key: string | null, settings: unknown): Promise<void> {
  return updateAccount((account) => {
    account.connected[integration.id] = { key: key?.trim() || null, settings: cleanSettings(integration, settings), connectedAt: account.connected[integration.id]?.connectedAt || new Date().toISOString() };
  });
}

export function disconnectIntegration(id: string): Promise<void> {
  return updateAccount((account) => {
    delete account.connected[id];
  });
}

export async function setProfilePanel(id: string, shown: boolean): Promise<void> {
  const next = shown ? [...new Set([...state.panels, id])] : state.panels.filter((p) => p !== id);
  const saved = await cloud<{ integrations: string[] }>("dev", "/v1/me/panels", { method: "PUT", body: { integrations: next } });
  set({ panels: saved.integrations });
  panelCache.clear();
}

export interface ProfilePanel { integration: string; image: string; link?: string }
const panelCache = new Map<string, { at: number; panels: Promise<ProfilePanel[]> }>();
/** Panels an account shows on its profile, ready to draw (cached a minute). */
export function profilePanelsOf(annoyId: string): Promise<ProfilePanel[]> {
  const cached = panelCache.get(annoyId);
  if (cached && Date.now() - cached.at < 60_000) return cached.panels;
  const panels = cloud<{ panels?: ProfilePanel[] }>("dev", `/v1/users/${annoyId}/panels`).then((p) => (Array.isArray(p.panels) ? p.panels : []), () => []);
  panelCache.set(annoyId, { at: Date.now(), panels });
  return panels;
}

export const iconOf = (integration: Pick<StoreIntegration, "icon"> | undefined | null): string | null => {
  const icon = integration?.icon;
  // Icons come from devannoy only.
  return icon && icon.startsWith(`${currentCloudUrls().dev}/`) ? icon : null;
};
