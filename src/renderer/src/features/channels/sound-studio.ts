import { useSyncExternalStore } from "react";
import { cleanMixer, DEFAULT_MIXER, PRESET_SOUNDS, type MixerPreset, type MixerSettings } from "../../../../shared/sound-mixer.ts";

/**
 * The song room's mixer, all on this device: the listener's equalizer and effects, sent to the
 * page that plays the music. Nothing is sent to the server or heard by anyone else.
 */

const MIXER_KEY = "annoy.song.mixer";

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
