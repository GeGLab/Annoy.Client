// Annoy Global in the app: one account for many servers. The password and the
// account keys never leave this device; Global keeps the server list only
// encrypted, and never learns which servers this account signs in to
// (Annoy-api-global DESIGN.md). global-crypto.ts is a copy of its client-kdf.ts.
import type { AuthResponse, GlobalLogin, InstanceInfo } from "@distopic/protocol";
import * as kdf from "./global-crypto.ts";
import { fetchInfo } from "./api.ts";
import { getState, setState, type Account, type GlobalAccount } from "./store.ts";

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
    res = await fetch(base + path, {
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
    if (!user) s.settings.globalDefault = false;
  });
}

/** At startup: the account kept by the OS keychain, if any, then the server list. */
export async function initGlobal(): Promise<void> {
  const raw = await window.distopic?.secrets.get("global").catch(() => null);
  if (!raw) return;
  try {
    const saved = JSON.parse(raw) as Saved;
    session = saved.session;
    keys = kdf.fromEscrow(saved.keys);
    setAccount(saved.user);
    const me = await global<GlobalAccount>("/v1/me");
    setAccount({ id: me.id, name: me.name, email: me.email });
    void syncVault();
  } catch (err) {
    // An ended session (password changed elsewhere, sanction): sign in again.
    if (err instanceof GlobalError && err.status === 401) await signOutGlobal(false);
  }
}

export async function signInGlobal(email: string, password: string): Promise<GlobalAccount> {
  const pre = await request<{ salt: string; iterations: number }>(GLOBAL_URL, "/v1/auth/prelogin", { body: { email } });
  const pk = await kdf.derivePasswordKeys(password, pre.salt, pre.iterations);
  const res = await request<{ token: string; wrappedKeys: string; user: GlobalAccount }>(GLOBAL_URL, "/v1/auth/login", { body: { email, authKey: pk.authKey } });
  session = res.token;
  keys = await kdf.unwrapKeys(pk.wrapKey, res.wrappedKeys);
  const user = { id: res.user.id, name: res.user.name, email: res.user.email };
  setAccount(user);
  await persist(user);
  void syncVault();
  return user;
}

export async function signOutGlobal(callApi = true): Promise<void> {
  if (callApi && session) await global("/v1/auth/logout", { body: {} }).catch(() => undefined);
  session = null;
  keys = null;
  setAccount(null);
  await persist(null);
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
export async function syncVault(): Promise<void> {
  if (!keys || !session) return;
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
    } catch {
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
async function proofFor(url: string, serverId: string) {
  if (!keys || !session) throw new GlobalError(401, "signed_out", "Entre na sua conta global primeiro");
  if (!tokenKeys || Date.now() - tokenKeys.at > 3_600_000) tokenKeys = { at: Date.now(), ...(await global<{ keys: kdf.IssuerKey[]; issueWith: string }>("/v1/tokens/keys")) };
  const identity = await kdf.serverIdentity(keys, serverId);
  const { challenge } = await request<{ challenge: string }>(url, "/api/auth/global/challenge", { body: {} });
  const key = tokenKeys.keys.find((k) => k.kid === tokenKeys!.issueWith)!;
  const pending = await kdf.blindToken(key, kdf.tokenContext(serverId, identity.id));
  const issued = await global<{ signatures: string[] }>("/v1/tokens", { body: { kid: tokenKeys.issueWith, blinded: [pending.blinded] } });
  return { identity: identity.id, challenge, signature: await kdf.signForServer(identity.privateKey, challenge), token: kdf.finalizeToken(pending, issued.signatures[0]!) };
}

/**
 * Signs in to a server with the global account. The first time there the
 * server answers "global_new_account": call again with a username.
 */
export async function signInServer(url: string, serverId: string, first?: Pick<GlobalLogin, "username" | "displayName" | "inviteCode">): Promise<AuthResponse> {
  const body: GlobalLogin = { ...(await proofFor(url, serverId)), ...first };
  const auth = await request<AuthResponse>(url, "/api/auth/global", { body });
  void rememberServer({ url, serverId });
  return auth;
}

/** Items 1.7/1.9: a local account starts signing in with the global one too. */
export async function linkAccount(account: Account, serverId: string): Promise<void> {
  await request(account.url, "/api/users/@me/global", { body: await proofFor(account.url, serverId), token: account.token });
  void rememberServer({ url: account.url, serverId });
}
