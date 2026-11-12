import {t as translate} from "../../shared/localization/index.ts";
import { screenProfile } from "./lib/screen-profile.ts";
import { applyScreenQuality, replaceScreenCapture, type ScreenSettings } from "./lib/screen-share.ts";
import type { Device } from "mediasoup-client";
import type { types as ms } from "mediasoup-client";
import type { GatewayEvent, MediaSource } from "@annoy/protocol";
import { clearTiles, dropTile, putTile, setStreamOffers } from "./media.ts";
import { isStreamSource, streamOffers } from "./lib/stream-watch.ts";
import { MicGate } from "./mic.ts";
import type { Gateway } from "./gateway.ts";
import { toast, type Settings } from "./store.ts";
import { CAMERA_PROFILE, OPUS_SCREEN, OPUS_VOICE, captureScreen, screenAudioSupported } from "./media-profiles.ts";
import { playbackVolume, volumeKindOf } from "../../shared/user-volume.ts";
import { RemoteAudioMixer, type AmplifiedAudio } from "./lib/remote-audio.ts";
import { savedDevice } from "./lib/devices.ts";

type TransportInfo = {
  id: string;
  iceParameters: ms.IceParameters;
  iceCandidates: ms.IceCandidate[];
  dtlsParameters: ms.DtlsParameters;
};


