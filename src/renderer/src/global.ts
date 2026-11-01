import {secureFetch} from "./secure-fetch.ts";
// Annoy Global in the app: one account for many servers. The password and the
// account keys never leave this device; Global keeps the server list only
// encrypted, and never learns which servers this account signs in to
// (Annoy-api-global DESIGN.md). global-crypto.ts is a copy of its client-kdf.ts.
import type { AuthResponse, GlobalLogin, InstanceInfo } from "@distopic/protocol";
import * as kdf from "./global-crypto.ts";
import { fetchInfo } from "./api.ts";
import { getState, setState, type Account, type GlobalAccount } from "./store.ts";

/** Development and tests can point elsewhere with localStorage "distopic.globalUrl". */
export let GLOBAL_URL = (() => {
  try {
    return localStorage.getItem("distopic.globalUrl") || "https://global.geg.dev.br";
  } catch {
    return "https://global.geg.dev.br";
  }
})();

/** Unlocked account keys, in memory only (and in the OS keychain when there is one). */
let keys: kdf.AccountKeys | null = null;
let session: string | null = null;

export class GlobalError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(base: string, path: string, init: { method?: string; body?: unknown; token?: string | null } = {}): Promise<T> {
  let res: Response;
  try {
    res = await secureFetch(base + path, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: { ...(init.body !== undefined && { "content-type": "application/json" }), ...(init.token && { authorization: `Bearer ${init.token}` }) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new GlobalError(0, "network", "Sem conexão. Tente de novo.");
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new GlobalError(res.status, String(data.error ?? "error"), String(data.message ?? `HTTP ${res.status}`));
  return data as T;
}

const global = <T>(path: string, init: { method?: string; body?: unknown } = {}) => request<T>(GLOBAL_URL, path, { ...init, token: session });

// --- Session ---------------------------------------------------------------------

interface Saved {
  session: string;
  user: GlobalAccount;
  keys: string;
}

async function persist(user: GlobalAccount | null): Promise<void> {
  const saved: Saved | null = user && session && keys ? { session, user, keys: kdf.escrowKeys(keys) } : null;
  await window.distopic?.secrets.set("global", saved ? JSON.stringify(saved) : null).catch(() => false);
}

function setAccount(user: GlobalAccount | null): void {
  setState((s) => {
    s.global = user;
  });
}

let initializing: Promise<void> | null = null;
async function globalUrl(): Promise<void> {
  if (window.distopic?.auth) GLOBAL_URL = await window.distopic.auth.globalUrl();
}

/** Saved profile data does not unlock the app: validate its session first. */
export function initGlobal(): Promise<void> {
  return initializing ??= (async () => {
    await globalUrl();
    const raw = await window.distopic?.secrets.get("global").catch(() => null);
    // A remembered name without a stored session is not a signed-in Annoy account.
    if (!raw) { session = null; keys = null; if (getState().global) setAccount(null); return; }
    try {
      const saved = JSON.parse(raw) as Saved;
      const restored = kdf.fromEscrow(saved.keys);
      const me = window.distopic?.auth ? await window.distopic.auth.global(saved.session)
        : await request<GlobalAccount>(GLOBAL_URL, "/v1/me", { token: saved.session });
      session = saved.session; keys = restored;
      setAccount({ id: me.id, name: me.name, email: me.email,cryptoMigrationRequired:me.cryptoMigrationRequired });
      if (!window.distopic) setState(s => { s.access = { allowed: true, global: true, localAccounts: [] }; });
      void syncVault();
    } catch {
      session = null; keys = null; setAccount(null);
    }
  })();
}

export async function signInGlobal(email: string, password: string): Promise<GlobalAccount> {
  await globalUrl();
  const pre = await request<{ salt: string; iterations: number }>(GLOBAL_URL, "/v1/auth/prelogin", { body: { email } });
  const pk = await kdf.derivePasswordKeys(password, pre.salt, pre.iterations);
  const res = await request<{ token: string; wrappedKeys: string; user: GlobalAccount }>(GLOBAL_URL, "/v1/auth/login", { body: { email, authKey: pk.authKey } });
  const unlocked = await kdf.unwrapKeys(pk.wrapKey, res.wrappedKeys);
  const me = window.distopic?.auth ? await window.distopic.auth.global(res.token) : res.user;
  session = res.token; keys = unlocked;
  const user = { id: me.id, name: me.name, email: me.email,cryptoMigrationRequired:me.cryptoMigrationRequired??res.user.cryptoMigrationRequired };
  setAccount(user);
  if (!window.distopic) setState(s => { s.access = { allowed: true, global: true, localAccounts: [] }; });
  await persist(user);
  void syncVault();
  return user;
}

let signingOut: Promise<void> | null = null;
export function signOutGlobal(callApi = true): Promise<void> {
  return signingOut ??= (async () => {
    const previous = session;
    session = null; keys = null; tokenKeys = null; setAccount(null);
    // Revoke native access before waiting on any network request.
    if (window.distopic?.auth) await window.distopic.auth.logoutGlobal();
    else setState(s => { s.access = { allowed: false, global: false, localAccounts: [] }; });
    const client = await import("./client.ts");
    const local = new Set(getState().access.localAccounts);
    for (const account of [...getState().accounts]) if (!local.has(account.id)) client.removeAccount(account.id, false);
    await persist(null);
    if (callApi && previous) await request(GLOBAL_URL, "/v1/auth/logout", { body: {}, token: previous }).catch(() => undefined);
  })().finally(() => { signingOut = null; });
}

// --- Vault: the encrypted list of this account's servers ------------------------------

interface VaultEntry {
  url: string;
  serverId: string;
}

async function readVault(): Promise<{ version: number; servers: VaultEntry[] }> {
  const v = await global<{ version: number; data: string | null }>("/v1/vault");
  if (!v.data || !keys) return { version: v.version, servers: [] };
  const { servers } = await kdf.openVault<{ servers: VaultEntry[] }>(keys, v.data);
  return { version: v.version, servers };
}

/** Read, change, write; on a conflict another device saved first, so start over from its copy. */
async function updateVault(change: (servers: VaultEntry[]) => VaultEntry[] | null): Promise<void> {
  if (!keys || !session) return;
  if(getState().global?.cryptoMigrationRequired)throw new Error("Migre o cofre legado antes de sincronizar novos servidores");
  for (let attempt = 0; attempt < 3; attempt++) {
    const { version, servers } = await readVault();
    const next = change(servers);
    if (!next) return;
    try {
      await global("/v1/vault", { method: "PUT", body: { data: await kdf.sealVault(keys, { servers: next }), baseVersion: version } });
      return;
    } catch (err) {
      if (!(err instanceof GlobalError && err.status === 409)) throw err;
    }
  }
}

const rememberServer = (entry: VaultEntry) =>
  updateVault((servers) => (servers.some((s) => s.url === entry.url) ? null : [...servers, entry])).catch(() => undefined);

export const forgetServer = (url: string) =>
  updateVault((servers) => (servers.some((s) => s.url === url) ? servers.filter((s) => s.url !== url) : null)).catch(() => undefined);

/**
 * Brings back every server in the vault this device isn't connected to yet
 * (a new device, or a server added elsewhere).
 */
/** True only when this run of the app holds a live Annoy account session, not just its remembered name. */
export const globalSignedIn = (): boolean => !!keys && !!session;

export interface VaultSync { added: number; needsAccount: string[]; migrationRequired: boolean }
export async function syncVault(): Promise<VaultSync> {
  const result: VaultSync = { added: 0, needsAccount: [], migrationRequired: !!getState().global?.cryptoMigrationRequired };
  if (!keys || !session || result.migrationRequired) return result;
  const { addAccountQuietly } = await import("./client.ts");
  const { servers } = await readVault().catch(() => ({ servers: [] as VaultEntry[] }));
  const known = new Set(getState().accounts.map((a) => a.url));
  for (const entry of servers) {
    if (known.has(entry.url)) continue;
    try {
      const info = await fetchInfo(entry.url);
      if (info.globalServerId !== entry.serverId) continue;
      const auth = await signInServer(entry.url, entry.serverId);
      addAccountQuietly(toAccount(entry.url, info, auth));
      result.added++;
    } catch (error) {
      // No user there yet (or anymore): the person picks a username for that server.
      if (error instanceof GlobalError && error.code === "global_new_account") result.needsAccount.push(entry.url);
      // Otherwise offline or refused: try again next time.
    }
  }
  return result;
}

export const toAccount = (url: string, info: InstanceInfo, auth: AuthResponse): Account => ({
  id: `${url}#${auth.user.id}`,
  url,
  token: auth.token,
  userId: auth.user.id,
  instanceName: info.name,
  annoy: true,
});

// --- Signing in to servers ------------------------------------------------------------

let tokenKeys: { at: number; keys: kdf.IssuerKey[]; issueWith: string } | null = null;

/**
 * Proof of this account for one server: its own identity there signs the
 * server's challenge, and a blind token from Global vouches for the account.
 * Global sees neither the server nor the identity.
 */
async function proofFor(url: string, serverId: string) {
  const info = await fetchInfo(url);
  if (info.accountMode === "local" || info.globalServerId !== serverId) throw new GlobalError(403, "account_mode", "Este servidor não aceita esta identidade global");
  if (!keys || !session) throw new GlobalError(401, "signed_out", "Entre na sua conta Annoy primeiro");
  if (!tokenKeys || Date.now() - tokenKeys.at > 3_600_000) tokenKeys = { at: Date.now(), ...(await global<{ keys: kdf.IssuerKey[]; issueWith: string }>("/v1/tokens/keys")) };
  const identity = await kdf.serverIdentity(keys, serverId);
  const { challenge } = await request<{ challenge: string }>(url, "/api/auth/global/challenge", { body: {} });
  const key = tokenKeys.keys.find((k) => k.kid === tokenKeys!.issueWith)!;
  const pending = await kdf.blindToken(key, kdf.tokenContext(serverId, identity.id));
  const issued = await global<{ signatures: string[] }>("/v1/tokens", { body: { kid: tokenKeys.issueWith, blinded: [pending.blinded] } });
  return { identity: identity.id, challenge, signature: await kdf.signForServer(identity.privateKey, challenge), token: await kdf.finalizeToken(pending, issued.signatures[0]!) };
}

/**
 * Signs in to a server with the Annoy account. The first time there the
 * server answers "global_new_account": call again with a username.
 */
export async function signInServer(url: string, serverId: string, first?: Pick<GlobalLogin, "username" | "displayName" | "inviteCode">): Promise<AuthResponse> {
  const body: GlobalLogin = { ...(await proofFor(url, serverId)), ...first };
  const auth = await request<AuthResponse>(url, "/api/auth/global", { body });
  void rememberServer({ url, serverId });
  return auth;
}

/** Ownership proof upgrades only this server's account; it cannot be used for normal login. */
export async function migrateServer(url: string, info: InstanceInfo, credentials: {
  username: string; password?: string; recoveryCode?: string; newPassword?: string;
}, previousSession?: string): Promise<AuthResponse> {
  const local = info.accountMode === "local";
  if (!local && !info.globalServerId) throw new GlobalError(503, "global_unavailable", "Login da conta Annoy indisponível");
  const auth = await request<AuthResponse & { removedUserId?: string | null }>(url, `/api/auth/migrate/${local ? "local" : "global"}`, {
    token: previousSession, body: { ...credentials, ...(!local ? await proofFor(url, info.globalServerId!) : {}) },
  });
  if (auth.removedUserId) {
    const stale = getState().accounts.find(a => a.url === url && a.userId === auth.removedUserId);
    if (stale) (await import("./client.ts")).removeAccount(stale.id, false);
    setState(s => { s.rememberedAccounts = s.rememberedAccounts.filter(a => a.url !== url || a.userId !== auth.removedUserId); });
  }
  if (!local) void rememberServer({ url, serverId: info.globalServerId! });
  return auth;
}
