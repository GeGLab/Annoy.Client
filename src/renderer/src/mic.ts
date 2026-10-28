// Microphone capture with voice-activity or push-to-talk gating, shared by
// every voice backend. The analyser listens to the raw track; the gate only
// toggles the transmitted clone, so detection keeps working while closed.
import type { Settings } from "./store.ts";

const VAD_HOLD_MS = 400;

export class MicGate {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastVoiceAt = 0;
  private pttDown = false;
  private open = false;
  /** Track to hand to the transport. */
  track: MediaStreamTrack | null = null;

  constructor(
    private settings: Settings,
    /** Fires when the gate opens or closes, i.e. when we start or stop talking. */
    private readonly onTalking: (talking: boolean) => void = () => undefined,
  ) {}

  async start(): Promise<MediaStreamTrack> {
    const deviceId = this.settings.inputDeviceId === "default" ? undefined : { exact: this.settings.inputDeviceId };
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const raw = this.stream.getAudioTracks()[0]!;
    this.track = raw.clone();
    this.ctx = new AudioContext();
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 512;
    this.ctx.createMediaStreamSource(new MediaStream([raw])).connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    this.timer = setInterval(() => {
      analyser.getByteTimeDomainData(buf);
      let peak = 0;
      for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
      // Map threshold 0..100 onto the 0..128 amplitude range.
      if ((peak / 128) * 100 >= this.settings.vadThreshold) this.lastVoiceAt = performance.now();
      this.apply();
    }, 50);
    this.apply();
    return this.track;
  }

  private apply(): void {
    if (!this.track) return;
    const s = this.settings;
    const open = !s.selfMute && !s.selfDeaf && (s.inputMode === "ptt" ? this.pttDown : performance.now() - this.lastVoiceAt < VAD_HOLD_MS);
    if (this.track.enabled !== open) this.track.enabled = open;
    if (this.open !== open) {
      this.open = open;
      this.onTalking(open);
    }
  }

  update(settings: Settings): void {
    this.settings = settings;
    this.apply();
  }

  setPushToTalk(down: boolean): void {
    this.pttDown = down;
    this.apply();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.track?.stop();
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    void this.ctx?.close();
    this.track = null;
  }
}
