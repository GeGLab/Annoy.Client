// Voice session for instances using Cloudflare's Realtime SFU. One
// RTCPeerConnection carries everything; the Annoy server relays every
// negotiation to Cloudflare and decides what we may publish or receive.
import type { GatewayEvent, MediaSource } from "@distopic/protocol";
import type { Gateway } from "./gateway.ts";
import { clearTiles, dropTile, putTile } from "./media.ts";
import { MicGate } from "./mic.ts";
import type { Settings } from "./store.ts";
import { CAMERA_PROFILE, OPUS_SCREEN, OPUS_VOICE, SCREEN_AUDIO_CONSTRAINTS, screenAudioSupported, screenProfile, tuneOpus } from "./media-profiles.ts";

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
  /** Sound shared together with the screen, published as its own track. */
  private screenAudio: { trackName: string; transceiver: RTCRtpTransceiver; track: MediaStreamTrack } | null = null;
  /** Opus parameters for each of our audio sections, re-applied to every remote description. */
  private opus = new Map<string, Record<string, number>>();
  /** The server accepts "screen_audio"; older ones would take it for a second mic. */
  private serverScreenAudio = false;
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
    const joined = await this.gw.voice<{ iceServers: RTCIceServer[]; canSpeak: boolean; canStream: boolean; screenAudio?: boolean }>("join", {
      channelId: this.channelId,
      selfMute: this.settings.selfMute,
      selfDeaf: this.settings.selfDeaf,
    });
    this.canSpeak = joined.canSpeak;
    this.canStream = joined.canStream;
    this.serverScreenAudio = joined.screenAudio === true;
    const pc = new RTCPeerConnection({ iceServers: joined.iceServers, bundlePolicy: "max-bundle" });
    this.pc = pc;
    pc.addEventListener("connectionstatechange", () => {
      if (pc.connectionState === "failed" && !this.closed) this.onMediaFailed();
    });

    if (this.canSpeak) {
      this.mic = new MicGate(this.settings, (talking) => this.gw.send({ op: "speaking", speaking: talking }));
      const track = await this.mic.start();
      await this.publish(track, "audio", "mic", undefined, OPUS_VOICE);
    }
    const { producers } = await this.gw.voice<{ producers: { producerId: string; userId: string; source: MediaSource }[] }>("getProducers");
    for (const p of producers) await this.subscribe(p.producerId, p.userId, p.source);
  }

  private publish(track: MediaStreamTrack, kind: "audio" | "video", source: MediaSource, maxBitrate?: number, opus?: Record<string, number>) {
    return this.serial(async () => {
      const pc = this.pc!;
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
      await this.setRemote(pc, "answer", res.sdp);
      return { trackName: res.producerId, transceiver };
    });
  }

  private setRemote(pc: RTCPeerConnection, type: "offer" | "answer", sdp: string): Promise<void> {
    return pc.setRemoteDescription({ type, sdp: tuneOpus(sdp, this.opus) });
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
  private dropRemote(producerId: string): void {
    const entry = this.remote.get(producerId);
    if (!entry) return;
    this.remote.delete(producerId);
    if (entry.audio) entry.audio.srcObject = null;
    else dropTile(producerId);
  }

  handleEvent(event: GatewayEvent): void {
    if (event.t === "VOICE_NEW_PRODUCER" && event.d.channelId === this.channelId) {
      void this.subscribeSoon(event.d.producerId, event.d.userId, event.d.source);
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
    const profile = source === "camera" ? CAMERA_PROFILE : screenProfile(this.settings.screenQuality);
    const withAudio = source === "screen" && this.settings.screenAudio && this.serverScreenAudio && screenAudioSupported();
    const stream =
      source === "camera"
        ? await navigator.mediaDevices.getUserMedia({ video: { ...profile.constraints, ...(deviceId && deviceId !== "default" && { deviceId: { exact: deviceId } }) } })
        : await navigator.mediaDevices.getDisplayMedia({ video: profile.constraints, audio: withAudio ? SCREEN_AUDIO_CONSTRAINTS : false });
    const track = stream.getVideoTracks()[0];
    const sound = stream.getAudioTracks()[0];
    if (!track) throw new Error("Nenhuma imagem capturada");
    // Games move a lot: keep the frame rate and let detail drop, unlike text and slides.
    if (source === "screen") track.contentHint = this.settings.screenQuality === "30" ? "detail" : "motion";
    if (this.closed) {
      track.stop();
      return void sound?.stop();
    }
    const { trackName, transceiver } = await this.publish(track, "video", source, profile.maxBitrate);
    this.video.set(source, { trackName, transceiver, track });
    if (sound) {
      try {
        const published = await this.publish(sound, "audio", "screen_audio", undefined, OPUS_SCREEN);
        this.screenAudio = { ...published, track: sound };
      } catch (err) {
        sound.stop();
        console.warn("screen audio failed", err);
      }
    }
    putTile({ key: `local:${source}`, userId: this.selfId, source, stream: new MediaStream([track]), local: true });
    track.addEventListener("ended", () => void this.stopVideo(source));
    this.onLocalMedia();
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
    this.screenAudio?.track.stop();
    this.screenAudio = null;
    clearTiles();
    this.mic?.stop();
    this.pc?.close();
  }
}
