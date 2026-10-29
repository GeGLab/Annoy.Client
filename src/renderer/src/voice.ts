import { screenProfile } from "./lib/screen-profile.ts";
import type { Device } from "mediasoup-client";
import type { types as ms } from "mediasoup-client";
import type { GatewayEvent, MediaSource } from "@distopic/protocol";
import { clearTiles, dropTile, putTile } from "./media.ts";
import { MicGate } from "./mic.ts";
import type { Gateway } from "./gateway.ts";
import type { Settings } from "./store.ts";

type TransportInfo = {
  id: string;
  iceParameters: ms.IceParameters;
  iceCandidates: ms.IceCandidate[];
  dtlsParameters: ms.DtlsParameters;
};


/** Sender limits; the SFU forwards one encoding, so these bound everyone's download too. */
const VIDEO_PROFILES = {
  camera: { constraints: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }, maxBitrate: 1_200_000 },
  screen: { constraints: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30, max: 30 } }, maxBitrate: 3_500_000 },
} as const;

interface RemoteMedia {
  consumer: ms.Consumer;
  source: MediaSource;
  userId: string;
  audio: HTMLAudioElement | null;
}

/**
 * One voice connection: mic capture, gating (VAD or push-to-talk), a send
 * transport for our audio and a receive transport for everyone else's.
 */
export class VoiceSession {
  private device: Device | null = null;
  private send: ms.Transport | null = null;
  private recv: ms.Transport | null = null;
  private producer: ms.Producer | null = null;
  private video = new Map<"camera" | "screen", { producer: ms.Producer; track: MediaStreamTrack }>();
  private consumers = new Map<string, RemoteMedia>();
  private micGate: MicGate | null = null;
  private closed = false;
  canSpeak = true;
  canStream = false;

  constructor(
    private readonly gw: Gateway,
    readonly channelId: string,
    private readonly selfId: string,
    private settings: Settings,
    /** Called when a local video source starts or stops (including the OS "stop sharing" button). */
    private readonly onLocalMedia: () => void,
    /** Media can't reach the server even though signaling works: almost always the announced IP or a closed port. */
    private readonly onMediaFailed: () => void,
  ) {}

  async start(): Promise<void> {
    const joined = await this.gw.voice<{ rtpCapabilities: ms.RtpCapabilities; canSpeak: boolean; canStream: boolean }>("join", {
      channelId: this.channelId,
      selfMute: this.settings.selfMute,
      selfDeaf: this.settings.selfDeaf,
    });
    this.canSpeak = joined.canSpeak;
    this.canStream = joined.canStream;
    const { Device } = await import("mediasoup-client");
    if (this.closed) return;
    this.device = await Device.factory();
    await this.device.load({ routerRtpCapabilities: joined.rtpCapabilities });

    this.recv = this.device.createRecvTransport(await this.gw.voice<TransportInfo>("createTransport"));
    this.wireConnect(this.recv);

    if (this.canSpeak || this.canStream) {
      this.send = this.device.createSendTransport(await this.gw.voice<TransportInfo>("createTransport"));
      this.wireConnect(this.send);
      this.send.on("produce", ({ kind, rtpParameters, appData }, callback, errback) => {
        this.gw
          .voice<{ id: string }>("produce", { transportId: this.send!.id, kind, rtpParameters, source: appData.source })
          .then(callback, errback);
      });
    }
    if (this.canSpeak) await this.startMic();

    const { producers } = await this.gw.voice<{ producers: { producerId: string; userId: string; source: MediaSource }[] }>("getProducers");
    await Promise.all(producers.map((p) => this.consume(p.producerId, p.userId, p.source)));
  }

  private wireConnect(transport: ms.Transport): void {
    transport.on("connectionstatechange", (state) => {
      if (state === "failed" && !this.closed) this.onMediaFailed();
    });
    transport.on("connect", ({ dtlsParameters }, callback, errback) => {
      this.gw.voice("connectTransport", { transportId: transport.id, dtlsParameters }).then(() => callback(), errback);
    });
  }

  private async startMic(): Promise<void> {
    this.micGate = new MicGate(this.settings);
    const track = await this.micGate.start();
    this.producer = await this.send!.produce({
      track,
      codecOptions: { opusDtx: true, opusFec: true },
      stopTracks: false,
      appData: { source: "mic" },
    });
  }

  updateSettings(settings: Settings): void {
    const deviceChanged = settings.outputDeviceId !== this.settings.outputDeviceId;
    this.settings = settings;
    this.micGate?.update(settings);
    for (const { audio } of this.consumers.values()) {
      if (!audio) continue;
      audio.muted = settings.selfDeaf;
      if (deviceChanged) void this.applySink(audio);
    }
  }

  setPushToTalk(down: boolean): void {
    this.micGate?.setPushToTalk(down);
  }


