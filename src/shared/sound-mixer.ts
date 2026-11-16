/**
 * A listener's own equalizer in a song room: ten octave bands and a preamp, with a limiter
 * at the end so boosts don't distort. It runs on their device only (in the page that plays
 * the music) and never reaches the server or anyone else.
 */

export const EQ_BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;
export const EQ_LIMIT = 12;
export const PREAMP_MIN = -12;
export const PREAMP_MAX = 6;

export type MixerPreset = "flat" | "bass" | "vshape" | "vocal" | "treble" | "rock" | "pop" | "electronic" | "acoustic" | "night";
export const MIXER_PRESETS: readonly MixerPreset[] = ["flat", "bass", "vshape", "vocal", "treble", "rock", "pop", "electronic", "acoustic", "night"];

export interface MixerSound {
  /** Gain per band in dB, from -EQ_LIMIT to EQ_LIMIT. */
  eq: number[];
  /** Gain before the bands, in dB: lower it when boosting a lot. */
  preamp: number;
}
export interface MixerSettings extends MixerSound {
  on: boolean;
  preset: MixerPreset | "custom";
}

const flat = () => EQ_BANDS.map(() => 0);
export const PRESET_SOUNDS: Record<MixerPreset, MixerSound> = {
  flat: { eq: flat(), preamp: 0 },
  bass: { eq: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0], preamp: -3 },
  vshape: { eq: [5, 4, 2, 0, -2, -2, 0, 2, 4, 5], preamp: -2 },
  vocal: { eq: [-3, -2, -1, 1, 3, 4, 3, 1, 0, -1], preamp: -2 },
  treble: { eq: [0, 0, 0, 0, 0, 1, 2, 4, 5, 6], preamp: -3 },
  rock: { eq: [4, 3, 2, 0, -1, -1, 1, 3, 4, 4], preamp: -2 },
  pop: { eq: [-1, 0, 2, 3, 4, 3, 1, 0, -1, -1], preamp: -2 },
  electronic: { eq: [5, 4, 1, 0, -2, 1, 0, 1, 4, 5], preamp: -3 },
  acoustic: { eq: [3, 2, 1, 1, 2, 2, 3, 3, 2, 1], preamp: -2 },
  night: { eq: [-4, -3, -1, 0, 0, 0, -1, -2, -3, -4], preamp: 0 },
};

export const DEFAULT_MIXER: MixerSettings = { on: false, preset: "flat", ...PRESET_SOUNDS.flat };

const clamp = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
const half = (value: number) => Math.round(value * 2) / 2;

/** Whatever was stored or sent, as valid settings. A curve with another number of bands starts flat. */
export function cleanMixer(raw: unknown): MixerSettings {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const eq = Array.isArray(r.eq) && r.eq.length === EQ_BANDS.length ? r.eq : [];
  return {
    on: r.on === true,
    preset: MIXER_PRESETS.includes(r.preset as MixerPreset) && eq.length ? (r.preset as MixerPreset) : eq.length ? "custom" : "flat",
    eq: EQ_BANDS.map((_, i) => half(clamp(eq[i], -EQ_LIMIT, EQ_LIMIT, 0))),
    preamp: half(clamp(r.preamp, PREAMP_MIN, PREAMP_MAX, 0)),
  };
}

/** Off, or on with nothing to change: the music can skip the equalizer entirely. */
export const mixerNeutral = (m: MixerSettings | null | undefined) =>
  !m || !m.on || (m.eq.every((gain) => gain === 0) && m.preamp === 0);

export interface MixerChain {
  input: AudioNode;
  output: AudioNode;
  apply(settings: MixerSettings | null): void;
}

/** input → preamp → ten octave bands → limiter → output. Neutral until `apply`. */
export function createMixerChain(context: BaseAudioContext): MixerChain {
  const input = new GainNode(context, { gain: 1 });
  const preamp = new GainNode(context, { gain: 1 });
  input.connect(preamp);
  const bands = EQ_BANDS.map((frequency) => new BiquadFilterNode(context, { type: "peaking", frequency, Q: 1.41, gain: 0 }));
  let last: AudioNode = preamp;
  for (const band of bands) {
    last.connect(band);
    last = band;
  }
  // Only catches peaks above -1 dBFS, so loud boosts stay clean instead of clipping.
  const limiter = new DynamicsCompressorNode(context, { threshold: -1, knee: 0, ratio: 20, attack: 0.003, release: 0.25 });
  last.connect(limiter);
  const output = new GainNode(context, { gain: 1 });
  limiter.connect(output);
  return {
    input,
    output,
    apply(settings) {
      const sound = !mixerNeutral(settings) ? settings! : DEFAULT_MIXER;
      const t = context.currentTime;
      bands.forEach((band, i) => band.gain.setTargetAtTime(sound.eq[i] ?? 0, t, 0.05));
      preamp.gain.setTargetAtTime(10 ** (sound.preamp / 20), t, 0.05);
    },
  };
}
