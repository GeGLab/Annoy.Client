import type { AuthResponse, GlobalLogin, InstanceInfo } from "@distopic/protocol";
import { t as translate } from "../../../shared/localization/index.ts";
import { fetchJson, isCancellation, RequestError, WRITE_TIMEOUT_MS } from "../../../shared/requests.ts";
import { fetchInfo } from "../api.ts";
import * as kdf from "../global-crypto.ts";
import { getState, setState, type Account } from "../store.ts";
import { AuthError, authRequest, currentGeneration, signedIn, unlockedKeys } from "./session.ts";

/**
 * The annoy-servers of the Annoy account. The list is kept encrypted in
 * authannoy (the vault: only this app opens it). Signing in to a server
 * proves the account with a per-server identity and a blind token, so
 * authannoy never learns which servers the account uses.
 */

interface VaultEntry {
  url: string;
  serverId: string;
}

function same(g: number): void {
  if (g !== currentGeneration()) throw new AuthError(0, "superseded", translate("common.459edfa35541"));
}

/** Calls to an annoy-server's own API. */
async function server<T>(url: string, path: string, body: unknown, token?: string, signal?: AbortSignal): Promise<T> {
  try {
    return (
      await fetchJson<T>(url + path, {
        method: "POST",
        headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }) },
        body: JSON.stringify(body),
      }, AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(WRITE_TIMEOUT_MS)]))
    ).data;
  } catch (error) {
    if (error instanceof RequestError) throw new AuthError(error.status, error.code ?? error.kind, error.message);
    throw error;
  }
}

async function readVault(): Promise<{ version: number; servers: VaultEntry[] }> {
  const g = currentGeneration(), unlocked = unlockedKeys();
  const v = await authRequest<{ version: number; data: string | null }>("/v1/vault");
  same(g);
  if (!v.data || !unlocked) return { version: v.version, servers: [] };
  const { servers } = await kdf.openVault<{ servers: VaultEntry[] }>(unlocked, v.data);
  return { version: v.version, servers };
}

/** Read, change, write; on a conflict another install saved first, so start over from its copy. */
async function updateVault(change: (servers: VaultEntry[]) => VaultEntry[] | null): Promise<void> {
  const unlocked = unlockedKeys();
  if (!unlocked || !signedIn()) return;
  if (getState().global?.cryptoMigrationRequired) throw new Error(translate("common.02bd1a1ee971"));
  const g = currentGeneration();
  for (let attempt = 0; attempt < 3; attempt++) {
    const { version, servers } = await readVault();
    const next = change(servers);
    if (!next) return;
    try {
      const data = await kdf.sealVault(unlocked, { servers: next });
      same(g);
      await authRequest("/v1/vault", { method: "PUT", body: { data, baseVersion: version } });
      return;
    } catch (err) {
      if (!(err instanceof AuthError && err.status === 409)) throw err;
    }
  }
}

const rememberServer = (entry: VaultEntry) => updateVault((servers) => (servers.some((s) => s.url === entry.url) ? null : [...servers, entry])).catch(() => undefined);
export const forgetServer = (url: string) => updateVault((servers) => (servers.some((s) => s.url === url) ? servers.filter((s) => s.url !== url) : null)).catch(() => undefined);

