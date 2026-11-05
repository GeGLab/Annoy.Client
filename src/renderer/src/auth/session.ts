import { t as translate } from "../../../shared/localization/index.ts";
import { observeHttp, observeRequestFailure } from "../../../shared/connectivity.ts";
import { fetchJson, isCancellation, READ_TIMEOUT_MS, RequestError, WRITE_TIMEOUT_MS } from "../../../shared/requests.ts";
import { CLIENT_VERSION } from "../lib/client-version.ts";
import * as kdf from "../global-crypto.ts";
import { getState, setState, toast, type GlobalAccount } from "../store.ts";

/**
 * The Annoy account in the app (TODO item 2), rewritten from scratch.
 *
 * One state, one place: the session token and the unlocked account keys live
 * only in this module (and, sealed by the OS, in the main process's secret
 * store). Signing in asks for username or e-mail and password; the password
 * never leaves this device (client-kdf). Each install has a random client ID,
 * so authannoy keeps one session per install and can list them. Signing out
 * erases everything on this install except the username and the preferences.
 */

export const DEFAULT_AUTH_URL = "https://authannoy.geg.dev.br";
export const DEFAULT_WEBSITE_URL = "https://global.geg.dev.br";
let authUrl = DEFAULT_AUTH_URL;
let websiteUrl = DEFAULT_WEBSITE_URL;

let session: string | null = null;
let keys: kdf.AccountKeys | null = null;
let clientRef: string | null = null;
let generation = 0;
/** Every request of the current attempt; cancelPending aborts them all. */
let inflight = new AbortController();

export class AuthError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Local data that survives sign-out (TODO item 2.3): preferences, the username, this install's IDs. */
const KEEP = new Set(["distopic.settings", "annoy.lastUsername", "annoy.clientId", "annoy.cloudDevice", "distopic.globalUrl", "annoy.cloudUrls", "annoy.authUrl"]);

export const lastUsername = (): string => {
  try {
    return localStorage.getItem("annoy.lastUsername") ?? "";
  } catch {
    return "";
  }
};

/** This install's ID (TODO item 2.4): random, made once, never derived from the machine. */
export function clientId(): string {
  try {
    const saved = localStorage.getItem("annoy.clientId");
    if (saved && /^[A-Za-z0-9_-]{43}$/.test(saved)) return saved;
    const id = kdf.b64url(crypto.getRandomValues(new Uint8Array(32)));
    localStorage.setItem("annoy.clientId", id);
    return id;
  } catch {
    return kdf.b64url(crypto.getRandomValues(new Uint8Array(32)));
  }
}

function clientName(): string {
  const platform = window.distopic?.platform ?? navigator.platform;
  const os = /win/i.test(platform) ? "Windows" : /darwin|mac/i.test(platform) ? "macOS" : /linux/i.test(platform) ? "Linux" : platform || "Navegador";
  return `${os} · Annoy ${CLIENT_VERSION}`;
}

async function loadUrls(): Promise<void> {
  try {
    authUrl = localStorage.getItem("annoy.authUrl") || (await window.distopic?.auth?.authUrl?.()) || DEFAULT_AUTH_URL;
    websiteUrl = localStorage.getItem("distopic.globalUrl") || (await window.distopic?.auth?.globalUrl?.()) || DEFAULT_WEBSITE_URL;
  } catch {
    /* defaults */
  }
}
export const accountWebsite = () => websiteUrl;
export const authBaseUrl = () => authUrl;

/** Stops a sign-in (or any account request) still in flight; its late answer changes nothing. */
export function cancelPending(): void {
  generation++;
  inflight.abort(new DOMException("Cancelado", "AbortError"));
  inflight = new AbortController();
}

