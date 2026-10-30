import type { AuthResponse, DiscordLoginBegin, DiscordLoginPoll, InstanceInfo } from "@distopic/protocol";
import { abortableDelay, cancelled, fetchJson, isCancellation, parseResponse, READ_TIMEOUT_MS, RequestError, RequestScope, UPLOAD_TIMEOUT_MS, WRITE_TIMEOUT_MS } from "../../shared/requests.ts";
export { RequestError } from "../../shared/requests.ts";

const publicRequests = new RequestScope();
const publicJson = <T>(url: string, init: RequestInit = {}, signal?: AbortSignal, timeoutMs = init.method === "POST" ? WRITE_TIMEOUT_MS : READ_TIMEOUT_MS) =>
  publicRequests.run((active) => fetchJson<T>(url, init, active), { signal, timeoutMs, key: !init.method || init.method === "GET" ? url : undefined }).then((result) => result.data);

export const DEFAULT_PORT = 8787;

/**
 * Addresses to try for what the user typed: a full URL is used as is. A bare
 * name ("chat.example.com") is tried over HTTPS first, as behind a proxy or
 * tunnel, then on the default Annoy port, TeamSpeak style ("192.168.0.10").
 */
export function candidateUrls(input: string): string[] {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (/^https?:\/\//i.test(trimmed)) return [new URL(trimmed).origin];
  const bare = new URL(`http://${trimmed}`);
  const secure = new URL(`https://${trimmed}`).origin;
  if (bare.port) return [bare.origin, secure];
  bare.port = String(DEFAULT_PORT);
  return [secure, bare.origin];
}

/** Finds the Annoy server behind what the user typed, trying each candidate address in turn. */
export async function findInstance(input: string, signal?: AbortSignal): Promise<{ url: string; info: InstanceInfo }> {
  const urls = candidateUrls(input);
  let lastError: unknown;
  for (const url of urls) {
    try {
      // A host that drops HTTPS silently must not stall the fallback.
      const info = await publicJson<InstanceInfo>(`${url}/api/info`, {}, signal, urls.length > 1 ? 5000 : READ_TIMEOUT_MS);
      if (typeof info?.name === "string") return { url, info };
    } catch (err) {
      if (isCancellation(err)) throw err;
      lastError = err;
    }
  }
  throw lastError instanceof RequestError ? lastError : new TypeError("unreachable");
}

export async function fetchInfo(url: string, signal?: AbortSignal): Promise<InstanceInfo> {
  return publicJson(`${url}/api/info`, {}, signal);
}

export async function authenticate(
  url: string,
  mode: "login" | "register",
  body: { username: string; password: string; displayName?: string; inviteCode?: string },
  signal?: AbortSignal,
): Promise<AuthResponse> {
  return publicJson(`${url}/api/auth/${mode}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }, signal);
}

const POLL_MS = 1500;
const POLL_TIMEOUT_MS = 10 * 60_000;

/**
 * Runs "Entrar com Discord": opens Discord's authorize page in the system
 * browser and polls the Annoy server until the browser leg finishes.
 * `begin` is the (optionally authenticated) call that starts the login.
 */
export async function discordLogin(url: string, begin: () => Promise<DiscordLoginBegin>, signal: AbortSignal): Promise<Extract<DiscordLoginPoll, { status: "done" }>> {
  signal.throwIfAborted();
  const { url: authorizeUrl, handoff } = await begin();
  signal.throwIfAborted();
  window.open(authorizeUrl, "_blank");
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await abortableDelay(POLL_MS, signal);
    const result = await publicJson<DiscordLoginPoll>(`${url}/api/auth/discord/poll`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handoff }),
      }, signal, Math.min(WRITE_TIMEOUT_MS, deadline - Date.now()));
    if (result.status === "done") return result;
    if (result.status === "error") throw new Error(result.message);
  }
  throw new Error("Tempo esgotado esperando o Discord");
}

export async function beginDiscordLogin(url: string, inviteCode?: string, signal?: AbortSignal): Promise<DiscordLoginBegin> {
  return publicJson(`${url}/api/auth/discord/begin`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(inviteCode ? { inviteCode } : {}),
    }, signal);
}

export class Api {
  private readonly scope = new RequestScope();

  constructor(
    readonly baseUrl: string,
    private readonly token: string,
    private readonly canWrite: () => boolean = () => true,
    private readonly observed?: (result: number | RequestError) => void,
  ) {}

  get generation(): number { return this.scope.generation; }
  cancelPending(): void { this.scope.invalidate(); }
  dispose(): void { this.scope.dispose(); }

  private observe<T>(promise: Promise<{ data: T; status: number }>, mutation = false): Promise<T> {
    const generation = this.scope.generation;
    return promise.then((result) => {
      if (generation !== this.scope.generation) throw cancelled();
      this.observed?.(result.status);
      return result.data;
    }, (error: unknown) => {
      if (generation !== this.scope.generation) throw cancelled();
      if (mutation && error instanceof RequestError && error.kind === "timeout")
        error = new RequestError(0, "Não foi possível confirmar a operação. Verifique o resultado antes de tentar novamente.", "timeout");
      if (error instanceof RequestError) this.observed?.(error);
      throw error;
    });
  }

  private fetch<T>(path: string, init: RequestInit, signal: AbortSignal | undefined, timeoutMs: number, key?: string): Promise<T> {
    return this.observe(this.scope.run((active) => fetchJson<T>(`${this.baseUrl}/api${path}`, init, active), { signal, timeoutMs, key }), init.method !== "GET" && init.method !== "HEAD");
  }

  private requireConnection(): void {
    if (!this.canWrite()) throw new Error("Sem conexão com o servidor. Aguarde a reconexão para continuar.");
  }

  async request<T = unknown>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    if (method !== "GET" && method !== "HEAD") this.requireConnection();
    return this.fetch<T>(path, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(body !== undefined && { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, signal, method === "GET" || method === "HEAD" ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS, method === "GET" ? `${method}:${path}` : undefined);
  }

  get = <T>(path: string, signal?: AbortSignal) => this.request<T>("GET", path, undefined, signal);
  post = <T>(path: string, body: unknown = {}, signal?: AbortSignal) => this.request<T>("POST", path, body, signal);
  patch = <T>(path: string, body: unknown, signal?: AbortSignal) => this.request<T>("PATCH", path, body, signal);
  put = <T>(path: string, body: unknown = {}, signal?: AbortSignal) => this.request<T>("PUT", path, body, signal);
  del = <T>(path: string, signal?: AbortSignal) => this.request<T>("DELETE", path, undefined, signal);

  async uploadServerIcon<T>(serverId: string, photo: Blob, signal?: AbortSignal): Promise<T> {
    this.requireConnection();
    const body = new FormData(); body.append("icon", photo, "icon");
    return this.fetch(`/servers/${serverId}/icon`, { method: "POST", headers: { authorization: `Bearer ${this.token}` }, body }, signal, WRITE_TIMEOUT_MS);
  }

  async uploadAvatar<T>(photo: Blob, signal?: AbortSignal): Promise<T> {
    this.requireConnection();
    const body = new FormData(); body.append("avatar", photo, "avatar.webp");
    return this.fetch("/users/@me/avatar", { method: "POST", headers: { authorization: `Bearer ${this.token}` }, body }, signal, WRITE_TIMEOUT_MS);
  }

  async sendMessage<T>(channelId: string, content: string, files: File[], replyToId: string | null, signal?: AbortSignal): Promise<T> {
    this.requireConnection();
    if (files.length === 0) return this.post<T>(`/channels/${channelId}/messages`, { content, replyToId }, signal);
    const form = new FormData();
    form.append("content", content);
    if (replyToId) form.append("replyToId", replyToId);
    for (const f of files) form.append("files", f, f.name);
    return this.fetch<T>(`/channels/${channelId}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}` },
      body: form,
    }, signal, UPLOAD_TIMEOUT_MS);
  }

  /** Like sendMessage with files, reporting upload progress from 0 to 1. */
  uploadMessage<T>(channelId: string, content: string, files: File[], onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<T> {
    if (!this.canWrite()) return Promise.reject(new Error("Sem conexão com o servidor. Aguarde a reconexão para continuar."));
    const form = new FormData();
    form.append("content", content);
    for (const f of files) form.append("files", f, f.name);
    return this.observe(this.scope.run<{ data: T; status: number }>((active) => new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      let settled = false;
      const finish = (complete: () => void) => {
        if (settled) return;
        settled = true;
        active.removeEventListener("abort", abort);
        xhr.onload = xhr.onerror = xhr.onabort = null;
        xhr.upload.onprogress = null;
        complete();
      };
      const abort = () => { xhr.abort(); finish(() => reject(active.reason)); };
      xhr.open("POST", `${this.baseUrl}/api/channels/${channelId}/messages`);
      xhr.setRequestHeader("authorization", `Bearer ${this.token}`);
      xhr.upload.onprogress = (e) => !active.aborted && e.lengthComputable && onProgress(e.loaded / e.total);
      xhr.onload = () => void parseResponse<T>(new Response(xhr.responseText || null, { status: xhr.status })).then(
        (data) => finish(() => active.aborted ? reject(active.reason) : resolve({ data, status: xhr.status })),
        (error: unknown) => finish(() => reject(error)),
      );
      xhr.onerror = () => finish(() => reject(new RequestError(0, "Falha de rede ao enviar. Tente novamente.", "network")));
      xhr.onabort = () => finish(() => reject(active.reason ?? new DOMException("Envio cancelado", "AbortError")));
      active.addEventListener("abort", abort, { once: true });
      try { active.throwIfAborted(); xhr.send(form); }
      catch (error) { finish(() => reject(error)); }
    }), { signal, timeoutMs: UPLOAD_TIMEOUT_MS }), true);
  }

  /** Attachment URLs are server-relative. */
  resolve(path: string): string {
    return path.startsWith("http") ? path : `${this.baseUrl}${path}`;
  }
}
