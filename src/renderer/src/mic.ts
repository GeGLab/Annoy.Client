import {t as translate} from "../../shared/localization/index.ts";
// Microphone capture with voice-activity or push-to-talk gating, shared by
// every voice backend and by the microphone test. The analyser listens to the
// filtered signal (so a keyboard doesn't open the gate); the gate only toggles
// the transmitted track, so detection keeps working while closed.
import { openMic, type Mic } from "./noise.ts";
import type { Settings } from "./store.ts";

const VAD_HOLD_MS = 400;

/** Changing one of these needs a new capture (a new track), not just new filter values. */
const needsReopen = (a: Settings, b: Settings) =>
  a.noiseFilter !== b.noiseFilter || a.inputDeviceId !== b.inputDeviceId || a.inputDeviceLabel !== b.inputDeviceLabel;

export class MicGate {
  private mic: Mic | null = null;
  private analyser: AnalyserNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastVoiceAt = 0;
  private pttDown = false;
  private open = false;
  private stopped = false;
  private reopening: Promise<void> | null = null;
  /** Track to hand to the transport. */
  track: MediaStreamTrack | null = null;

  constructor(
    private settings: Settings,
    /** Fires when the gate opens or closes, i.e. when we start or stop talking. */
    private readonly onTalking: (talking: boolean) => void = () => undefined,
    /** A new track replaced the old one (noise filter or microphone changed): send this one now. */
    private readonly onTrack: (track: MediaStreamTrack) => Promise<unknown> | void = () => undefined,
  ) {}

  /** The last node of the filter chain (what the others hear), for level meters. */
  get output(): AudioNode | null {
    return this.mic?.output ?? null;
  }

  async start(): Promise<MediaStreamTrack> {
    const mic = await openMic(this.settings.inputDeviceId, this.settings.noiseFilter, this.settings.micFilters, this.settings.inputDeviceLabel);
    if (this.stopped) {
      mic.stop();
      throw new Error(translate("common.99e2847d16e5"));
    }
    this.attach(mic);
    const buf = new Uint8Array(512);
    this.timer = setInterval(() => {
      if (!this.analyser) return;
      this.analyser.getByteTimeDomainData(buf);
      let peak = 0;
      for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
      // Map threshold 0..100 onto the 0..128 amplitude range.
      if ((peak / 128) * 100 >= this.settings.vadThreshold) this.lastVoiceAt = performance.now();
      this.apply();
    }, 50);
    this.apply();
    return this.track!;
  }

  private attach(mic: Mic): void {
    this.mic = mic;
    this.track = mic.track;
    this.open = false;
    this.analyser = mic.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    mic.output.connect(this.analyser);
  }

  /** Opens the new capture first, hands its track over, then closes the old one: no gap in the call. */
  private async reopen(): Promise<void> {
    const s = this.settings;
    const next = await openMic(s.inputDeviceId, s.noiseFilter, s.micFilters, s.inputDeviceLabel);
    if (this.stopped) { next.stop(); return; }
    const old = this.mic;
    this.attach(next);
    this.apply();
    try {
      await this.onTrack(next.track);
    } finally {
      old?.stop();
    }
    // Settings changed again while the new capture was opening.
    if (needsReopen(s, this.settings)) await this.reopen();
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
    const previous = this.settings;
    if (settings.micFilters !== previous.micFilters) this.mic?.setFilters(settings.micFilters);
    this.settings = settings;
    // A new noise filter or microphone applies right away, in the middle of a call too.
    if (this.mic && needsReopen(previous, settings) && !this.reopening) {
      this.reopening = this.reopen().catch((err) => console.warn("microphone reopen failed", err)).finally(() => { this.reopening = null; });
    }
    this.apply();
  }

  setPushToTalk(down: boolean): void {
    this.pttDown = down;
    this.apply();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.mic?.stop();
    this.mic = null;
    this.analyser = null;
    this.track = null;
  }
}
