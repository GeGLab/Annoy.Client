import {secureFetch} from "./secure-fetch.ts";
// Annoy Global in the app: one account for many servers. The password and the
// account keys never leave this device; Global keeps the server list only
// encrypted, and never learns which servers this account signs in to
// (Annoy-api-global DESIGN.md). global-crypto.ts is a copy of its client-kdf.ts.
import type { AuthResponse, GlobalLogin, InstanceInfo } from "@distopic/protocol";
import * as kdf from "./global-crypto.ts";
import { fetchInfo } from "./api.ts";
import { getState, setState, type Account, type GlobalAccount } from "./store.ts";
import { observeHttp, observeRequestFailure } from "../../shared/connectivity.ts";
import { cancelled, fetchJson, isCancellation, READ_TIMEOUT_MS, RequestError, RequestScope, WRITE_TIMEOUT_MS } from "../../shared/requests.ts";

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
let sessionGeneration = 0;
const requests = new RequestScope();
const assertSession = (generation: number, signal?: AbortSignal) => {
  signal?.throwIfAborted();
  if (generation !== sessionGeneration) throw cancelled();
};

export class GlobalError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(base: string, path: string, init: { method?: string; body?: unknown; token?: string | null; signal?: AbortSignal } = {}): Promise<T> {
  const observesGlobal = base === GLOBAL_URL && path.startsWith("/v1/");
  const generation = requests.generation;
  const method = init.method ?? (init.body === undefined ? "GET" : "POST");
  try {
    const result = await requests.run((active) => fetchJson<T>(base + path, {
      method,
      headers: { ...(init.body !== undefined && { "content-type": "application/json" }), ...(init.token && { authorization: `Bearer ${init.token}` }) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }, active), { signal: init.signal, timeoutMs: method === "GET" ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS, key: method === "GET" ? base + path : undefined });
    if (observesGlobal && generation === requests.generation) setState((s) => {
      s.connectivity.global = observeHttp(s.connectivity.global, result.status, Date.now(), !!init.token || path === "/v1/auth/login");
    });
    return result.data;
  } catch (error) {
    if (isCancellation(error)) throw error;
    if (observesGlobal && generation === requests.generation) setState((s) => {
      s.connectivity.global = error instanceof RequestError && error.status > 0
        ? observeHttp(s.connectivity.global, error.status, Date.now(), !!init.token)
        : observeRequestFailure(s.connectivity.global, error, Date.now(), s.connectivity.network);
    });
    if (error instanceof RequestError) throw new GlobalError(error.status, error.code ?? error.kind, error.message);
    throw error;
  }
}

const global = <T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}) => request<T>(GLOBAL_URL, path, { ...init, token: session });

// --- Session ---------------------------------------------------------------------

interface Saved {
  session: string;
  user: GlobalAccount;
  keys: string;
}

let persistence: Promise<unknown> = Promise.resolve();
async function persist(user: GlobalAccount | null): Promise<void> {
  const saved: Saved | null = user && session && keys ? { session, user, keys: kdf.escrowKeys(keys) } : null;
  const serialized = saved ? JSON.stringify(saved) : null;
  persistence = persistence.then(() => window.distopic?.secrets.set("global", serialized).catch(() => false));
  await persistence;
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
    const generation = sessionGeneration;
    await globalUrl();
    const raw = await window.distopic?.secrets.get("global").catch(() => null);
    if (generation !== sessionGeneration) return;
    // A remembered name without a stored session is not a signed-in Annoy account.
    if (!raw) { session = null; keys = null; if (getState().global) setAccount(null); return; }
    try {
      const saved = JSON.parse(raw) as Saved;
      const restored = kdf.fromEscrow(saved.keys);
      const me = window.distopic?.auth ? await window.distopic.auth.global(saved.session)
        : await request<GlobalAccount>(GLOBAL_URL, "/v1/me", { token: saved.session });
      assertSession(generation);
      session = saved.session; keys = restored;
      setAccount({ id: me.id, name: me.name, email: me.email, cryptoMigrationRequired: me.cryptoMigrationRequired });
      if (!window.distopic) setState(s => { s.access = { allowed: true, global: true, localAccounts: [] }; });
      void syncVault();
    } catch (error) {
      if (isCancellation(error) || generation !== sessionGeneration) return;
      session = null; keys = null; setAccount(null);
    }
  })();
}

