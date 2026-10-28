// Voice session for instances using Cloudflare's Realtime SFU. One
// RTCPeerConnection carries everything; the Distopic server relays every
// negotiation to Cloudflare and decides what we may publish or receive.
import type { GatewayEvent, MediaSource } from "@distopic/protocol";
import type { Gateway } from "./gateway.ts";
import { clearTiles, dropTile, putTile } from "./media.ts";
import { MicGate } from "./mic.ts";
import type { Settings } from "./store.ts";

const VIDEO_PROFILES = {
  camera: { constraints: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }, maxBitrate: 1_200_000 },
  screen: { constraints: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30, max: 30 } }, maxBitrate: 3_500_000 },
} as const;

interface Remote {
  source: MediaSource;
  audio: HTMLAudioElement | null;
}

export class CloudflareVoiceSession {
  private pc: RTCPeerConnection | null = null;
  /** Offer/answer exchanges on one connection must not interleave. */
  private queue: Promise<unknown> = Promise.resolve();
  private mic: MicGate | null = null;
  private video = new Map<"camera" | "screen", { trackName: string; transceiver: RTCRtpTransceiver; track: MediaStreamTrack }>();
  private remote = new Map<string, Remote>();
  private closed = false;
  canSpeak = false;
  canStream = false;

  constructor(
    private readonly gw: Gateway,
    readonly channelId: string,
    private readonly selfId: string,
    private settings: Settings,
    private readonly onLocalMedia: () => void,
    private readonly onMediaFailed: () => void,
  ) {}

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  async start(): Promise<void> {
    const joined = await this.gw.voice<{ iceServers: RTCIceServer[]; canSpeak: boolean; canStream: boolean }>("join", {
      channelId: this.channelId,
      selfMute: this.settings.selfMute,
      selfDeaf: this.settings.selfDeaf,
    });
    this.canSpeak = joined.canSpeak;
    this.canStream = joined.canStream;
    const pc = new RTCPeerConnection({ iceServers: joined.iceServers, bundlePolicy: "max-bundle" });
    this.pc = pc;
    pc.addEventListener("connectionstatechange", () => {
      if (pc.connectionState === "failed" && !this.closed) this.onMediaFailed();
    });

    if (this.canSpeak) {
      this.mic = new MicGate(this.settings, (talking) => this.gw.send({ op: "speaking", speaking: talking }));
      const track = await this.mic.start();
      await this.publish(track, "audio", "mic");
    }
    const { producers } = await this.gw.voice<{ producers: { producerId: string; userId: string; source: MediaSource }[] }>("getProducers");
    for (const p of producers) await this.subscribe(p.producerId, p.userId, p.source);
  }

  private publish(track: MediaStreamTrack, kind: "audio" | "video", source: MediaSource, maxBitrate?: number) {
    return this.serial(async () => {
      const pc = this.pc!;
      const transceiver = pc.addTransceiver(track, { direction: "sendonly", ...(maxBitrate && { sendEncodings: [{ maxBitrate }] }) });
      await pc.setLocalDescription(await pc.createOffer());
      const res = await this.gw.voice<{ producerId: string; sdp: string }>("publish", { sdp: pc.localDescription!.sdp, mid: transceiver.mid, kind, source });
      await pc.setRemoteDescription({ type: "answer", sdp: res.sdp });
      return { trackName: res.producerId, transceiver };
    });
  }

  private subscribe(producerId: string, userId: string, source: MediaSource) {
    return this.serial(async () => {
      if (this.closed || this.remote.has(producerId) || !this.pc) return;
      const pc = this.pc;
      const res = await this.gw.voice<{ mid: string; kind: "audio" | "video"; sdp?: string; renegotiate: boolean }>("subscribe", { producerId });
      if (res.renegotiate && res.sdp) {
        await pc.setRemoteDescription({ type: "offer", sdp: res.sdp });
        await pc.setLocalDescription(await pc.createAnswer());
        await this.gw.voice("renegotiate", { sdp: pc.localDescription!.sdp });
      }
      const transceiver = pc.getTransceivers().find((t) => t.mid === res.mid);
      if (!transceiver) throw new Error("Faixa recebida não encontrada na conexão");
      const track = transceiver.receiver.track;
      let audio: HTMLAudioElement | null = null;
      if (res.kind === "audio") {
        audio = new Audio();
        audio.autoplay = true;
        audio.srcObject = new MediaStream([track]);
        audio.muted = this.settings.selfDeaf;
        await this.applySink(audio);
        void audio.play().catch(() => undefined);
      } else {
        putTile({ key: producerId, userId, source: source === "screen" ? "screen" : "camera", stream: new MediaStream([track]), local: false });
      }
      this.remote.set(producerId, { source, audio });
    });
  }

