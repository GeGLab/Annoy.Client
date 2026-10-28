import type { ClientOp, GatewayEvent, VoiceMethod } from "@distopic/protocol";

const HEARTBEAT_MS = 30_000;
const MAX_BACKOFF_MS = 30_000;

type Status = "connecting" | "ready" | "offline" | "invalid";

/** One reconnecting gateway connection per account. */
export class Gateway {
  private socket: WebSocket | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private backoff = 1000;
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
    this.closed = false;
    this.onStatus("connecting");
    const socket = new WebSocket(`${this.url.replace(/^http/, "ws")}/gateway`);
    this.socket = socket;
    socket.onopen = () => this.send({ op: "identify", token: this.token });
    socket.onmessage = (e) => this.receive(JSON.parse(String(e.data)) as GatewayEvent);
    socket.onclose = (e) => {
      this.stopHeartbeat();
      this.failPending("Conexão perdida");
      if (this.socket === socket) this.socket = null;
      if (this.closed) return;
      if (e.code === 4004) return this.onStatus("invalid");
      this.onStatus("offline");
      this.retry = setTimeout(() => this.connect(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
    };
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
    this.stopHeartbeat();
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
      this.backoff = 1000;
      this.startHeartbeat();
      this.onStatus("ready");
    }
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
    this.heartbeat = setInterval(() => this.send({ op: "heartbeat" }), HEARTBEAT_MS);
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