/** Requests to authannoy. Account requests also tell the app whether the Annoy account is reachable. */
export async function authRequest<T>(path: string, init: { method?: string; body?: unknown; token?: string | null; signal?: AbortSignal; observe?: boolean } = {}): Promise<T> {
  const method = init.method ?? (init.body === undefined ? "GET" : "POST");
  const token = init.token === undefined ? session : init.token;
  const observe = init.observe !== false;
  try {
    const result = await fetchJson<T>(authUrl + path, {
      method,
      headers: { ...(init.body !== undefined && { "content-type": "application/json" }), ...(token && { authorization: `Bearer ${token}` }) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }, AbortSignal.any([inflight.signal, ...(init.signal ? [init.signal] : []), AbortSignal.timeout(method === "GET" ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS)]));
    if (observe) setState((s) => void (s.connectivity.global = observeHttp(s.connectivity.global, result.status, Date.now(), !!token)));
    return result.data;
  } catch (error) {
    if (isCancellation(error)) throw error;
    if (observe)
      setState((s) => {
        s.connectivity.global = error instanceof RequestError && error.status > 0 ? observeHttp(s.connectivity.global, error.status, Date.now(), !!token) : observeRequestFailure(s.connectivity.global, error, Date.now(), s.connectivity.network);
      });
    if (error instanceof RequestError) throw new AuthError(error.status, error.code ?? error.kind, error.message);
    throw error;
  }
}

// --- Saved session ------------------------------------------------------------------

interface Saved {
  session: string;
  user: GlobalAccount;
  keys: string;
  client?: string | null;
}

let persisting: Promise<unknown> = Promise.resolve();
function persist(user: GlobalAccount | null): Promise<unknown> {
  const value = user && session && keys ? JSON.stringify({ session, user, keys: kdf.escrowKeys(keys), client: clientRef } satisfies Saved) : null;
  persisting = persisting.then(() => window.distopic?.secrets.set("global", value).catch(() => false));
  return persisting;
}

function setAccount(user: GlobalAccount | null): void {
  setState((s) => {
    s.global = user;
    if (!window.distopic) s.access = { allowed: !!user, global: !!user, localAccounts: [] };
  });
}

const toUser = (u: GlobalAccount): GlobalAccount => ({ id: u.id, name: u.name, email: u.email, ...(u.cryptoMigrationRequired && { cryptoMigrationRequired: true }) });

let restoring: Promise<void> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let retryDelay = 5_000;
/** authannoy itself refused the session (401/403), as opposed to not answering. */
const refusedSession = (error: unknown) =>
  (error instanceof AuthError && (error.status === 401 || error.status === 403)) || (error instanceof Error && error.message.includes("SESSION_REFUSED"));
/** At start: a saved session counts only after authannoy confirms it (the main process checks too). */
export function restoreSession(): Promise<void> {
  return (restoring ??= (async () => {
    const g = generation;
    await loadUrls();
    const raw = await window.distopic?.secrets.get("global").catch(() => null);
    if (g !== generation) return;
    if (!raw) {
      session = keys = null;
      if (getState().global) setAccount(null);
      return;
    }
    try {
      const saved = JSON.parse(raw) as Saved;
      const restored = kdf.fromEscrow(saved.keys);
      const me = window.distopic?.auth ? await window.distopic.auth.global(saved.session) : await authRequest<GlobalAccount>("/v1/me", { token: saved.session });
      if (g !== generation) return;
      session = saved.session;
      keys = restored;
      clientRef = saved.client ?? null;
      setAccount(toUser(me));
      void import("./servers.ts").then((m) => m.keepVaultInSync());
    } catch (error) {
      if (isCancellation(error) || g !== generation) return;
      if (refusedSession(error)) {
        // Revoked elsewhere or password changed: sign in again. Nothing local is deleted;
        // only the user's own "Sair" wipes this install.
        await endSession();
        return;
      }
      // authannoy did not answer (offline, DNS, restart): keep the saved session and try again.
      session = keys = null;
      setAccount(null);
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => { restoring = null; void restoreSession(); }, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 60_000);
    } finally {
      if (session) retryDelay = 5_000;
    }
  })());
}

/**
 * The server ended this session (it was revoked or the password changed). Back to the sign-in
 * screen, keeping everything else: service tabs (Discord), local data and preferences stay.
 */
let ending: Promise<void> | null = null;
export function endSession(): Promise<void> {
  if (signingOut) return signingOut;
  return (ending ??= (async () => {
    cancelPending();
    clearTimeout(retryTimer);
    session = keys = null;
    access = null;
    clientRef = null;
    await window.distopic?.secrets.set("global", null).catch(() => false);
    void import("./servers.ts").then((m) => m.stopVaultSync());
    setAccount(null);
    toast(translate("auth.sessionEnded"), 8000);
  })().finally(() => {
    ending = null;
  }));
}

/** Username or e-mail, and password. */
export async function signIn(identifier: string, password: string, signal?: AbortSignal): Promise<GlobalAccount> {
  const g = ++generation;
  await loadUrls();
  const id = identifier.trim();
  const pre = await authRequest<{ salt: string; iterations: number }>("/v1/auth/prelogin", { body: { identifier: id }, token: null, signal });
  const pk = await kdf.derivePasswordKeys(password, pre.salt, pre.iterations);
  signal?.throwIfAborted();
  const res = await authRequest<{ token: string; wrappedKeys: string; user: GlobalAccount; client?: string }>("/v1/auth/login", {
    body: { identifier: id, authKey: pk.authKey, clientId: clientId(), clientName: clientName() },
    token: null,
    signal,
  });
  const unlocked = await kdf.unwrapKeys(pk.wrapKey, res.wrappedKeys);
  const me = window.distopic?.auth ? await window.distopic.auth.global(res.token) : res.user;
  if (g !== generation) throw new AuthError(0, "superseded", translate("common.459edfa35541"));
  session = res.token;
  keys = unlocked;
  clientRef = res.client ?? null;
  access = null;
  const user = toUser({ ...res.user, ...me });
  try {
    localStorage.setItem("annoy.lastUsername", user.name);
  } catch {
    /* not essential */
  }
  setAccount(user);
  await persist(user);
  void import("./servers.ts").then((m) => m.keepVaultInSync());
  return user;
}