export async function signInGlobal(email: string, password: string, signal?: AbortSignal): Promise<GlobalAccount> {
  const generation = ++sessionGeneration;
  requests.invalidate();
  await globalUrl();
  assertSession(generation, signal);
  const pre = await request<{ salt: string; iterations: number }>(GLOBAL_URL, "/v1/auth/prelogin", { body: { email }, signal });
  assertSession(generation, signal);
  const pk = await kdf.derivePasswordKeys(password, pre.salt, pre.iterations);
  assertSession(generation, signal);
  const res = await request<{ token: string; wrappedKeys: string; user: GlobalAccount }>(GLOBAL_URL, "/v1/auth/login", { body: { email, authKey: pk.authKey }, signal });
  assertSession(generation, signal);
  const unlocked = await kdf.unwrapKeys(pk.wrapKey, res.wrappedKeys);
  assertSession(generation, signal);
  const me = window.distopic?.auth ? await window.distopic.auth.global(res.token) : res.user;
  assertSession(generation, signal);
  session = res.token;
  keys = unlocked;
  tokenKeys = null;
  const user = { id: me.id, name: me.name, email: me.email, cryptoMigrationRequired: me.cryptoMigrationRequired ?? res.user.cryptoMigrationRequired };
  setAccount(user);
  if (!window.distopic) setState(s => { s.access = { allowed: true, global: true, localAccounts: [] }; });
  await persist(user);
  assertSession(generation, signal);
  void syncVault();
  return user;
}

