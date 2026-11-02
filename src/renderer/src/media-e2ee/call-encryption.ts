import {t as translate} from "../../../shared/localization/index.ts";
import type { MediaSource, VoiceMediaEvent } from "@distopic/protocol";
import type { FrameStats, StreamKind, TransformOptions } from "./sframe-worker.ts";

interface Signaling {
  voice<T = Record<string, unknown>>(method: "mediaCreate" | "mediaPropose" | "mediaCommit", data: Record<string, unknown>): Promise<T>;
}
type MediaBridge = NonNullable<NonNullable<Window["distopic"]>["media"]>;
interface ScriptTransformConstructor { new (worker: Worker, options: TransformOptions): unknown }
type Encodable = { transform?: unknown; createEncodedStreams?: () => { readable: ReadableStream; writable: WritableStream } };

/** One SFrame context per outgoing stream of this device, see the KID layout in annoy-sframe. */
const CONTEXTS: Record<MediaSource, number> = { mic: 0, camera: 1, screen: 2, screen_audio: 3 };
const ScriptTransform = (globalThis as { RTCRtpScriptTransform?: ScriptTransformConstructor }).RTCRtpScriptTransform;

/** The legacy encoded-streams API needs this flag on every RTCPeerConnection of the call. */
export const needsEncodedStreamsFlag = !ScriptTransform;

export function callEncryptionSupported(): boolean {
  const legacy = typeof RTCRtpSender !== "undefined" && "createEncodedStreams" in RTCRtpSender.prototype;
  return !!window.distopic?.media && (!!ScriptTransform || legacy);
}

function awaitPort(handle: Promise<{ handle: string }>): Promise<{ handle: string; port: MessagePort }> {
  return new Promise((resolve, reject) => {
    let wanted: string | null = null;
    const early = new Map<string, MessagePort>();
    const timer = setTimeout(() => finish(new Error(translate("common.ac5b18335e3f"))), 10_000);
    const listener = (event: MessageEvent) => {
      const id = (event.data as { annoyMediaPort?: unknown })?.annoyMediaPort;
      if (event.source !== window || typeof id !== "string" || !event.ports[0]) return;
      if (wanted === null) early.set(id, event.ports[0]);
      else if (id === wanted) finish(null, event.ports[0]);
    };
    const finish = (error: Error | null, port?: MessagePort) => {
      clearTimeout(timer);
      window.removeEventListener("message", listener);
      if (error || !port) reject(error ?? new Error("Canal de chaves ausente"));
      else resolve({ handle: wanted!, port });
    };
    window.addEventListener("message", listener);
    handle.then(({ handle }) => {
      wanted = handle;
      const port = early.get(handle);
      if (port) finish(null, port);
    }, (error: Error) => finish(error));
  });
}

/**
 * End-to-end encryption of one voice call: an MLS group per call (keys and device checks in
 * the main process) and an SFrame worker for the frames. The server only orders commits.
 */
export class CallEncryption {
  private handle: string | null = null;
  private callId: string | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  private keyed!: Promise<void>;
  private resolveKeyed!: () => void;
  private failures = 0;

  private constructor(
    private readonly bridge: MediaBridge,
    private readonly worker: Worker,
    private readonly signaling: Signaling,
    private readonly account: { url: string; token: string; userId: string },
    private readonly channelId: string,
    private readonly onError: (message: string) => void,
  ) {
    this.resetKeyed();
  }

  static async start(signaling: Signaling, account: { url: string; token: string; userId: string }, channelId: string, media: { callId: string | null }, onError: (message: string) => void): Promise<CallEncryption> {
    const bridge = window.distopic?.media;
    if (!bridge) throw new Error(translate("common.e40b5e791434"));
    const worker = new Worker(new URL("./sframe-worker.ts", import.meta.url), { type: "module", name: "annoy-sframe" });
    const call = new CallEncryption(bridge, worker, signaling, account, channelId, onError);
    worker.addEventListener("message", (event) => {
      if ((event.data as { type?: string })?.type === "failed") call.onError(translate("common.f91891cd6292"));
    });
    try {
      await call.begin(media.callId);
    } catch (error) {
      call.close();
      throw error;
    }
    return call;
  }

  private resetKeyed(): void {
    this.keyed = new Promise((resolve) => (this.resolveKeyed = resolve));
  }

