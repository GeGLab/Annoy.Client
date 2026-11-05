import { cloudAccessToken } from "../auth/session.ts";
import { cloudUrls } from "./cloud.ts";

/**
 * The one live connection of the Annoy account to chatannoy: status, friends,
 * DMs and direct-call signaling, whatever servers are open. Reconnects with
 * backoff, keeps a heartbeat and renews the access token before it expires.
 */
export type CloudEvent = { t: string; d: any };

const MAX_BACKOFF_MS = 30_000;
const REAUTH_MS = 7 * 60_000;

export class CloudGateway {
  private socket: WebSocket | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private reauth: ReturnType<typeof setInterval> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private backoff = 1000;
  private closed = false;
  private readonly device: string;
  private readonly hello: () => Record<string, unknown>;
  private readonly onEvent: (event: CloudEvent) => void;
  private readonly onStatus: (status: "connecting" | "ready" | "offline") => void;

  constructor(options: { device: string; hello: () => Record<string, unknown>; onEvent: (event: CloudEvent) => void; onStatus: (status: "connecting" | "ready" | "offline") => void }) {
    this.device = options.device;
    this.hello = options.hello;
    this.onEvent = options.onEvent;
    this.onStatus = options.onStatus;
  }

  async connect(): Promise<void> {
    if (this.socket || this.closed) return;
    this.onStatus("connecting");
    let url: URL, token: string;
    try {
      url = new URL("/v1/gateway", (await cloudUrls()).chat);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      token = await cloudAccessToken();
    } catch {
      return this.scheduleRetry();
    }
    if (this.closed || this.socket) return;
    const socket = new WebSocket(url.toString());
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.send({ op: "hello", token, device: this.device, ...this.hello() });
    };
    socket.onmessage = (message) => {
      if (this.socket !== socket) return;
      let event: CloudEvent;
      try {
        event = JSON.parse(String(message.data)) as CloudEvent;
      } catch {
        return socket.close(1002, "invalid json");
      }
      if (event.t === "READY") {
        this.backoff = 1000;
        this.startTimers(event.d.heartbeatInterval ?? 30_000);
        this.onStatus("ready");
      }
      this.onEvent(event);
    };
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.stopTimers();
      if (this.closed) return;
      this.onStatus("offline");
      // 4004: token refused. Get a fresh one on the next try.
      if (event.code === 4004) void cloudAccessToken(true).catch(() => undefined);
      this.scheduleRetry();
    };
    socket.onerror = () => undefined;
  }

  private scheduleRetry(): void {
    if (this.closed || this.retry) return;
    this.onStatus("offline");
    const delay = this.backoff * (0.75 + Math.random() * 0.5);
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
    this.retry = setTimeout(() => {
      this.retry = null;
      void this.connect();
    }, delay);
  }

  private startTimers(heartbeatMs: number): void {
    this.stopTimers();
    this.heartbeat = setInterval(() => this.send({ op: "heartbeat" }), heartbeatMs);
    this.reauth = setInterval(async () => {
      try {
        this.send({ op: "reauth", token: await cloudAccessToken() });
      } catch {
        /* the next reconnect asks again */
      }
    }, REAUTH_MS);
  }

  private stopTimers(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.reauth) clearInterval(this.reauth);
    this.heartbeat = this.reauth = null;
  }

  /** Reconnect now (network back, app resumed). */
  nudge(): void {
    if (this.socket || this.closed) return;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    this.backoff = 1000;
    void this.connect();
  }

  send(op: Record<string, unknown>): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(op));
    return true;
  }

  close(): void {
    this.closed = true;
    if (this.retry) clearTimeout(this.retry);
    this.stopTimers();
    const socket = this.socket;
    this.socket = null;
    socket?.close(1000, "signed out");
  }
}
