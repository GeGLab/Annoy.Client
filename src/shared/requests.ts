export const READ_TIMEOUT_MS = 15_000;
export const WRITE_TIMEOUT_MS = 20_000;
/** File transfers have a separate bound; they are never retried automatically. */
export const UPLOAD_TIMEOUT_MS = 120_000;

export type RequestFailure = "network" | "timeout" | "unauthorized" | "forbidden" | "service" | "http" | "invalid-response";
export class RequestError extends Error {
  constructor(readonly status: number, message: string, readonly kind: RequestFailure = status === 401 ? "unauthorized" : status === 403 ? "forbidden" : status >= 500 ? "service" : "http", readonly code?: string) {
    super(message);
    this.name = "RequestError";
  }
}

export const isCancellation = (error: unknown): boolean => error instanceof Error && error.name === "AbortError";
export const cancelled = () => new DOMException("Operação cancelada", "AbortError");

/** Owns the timer and parent listener, including while the response body is being read. */
async function bounded<T>(operation: (signal: AbortSignal) => Promise<T>, parent: AbortSignal, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort(parent.reason ?? cancelled());
  parent.addEventListener("abort", abort, { once: true });
  if (parent.aborted) abort();
  const timer = setTimeout(() => controller.abort(new RequestError(0, "O servidor demorou para responder. Tente novamente.", "timeout")), timeoutMs);
  let onAbort: () => void = () => {};
  try {
    return await Promise.race([
      Promise.resolve().then(() => { controller.signal.throwIfAborted(); return operation(controller.signal); }).then((value) => { controller.signal.throwIfAborted(); return value; }),
      new Promise<never>((_, reject) => {
        onAbort = () => reject(controller.signal.reason);
        controller.signal.addEventListener("abort", onAbort, { once: true });
        if (controller.signal.aborted) onAbort();
      }),
    ]);
  } finally {
    clearTimeout(timer);
    parent.removeEventListener("abort", abort);
    controller.signal.removeEventListener("abort", onAbort);
  }
}

interface Pending {
  controller: AbortController;
  promise: Promise<unknown>;
  consumers: number;
  settled: boolean;
}

/** Per-account/session owner. Only explicitly keyed reads coalesce; writes never do. */
export class RequestScope {
  private readonly keyed = new Map<string, Pending>();
  private readonly pending = new Set<Pending>();
  private closed = false;
  generation = 0;

  invalidate(): void {
    this.generation++;
    this.keyed.clear();
    for (const entry of this.pending) entry.controller.abort(cancelled());
    this.pending.clear();
  }

  dispose(): void { this.closed = true; this.invalidate(); }

  run<T>(operation: (signal: AbortSignal) => Promise<T>, { key, signal, timeoutMs = READ_TIMEOUT_MS }: { key?: string; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<T> {
    if (this.closed || signal?.aborted) return Promise.reject(signal?.reason ?? cancelled());
    let entry = key ? this.keyed.get(key) : undefined;
    if (!entry) {
      const fresh: Pending = { controller: new AbortController(), promise: Promise.resolve(), consumers: 0, settled: false };
      fresh.promise = bounded(operation, fresh.controller.signal, timeoutMs).finally(() => {
        fresh.settled = true;
        this.pending.delete(fresh);
        if (key && this.keyed.get(key) === fresh) this.keyed.delete(key);
      });
      entry = fresh;
      this.pending.add(entry);
      if (key) this.keyed.set(key, entry);
    }
    const shared = entry;
    shared.consumers++;
    return new Promise<T>((resolve, reject) => {
      let finished = false;
      const finish = (complete: () => void) => {
        if (finished) return;
        finished = true;
        signal?.removeEventListener("abort", abort);
        shared.consumers--;
        if (!shared.consumers && !shared.settled) {
          if (key && this.keyed.get(key) === shared) this.keyed.delete(key);
          shared.controller.abort(cancelled());
        }
        complete();
      };
      const abort = () => finish(() => reject(signal?.reason ?? cancelled()));
      signal?.addEventListener("abort", abort, { once: true });
      shared.promise.then((value) => finish(() => resolve(value as T)), (error: unknown) => finish(() => reject(error)));
      if (signal?.aborted) abort();
    });
  }
}

export async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let body: unknown;
  try { body = text ? JSON.parse(text) : {}; }
  catch { if (response.ok) throw new RequestError(response.status, "O servidor retornou uma resposta inválida. Tente novamente.", "invalid-response"); }
  if (!response.ok) {
    const message = typeof body === "object" && body !== null && "message" in body && typeof body.message === "string" ? body.message
      : response.status === 401 ? "Sua sessão expirou. Entre novamente."
      : response.status === 403 ? "Você não tem permissão para esta ação."
      : response.status >= 500 ? "O serviço está indisponível. Tente novamente."
      : `Não foi possível concluir a solicitação (HTTP ${response.status}).`;
    const code = typeof body === "object" && body !== null && "error" in body && typeof body.error === "string" ? body.error : undefined;
    throw new RequestError(response.status, message, undefined, code);
  }
  return body as T;
}

export async function fetchJson<T>(url: string, init: RequestInit, signal: AbortSignal): Promise<{ data: T; status: number }> {
  try {
    const response = await fetch(url, { ...init, signal });
    const data = await parseResponse<T>(response);
    signal.throwIfAborted();
    return { data, status: response.status };
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof RequestError || isCancellation(error)) throw error;
    throw new RequestError(0, "Não foi possível alcançar o servidor. Verifique a conexão e tente novamente.", "network");
  }
}

export function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason ?? cancelled());
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); };
    const abort = () => { cleanup(); reject(signal.reason ?? cancelled()); };
    const timer = setTimeout(() => { cleanup(); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}