  private async openHandle(): Promise<string> {
    const { handle, port } = await awaitPort(this.bridge.open(this.account.url, this.account.token, this.channelId, this.account.userId));
    this.worker.postMessage({ type: "keys", port }, [port]);
    this.handle = handle;
    return handle;
  }

  private async begin(existing: string | null): Promise<void> {
    let callId = existing;
    if (!callId) {
      const handle = await this.openHandle();
      const created = await this.bridge.create(handle);
      const reply = await this.signaling.voice<{ created: boolean; callId: string }>("mediaCreate", { callId: created.callId, binding: created.binding });
      if (reply.created) {
        this.callId = created.callId;
        this.resolveKeyed();
        return;
      }
      // Someone else created the call at the same time: join theirs.
      await this.bridge.close(handle);
      this.handle = null;
      callId = reply.callId;
    }
    const handle = await this.openHandle();
    const proposal = await this.bridge.propose(handle, callId);
    this.callId = callId;
    await this.signaling.voice("mediaPropose", { callId, keyPackage: proposal.keyPackage, binding: proposal.binding });
  }

  /** Resolves once this device holds the key of the current epoch. Media flows only then. */
  ready(): Promise<void> {
    return this.keyed;
  }

  handleEvent(event: VoiceMediaEvent): void {
    if (event.channelId !== this.channelId) return;
    const task = this.queue.catch(() => undefined).then(() => this.apply(event));
    this.queue = task.catch((error: Error) => {
      if (this.closed) return;
      this.failures++;
      this.onError(`Criptografia da chamada: ${error.message}`);
    });
  }

  private async apply(event: VoiceMediaEvent): Promise<void> {
    if (this.closed) return;
    const handle = this.handle;
    if (event.kind === "restart") {
      if (handle) await this.bridge.close(handle);
      this.handle = null;
      this.callId = null;
      this.resetKeyed();
      return this.begin(null);
    }
    if (!handle || event.callId !== this.callId) return;
    if (event.kind === "proposals") {
      const commit = await this.bridge.commit(handle, event);
      if (!commit) return;
      let accepted = false;
      try {
        await this.signaling.voice("mediaCommit", { callId: event.callId, epoch: commit.epoch, commit: commit.commit, welcome: commit.welcome, adds: commit.adds, removes: commit.removes });
        accepted = true;
      } finally {
        await this.bridge.settle(handle, commit.delivery, accepted);
      }
    } else if (event.kind === "commit") {
      const { removed } = await this.bridge.accept(handle, event);
      if (removed) this.onError(translate("common.71cf220b99c3"));
    } else if (event.kind === "welcome") {
      await this.bridge.welcome(handle, event);
      this.resolveKeyed();
    }
  }

  private transform(target: Encodable, options: TransformOptions): void {
    if (ScriptTransform) {
      target.transform = new ScriptTransform(this.worker, options);
      return;
    }
    const { readable, writable } = target.createEncodedStreams!();
    this.worker.postMessage({ type: "stream", readable, writable, options }, [readable as unknown as Transferable, writable as unknown as Transferable]);
  }

  /** Must run before the sender negotiates, so no frame ever leaves unencrypted. */
  protectSender(sender: RTCRtpSender, source: MediaSource, kind: StreamKind): void {
    this.transform(sender as unknown as Encodable, { direction: "send", kind, context: CONTEXTS[source] });
  }

  protectReceiver(receiver: RTCRtpReceiver, kind: StreamKind): void {
    this.transform(receiver as unknown as Encodable, { direction: "recv", kind, context: 0 });
  }

  roster(): Promise<{ userId: string; deviceId: string }[]> {
    return this.handle ? this.bridge.roster(this.handle) : Promise.resolve([]);
  }

  stats(): Promise<FrameStats> {
    return new Promise((resolve) => {
      const listener = (event: MessageEvent) => {
        if ((event.data as { type?: string })?.type !== "stats") return;
        this.worker.removeEventListener("message", listener);
        resolve((event.data as { stats: FrameStats }).stats);
      };
      this.worker.addEventListener("message", listener);
      this.worker.postMessage({ type: "stats" });
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.worker.postMessage({ type: "close" });
    // Let the worker wipe its keys before it is terminated.
    setTimeout(() => this.worker.terminate(), 200);
    if (this.handle) void this.bridge.close(this.handle).catch(() => undefined);
    this.handle = null;
  }
}
