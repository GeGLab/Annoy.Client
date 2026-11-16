import { useSyncExternalStore } from "react";
import { cleanMixer, DEFAULT_MIXER, PRESET_SOUNDS, type MixerPreset, type MixerSettings } from "../../../../shared/sound-mixer.ts";

/**
 * The song room's studio, all on this device: the listener's mixer (sent to the page that
 * plays the music) and a pad board and small keyboard synthesized here. Nothing is sent to
 * the server or heard by anyone else.
 */

const MIXER_KEY = "annoy.song.mixer";
const PADS_KEY = "annoy.song.pads";

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => (listeners.add(listener), () => listeners.delete(listener));

function read<T>(key: string, parse: (raw: unknown) => T, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? parse(JSON.parse(raw)) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage off: this session only */ }
}

// Mixer -------------------------------------------------------------------------------

let mixer: MixerSettings = read(MIXER_KEY, cleanMixer, DEFAULT_MIXER);
export const useMixer = () => useSyncExternalStore(subscribe, () => mixer);
export function setMixer(next: MixerSettings): void {
  mixer = cleanMixer(next);
  write(MIXER_KEY, mixer);
  emit();
}
export const choosePreset = (preset: MixerPreset) => setMixer({ ...mixer, on: true, preset, ...PRESET_SOUNDS[preset] });

/** Whether the listener's sound reaches the track playing now: false when the page's media can't be read. */
let reach: boolean | null = null;
export const useMixerReach = () => useSyncExternalStore(subscribe, () => reach);
export function setMixerReach(value: boolean | null): void {
  if (value === reach) return;
  reach = value;
  emit();
}

// Pads and keyboard -------------------------------------------------------------------

export type PadName = "kick" | "snare" | "hat" | "clap" | "horn" | "laser" | "riser" | "drop";
export const PADS: readonly PadName[] = ["kick", "snare", "hat", "clap", "horn", "laser", "riser", "drop"];
export type Wave = "sine" | "triangle" | "square" | "sawtooth";
export const WAVES: readonly Wave[] = ["sine", "triangle", "square", "sawtooth"];
export interface PadSettings { volume: number; wave: Wave }

let pads: PadSettings = read(PADS_KEY, (raw) => {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const volume = typeof r.volume === "number" && Number.isFinite(r.volume) ? Math.min(1, Math.max(0, r.volume)) : 0.6;
  return { volume, wave: WAVES.includes(r.wave as Wave) ? (r.wave as Wave) : "sawtooth" };
}, { volume: 0.6, wave: "sawtooth" });
export const usePads = () => useSyncExternalStore(subscribe, () => pads);
export function setPads(next: PadSettings): void {
  pads = next;
  write(PADS_KEY, pads);
  if (out) out.master.gain.setTargetAtTime(pads.volume, out.context.currentTime, 0.02);
  emit();
}

let out: { context: AudioContext; master: GainNode; noise: AudioBuffer } | null = null;
function output() {
  if (!out) {
    const context = new AudioContext();
    const master = new GainNode(context, { gain: pads.volume });
    master.connect(context.destination);
    const noise = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    out = { context, master, noise };
  }
  if (out.context.state === "suspended") void out.context.resume();
  return out;
}

/** A gain that rises in `attack` seconds to `peak` and falls away over `decay`. */
function envelope(context: AudioContext, at: number, peak: number, attack: number, decay: number): GainNode {
  const gain = new GainNode(context, { gain: 0.0001 });
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
  return gain;
}

function tone(type: OscillatorType, from: number, to: number, glide: number, gain: GainNode, at: number, length: number): void {
  const { context } = output();
  const osc = new OscillatorNode(context, { type, frequency: from });
  osc.frequency.setValueAtTime(from, at);
  if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, at + glide);
  osc.connect(gain);
  osc.start(at);
  osc.stop(at + length);
}

function burst(filter: BiquadFilterOptions, gain: GainNode, at: number, length: number): void {
  const { context, noise } = output();
  const source = new AudioBufferSourceNode(context, { buffer: noise, loop: true });
  source.connect(new BiquadFilterNode(context, filter)).connect(gain);
  source.start(at);
  source.stop(at + length);
}

export function playPad(name: PadName): void {
  const { context, master } = output();
  const at = context.currentTime + 0.005;
  const env = (peak: number, attack: number, decay: number) => {
    const gain = envelope(context, at, peak, attack, decay);
    gain.connect(master);
    return gain;
  };
  switch (name) {
    case "kick":
      tone("sine", 150, 45, 0.35, env(1, 0.005, 0.45), at, 0.5);
      break;
    case "snare":
      burst({ type: "highpass", frequency: 1200 }, env(0.7, 0.002, 0.2), at, 0.25);
      tone("triangle", 190, 140, 0.1, env(0.5, 0.002, 0.12), at, 0.15);
      break;
    case "hat":
      burst({ type: "highpass", frequency: 7500 }, env(0.35, 0.001, 0.06), at, 0.08);
      break;
    case "clap":
      for (const offset of [0, 0.012, 0.024]) {
        const gain = envelope(context, at + offset, 0.6, 0.001, offset === 0.024 ? 0.18 : 0.01);
        gain.connect(master);
        burst({ type: "bandpass", frequency: 1500, Q: 1 }, gain, at + offset, 0.2);
      }
      break;
    case "horn": {
      const gain = env(0.35, 0.03, 0.9);
      const tint = new BiquadFilterNode(context, { type: "lowpass", frequency: 2400 });
      tint.connect(gain);
      for (const frequency of [466, 469, 470.5]) {
        const voice = envelope(context, at, 1, 0.01, 0.9);
        voice.connect(tint);
        tone("sawtooth", frequency, frequency, 0, voice, at, 1);
      }
      break;
    }
    case "laser":
      tone("square", 1800, 120, 0.3, env(0.25, 0.002, 0.32), at, 0.35);
      break;
    case "riser": {
      const gain = new GainNode(context, { gain: 0.0001 });
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.4, at + 2);
      gain.gain.setValueAtTime(0.0001, at + 2.05);
      gain.connect(master);
      tone("sawtooth", 180, 2000, 2, gain, at, 2.05);
      burst({ type: "highpass", frequency: 3000 }, gain, at, 2.05);
      break;
    }
    case "drop":
      tone("sine", 110, 38, 1.2, env(1, 0.01, 1.6), at, 1.7);
      burst({ type: "lowpass", frequency: 400 }, env(0.5, 0.005, 0.5), at, 0.6);
      break;
  }
}

/** Keyboard notes: C4 to C5 (MIDI 60 to 72). */
export const NOTES = Array.from({ length: 13 }, (_, i) => 60 + i);
export const NOTE_KEYS = ["a", "w", "s", "e", "d", "f", "t", "g", "y", "h", "u", "j", "k"];
export const isSharp = (midi: number) => [1, 3, 6, 8, 10].includes(midi % 12);

/** Starts a note with the chosen wave; the returned function lets it go. */
export function noteOn(midi: number): () => void {
  const { context, master } = output();
  const at = context.currentTime;
  const gain = new GainNode(context, { gain: 0.0001 });
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.3, at + 0.015);
  const osc = new OscillatorNode(context, { type: pads.wave, frequency: 440 * 2 ** ((midi - 69) / 12) });
  osc.connect(gain).connect(master);
  osc.start(at);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const now = context.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
    osc.stop(now + 0.3);
  };
}
