import type { ClientOp, GatewayEvent, VoiceMethod } from "@distopic/protocol";
import { deviceId } from "./lib/device-id.ts";
import { getState } from "./store.ts";
import { jitterRetryDelay, recoveryDeadline as getRecoveryDeadline, type TransportStatus } from "../../shared/connectivity.ts";

const HEARTBEAT_MS = 5_000;
const ACK_TIMEOUT_MS = 10_000;
const MAX_BACKOFF_MS = 30_000;
/** After the server says it's restarting, retry every second for this long instead of backing off. */
const RESTART_WINDOW_MS = 3 * 60_000;
export interface RecoveryEvent {
  cause: "network" | "timeout" | "service" | "system-offline";
  observedAt: number;
  attempt: number;
  nextRetryAt: number | null;
  recoveryDeadline: number | null;
  restartUntil: number | null;
}

/** One reconnecting gateway connection per account. */
export class Gateway {
  private socket: WebSocket | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private connectTimeout: ReturnType<typeof setTimeout> | null = null;
  private lastAck = 0;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private backoff = 1000;
  private restartUntil = 0;
  private closed = false;
  private invalid = false;
  private ready = false;
  private voiceSeq = 0;
  private attempts = 0;
  private offlineSince: number | null = null;
  private retryCause: RecoveryEvent["cause"] = "network";
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly onEvent: (event: GatewayEvent) => void,
    private readonly onStatus: (status: TransportStatus) => void,
    private readonly onReachable?: () => void,
    private readonly onRecovery?: (event: RecoveryEvent) => void,
  ) {}

  connect(): void {
    if (this.socket || this.invalid) return;
    if (getState().connectivity.network.status === "offline") {
      this.pauseForOffline();
      return;
    }
    this.closed = false;
    this.ready = false;
    this.attempts++;
    if (this.offlineSince !== null) this.reportRecovery(this.retryCause, null);
    this.onStatus("connecting");
    const socket = new WebSocket(`${this.url.replace(/^http/, "ws")}/gateway`);
    this.socket = socket;
    this.connectTimeout = setTimeout(() => { if (this.socket === socket) this.networkLost(); }, 30_000);
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.onReachable?.();
      this.send({ op: "identify", token: this.token, deviceId, presence: getState().settings.manualPresence, features: ["developmentActivity", "idlePresence", "manualPresence", "directCalls", "extendedActivity"] });
    };
    socket.onmessage = (e) => {
      if (this.socket !== socket) return;
      try { this.receive(JSON.parse(String(e.data)) as GatewayEvent); }
      catch { socket.close(1002, "Invalid gateway event"); }
    };
    socket.onclose = (e) => {
      if (this.socket !== socket) return;
      if (this.connectTimeout) clearTimeout(this.connectTimeout);
      this.connectTimeout = null;
      this.stopHeartbeat();
      this.ready = false;
      this.failPending("Conexão perdida");
      if (this.socket === socket) this.socket = null;
      if (this.closed) return;
      if (e.code === 4004) {
        this.invalid = true;
        this.onRecovery?.({ cause: "network", observedAt: Date.now(), attempt: this.attempts, nextRetryAt: null, recoveryDeadline: null, restartUntil: null });
        return this.onStatus("invalid");
      }
      if (e.code === 4010) {
        // During an update the new version is already answering: reconnect at
        // once, spread over a moment so every client doesn't land together.
        this.restartUntil = Date.now() + RESTART_WINDOW_MS;
        if (this.offlineSince === null) this.offlineSince = Date.now();
        this.onStatus("offline");
        if (getState().connectivity.network.status === "offline") return this.pauseForOffline();
        this.scheduleRetry("service", Math.random() * 300);
        return;
      }
      if (this.offlineSince === null) this.offlineSince = Date.now();
      this.onStatus("offline");
      if (getState().connectivity.network.status === "offline") return this.pauseForOffline();
      this.scheduleRetry("network", this.nextDelay());
    };
  }

  /** Do not wait for a dead TCP connection to notice an offline network. */
  networkLost(): void {
    if (this.closed || this.invalid) return;
    const socket = this.socket;
    this.socket = null;
    this.ready = false;
    if (this.connectTimeout) clearTimeout(this.connectTimeout);
    this.connectTimeout = null;
    this.stopHeartbeat();
    this.failPending("Conexão perdida");
    socket?.close();
    if (this.offlineSince === null) this.offlineSince = Date.now();
    this.onStatus("offline");
    if (getState().connectivity.network.status === "offline") return this.pauseForOffline();
    this.scheduleRetry("timeout", this.nextDelay());
  }

  /** Stop scheduled and active socket work while the operating system reports offline. */
  pauseForOffline(): void {
    if (this.closed || this.invalid) return;
    const socket = this.socket;
    this.socket = null;
    this.ready = false;
    if (this.connectTimeout) clearTimeout(this.connectTimeout);
    this.connectTimeout = null;
    this.stopHeartbeat();
    this.failPending("Conexão pausada enquanto o sistema está offline");
    socket?.close();
    if (this.offlineSince === null) this.offlineSince = Date.now();
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    this.onStatus("offline");
    this.reportRecovery("system-offline", null);
  }

  private scheduleRetry(cause: RecoveryEvent["cause"], baseDelay: number): void {
    if (this.retry) clearTimeout(this.retry);
    const delay = jitterRetryDelay(baseDelay);
    this.retryCause = cause;
    const nextRetryAt = Date.now() + delay;
    this.reportRecovery(cause, nextRetryAt);
    this.retry = setTimeout(() => { this.retry = null; this.connect(); }, delay);
  }

  private reportRecovery(cause: RecoveryEvent["cause"], nextRetryAt: number | null): void {
    const restartUntil = this.restartUntil || null;
    const deadline = getRecoveryDeadline(this.offlineSince, restartUntil);
    this.onRecovery?.({
      cause, observedAt: Date.now(), attempt: this.attempts, nextRetryAt,
      recoveryDeadline: deadline,
      restartUntil,
    });
  }

  /** A restarting server comes back within seconds; anything else backs off up to 30 s. */
  private nextDelay(): number {
    if (Date.now() < this.restartUntil) return 1000;
    const delay = this.backoff;
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
    return delay;
  }

  /** Skips the backoff wait: used when the network comes back or the user asks to retry. */
  reconnectNow(): void {
    if (this.closed || this.invalid || (this.socket && this.ready)) return;
    if (getState().connectivity.network.status === "offline") return;
    if (this.socket) this.networkLost();
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    this.backoff = 1000;
    this.connect();
  }

  close(): void {
    this.closed = true;
    this.ready = false;
    if (this.retry) clearTimeout(this.retry);
    if (this.connectTimeout) clearTimeout(this.connectTimeout);
    this.connectTimeout = null;
    this.stopHeartbeat();
    this.failPending("Conexão encerrada");
    this.socket?.close();
    this.socket = null;
  }

  /** HTTP can discover an expired session before the gateway does. */
  invalidateSession(): void {
    this.close();
    this.invalid = true;
    this.onStatus("invalid");
  }

  send(op: ClientOp): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(op));
  }

  voice<T = Record<string, unknown>>(method: VoiceMethod, data: Record<string, unknown> = {}): Promise<T> {
    const id = ++this.voiceSeq;
    return new Promise<T>((resolve, reject) => {
      if (this.socket?.readyState !== WebSocket.OPEN) return reject(new Error("Sem conexão com o servidor"));
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.send({ op: "voice", id, method, data });
    });
  }

  private receive(event: GatewayEvent): void {
    if (event.t === "READY") {
      this.ready = true;
      if (this.connectTimeout) clearTimeout(this.connectTimeout);
      this.connectTimeout = null;
      this.lastAck = Date.now();
      this.backoff = 1000;
      this.restartUntil = 0;
      this.attempts = 0;
      this.offlineSince = null;
      this.onRecovery?.({ cause: "network", observedAt: Date.now(), attempt: 0, nextRetryAt: null, recoveryDeadline: null, restartUntil: null });
      this.startHeartbeat();
      this.onStatus("ready");
    }
    if (event.t === "HEARTBEAT_ACK") this.lastAck = Date.now();
    if (event.t === "VOICE_REPLY") {
      const p = this.pending.get(event.d.id);
      this.pending.delete(event.d.id);
      if (event.d.ok) p?.resolve(event.d.data);
      else p?.reject(new Error(event.d.message));
      return;
    }
    this.onEvent(event);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => {
      if (Date.now() - this.lastAck >= ACK_TIMEOUT_MS) return this.networkLost();
      this.send({ op: "heartbeat" });
    }, HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  private failPending(message: string): void {
    for (const p of this.pending.values()) p.reject(new Error(message));
    this.pending.clear();
  }
}
