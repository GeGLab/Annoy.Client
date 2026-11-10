import {t as translate} from "../../shared/localization/index.ts";
import { screenProfile } from "./lib/screen-profile.ts";
import { applyScreenQuality, replaceScreenCapture, type ScreenSettings } from "./lib/screen-share.ts";
// Voice session for instances using Cloudflare's Realtime SFU. One
// RTCPeerConnection carries everything; the Annoy server relays every
// negotiation to Cloudflare and decides what we may publish or receive.
import type { GatewayEvent, MediaSource } from "@annoy/protocol";
import type { Gateway } from "./gateway.ts";
import { clearTiles, dropTile, putTile, setStreamOffers } from "./media.ts";
import { isStreamSource, streamOffers } from "./lib/stream-watch.ts";
import { MicGate } from "./mic.ts";
import { toast, type Settings } from "./store.ts";
import { alignExtmap, CAMERA_PROFILE, OPUS_SCREEN, OPUS_VOICE, captureScreen, screenAudioSupported, tuneOpus } from "./media-profiles.ts";
import { playbackVolume, volumeKindOf } from "../../shared/user-volume.ts";
import { RemoteAudioMixer, type AmplifiedAudio } from "./lib/remote-audio.ts";
import { savedDevice } from "./lib/devices.ts";

interface Remote {
  source: MediaSource;
  /** Our section for this track, reported when resuming the session. */
  mid: string;
  audio: HTMLAudioElement | null;
  userId: string;
  amplified: AmplifiedAudio | null;
}

export class CloudflareVoiceSession {
  private pc: RTCPeerConnection | null = null;
  /** Offer/answer exchanges on one connection must not interleave. */
  private queue: Promise<unknown> = Promise.resolve();
  private mic: MicGate | null = null;
  private video = new Map<"camera" | "screen", { trackName: string; transceiver: RTCRtpTransceiver; track: MediaStreamTrack; maxBitrate: number }>();
  /** Sound shared together with the screen, published as its own track. */
  private screenAudio: { trackName: string; transceiver: RTCRtpTransceiver; track: MediaStreamTrack } | null = null;
  /** Opus parameters for each of our audio sections, re-applied to every remote description. */
  private opus = new Map<string, Record<string, number>>();
  /** The server accepts "screen_audio"; older ones would take it for a second mic. */
  private serverScreenAudio = false;
  private remote = new Map<string, Remote>();
  /** Screen shares (picture and sound) announced but not received: watching is opt-in. */
  private pendingStreams = new Map<string, { userId: string; source: MediaSource }>();
  /** People whose screen share we chose to watch. */
  private watching = new Set<string>();
  private mixer = new RemoteAudioMixer();
  private closed = false;
  private capturedTracks = new Set<MediaStreamTrack>();
  canSpeak = false;
  canStream = false;

  constructor(
    private readonly gw: Gateway,
    readonly channelId: string,
    private readonly selfId: string,
    private settings: Settings,
    private readonly onLocalMedia: () => void,
    private readonly onMediaFailed: () => void,
    private readonly accountId: string,
  ) {}

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  async start(): Promise<void> {
    const joined = await this.gw.voice<{
      iceServers: RTCIceServer[];
      canSpeak: boolean;
      canStream: boolean;
      screenAudio?: boolean;
      media?: { callId: string | null };
    }>("join", {
      channelId: this.channelId,
      selfMute: this.settings.selfMute,
      selfDeaf: this.settings.selfDeaf,
    });
    this.canSpeak = joined.canSpeak;
    this.canStream = joined.canStream;
    this.serverScreenAudio = joined.screenAudio === true;
    if (this.closed) return;
    const pc = new RTCPeerConnection({ iceServers: joined.iceServers, bundlePolicy: "max-bundle" });
    this.pc = pc;
    pc.addEventListener("connectionstatechange", () => {
      if (pc.connectionState === "failed" && !this.closed) this.onMediaFailed();
    });

    if (this.canSpeak) {
      let sender: RTCRtpSender | null = null;
      // A new noise filter or microphone mid-call: the same sender carries the new track at once.
      this.mic = new MicGate(this.settings, (talking) => this.gw.send({ op: "speaking", speaking: talking }), async (next) => {
        this.capturedTracks.add(next);
        const previous = sender?.track;
        await sender?.replaceTrack(next);
        if (previous) this.capturedTracks.delete(previous);
      });
      const track = await this.mic.start();
      sender = (await this.publish(track, "audio", "mic", undefined, OPUS_VOICE)).transceiver.sender;
    }
    const { producers } = await this.gw.voice<{ producers: { producerId: string; userId: string; source: MediaSource }[] }>("getProducers");
    for (const p of producers) await this.offer(p.producerId, p.userId, p.source, false);
  }