let signingOut: Promise<void> | null = null;
export function signOutGlobal(callApi = true): Promise<void> {
  return signingOut ??= (async () => {
    const previous = session;
    ++sessionGeneration;
    requests.invalidate();
    session = null; keys = null; tokenKeys = null; setAccount(null);
    // Revoke native access before waiting on any network request.
    if (window.distopic?.auth) await window.distopic.auth.logoutGlobal();
    else setState(s => { s.access = { allowed: false, global: false, localAccounts: [] }; });
    const client = await import("./client.ts");
    const local = new Set(getState().access.localAccounts);
    for (const account of [...getState().accounts]) if (!local.has(account.id)) client.removeAccount(account.id, "internal");
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
  const generation = sessionGeneration, unlocked = keys;
  const v = await global<{ version: number; data: string | null }>("/v1/vault");
  assertSession(generation);
  if (!v.data || !unlocked) return { version: v.version, servers: [] };
  const { servers } = await kdf.openVault<{ servers: VaultEntry[] }>(unlocked, v.data);
  assertSession(generation);
  return { version: v.version, servers };
}

/** Read, change, write; on a conflict another device saved first, so start over from its copy. */
async function updateVault(change: (servers: VaultEntry[]) => VaultEntry[] | null): Promise<void> {
  if (!keys || !session) return;
  if (getState().global?.cryptoMigrationRequired) throw new Error("Migre o cofre legado antes de sincronizar novos servidores");
  const generation = sessionGeneration, unlocked = keys;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { version, servers } = await readVault();
    assertSession(generation);
    const next = change(servers);
    if (!next) return;
    try {
      const data = await kdf.sealVault(unlocked, { servers: next });
      assertSession(generation);
      await global("/v1/vault", { method: "PUT", body: { data, baseVersion: version } });
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
  const generation = sessionGeneration;
  const { addAccountQuietly } = await import("./client.ts");
  const { servers } = await readVault().catch(() => ({ servers: [] as VaultEntry[] }));
  if (generation !== sessionGeneration) return result;
  const known = new Set(getState().accounts.filter((a) => !a.pending).map((a) => a.url));
  for (const entry of servers) {
    if (known.has(entry.url)) continue;
    let name = new URL(entry.url).host;
    try {
      const info = await fetchInfo(entry.url);
      name = info.name;
      assertSession(generation);
      // Never sign in to a server that is not the one saved in the vault: it stays disconnected.
      if (info.globalServerId !== entry.serverId) throw new Error("server_mismatch");
      const auth = await signInServer(entry.url, entry.serverId);
      assertSession(generation);
      addAccountQuietly(toAccount(entry.url, info, auth));
      result.added++;
    } catch (error) {
      if (isCancellation(error)) return result;
      const needsUser = error instanceof GlobalError && error.code === "global_new_account";
      if (needsUser) result.needsAccount.push(entry.url);
      // Every server of the account is listed; one that could not be signed in shows as disconnected.
      addAccountQuietly({ id: `${entry.url}#annoy`, url: entry.url, token: "", userId: "", instanceName: name, annoy: true, pending: needsUser ? "invalid" : "offline" });
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
async function proofFor(url: string, serverId: string, signal?: AbortSignal) {
  const info = await fetchInfo(url, signal);
  if (info.accountMode === "local" || info.globalServerId !== serverId) throw new GlobalError(403, "account_mode", "Este servidor não aceita esta identidade global");
  if (!keys || !session) throw new GlobalError(401, "signed_out", "Entre na sua conta Annoy primeiro");
  const generation = sessionGeneration, unlocked = keys;
  const identity = await kdf.serverIdentity(unlocked, serverId);
  assertSession(generation, signal);
  // Global starts a new signing key each week: on "stale_key", fetch the keys again and retry once.
  for (let attempt = 0; ; attempt++) {
    if (!tokenKeys || Date.now() - tokenKeys.at > 3_600_000) {
      const fresh = await global<{ keys: kdf.IssuerKey[]; issueWith: string }>("/v1/tokens/keys", { signal });
      assertSession(generation, signal);
      tokenKeys = { at: Date.now(), ...fresh };
    }
    const issuingKeys = tokenKeys;
    const key = issuingKeys.keys.find((k) => k.kid === issuingKeys.issueWith)!;
    const pending = await kdf.blindToken(key, kdf.tokenContext(serverId, identity.id));
    assertSession(generation, signal);
    let issued: { signatures: string[] };
    try {
      issued = await global<{ signatures: string[] }>("/v1/tokens", { body: { kid: issuingKeys.issueWith, blinded: [pending.blinded] }, signal });
    } catch (error) {
      if (attempt === 0 && error instanceof GlobalError && error.code === "stale_key") { tokenKeys = null; continue; }
      throw error;
    }
    assertSession(generation, signal);
    const { challenge } = await request<{ challenge: string }>(url, "/api/auth/global/challenge", { body: {}, signal });
    assertSession(generation, signal);
    const signature = await kdf.signForServer(identity.privateKey, challenge);
    assertSession(generation, signal);
    return { identity: identity.id, challenge, signature, token: await kdf.finalizeToken(pending, issued.signatures[0]!) };
  }
}

/**
 * Signs in to a server with the Annoy account. The first time there the
 * server answers "global_new_account": call again with a username.
 */
export async function signInServer(url: string, serverId: string, first?: Pick<GlobalLogin, "username" | "displayName" | "inviteCode">, signal?: AbortSignal): Promise<AuthResponse> {
  const generation = sessionGeneration;
  const body: GlobalLogin = { ...(await proofFor(url, serverId, signal)), ...first };
  assertSession(generation, signal);
  const auth = await request<AuthResponse>(url, "/api/auth/global", { body, signal });
  assertSession(generation, signal);
  void rememberServer({ url, serverId });
  return auth;
}

/** Ownership proof upgrades only this server's account; it cannot be used for normal login. */
export async function migrateServer(url: string, info: InstanceInfo, credentials: {
  username: string; password?: string; recoveryCode?: string; newPassword?: string;
}, previousSession?: string): Promise<AuthResponse> {
  const local = info.accountMode === "local";
  if (!local && !info.globalServerId) throw new GlobalError(503, "global_unavailable", "Login da conta Annoy indisponível");
  const generation = sessionGeneration;
  const auth = await request<AuthResponse & { removedUserId?: string | null }>(url, `/api/auth/migrate/${local ? "local" : "global"}`, {
    token: previousSession, body: { ...credentials, ...(!local ? await proofFor(url, info.globalServerId!) : {}) },
  });
  if (!local) assertSession(generation);
  if (auth.removedUserId) {
    const stale = getState().accounts.find(a => a.url === url && a.userId === auth.removedUserId);
    if (stale) (await import("./client.ts")).removeAccount(stale.id, "internal");
    setState(s => { s.rememberedAccounts = s.rememberedAccounts.filter(a => a.url !== url || a.userId !== auth.removedUserId); });
  }
  if (!local) void rememberServer({ url, serverId: info.globalServerId! });
  return auth;
}