export interface VaultSync {
  added: number;
  needsAccount: string[];
  migrationRequired: boolean;
}
/** Brings back every server in the vault this install isn't connected to yet. */
export async function syncVault(): Promise<VaultSync> {
  const result: VaultSync = { added: 0, needsAccount: [], migrationRequired: !!getState().global?.cryptoMigrationRequired };
  if (!signedIn() || result.migrationRequired) return result;
  const g = currentGeneration();
  const { addAccountQuietly } = await import("../client.ts");
  const { servers } = await readVault().catch(() => ({ servers: [] as VaultEntry[] }));
  if (g !== currentGeneration()) return result;
  const known = new Set(getState().accounts.filter((a) => !a.pending).map((a) => a.url));
  for (const entry of servers) {
    if (known.has(entry.url)) continue;
    let name = new URL(entry.url).host;
    try {
      const info = await fetchInfo(entry.url);
      name = info.name;
      same(g);
      // Never sign in to a server other than the one saved in the vault.
      if (info.globalServerId !== entry.serverId) throw new Error("server_mismatch");
      const auth = await signInServer(entry.url, entry.serverId);
      same(g);
      addAccountQuietly(toAccount(entry.url, info, auth));
      result.added++;
    } catch (error) {
      if (isCancellation(error)) return result;
      const needsUser = error instanceof AuthError && error.code === "global_new_account";
      if (needsUser) result.needsAccount.push(entry.url);
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
  annoy: info.accountMode === "global" || auth.user.global === true,
});

let tokenKeys: { at: number; keys: kdf.IssuerKey[]; issueWith: string } | null = null;

/** Proof of the account for one server: its identity there signs the challenge, a blind token vouches for the account. */
async function proofFor(url: string, serverId: string, signal?: AbortSignal) {
  const info = await fetchInfo(url, signal);
  if (info.accountMode === "local" || info.globalServerId !== serverId) throw new AuthError(403, "account_mode", translate("common.b26cbaab546f"));
  const unlocked = unlockedKeys();
  if (!unlocked || !signedIn()) throw new AuthError(401, "signed_out", translate("auth.signInFirst"));
  const g = currentGeneration();
  const identity = await kdf.serverIdentity(unlocked, serverId);
  // A new blind-token key starts each week: on "stale_key", fetch the keys again and retry once.
  for (let attempt = 0; ; attempt++) {
    if (!tokenKeys || Date.now() - tokenKeys.at > 3_600_000) {
      const fresh = await authRequest<{ keys: kdf.IssuerKey[]; issueWith: string }>("/v1/tokens/keys", { signal, observe: false });
      tokenKeys = { at: Date.now(), ...fresh };
    }
    const issuing = tokenKeys;
    const key = issuing.keys.find((k) => k.kid === issuing.issueWith)!;
    const pending = await kdf.blindToken(key, kdf.tokenContext(serverId, identity.id));
    let issued: { signatures: string[] };
    try {
      issued = await authRequest<{ signatures: string[] }>("/v1/tokens", { body: { kid: issuing.issueWith, blinded: [pending.blinded] }, signal });
    } catch (error) {
      if (attempt === 0 && error instanceof AuthError && error.code === "stale_key") {
        tokenKeys = null;
        continue;
      }
      throw error;
    }
    same(g);
    const { challenge } = await server<{ challenge: string }>(url, "/api/auth/global/challenge", {}, undefined, signal);
    const signature = await kdf.signForServer(identity.privateKey, challenge);
    // authannoy vouches for the account's public ID, so the server can link it to an existing user.
    const attestation = await authRequest<{ publicId: string; expires: number; signature: string }>("/v1/attest", { body: { identity: identity.id }, signal }).catch(() => undefined);
    same(g);
    return { identity: identity.id, challenge, signature, token: await kdf.finalizeToken(pending, issued.signatures[0]!), ...(attestation && { attestation }) };
  }
}

/** Signs in to a server with the Annoy account. The first time, the server answers "global_new_account": call again with a username. */
export async function signInServer(url: string, serverId: string, first?: Pick<GlobalLogin, "username" | "displayName" | "inviteCode">, signal?: AbortSignal): Promise<AuthResponse> {
  const g = currentGeneration();
  const body: GlobalLogin = { ...(await proofFor(url, serverId, signal)), ...first };
  const auth = await server<AuthResponse>(url, "/api/auth/global", body, undefined, signal);
  same(g);
  void rememberServer({ url, serverId });
  return auth;
}

/** Ownership proof upgrades only this server's account; it is never an ordinary login. */
export async function migrateServer(url: string, info: InstanceInfo, credentials: { username: string; password?: string; recoveryCode?: string; newPassword?: string }, previousSession?: string): Promise<AuthResponse> {
  const local = info.accountMode === "local";
  if (!local && !info.globalServerId) throw new AuthError(503, "global_unavailable", translate("common.df9f30310ead"));
  const g = currentGeneration();
  const auth = await server<AuthResponse & { removedUserId?: string | null }>(url, `/api/auth/migrate/${local ? "local" : "global"}`, { ...credentials, ...(!local ? await proofFor(url, info.globalServerId!) : {}) }, previousSession);
  if (!local) same(g);
  if (auth.removedUserId) {
    const stale = getState().accounts.find((a) => a.url === url && a.userId === auth.removedUserId);
    if (stale) (await import("../client.ts")).removeAccount(stale.id, "internal");
    setState((s) => {
      s.rememberedAccounts = s.rememberedAccounts.filter((a) => a.url !== url || a.userId !== auth.removedUserId);
    });
  }
  if (!local) void rememberServer({ url, serverId: info.globalServerId! });
  return auth;
}

