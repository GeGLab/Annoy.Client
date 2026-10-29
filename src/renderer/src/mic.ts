// Microphone capture with voice-activity or push-to-talk gating, shared by
// every voice backend. The analyser listens to the filtered signal (so a
// keyboard doesn't open the gate); the gate only toggles the transmitted
// track, so detection keeps working while closed.
import { openMic, type Mic } from "./noise.ts";
import type { Settings } from "./store.ts";

const VAD_HOLD_MS = 400;

export class MicGate {
  private mic: Mic | null = null;
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
    this.mic = await openMic(this.settings.inputDeviceId, this.settings.noiseFilter);
    this.track = this.mic.track;
    const analyser = this.mic.ctx.createAnalyser();
    analyser.fftSize = 512;
    this.mic.output.connect(analyser);
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
    this.mic?.stop();
    this.mic = null;
    this.track = null;
  }
}
