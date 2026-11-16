/**
 * A listener's own sound in a song room: a five-band equalizer, reverb and an "8D" sweep
 * around the head. It runs on their device only (in the page that plays the music) and
 * never reaches the server or anyone else.
 */

export const EQ_BANDS = [60, 250, 1000, 4000, 12000] as const;
export const EQ_LIMIT = 12;

export type MixerPreset = "flat" | "bass" | "vocal" | "bright" | "lofi" | "hall" | "spin";
export const MIXER_PRESETS: readonly MixerPreset[] = ["flat", "bass", "vocal", "bright", "lofi", "hall", "spin"];

export interface MixerSound {
  /** Gain per band in dB, from -EQ_LIMIT to EQ_LIMIT. */
  eq: number[];
  /** 0 to 1: how much of the room's reverb is heard. */
  reverb: number;
  /** 0 to 1: how far the music circles around the head. */
  spin: number;
}
export interface MixerSettings extends MixerSound {
  on: boolean;
  preset: MixerPreset | "custom";
}

export const PRESET_SOUNDS: Record<MixerPreset, MixerSound> = {
  flat: { eq: [0, 0, 0, 0, 0], reverb: 0, spin: 0 },
  bass: { eq: [8, 4, 0, 0, 1], reverb: 0, spin: 0 },
  vocal: { eq: [-2, -1, 3, 4, 1], reverb: 0.05, spin: 0 },
  bright: { eq: [0, 0, 1, 4, 6], reverb: 0, spin: 0 },
  lofi: { eq: [3, 2, 0, -6, -12], reverb: 0.15, spin: 0 },
  hall: { eq: [1, 0, 0, 1, 2], reverb: 0.45, spin: 0 },
  spin: { eq: [2, 0, 0, 1, 2], reverb: 0.15, spin: 0.9 },
};

export const DEFAULT_MIXER: MixerSettings = { on: false, preset: "flat", ...PRESET_SOUNDS.flat };

const clamp = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

/** Whatever was stored or sent, as valid settings. */
export function cleanMixer(raw: unknown): MixerSettings {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const eq = Array.isArray(r.eq) ? r.eq : [];
  return {
    on: r.on === true,
    preset: MIXER_PRESETS.includes(r.preset as MixerPreset) ? (r.preset as MixerPreset) : "custom",
    eq: EQ_BANDS.map((_, i) => Math.round(clamp(eq[i], -EQ_LIMIT, EQ_LIMIT, 0) * 2) / 2),
    reverb: clamp(r.reverb, 0, 1, 0),
    spin: clamp(r.spin, 0, 1, 0),
  };
}

/** Off, or on with nothing to change: the music can skip the effects entirely. */
export const mixerNeutral = (m: MixerSettings | null | undefined) =>
  !m || !m.on || (m.eq.every((gain) => gain === 0) && m.reverb === 0 && m.spin === 0);

export interface MixerChain {
  input: AudioNode;
  output: AudioNode;
  apply(settings: MixerSettings | null): void;
}

/** A short, dark room: stereo noise that fades out, for the convolver. */
function impulse(context: BaseAudioContext, seconds: number): AudioBuffer {
  const length = Math.max(1, Math.floor(context.sampleRate * seconds));
  const buffer = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3);
  }
  return buffer;
}

/** input → equalizer → sweep → dry + reverb → output. Neutral until `apply`. */
export function createMixerChain(context: BaseAudioContext): MixerChain {
  const input = new GainNode(context, { gain: 1 });
  const filters = EQ_BANDS.map((frequency, i) => new BiquadFilterNode(context, {
    type: i === 0 ? "lowshelf" : i === EQ_BANDS.length - 1 ? "highshelf" : "peaking",
    frequency,
    Q: 1,
    gain: 0,
  }));
  let last: AudioNode = input;
  for (const filter of filters) {
    last.connect(filter);
    last = filter;
  }
  const panner = new StereoPannerNode(context, { pan: 0 });
  const sweep = new OscillatorNode(context, { frequency: 0.12 });
  const depth = new GainNode(context, { gain: 0 });
  sweep.connect(depth).connect(panner.pan);
  sweep.start();
  last.connect(panner);
  const dry = new GainNode(context, { gain: 1 });
  const wet = new GainNode(context, { gain: 0 });
  const room = new ConvolverNode(context, { buffer: impulse(context, 2.4) });
  const output = new GainNode(context, { gain: 1 });
  panner.connect(dry).connect(output);
  panner.connect(room).connect(wet).connect(output);
  return {
    input,
    output,
    apply(settings) {
      const sound = !mixerNeutral(settings) ? settings! : DEFAULT_MIXER;
      const t = context.currentTime;
      filters.forEach((filter, i) => filter.gain.setTargetAtTime(sound.eq[i] ?? 0, t, 0.05));
      depth.gain.setTargetAtTime(sound.spin, t, 0.1);
      wet.gain.setTargetAtTime(sound.reverb * 0.9, t, 0.1);
      dry.gain.setTargetAtTime(1 - sound.reverb * 0.35, t, 0.1);
    },
  };
}
