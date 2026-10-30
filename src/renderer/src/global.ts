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
export const GLOBAL_URL = (() => {
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
    if (!user) s.settings.globalDefault = false;
  });
}

/** At startup: the account kept by the OS keychain, if any, then the server list. */
export async function initGlobal(): Promise<void> {
  const generation = sessionGeneration;
  const raw = await window.distopic?.secrets.get("global").catch(() => null);
  if (!raw || generation !== sessionGeneration) return;
  try {
    const saved = JSON.parse(raw) as Saved;
    session = saved.session;
    keys = kdf.fromEscrow(saved.keys);
    setAccount(saved.user);
    const me = await global<GlobalAccount>("/v1/me");
    assertSession(generation);
    setAccount({ id: me.id, name: me.name, email: me.email });
    void syncVault();
  } catch (err) {
    // An ended session (password changed elsewhere, sanction): sign in again.
    if (generation === sessionGeneration && err instanceof GlobalError && err.status === 401) await signOutGlobal(false);
  }
}

export async function signInGlobal(email: string, password: string, signal?: AbortSignal): Promise<GlobalAccount> {
  const generation = ++sessionGeneration;
  requests.invalidate();
  const pre = await request<{ salt: string; iterations: number }>(GLOBAL_URL, "/v1/auth/prelogin", { body: { email }, signal });
  assertSession(generation, signal);
  const pk = await kdf.derivePasswordKeys(password, pre.salt, pre.iterations);
  assertSession(generation, signal);
  const res = await request<{ token: string; wrappedKeys: string; user: GlobalAccount }>(GLOBAL_URL, "/v1/auth/login", { body: { email, authKey: pk.authKey }, signal });
  assertSession(generation, signal);
  const unlocked = await kdf.unwrapKeys(pk.wrapKey, res.wrappedKeys);
  assertSession(generation, signal);
  session = res.token;
  keys = unlocked;
  tokenKeys = null;
  const user = { id: res.user.id, name: res.user.name, email: res.user.email };
  setAccount(user);
  await persist(user);
  assertSession(generation, signal);
  void syncVault();
  return user;
}

export async function signOutGlobal(callApi = true): Promise<void> {
  const token = session;
  const generation = ++sessionGeneration;
  requests.invalidate();
  session = null;
  keys = null;
  tokenKeys = null;
  setAccount(null);
  await persist(null);
  if (callApi && token && generation === sessionGeneration) await request(GLOBAL_URL, "/v1/auth/logout", { body: {}, token }).catch(() => undefined);
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
export async function syncVault(): Promise<void> {
  if (!keys || !session) return;
  const generation = sessionGeneration;
  const { addAccountQuietly } = await import("./client.ts");
  const { servers } = await readVault().catch(() => ({ servers: [] as VaultEntry[] }));
  if (generation !== sessionGeneration) return;
  const known = new Set(getState().accounts.map((a) => a.url));
  for (const entry of servers) {
    if (known.has(entry.url)) continue;
    try {
      const info = await fetchInfo(entry.url);
      assertSession(generation);
      if (info.globalServerId !== entry.serverId) continue;
      const auth = await signInServer(entry.url, entry.serverId);
      assertSession(generation);
      addAccountQuietly(toAccount(entry.url, info, auth));
    } catch (error) {
      if (isCancellation(error)) return;
      // Offline, or this account has no user there anymore: try again next time.
    }
  }
}

export const toAccount = (url: string, info: InstanceInfo, auth: AuthResponse): Account => ({
  id: `${url}#${auth.user.id}`,
  url,
  token: auth.token,
  userId: auth.user.id,
  instanceName: info.name,
});

// --- Signing in to servers ------------------------------------------------------------

let tokenKeys: { at: number; keys: kdf.IssuerKey[]; issueWith: string } | null = null;

/**
 * Proof of this account for one server: its own identity there signs the
 * server's challenge, and a blind token from Global vouches for the account.
 * Global sees neither the server nor the identity.
 */
async function proofFor(url: string, serverId: string, signal?: AbortSignal) {
  if (!keys || !session) throw new GlobalError(401, "signed_out", "Entre na sua conta global primeiro");
  const generation = sessionGeneration, unlocked = keys;
  if (!tokenKeys || Date.now() - tokenKeys.at > 3_600_000) {
    const fresh = await global<{ keys: kdf.IssuerKey[]; issueWith: string }>("/v1/tokens/keys", { signal });
    assertSession(generation, signal);
    tokenKeys = { at: Date.now(), ...fresh };
  }
  const issuingKeys = tokenKeys;
  const identity = await kdf.serverIdentity(unlocked, serverId);
  assertSession(generation, signal);
  const { challenge } = await request<{ challenge: string }>(url, "/api/auth/global/challenge", { body: {}, signal });
  assertSession(generation, signal);
  const key = issuingKeys.keys.find((k) => k.kid === issuingKeys.issueWith)!;
  const pending = await kdf.blindToken(key, kdf.tokenContext(serverId, identity.id));
  assertSession(generation, signal);
  const issued = await global<{ signatures: string[] }>("/v1/tokens", { body: { kid: issuingKeys.issueWith, blinded: [pending.blinded] }, signal });
  assertSession(generation, signal);
  const signature = await kdf.signForServer(identity.privateKey, challenge);
  assertSession(generation, signal);
  return { identity: identity.id, challenge, signature, token: kdf.finalizeToken(pending, issued.signatures[0]!) };
}

/**
 * Signs in to a server with the global account. The first time there the
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

/**
 * Item 1.9: the global account already has its own user on this server. The
 * local user (confirmed by its password) takes everything of the other one.
 * Returns the removed user's id, so the app can drop that account.
 */
export async function mergeAccount(account: Account, serverId: string, password: string, signal?: AbortSignal): Promise<string | null> {
  const generation = sessionGeneration;
  const proof = await proofFor(account.url, serverId, signal);
  assertSession(generation, signal);
  const res = await request<{ removedUserId: string | null }>(account.url, "/api/users/@me/global/merge", {
    body: { ...proof, password },
    token: account.token,
    signal,
  });
  assertSession(generation, signal);
  void rememberServer({ url: account.url, serverId });
  return res.removedUserId;
}

/** Items 1.7/1.9: a local account starts signing in with the global one too. */
export async function linkAccount(account: Account, serverId: string, signal?: AbortSignal): Promise<void> {
  const generation = sessionGeneration;
  const proof = await proofFor(account.url, serverId, signal);
  assertSession(generation, signal);
  await request(account.url, "/api/users/@me/global", { body: proof, token: account.token, signal });
  assertSession(generation, signal);
  void rememberServer({ url: account.url, serverId });
}
