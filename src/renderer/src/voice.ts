import { Device } from "mediasoup-client";
import type { types as ms } from "mediasoup-client";
import type { GatewayEvent } from "@distopic/protocol";
import type { Gateway } from "./gateway.ts";
import type { Settings } from "./store.ts";

type TransportInfo = {
  id: string;
  iceParameters: ms.IceParameters;
  iceCandidates: ms.IceCandidate[];
  dtlsParameters: ms.DtlsParameters;
};

const VAD_HOLD_MS = 400;

/**
 * One voice connection: mic capture, gating (VAD or push-to-talk), a send
 * transport for our audio and a receive transport for everyone else's.
 */
export class VoiceSession {
  private device: Device | null = null;
  private send: ms.Transport | null = null;
  private recv: ms.Transport | null = null;
  private producer: ms.Producer | null = null;
  private consumers = new Map<string, { consumer: ms.Consumer; audio: HTMLAudioElement }>();
  private mic: MediaStream | null = null;
  /** The track we transmit; gating toggles `enabled` while the raw mic keeps feeding the analyser. */
  private outTrack: MediaStreamTrack | null = null;
  private audioCtx: AudioContext | null = null;
  private vadTimer: ReturnType<typeof setInterval> | null = null;
  private lastVoiceAt = 0;
  private pttDown = false;
  private closed = false;
  canSpeak = true;

  constructor(
    private readonly gw: Gateway,
    readonly channelId: string,
    private settings: Settings,
  ) {}

  async start(): Promise<void> {
    const joined = await this.gw.voice<{ rtpCapabilities: ms.RtpCapabilities; canSpeak: boolean }>("join", {
      channelId: this.channelId,
      selfMute: this.settings.selfMute,
      selfDeaf: this.settings.selfDeaf,
    });
    this.canSpeak = joined.canSpeak;
    this.device = await Device.factory();
    await this.device.load({ routerRtpCapabilities: joined.rtpCapabilities });

    this.recv = this.device.createRecvTransport(await this.gw.voice<TransportInfo>("createTransport"));
    this.wireConnect(this.recv);

    if (this.canSpeak) {
      this.send = this.device.createSendTransport(await this.gw.voice<TransportInfo>("createTransport"));
      this.wireConnect(this.send);
      this.send.on("produce", ({ kind, rtpParameters }, callback, errback) => {
        this.gw
          .voice<{ id: string }>("produce", { transportId: this.send!.id, kind, rtpParameters })
          .then(callback, errback);
      });
      await this.startMic();
    }

    const { producers } = await this.gw.voice<{ producers: { producerId: string }[] }>("getProducers");
    await Promise.all(producers.map((p) => this.consume(p.producerId)));
  }

  private wireConnect(transport: ms.Transport): void {
    transport.on("connect", ({ dtlsParameters }, callback, errback) => {
      this.gw.voice("connectTransport", { transportId: transport.id, dtlsParameters }).then(() => callback(), errback);
    });
  }

  private async startMic(): Promise<void> {
    const deviceId = this.settings.inputDeviceId === "default" ? undefined : { exact: this.settings.inputDeviceId };
    this.mic = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const raw = this.mic.getAudioTracks()[0]!;
    this.outTrack = raw.clone();
    this.producer = await this.send!.produce({
      track: this.outTrack,
      codecOptions: { opusDtx: true, opusFec: true },
      stopTracks: false,
    });
    this.startGate(raw);
  }

  private startGate(raw: MediaStreamTrack): void {
    this.audioCtx = new AudioContext();
    const analyser = this.audioCtx.createAnalyser();
    analyser.fftSize = 512;
    this.audioCtx.createMediaStreamSource(new MediaStream([raw])).connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    this.vadTimer = setInterval(() => {
      analyser.getByteTimeDomainData(buf);
      let peak = 0;
      for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
      // Map threshold 0..100 onto the 0..128 amplitude range.
      if ((peak / 128) * 100 >= this.settings.vadThreshold) this.lastVoiceAt = performance.now();
      this.applyGate();
    }, 50);
    this.applyGate();
  }

  private applyGate(): void {
    if (!this.outTrack) return;
    const s = this.settings;
    const open =
      !s.selfMute &&
      !s.selfDeaf &&
      (s.inputMode === "ptt" ? this.pttDown : performance.now() - this.lastVoiceAt < VAD_HOLD_MS);
    if (this.outTrack.enabled !== open) this.outTrack.enabled = open;
  }

  updateSettings(settings: Settings): void {
    const deviceChanged = settings.outputDeviceId !== this.settings.outputDeviceId;
    this.settings = settings;
    this.applyGate();
    for (const { audio } of this.consumers.values()) {
      audio.muted = settings.selfDeaf;
      if (deviceChanged) void this.applySink(audio);
    }
  }

  setPushToTalk(down: boolean): void {
    this.pttDown = down;
    this.applyGate();
  }

  private async applySink(audio: HTMLAudioElement): Promise<void> {
    const sinkId = this.settings.outputDeviceId === "default" ? "" : this.settings.outputDeviceId;
    try {
      await audio.setSinkId(sinkId);
    } catch {
      // Device disappeared; keep the current output.
    }
  }

  private async consume(producerId: string): Promise<void> {
    if (!this.device || !this.recv || this.closed) return;
    const params = await this.gw.voice<{
      id: string;
      producerId: string;
      kind: ms.MediaKind;
      rtpParameters: ms.RtpParameters;
    }>("consume", { producerId, transportId: this.recv.id, rtpCapabilities: this.device.rtpCapabilities });
    const consumer = await this.recv.consume(params);
    const audio = new Audio();
    audio.autoplay = true;
    audio.srcObject = new MediaStream([consumer.track]);
    audio.muted = this.settings.selfDeaf;
    await this.applySink(audio);
    this.consumers.set(producerId, { consumer, audio });
    await this.gw.voice("resumeConsumer", { consumerId: consumer.id });
    void audio.play().catch(() => undefined);
  }

  private dropConsumer(producerId: string): void {
    const entry = this.consumers.get(producerId);
    if (!entry) return;
    entry.consumer.close();
    entry.audio.srcObject = null;
    this.consumers.delete(producerId);
  }

  handleEvent(event: GatewayEvent): void {
    if (event.t === "VOICE_NEW_PRODUCER" && event.d.channelId === this.channelId) {
      void this.consume(event.d.producerId).catch((err: unknown) => console.warn("consume failed", err));
    } else if (event.t === "VOICE_PRODUCER_CLOSED") {
      this.dropConsumer(event.d.producerId);
    }
  }

  /** `notifyServer` is false when the server already ended the session. */
  close(notifyServer = true): void {
    if (this.closed) return;
    this.closed = true;
    if (notifyServer) void this.gw.voice("leave").catch(() => undefined);
    if (this.vadTimer) clearInterval(this.vadTimer);
    for (const id of [...this.consumers.keys()]) this.dropConsumer(id);
    this.producer?.close();
    this.send?.close();
    this.recv?.close();
    this.outTrack?.stop();
    for (const t of this.mic?.getTracks() ?? []) t.stop();
    void this.audioCtx?.close();
  }
}