  // Watching screen shares ------------------------------------------------

  /** Receives a new track now, unless it is a screen share we did not choose to watch. */
  private offer(producerId: string, userId: string, source: MediaSource, fresh: boolean): Promise<void> {
    if (isStreamSource(source) && !this.watching.has(userId)) {
      this.pendingStreams.set(producerId, { userId, source });
      this.publishOffers();
      return Promise.resolve();
    }
    return fresh ? this.subscribeSoon(producerId, userId, source) : this.subscribe(producerId, userId, source);
  }

  private publishOffers(): void {
    if (this.closed) return;
    setStreamOffers(streamOffers([...this.pendingStreams.values(), ...this.remote.values()], this.watching));
  }

  watch(userId: string): void {
    if (this.closed) return;
    this.watching.add(userId);
    for (const [producerId, entry] of [...this.pendingStreams]) {
      if (entry.userId !== userId) continue;
      this.pendingStreams.delete(producerId);
      void this.subscribeSoon(producerId, entry.userId, entry.source);
    }
    this.publishOffers();
  }

  unwatch(userId: string): void {
    this.watching.delete(userId);
    for (const [producerId, entry] of [...this.remote]) {
      if (entry.userId === userId && isStreamSource(entry.source)) this.release(producerId);
    }
    this.publishOffers();
  }

  /** Stops pulling a screen share track but keeps it on offer. */
  private release(producerId: string): void {
    const entry = this.remote.get(producerId);
    if (!entry || !this.pc) return;
    this.dropRemote(producerId, false);
    this.pendingStreams.set(producerId, { userId: entry.userId, source: entry.source });
    const pc = this.pc;
    void this.serial(async () => {
      if (this.closed) return;
      const transceiver = pc.getTransceivers().find((t) => t.mid === entry.mid);
      if (!transceiver || transceiver.currentDirection === "stopped") return;
      transceiver.direction = "inactive";
      await pc.setLocalDescription(await pc.createOffer());
      try {
        const res = await this.gw.voice<{ sdp?: string }>("unsubscribe", { producerId, sdp: pc.localDescription!.sdp });
        if (res.sdp) await this.setRemote(pc, "answer", res.sdp);
      } catch (err) {
        // Older servers lack "unsubscribe": undo the offer; the local close still stops playback.
        if (pc.signalingState === "have-local-offer") await pc.setLocalDescription({ type: "rollback" });
        throw err;
      }
    }).catch((err: unknown) => console.warn("unsubscribe failed", err));
  }

  private publish(track: MediaStreamTrack, kind: "audio" | "video", source: MediaSource, maxBitrate?: number, opus?: Record<string, number>) {
    this.capturedTracks.add(track);
    return this.serial(async () => {
      if (this.closed || !this.pc) throw new Error(translate("common.99e2847d16e5"));
      const pc = this.pc;
      const transceiver = pc.addTransceiver(track, { direction: "sendonly", ...(maxBitrate && { sendEncodings: [{ maxBitrate }] }) });
      await pc.setLocalDescription(await pc.createOffer());
      if (opus && transceiver.mid) this.opus.set(transceiver.mid, opus);
      const res = await this.gw.voice<{ producerId: string; sdp: string }>("publish", {
        sdp: pc.localDescription!.sdp,
        mid: transceiver.mid,
        kind,
        source,
        ...(maxBitrate && { maxBitrate }),
      });
      if (this.closed) throw new Error(translate("common.99e2847d16e5"));
      await this.setRemote(pc, "answer", res.sdp);
      return { trackName: res.producerId, transceiver };
    }).catch((error) => { track.stop(); this.capturedTracks.delete(track); throw error; });
  }