  private async applySink(audio: HTMLAudioElement): Promise<void> {
    const sinkId = this.settings.outputDeviceId === "default" ? "" : this.settings.outputDeviceId;
    try {
      await audio.setSinkId(sinkId);
    } catch {
      // Device disappeared; keep the current output.
    }
  }

  // Video ---------------------------------------------------------------

  isSharing(source: "camera" | "screen"): boolean {
    return this.video.has(source);
  }

  /** Starts a camera, or a screen capture (the source was chosen beforehand, see client.ts). */
  async startVideo(source: "camera" | "screen", deviceId?: string): Promise<void> {
    if (!this.send || !this.canStream) throw new Error("Sem permissão para transmitir neste canal");
    if (this.video.has(source)) return;
    const profile = source === "screen" ? screenProfile(this.settings) : VIDEO_PROFILES.camera;
    const stream =
      source === "camera"
        ? await navigator.mediaDevices.getUserMedia({ video: { ...profile.constraints, ...(deviceId && deviceId !== "default" && { deviceId: { exact: deviceId } }) } })
        : await navigator.mediaDevices.getDisplayMedia({ video: profile.constraints, audio: false });
    const track = stream.getVideoTracks()[0];
    if (!track) throw new Error("Nenhuma imagem capturada");
    if (source === "screen") track.contentHint = "detail";
    if (this.closed) return void track.stop();
    const producer = await this.send.produce({
      track,
      encodings: [{ maxBitrate: profile.maxBitrate }],
      codecOptions: { videoGoogleStartBitrate: 1000 },
      appData: { source },
    });
    this.video.set(source, { producer, track });
    putTile({ key: `local:${source}`, userId: this.selfId, source, stream: new MediaStream([track]), local: true });
    // The OS "stop sharing" control (or an unplugged camera) ends the track.
    track.addEventListener("ended", () => void this.stopVideo(source));
    this.onLocalMedia();
  }

  async stopVideo(source: "camera" | "screen"): Promise<void> {
    const entry = this.video.get(source);
    if (!entry) return;
    this.video.delete(source);
    entry.producer.close();
    entry.track.stop();
    dropTile(`local:${source}`);
    this.onLocalMedia();
    if (!this.closed) await this.gw.voice("closeProducer", { producerId: entry.producer.id }).catch(() => undefined);
  }

  // Remote media --------------------------------------------------------

  private async consume(producerId: string, userId: string, source: MediaSource): Promise<void> {
    if (!this.device || !this.recv || this.closed || this.consumers.has(producerId)) return;
    const params = await this.gw.voice<{
      id: string;
      producerId: string;
      kind: ms.MediaKind;
      rtpParameters: ms.RtpParameters;
    }>("consume", { producerId, transportId: this.recv.id, rtpCapabilities: this.device.rtpCapabilities });
    const consumer = await this.recv.consume(params);
    let audio: HTMLAudioElement | null = null;
    if (consumer.kind === "audio") {
      audio = new Audio();
      audio.autoplay = true;
      audio.srcObject = new MediaStream([consumer.track]);
      audio.muted = this.settings.selfDeaf;
      await this.applySink(audio);
    } else {
      putTile({ key: producerId, userId, source: source === "screen" ? "screen" : "camera", stream: new MediaStream([consumer.track]), local: false });
    }
    this.consumers.set(producerId, { consumer, source, userId, audio });
    await this.gw.voice("resumeConsumer", { consumerId: consumer.id });
    if (audio) void audio.play().catch(() => undefined);
  }

  private dropConsumer(producerId: string): void {
    const entry = this.consumers.get(producerId);
    if (!entry) return;
    entry.consumer.close();
    if (entry.audio) entry.audio.srcObject = null;
    else dropTile(producerId);
    this.consumers.delete(producerId);
  }

  handleEvent(event: GatewayEvent): void {
    if (event.t === "VOICE_NEW_PRODUCER" && event.d.channelId === this.channelId) {
      void this.consume(event.d.producerId, event.d.userId, event.d.source).catch((err: unknown) => console.warn("consume failed", err));
    } else if (event.t === "VOICE_PRODUCER_CLOSED") {
      this.dropConsumer(event.d.producerId);
    }
  }

  /** `notifyServer` is false when the server already ended the session. */
  close(notifyServer = true): void {
    if (this.closed) return;
    this.closed = true;
    if (notifyServer) void this.gw.voice("leave").catch(() => undefined);
    for (const id of [...this.consumers.keys()]) this.dropConsumer(id);
    for (const { producer, track } of this.video.values()) {
      producer.close();
      track.stop();
    }
    this.video.clear();
    clearTiles();
    this.producer?.close();
    this.send?.close();
    this.recv?.close();
    this.micGate?.stop();
  }
}
