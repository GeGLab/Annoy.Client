import type { ClientOp, GatewayEvent, VoiceMethod } from "@distopic/protocol";

const HEARTBEAT_MS = 30_000;
const MAX_BACKOFF_MS = 30_000;
/** After the server says it's restarting, retry every second for this long instead of backing off. */
const RESTART_WINDOW_MS = 3 * 60_000;

type Status = "connecting" | "ready" | "offline" | "invalid";

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
  private voiceSeq = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly onEvent: (event: GatewayEvent) => void,
    private readonly onStatus: (status: Status) => void,
  ) {}

  connect(): void {
    if (this.socket) return;
    this.closed = false;
    this.onStatus("connecting");
    const socket = new WebSocket(`${this.url.replace(/^http/, "ws")}/gateway`);
    this.socket = socket;
    this.connectTimeout = setTimeout(() => { if (this.socket === socket) this.networkLost(); }, 30_000);
    socket.onopen = () => this.send({ op: "identify", token: this.token });
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
      this.failPending("Conexão perdida");
      if (this.socket === socket) this.socket = null;
      if (this.closed) return;
      if (e.code === 4004) return this.onStatus("invalid");
      if (e.code === 4010) this.restartUntil = Date.now() + RESTART_WINDOW_MS;
      this.onStatus("offline");
      this.retry = setTimeout(() => this.connect(), this.nextDelay());
    };
  }

  /** Do not wait for a dead TCP connection to notice an offline network. */
  networkLost(): void {
    if (this.closed) return;
    const socket = this.socket;
    this.socket = null;
    if (this.connectTimeout) clearTimeout(this.connectTimeout);
    this.connectTimeout = null;
    this.stopHeartbeat();
    this.failPending("Conexão perdida");
    socket?.close();
    this.onStatus("offline");
    if (this.retry) clearTimeout(this.retry);
    this.retry = setTimeout(() => { this.retry = null; this.connect(); }, this.nextDelay());
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
    if (this.closed || this.socket) return;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    this.backoff = 1000;
    this.connect();
  }

  close(): void {
    this.closed = true;
    if (this.retry) clearTimeout(this.retry);
    if (this.connectTimeout) clearTimeout(this.connectTimeout);
    this.connectTimeout = null;
    this.stopHeartbeat();
    this.failPending("Conexão encerrada");
    this.socket?.close();
    this.socket = null;
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
      if (this.connectTimeout) clearTimeout(this.connectTimeout);
      this.connectTimeout = null;
      this.lastAck = Date.now();
      this.backoff = 1000;
      this.restartUntil = 0;
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
      if (Date.now() - this.lastAck > HEARTBEAT_MS * 2) return this.networkLost();
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
