import { cloudAccessToken } from "../auth/session.ts";

/**
 * HTTP to the Annoy cloud: usersannoy (profiles, friends), chatannoy (DMs,
 * status) and cdnannoy (images, encrypted DM files). Each call carries the
 * 10-minute access token; a 401 gets one retry with a fresh token.
 */
export interface CloudUrls {
  users: string;
  chat: string;
  cdn: string;
  /** devannoy: the store catalog and the account's integrations. */
  dev: string;
}

const DEFAULTS: CloudUrls = { users: "https://usersannoy.geg.dev.br", chat: "https://chatannoy.geg.dev.br", cdn: "https://cdnannoy.geg.dev.br", dev: "https://devannoy.geg.dev.br" };
let urls: CloudUrls = DEFAULTS;
let loaded: Promise<CloudUrls> | null = null;

/** Development and tests can point elsewhere with localStorage "annoy.cloudUrls" (JSON) or ANNOY_*_URL in the main process. */
export function cloudUrls(): Promise<CloudUrls> {
  return (loaded ??= (async () => {
    let next = DEFAULTS;
    try {
      next = { ...next, ...((await window.annoy?.auth?.cloudUrls?.()) ?? {}) };
    } catch {
      /* defaults */
    }
    try {
      const override = localStorage.getItem("annoy.cloudUrls");
      if (override) next = { ...next, ...(JSON.parse(override) as Partial<CloudUrls>) };
    } catch {
      /* ignore a bad override */
    }
    urls = next;
    return next;
  })());
}

export const currentCloudUrls = () => urls;

export class CloudError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface CloudRequest {
  method?: string;
  body?: unknown;
  raw?: BodyInit;
  contentType?: string;
  signal?: AbortSignal;
}

async function send(service: keyof CloudUrls, path: string, init: CloudRequest, force: boolean): Promise<Response> {
  const base = (await cloudUrls())[service];
  const token = await cloudAccessToken(force);
  const method = init.method ?? (init.body === undefined && init.raw === undefined ? "GET" : "POST");
  return fetch(base + path, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body !== undefined && { "content-type": "application/json" }),
      ...(init.raw !== undefined && { "content-type": init.contentType ?? "application/octet-stream" }),
    },
    body: init.raw ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
    signal: init.signal ?? AbortSignal.timeout(init.raw ? 120_000 : 15_000),
    redirect: "error",
  });
}

export async function cloudFetch(service: keyof CloudUrls, path: string, init: CloudRequest = {}): Promise<Response> {
  let res = await send(service, path, init, false);
  if (res.status === 401) {
    await res.body?.cancel();
    res = await send(service, path, init, true);
  }
  if (!res.ok) {
    let body: { error?: string; message?: string } = {};
    try {
      body = (await res.json()) as typeof body;
    } catch {
      /* not JSON */
    }
    throw new CloudError(res.status, body.error ?? "http_error", body.message ?? `HTTP ${res.status}`);
  }
  return res;
}

export async function cloud<T>(service: keyof CloudUrls, path: string, init: CloudRequest = {}): Promise<T> {
  return (await (await cloudFetch(service, path, init)).json()) as T;
}

/** Public URL of a profile image on cdnannoy. */
export const imageUrl = (id: string | null | undefined): string | null => (id ? `${urls.cdn}/i/${id}` : null);