  private setRemote(pc: RTCPeerConnection, type: "offer" | "answer", sdp: string): Promise<void> {
    // Answers must keep the extension IDs of our offer; offers may introduce new sections.
    const aligned = type === "answer" ? alignExtmap(sdp, pc.localDescription?.sdp) : alignExtmap(sdp, pc.currentLocalDescription?.sdp);
    return pc.setRemoteDescription({ type, sdp: tuneOpus(aligned, this.opus) });
  }

  private subscribe(producerId: string, userId: string, source: MediaSource) {
    return this.serial(async () => {
      if (this.closed || this.remote.has(producerId) || !this.pc) return;
      const pc = this.pc;
      const res = await this.gw.voice<{ mid: string; kind: "audio" | "video"; sdp?: string; renegotiate: boolean }>("subscribe", { producerId });
      if (res.renegotiate && res.sdp) {
        await this.setRemote(pc, "offer", res.sdp);
        await pc.setLocalDescription(await pc.createAnswer());
        await this.gw.voice("renegotiate", { sdp: pc.localDescription!.sdp });
      }
      if (this.closed) return;
      const transceiver = pc.getTransceivers().find((t) => t.mid === res.mid);
      if (!transceiver) throw new Error(translate("common.f0cc45c67996"));
      const track = transceiver.receiver.track;
      let audio: HTMLAudioElement | null = null;
      let amplified: AmplifiedAudio | null = null;
      if (res.kind === "audio") {
        audio = new Audio();
        audio.autoplay = true;
        amplified = this.mixer.connect(new MediaStream([track]), playbackVolume(this.settings, volumeKindOf(source), this.accountId, userId), audio);
        audio.muted = this.settings.selfDeaf;
        await this.applySink(audio);
        if (this.closed) { audio.pause(); audio.srcObject = null; amplified.close(); return; }
        audio.muted = this.settings.selfDeaf;
        amplified.setVolume(playbackVolume(this.settings, volumeKindOf(source), this.accountId, userId));
        void audio.play().catch(() => undefined);
      } else {
        putTile({ key: producerId, userId, source: source === "screen" ? "screen" : "camera", stream: new MediaStream([track]), local: false });
      }
      this.remote.set(producerId, { source, mid: res.mid, audio, amplified, userId });
      this.publishOffers();
      // The user stopped watching while this was being set up.
      if (isStreamSource(source) && !this.watching.has(userId)) queueMicrotask(() => this.release(producerId));
    });
  }


  /**
   * A track announced a moment ago may not have reached Cloudflare yet ("Track
   * not found on remote peer"), so a fresh one is retried for a few seconds.
   */
  private async subscribeSoon(producerId: string, userId: string, source: MediaSource): Promise<void> {
    for (const wait of [0, 500, 1000, 2000, 4000, 8000]) {
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
      if (this.closed || this.remote.has(producerId)) return;
      try {
        return await this.subscribe(producerId, userId, source);
      } catch (err) {
        if (!/not found/i.test((err as Error).message)) return void console.warn("subscribe failed", err);
      }
    }
    console.warn("subscribe gave up", producerId);
  }

  /** Cloudflare already stopped forwarding; release what we built for it. */
  /** `ended` is false when only we stop receiving it (the share goes on). */
  private dropRemote(producerId: string, ended = true): void {
    const entry = this.remote.get(producerId);
    const pending = this.pendingStreams.get(producerId);
    if (ended) {
      this.pendingStreams.delete(producerId);
      // The next share by the same person is opt-in again.
      const source = entry?.source ?? pending?.source;
      if (source === "screen") this.watching.delete((entry ?? pending)!.userId);
    }
    if (entry) {
      this.remote.delete(producerId);
      if (entry.audio) { entry.audio.pause(); entry.audio.srcObject = null; entry.amplified?.close(); }
      else dropTile(producerId);
    }
    if (entry || pending) this.publishOffers();
  }

  handleEvent(event: GatewayEvent): void {
    if (event.t === "VOICE_NEW_PRODUCER" && event.d.channelId === this.channelId) {
      void this.offer(event.d.producerId, event.d.userId, event.d.source, true);
    } else if (event.t === "VOICE_PRODUCER_CLOSED") {
      this.dropRemote(event.d.producerId);
    }
  }

