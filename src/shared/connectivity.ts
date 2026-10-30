/** Observations are session-local: cached data is never evidence of connectivity. */
export type TransportStatus = "connecting" | "ready" | "offline" | "invalid";
export interface NetworkObservation {
  // `onLine === true` only means the OS stopped reporting offline.
  status: "unknown" | "offline";
  observedAt: number | null;
}
export interface EndpointObservation {
  availability: "unknown" | "available" | "unavailable";
  authentication: "unknown" | "valid" | "invalid" | "forbidden";
  cause: "system-offline" | "network" | "timeout" | "service" | "unauthorized" | "forbidden" | null;
  observedAt: number | null;
  /** Number of attempts since the last READY event. */
  attempt: number;
  nextRetryAt: number | null;
  recoveryDeadline: number | null;
  restartUntil: number | null;
}

export const unknownEndpoint = (): EndpointObservation => ({
  availability: "unknown", authentication: "unknown", cause: null, observedAt: null,
  attempt: 0, nextRetryAt: null, recoveryDeadline: null, restartUntil: null,
});

/** Spread reconnect work while keeping the configured exponential ceiling. */
export function jitterRetryDelay(baseMs: number, random = Math.random): number {
  return Math.max(0, Math.round(baseMs * (0.75 + random() * 0.5)));
}

/** A server announced restart gets its own window; normal failures get one minute. */
export function recoveryDeadline(offlineSince: number | null, restartUntil: number | null): number | null {
  return restartUntil ?? (offlineSince === null ? null : offlineSince + 60_000);
}

export function observeNetwork(online: boolean, at: number): NetworkObservation {
  return { status: online ? "unknown" : "offline", observedAt: at };
}

/** Connecting is an attempt, not a new result. Preserve the last observation. */
export function observeTransport(previous: EndpointObservation, status: TransportStatus, at: number, network: NetworkObservation): EndpointObservation {
  if (status === "connecting") return previous;
  if (status === "ready") return { ...unknownEndpoint(), availability: "available", authentication: "valid", observedAt: at };
  if (status === "invalid") return { ...unknownEndpoint(), availability: "available", authentication: "invalid", cause: "unauthorized", observedAt: at };
  return { ...previous, availability: "unavailable", cause: network.status === "offline" ? "system-offline" : "network", observedAt: at, nextRetryAt: null };
}

/** A socket opening proves reachability, but does not authenticate the account. */
export function observeReachable(previous: EndpointObservation, at: number): EndpointObservation {
  return { ...previous, availability: "available", cause: null, observedAt: at, nextRetryAt: null };
}

export function observeHttp(previous: EndpointObservation, status: number, at: number, authenticated: boolean): EndpointObservation {
  const authentication = status === 401 ? "invalid" : status === 403 ? "forbidden"
    : status < 400 && authenticated ? "valid" : previous.authentication;
  const cause = status === 401 ? "unauthorized" : status === 403 ? "forbidden" : status >= 500 ? "service" : null;
  return { availability: status >= 500 ? "unavailable" : "available", authentication, cause, observedAt: at, nextRetryAt: null };
}

export function observeRequestFailure(previous: EndpointObservation, error: unknown, at: number, network: NetworkObservation): EndpointObservation {
  const timeout = error instanceof Error && (error.name === "TimeoutError" || ("kind" in error && error.kind === "timeout"));
  return { ...previous, availability: "unavailable", cause: network.status === "offline" ? "system-offline" : timeout ? "timeout" : "network", observedAt: at, nextRetryAt: null };
}

/** Only the selected account's area depends on its connection; Global is independent. */
export function affectedAccountId(
  view: { kind: string; accountId?: string | null },
  instances: Record<string, { status: TransportStatus }>,
  network: NetworkObservation,
): string | null {
  if (!["home", "server", "marketplace"].includes(view.kind) || !view.accountId) return null;
  return instances[view.accountId]?.status === "ready" && network.status !== "offline" ? null : view.accountId;
}