  /** Cloudflare already stopped forwarding; release what we built for it. */
  private dropRemote(producerId: string): void {
    const entry = this.remote.get(producerId);
    if (!entry) return;
    this.remote.delete(producerId);
    if (entry.audio) entry.audio.srcObject = null;
    else dropTile(producerId);
  }

  handleEvent(event: GatewayEvent): void {
    if (event.t === "VOICE_NEW_PRODUCER" && event.d.channelId === this.channelId) {
      void this.subscribe(event.d.producerId, event.d.userId, event.d.source).catch((err: unknown) => console.warn("subscribe failed", err));
    } else if (event.t === "VOICE_PRODUCER_CLOSED") {
      this.dropRemote(event.d.producerId);
    }
  }

  isSharing(source: "camera" | "screen"): boolean {
    return this.video.has(source);
  }

  async startVideo(source: "camera" | "screen", deviceId?: string): Promise<void> {
    if (!this.pc || !this.canStream) throw new Error("Sem permissão para transmitir neste canal");
    if (this.video.has(source)) return;
    const profile = VIDEO_PROFILES[source];
    const stream =
      source === "camera"
        ? await navigator.mediaDevices.getUserMedia({ video: { ...profile.constraints, ...(deviceId && deviceId !== "default" && { deviceId: { exact: deviceId } }) } })
        : await navigator.mediaDevices.getDisplayMedia({ video: profile.constraints, audio: false });
    const track = stream.getVideoTracks()[0];
    if (!track) throw new Error("Nenhuma imagem capturada");
    if (source === "screen") track.contentHint = "detail";
    if (this.closed) return void track.stop();
    const { trackName, transceiver } = await this.publish(track, "video", source, profile.maxBitrate);
    this.video.set(source, { trackName, transceiver, track });
    putTile({ key: `local:${source}`, userId: this.selfId, source, stream: new MediaStream([track]), local: true });
    track.addEventListener("ended", () => void this.stopVideo(source));
    this.onLocalMedia();
  }

  async stopVideo(source: "camera" | "screen"): Promise<void> {
    const entry = this.video.get(source);
    if (!entry) return;
    this.video.delete(source);
    entry.track.stop();
    dropTile(`local:${source}`);
    this.onLocalMedia();
    if (this.closed || !this.pc) return;
    const pc = this.pc;
    await this.serial(async () => {
      entry.transceiver.direction = "inactive";
      await pc.setLocalDescription(await pc.createOffer());
      const res = await this.gw.voice<{ sdp?: string }>("closeProducer", { producerId: entry.trackName, sdp: pc.localDescription!.sdp });
      if (res.sdp) await pc.setRemoteDescription({ type: "answer", sdp: res.sdp });
    }).catch((err: unknown) => console.warn("close track failed", err));
  }

  updateSettings(settings: Settings): void {
    const deviceChanged = settings.outputDeviceId !== this.settings.outputDeviceId;
    this.settings = settings;
    this.mic?.update(settings);
    for (const { audio } of this.remote.values()) {
      if (!audio) continue;
      audio.muted = settings.selfDeaf;
      if (deviceChanged) void this.applySink(audio);
    }
  }

  setPushToTalk(down: boolean): void {
    this.mic?.setPushToTalk(down);
  }

  private async applySink(audio: HTMLAudioElement): Promise<void> {
    try {
      await audio.setSinkId(this.settings.outputDeviceId === "default" ? "" : this.settings.outputDeviceId);
    } catch {
      // Device disappeared; keep the current output.
    }
  }

  close(notifyServer = true): void {
    if (this.closed) return;
    this.closed = true;
    if (notifyServer) void this.gw.voice("leave").catch(() => undefined);
    for (const id of [...this.remote.keys()]) this.dropRemote(id);
    for (const { track } of this.video.values()) track.stop();
    this.video.clear();
    clearTiles();
    this.mic?.stop();
    this.pc?.close();
  }
}
