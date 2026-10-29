import type { ApiError, AuthResponse, DiscordLoginBegin, DiscordLoginPoll, InstanceInfo } from "@distopic/protocol";

export class RequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

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
export async function findInstance(input: string): Promise<{ url: string; info: InstanceInfo }> {
  const urls = candidateUrls(input);
  let lastError: unknown;
  for (const url of urls) {
    try {
      // A host that drops HTTPS silently must not stall the fallback.
      const res = await fetch(`${url}/api/info`, { signal: AbortSignal.timeout(urls.length > 1 ? 5000 : 15000) });
      const info = await parse<InstanceInfo>(res);
      if (typeof info?.name === "string") return { url, info };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof RequestError ? lastError : new TypeError("unreachable");
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  const body: unknown = text ? JSON.parse(text) : {};
  if (!res.ok) throw new RequestError(res.status, (body as Partial<ApiError>).message ?? `HTTP ${res.status}`);
  return body as T;
}

export async function fetchInfo(url: string): Promise<InstanceInfo> {
  return parse(await fetch(`${url}/api/info`));
}

export async function authenticate(
  url: string,
  mode: "login" | "register",
  body: { username: string; password: string; displayName?: string; inviteCode?: string },
): Promise<AuthResponse> {
  return parse(
    await fetch(`${url}/api/auth/${mode}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

const POLL_MS = 1500;
const POLL_TIMEOUT_MS = 10 * 60_000;

/**
 * Runs "Entrar com Discord": opens Discord's authorize page in the system
 * browser and polls the Annoy server until the browser leg finishes.
 * `begin` is the (optionally authenticated) call that starts the login.
 */
export async function discordLogin(url: string, begin: () => Promise<DiscordLoginBegin>, signal: AbortSignal): Promise<Extract<DiscordLoginPoll, { status: "done" }>> {
  const { url: authorizeUrl, handoff } = await begin();
  window.open(authorizeUrl, "_blank");
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    if (signal.aborted) throw new Error("Cancelado");
    const result = await parse<DiscordLoginPoll>(
      await fetch(`${url}/api/auth/discord/poll`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handoff }),
        signal,
      }),
    );
    if (result.status === "done") return result;
    if (result.status === "error") throw new Error(result.message);
  }
  throw new Error("Tempo esgotado esperando o Discord");
}

export async function beginDiscordLogin(url: string, inviteCode?: string): Promise<DiscordLoginBegin> {
  return parse(
    await fetch(`${url}/api/auth/discord/begin`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(inviteCode ? { inviteCode } : {}),
    }),
  );
}

export class Api {
  constructor(
    readonly baseUrl: string,
    private readonly token: string,
  ) {}

  async request<T = unknown>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const res = await fetch(`${this.baseUrl}/api${path}`, {
      signal,
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(body !== undefined && { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return parse<T>(res);
  }

  get = <T>(path: string) => this.request<T>("GET", path);
  post = <T>(path: string, body: unknown = {}) => this.request<T>("POST", path, body);
  patch = <T>(path: string, body: unknown) => this.request<T>("PATCH", path, body);
  put = <T>(path: string, body: unknown = {}) => this.request<T>("PUT", path, body);
  del = <T>(path: string) => this.request<T>("DELETE", path);

  async uploadAvatar<T>(photo: Blob): Promise<T> {
    const body = new FormData(); body.append("avatar", photo, "avatar.webp");
    return parse<T>(await fetch(`${this.baseUrl}/api/users/@me/avatar`, { method: "POST", headers: { authorization: `Bearer ${this.token}` }, body, signal: AbortSignal.timeout(20_000) }));
  }

  async sendMessage<T>(channelId: string, content: string, files: File[], replyToId: string | null): Promise<T> {
    if (files.length === 0) return this.post<T>(`/channels/${channelId}/messages`, { content, replyToId });
    const form = new FormData();
    form.append("content", content);
    if (replyToId) form.append("replyToId", replyToId);
    for (const f of files) form.append("files", f, f.name);
    const res = await fetch(`${this.baseUrl}/api/channels/${channelId}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}` },
      body: form,
    });
    return parse<T>(res);
  }

  /** Attachment URLs are server-relative. */
  resolve(path: string): string {
    return path.startsWith("http") ? path : `${this.baseUrl}${path}`;
  }
}