  isSharing(source: "camera" | "screen"): boolean {
    return this.video.has(source);
  }

  async startVideo(source: "camera" | "screen", deviceId?: string): Promise<void> {
    if (!this.pc || !this.canStream) throw new Error(translate("common.a29daa11e424"));
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
    let publishedVideo;
    try { publishedVideo = await this.publish(track, "video", source, profile.maxBitrate); }
    catch (error) { stream.getTracks().forEach((captured) => captured.stop()); throw error; }
    if (this.closed) { stream.getTracks().forEach((captured) => captured.stop()); return; }
    const { trackName, transceiver } = publishedVideo;
    this.video.set(source, { trackName, transceiver, track, maxBitrate: profile.maxBitrate });
    if (sound) {
      try {
        const published = await this.publish(sound, "audio", "screen_audio", undefined, OPUS_SCREEN);
        if (this.closed) { sound.stop(); return; }
        this.screenAudio = { ...published, track: sound };
      } catch (err) {
        sound.stop();
        console.warn("screen audio failed", err);
        toast(translate("common.ce01001e093b"), 10000);
      }
    }
    putTile({ key: `local:${source}`, userId: this.selfId, source, stream: new MediaStream([track]), local: true });
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
      replace: async track => { await entry.transceiver.sender.replaceTrack(track); },
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
      // Keep the original SFU budget reservation valid while changing capture quality.
      const sender = entry.transceiver.sender, parameters = sender.getParameters();
      for (const encoding of parameters.encodings) encoding.maxBitrate = Math.min(maxBitrate, entry.maxBitrate);
      await sender.setParameters(parameters);
    }, () => !this.closed && this.video.get("screen") === entry);
    this.settings = { ...this.settings, ...settings };
  }

  async stopVideo(source: "camera" | "screen"): Promise<void> {
    const entry = this.video.get(source);
    if (!entry) return;
    this.video.delete(source);
    entry.track.stop();
    const sound = source === "screen" ? this.screenAudio : null;
    if (sound) {
      this.screenAudio = null;
      sound.track.stop();
    }
    dropTile(`local:${source}`);
    this.onLocalMedia();
    if (this.closed || !this.pc) return;
    for (const track of sound ? [entry, sound] : [entry]) await this.unpublish(track);
  }

  private unpublish(entry: { trackName: string; transceiver: RTCRtpTransceiver }): Promise<void> {
    const pc = this.pc!;
    return this.serial(async () => {
      entry.transceiver.direction = "inactive";
      await pc.setLocalDescription(await pc.createOffer());
      const res = await this.gw.voice<{ sdp?: string }>("closeProducer", { producerId: entry.trackName, sdp: pc.localDescription!.sdp });
      if (res.sdp) await this.setRemote(pc, "answer", res.sdp);
    }).catch((err: unknown) => console.warn("close track failed", err));
  }

  updateSettings(settings: Settings): void {
    const deviceChanged = settings.outputDeviceId !== this.settings.outputDeviceId;
    this.settings = settings;
    this.mic?.update(settings);
    for (const { audio, amplified, userId, source } of this.remote.values()) {
      if (!audio) continue;
      amplified?.setVolume(playbackVolume(settings, volumeKindOf(source), this.accountId, userId));
      audio.muted = settings.selfDeaf;
      if (deviceChanged) void this.applySink(audio);
    }
  }

  setPushToTalk(down: boolean): void {
    this.mic?.setPushToTalk(down);
  }

  private async applySink(audio: HTMLAudioElement): Promise<void> {
    try {
      await audio.setSinkId((await savedDevice("output", this.settings)) ?? "");
    } catch {
      // Device disappeared; keep the current output.
    }
  }

  close(notifyServer = true): void {
    if (this.closed) return;
    this.closed = true;
    for (const track of this.capturedTracks) track.stop();
    this.capturedTracks.clear();
    if (notifyServer) void this.gw.voice("leave").catch(() => undefined);
    for (const id of [...this.remote.keys()]) this.dropRemote(id);
    this.mixer.close();
    for (const { track } of this.video.values()) track.stop();
    this.video.clear();
    this.screenAudio?.track.stop();
    this.screenAudio = null;
    clearTiles();
    this.mic?.stop();
    this.pc?.close();
  }
}