interface RemoteMedia {
  consumer: ms.Consumer;
  source: MediaSource;
  userId: string;
  audio: HTMLAudioElement | null;
  amplified: AmplifiedAudio | null;
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
  /** Sound shared together with the screen. */
  private screenAudio: { producer: ms.Producer; track: MediaStreamTrack } | null = null;
  /** The server accepts "screen_audio"; older ones would take it for a second mic. */
  private serverScreenAudio = false;
  private consumers = new Map<string, RemoteMedia>();
  /** Announcements survive setup and playback, until the producer actually ends. */
  private available = new Map<string, { userId: string; source: MediaSource }>();
  private consuming = new Map<string, symbol>();
  /** People whose screen share we chose to watch. */
  private watching = new Set<string>();
  private mixer = new RemoteAudioMixer();
  private micGate: MicGate | null = null;
  private closed = false;
  private capturedTracks = new Set<MediaStreamTrack>();
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
    private readonly accountId: string,
  ) {}

  async start(): Promise<void> {
    const joined = await this.gw.voice<{ rtpCapabilities: ms.RtpCapabilities; canSpeak: boolean; canStream: boolean; screenAudio?: boolean; media?: { callId: string | null } }>("join", {
      channelId: this.channelId,
      selfMute: this.settings.selfMute,
      selfDeaf: this.settings.selfDeaf,
    });
    if (this.closed) return;
    this.canSpeak = joined.canSpeak;
    this.canStream = joined.canStream;
    this.serverScreenAudio = joined.screenAudio === true;
    const { Device } = await import("mediasoup-client");
    if (this.closed) return;
    this.device = await Device.factory();
    await this.device.load({ routerRtpCapabilities: joined.rtpCapabilities });
    if (this.closed) return;

    const receiveInfo = await this.gw.voice<TransportInfo>("createTransport");
    if (this.closed) return;
    this.recv = this.device.createRecvTransport({ ...receiveInfo });
    this.wireConnect(this.recv);

    if (this.canSpeak || this.canStream) {
      const sendInfo = await this.gw.voice<TransportInfo>("createTransport");
      if (this.closed) return;
      this.send = this.device.createSendTransport({ ...sendInfo });
      this.wireConnect(this.send);
      this.send.on("produce", ({ kind, rtpParameters, appData }, callback, errback) => {
        this.gw
          .voice<{ id: string }>("produce", { transportId: this.send!.id, kind, rtpParameters, source: appData.source })
          .then(callback, errback);
      });
    }
    if (this.canSpeak) await this.startMic();

    if (this.closed) return;
    const { producers } = await this.gw.voice<{ producers: { producerId: string; userId: string; source: MediaSource }[] }>("getProducers");
    if (this.closed) return;
    await Promise.all(producers.map((p) => this.offer(p.producerId, p.userId, p.source)));
  }

  // Watching screen shares ------------------------------------------------

  /** Receives a new track now, unless it is a screen share we did not choose to watch. */
  private offer(producerId: string, userId: string, source: MediaSource): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (!this.available.has(producerId)) this.available.set(producerId, { userId, source });
    if (isStreamSource(source) && !this.watching.has(userId)) {
      this.publishOffers();
      return Promise.resolve();
    }
    return this.consume(producerId, userId, source);
  }

  private publishOffers(): void {
    if (this.closed) return;
    setStreamOffers(streamOffers(this.available.values(), this.watching));
  }

  watch(userId: string): void {
    if (this.closed) return;
    this.watching.add(userId);
    for (const [producerId, entry] of this.available) {
      if (entry.userId !== userId || !isStreamSource(entry.source)) continue;
      void this.consume(producerId, entry.userId, entry.source).catch((err: unknown) => {
        if (!this.closed && this.available.has(producerId)) this.unwatch(userId);
        console.warn("consume failed", err);
      });
    }
    this.publishOffers();
  }

  unwatch(userId: string): void {
    this.watching.delete(userId);
    for (const [producerId, entry] of [...this.consumers]) {
      if (entry.userId === userId && isStreamSource(entry.source)) this.release(producerId);
    }
    this.publishOffers();
  }

  /** Stops receiving a screen share track but keeps it on offer. */
  private release(producerId: string): void {
    const entry = this.consumers.get(producerId);
    if (!entry) return;
    this.dropConsumer(producerId, false);
    // Older servers lack "closeConsumer"; the local close still stops playback.
    void this.gw.voice("closeConsumer", { consumerId: entry.consumer.id }).catch(() => undefined);
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
    // A new noise filter or microphone mid-call: the producer sends the new track at once.
    this.micGate = new MicGate(this.settings, undefined, (track) => this.producer?.replaceTrack({ track }));
    const track = await this.micGate.start();
    if (this.closed) { track.stop(); return; }
    const producer = await this.send!.produce({
      track,
      codecOptions: { opusDtx: true, opusFec: true, opusMaxAverageBitrate: OPUS_VOICE.maxaveragebitrate },
      stopTracks: false,
      appData: { source: "mic" },
    });
    if (this.closed) { producer.close(); track.stop(); return; }
    this.producer = producer;
  }

  updateSettings(settings: Settings): void {
    const deviceChanged = settings.outputDeviceId !== this.settings.outputDeviceId;
    this.settings = settings;
    this.micGate?.update(settings);
    for (const { audio, amplified, userId, source } of this.consumers.values()) {
      if (!audio) continue;
      amplified?.setVolume(playbackVolume(settings, volumeKindOf(source), this.accountId, userId));
      audio.muted = settings.selfDeaf;
      if (deviceChanged) void this.applySink(audio);
    }
  }

  setPushToTalk(down: boolean): void {
    this.micGate?.setPushToTalk(down);
  }


  private async applySink(audio: HTMLAudioElement): Promise<void> {
    try {
      await audio.setSinkId((await savedDevice("output", this.settings)) ?? "");
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
    if (!this.send || !this.canStream) throw new Error(translate("common.a29daa11e424"));
    if (this.video.has(source)) return;
    const profile = source === "screen" ? screenProfile(this.settings) : CAMERA_PROFILE;
    if (source === "screen" && this.settings.screenAudio) {
      if (!screenAudioSupported()) toast(translate("common.a61148654b3b"), 8000);
      else if (!this.serverScreenAudio) toast(translate("common.036d4bf6473c"), 12000);
    }
    const withAudio = source === "screen" && this.settings.screenAudio && this.serverScreenAudio && screenAudioSupported();
    const stream =
      source === "camera"
        ? await navigator.mediaDevices.getUserMedia({ video: { ...profile.constraints, ...(deviceId && deviceId !== "default" && { deviceId: { exact: deviceId } }) } })
        : await captureScreen(profile.constraints, withAudio);
    for (const captured of stream.getTracks()) this.capturedTracks.add(captured);
    const track = stream.getVideoTracks()[0];
    const sound = stream.getAudioTracks()[0];
    if (withAudio && !sound) toast(translate("common.5cd6dd99a676"), 10000);
    if (!track) { stream.getTracks().forEach((captured) => captured.stop()); throw new Error(translate("common.5641e70d7b1b")); }
    // Games move a lot: keep the frame rate and let detail drop, unlike text and slides.
    if (source === "screen") track.contentHint = this.settings.screenFps > 0 && this.settings.screenFps <= 30 ? "detail" : "motion";
    if (this.closed) {
      track.stop();
      return void sound?.stop();
    }
    const producer = await this.send.produce({
      track,
      encodings: [{ maxBitrate: profile.maxBitrate }],
      codecOptions: { videoGoogleStartBitrate: 1000 },
      appData: { source },
    });
    if (this.closed) { producer.close(); stream.getTracks().forEach((captured) => captured.stop()); return; }
    this.video.set(source, { producer, track });
    if (sound) {
      try {
        const audio = await this.send.produce({
          track: sound,
          codecOptions: { opusStereo: true, opusDtx: false, opusFec: true, opusMaxAverageBitrate: OPUS_SCREEN.maxaveragebitrate },
          appData: { source: "screen_audio" },
        });
        if (this.closed) { audio.close(); sound.stop(); return; }
        this.screenAudio = { producer: audio, track: sound };
      } catch (err) {
        sound.stop();
        console.warn("screen audio failed", err);
        toast(translate("common.ce01001e093b"), 10000);
      }
    }
    putTile({ key: `local:${source}`, userId: this.selfId, source, stream: new MediaStream([track]), local: true });
    // The OS "stop sharing" control (or an unplugged camera) ends the track.
    track.addEventListener("ended", () => { if (this.video.get(source)?.track === track) void this.stopVideo(source); });
    this.onLocalMedia();
  }

  /** Change the captured display while retaining the sender and its viewers. */
  async replaceScreen(): Promise<void> {
    const entry = this.video.get("screen");
    if (!entry) return this.startVideo("screen");
    await replaceScreenCapture({
      settings: this.settings, previous: entry.track, captured: this.capturedTracks,
      current: () => !this.closed && this.video.get("screen") === entry,
      replace: async track => { await entry.producer.replaceTrack({ track }); },
      commit: track => {
        entry.track = track;
        putTile({ key: "local:screen", userId: this.selfId, source: "screen", stream: new MediaStream([track]), local: true });
        track.addEventListener("ended", () => { if (this.video.get("screen")?.track === track) void this.stopVideo("screen"); });
        this.onLocalMedia();
      },
    });
  }

  async updateScreenQuality(settings: ScreenSettings): Promise<void> {
    const entry = this.video.get("screen");
    if (!entry) throw new Error(translate("common.99e2847d16e5"));
    await applyScreenQuality(entry.track, settings, this.settings, async maxBitrate => {
      await entry.producer.setRtpEncodingParameters({ maxBitrate });
    }, () => !this.closed && this.video.get("screen") === entry);
    this.settings = { ...this.settings, ...settings };
  }

  async stopVideo(source: "camera" | "screen"): Promise<void> {
    const entry = this.video.get(source);
    if (!entry) return;
    this.video.delete(source);
    entry.producer.close();
    entry.track.stop();
    const sound = source === "screen" ? this.screenAudio : null;
    if (sound) {
      this.screenAudio = null;
      sound.producer.close();
      sound.track.stop();
    }
    dropTile(`local:${source}`);
    this.onLocalMedia();
    if (this.closed) return;
    for (const { producer } of sound ? [entry, sound] : [entry]) await this.gw.voice("closeProducer", { producerId: producer.id }).catch(() => undefined);
  }

  // Remote media --------------------------------------------------------

  private async consume(producerId: string, userId: string, source: MediaSource): Promise<void> {
    if (!this.device || !this.recv || this.closed || this.consumers.has(producerId) || this.consuming.has(producerId)) return;
    const announcement = this.available.get(producerId);
    if (!announcement) return;
    const recv = this.recv;
    const operation = Symbol();
    this.consuming.set(producerId, operation);
    try {
      const params = await this.gw.voice<{
        id: string;
        producerId: string;
        kind: ms.MediaKind;
        rtpParameters: ms.RtpParameters;
      }>("consume", { producerId, transportId: recv.id, rtpCapabilities: this.device.rtpCapabilities });
      if (this.closed || this.available.get(producerId) !== announcement) {
        if (!this.closed) void this.gw.voice("closeConsumer", { consumerId: params.id }).catch(() => undefined);
        return;
      }
      const consumer = await recv.consume(params);
      if (this.closed) { consumer.close(); return; }
      if (this.available.get(producerId) !== announcement) {
        consumer.close();
        void this.gw.voice("closeConsumer", { consumerId: consumer.id }).catch(() => undefined);
        return;
      }
      let audio: HTMLAudioElement | null = null;
      let amplified: AmplifiedAudio | null = null;
      if (consumer.kind === "audio") {
        audio = new Audio();
        audio.autoplay = true;
        amplified = this.mixer.connect(new MediaStream([consumer.track]), playbackVolume(this.settings, volumeKindOf(source), this.accountId, userId), audio);
        audio.muted = this.settings.selfDeaf;
        await this.applySink(audio);
        if (this.closed || this.available.get(producerId) !== announcement) { audio.pause(); audio.srcObject = null; amplified.close(); consumer.close(); return; }
        audio.muted = this.settings.selfDeaf;
        amplified.setVolume(playbackVolume(this.settings, volumeKindOf(source), this.accountId, userId));
      } else {
        putTile({ key: producerId, userId, source: source === "screen" ? "screen" : "camera", stream: new MediaStream([consumer.track]), local: false });
      }
      this.consumers.set(producerId, { consumer, source, userId, audio, amplified });
      this.consuming.delete(producerId);
      this.publishOffers();
      // The user stopped watching while this was being set up.
      if (isStreamSource(source) && !this.watching.has(userId)) return this.release(producerId);
      await this.gw.voice("resumeConsumer", { consumerId: consumer.id });
      if (audio && !this.closed && this.consumers.get(producerId)?.consumer === consumer) void audio.play().catch(() => undefined);
    } finally {
      if (this.consuming.get(producerId) === operation) this.consuming.delete(producerId);
    }
  }

  /** `ended` is false when only we stop receiving it (the share goes on). */
  private dropConsumer(producerId: string, ended = true): void {
    const entry = this.consumers.get(producerId);
    const pending = this.available.get(producerId);
    if (ended) {
      this.available.delete(producerId);
      // The next share by the same person is opt-in again.
      const source = entry?.source ?? pending?.source;
      if (source === "screen") this.watching.delete((entry ?? pending)!.userId);
    }
    if (entry) {
      entry.consumer.close();
      if (entry.audio) { entry.audio.pause(); entry.audio.srcObject = null; entry.amplified?.close(); }
      else dropTile(producerId);
      this.consumers.delete(producerId);
    }
    if (entry || pending) this.publishOffers();
  }

  handleEvent(event: GatewayEvent): void {
    if (this.closed) return;
    if (event.t === "VOICE_NEW_PRODUCER" && event.d.channelId === this.channelId) {
      void this.offer(event.d.producerId, event.d.userId, event.d.source).catch((err: unknown) => console.warn("consume failed", err));
    } else if (event.t === "VOICE_PRODUCER_CLOSED") {
      this.dropConsumer(event.d.producerId);
    }
  }

  /** `notifyServer` is false when the server already ended the session. */
  close(notifyServer = true): void {
    if (this.closed) return;
    this.closed = true;
    for (const track of this.capturedTracks) track.stop();
    this.capturedTracks.clear();
    if (notifyServer) void this.gw.voice("leave").catch(() => undefined);
    for (const id of [...this.consumers.keys()]) this.dropConsumer(id);
    this.available.clear();
    this.watching.clear();
    this.mixer.close();
    for (const { producer, track } of this.video.values()) {
      producer.close();
      track.stop();
    }
    this.video.clear();
    this.screenAudio?.producer.close();
    this.screenAudio?.track.stop();
    this.screenAudio = null;
    clearTiles();
    this.producer?.close();
    this.send?.close();
    this.recv?.close();
    this.micGate?.stop();
  }
}