/**
 * Sign-out (TODO item 2.3): authannoy ends this install's session, then
 * everything local goes except the username and the preferences, and the app
 * reloads to the sign-in screen.
 */
let signingOut: Promise<void> | null = null;
export function signOut(callApi = true): Promise<void> {
  return (signingOut ??= (async () => {
    const previous = session;
    cancelPending();
    void import("./servers.ts").then((m) => m.stopVaultSync());
    if (callApi && previous) await authRequest("/v1/auth/logout", { body: {}, token: previous, observe: false }).catch(() => undefined);
    session = keys = null;
    access = null;
    clientRef = null;
    await window.distopic?.auth?.logoutGlobal().catch(() => undefined);
    await wipeLocal();
    location.reload();
  })().finally(() => {
    signingOut = null;
  }));
}

/** Everything of the account on this install, except the username and the app's preferences. */
async function wipeLocal(): Promise<void> {
  const services = getState().services.map((s) => s.id);
  try {
    for (const key of Object.keys(localStorage)) if (!KEEP.has(key)) localStorage.removeItem(key);
    sessionStorage.clear();
  } catch {
    /* storage unavailable */
  }
  try {
    for (const db of (await indexedDB.databases?.()) ?? []) if (db.name) indexedDB.deleteDatabase(db.name);
  } catch {
    /* nothing stored */
  }
  await window.distopic?.auth?.wipe?.(services).catch(() => undefined);
}

// --- What other modules need ------------------------------------------------------------

/** True only when this run holds a live session with unlocked keys, not just a remembered name. */
export const signedIn = (): boolean => !!keys && !!session;
export const unlockedKeys = (): kdf.AccountKeys | null => keys;
export const currentGeneration = () => generation;
export const ownClientRef = () => clientRef;
/** The account's identity key, from which the DM key pair is derived (social/dm-crypto.ts). */
export const accountIdentityKey = (): Uint8Array | null => keys?.identity ?? null;

/** A 10-minute token for the Annoy cloud (usersannoy, chatannoy, cdnannoy). */
let access: { token: string; expiresAt: number; generation: number } | null = null;
let accessPending: Promise<string> | null = null;
export async function cloudAccessToken(force = false): Promise<string> {
  if (!session) throw new AuthError(401, "unauthorized", translate("common.b13c69621e91"));
  const g = generation;
  if (!force && access && access.generation === g && access.expiresAt - 90 > Date.now() / 1000) return access.token;
  accessPending ??= authRequest<{ token: string; expiresAt: number }>("/v1/auth/access", { body: {}, observe: false })
    .then((issued) => {
      if (g !== generation) throw new AuthError(0, "superseded", translate("common.459edfa35541"));
      access = { ...issued, generation: g };
      return issued.token;
    })
    .finally(() => {
      accessPending = null;
    });
  return accessPending;
}

// --- Installs of this account (TODO item 2.4) ------------------------------------------

export interface ClientInfo {
  id: string;
  name: string;
  firstSeen: string;
  lastLogin: string;
  lastSeen: string;
  signedIn: boolean;
  current: boolean;
}
export const listClients = () => authRequest<ClientInfo[]>("/v1/me/clients");
export const signOutClient = (id: string, forget = false) => authRequest(`/v1/me/clients/${encodeURIComponent(id)}${forget ? "?forget=1" : ""}`, { method: "DELETE" });

/** Account events relayed by chatannoy: a new sign-in elsewhere, or this install signed out remotely. */
export function handleAccountEvent(event: { t: string; d: { client?: string; name?: string; all?: boolean } }): void {
  if (event.t === "NEW_LOGIN" && event.d.client && event.d.client !== clientRef) toast(translate("auth.newLogin", { p0: event.d.name ?? "" }), 8000);
  if (event.t === "SESSION_REVOKED" && (event.d.all || (event.d.client && event.d.client === clientRef))) {
    toast(translate("auth.signedOutRemotely"), 8000);
    void signOut(false);
  }
}
