import type { DjStyle } from "@annoy/protocol";

/**
 * The song room's DJ brain: what kind of music a track is, and how a DJ of that
 * scene would carry one track into the next. Every listener computes the same
 * plan from the same catalog data, so the whole room hears the same mix.
 *
 * The scenes follow how DJs actually play them: house and techno blend long and
 * swap the bass on the bar; hip-hop and baile funk cut on the beat or throw an
 * echo; rock and metal keep it short; reggae and dub ride the delay; chill,
 * jazz and classical simply breathe from one track into the other.
 */

/** Room transitions: the six a room can choose, plus two the scenes use on their own. */
export type MixPreset = Exclude<DjStyle, "auto"> | "cut" | "wash";

export type GenreFamily =
  | "electronic" | "hiphop" | "funk" | "rock" | "metal" | "pop" | "latin" | "brazil"
  | "rnb" | "reggae" | "chill" | "jazz" | "classical" | "country";

interface Scene {
  /** The room's colour while this plays (HSL hue). */
  hue: number;
  /** Transitions that suit the scene, in order of preference. */
  presets: readonly MixPreset[];
  /** How many beats a blend lasts, and the usual tempo when the catalog doesn't know it. */
  beats: number;
  bpm: number;
  /** Bounds of a blend, in seconds. */
  min: number;
  max: number;
}

const SCENES: Record<GenreFamily, Scene> = {
  electronic: { hue: 192, presets: ["bassswap", "filter", "riser"], beats: 32, bpm: 124, min: 8, max: 16 },
  hiphop: { hue: 38, presets: ["echo", "cut", "brake"], beats: 8, bpm: 90, min: 2.5, max: 6 },
  funk: { hue: 142, presets: ["echo", "cut", "bassswap"], beats: 8, bpm: 130, min: 2.5, max: 6 },
  rock: { hue: 6, presets: ["smooth", "filter", "cut"], beats: 8, bpm: 120, min: 3, max: 6 },
  metal: { hue: 352, presets: ["brake", "cut", "smooth"], beats: 8, bpm: 140, min: 2, max: 4 },
  pop: { hue: 322, presets: ["filter", "smooth", "riser", "echo"], beats: 16, bpm: 118, min: 6, max: 10 },
  latin: { hue: 22, presets: ["echo", "bassswap", "filter"], beats: 16, bpm: 95, min: 5, max: 9 },
  brazil: { hue: 92, presets: ["smooth", "echo", "filter"], beats: 16, bpm: 100, min: 5, max: 8 },
  rnb: { hue: 278, presets: ["smooth", "wash", "echo"], beats: 16, bpm: 95, min: 6, max: 10 },
  reggae: { hue: 112, presets: ["echo", "wash"], beats: 16, bpm: 80, min: 6, max: 10 },
  chill: { hue: 170, presets: ["wash", "smooth"], beats: 16, bpm: 80, min: 8, max: 12 },
  jazz: { hue: 212, presets: ["smooth", "wash"], beats: 16, bpm: 110, min: 7, max: 10 },
  classical: { hue: 234, presets: ["smooth"], beats: 24, bpm: 100, min: 9, max: 14 },
  country: { hue: 30, presets: ["smooth", "filter"], beats: 8, bpm: 115, min: 4, max: 7 },
};

/** Transitions without a scene: the old "surprise" rotation and its lengths. */
const ROTATION: readonly MixPreset[] = ["smooth", "filter", "echo", "brake", "bassswap", "riser"];
const DEFAULT_SECONDS: Record<MixPreset, number> = { smooth: 8, filter: 8, echo: 6, brake: 2.5, bassswap: 10, riser: 7, cut: 2, wash: 9 };

/**
 * Catalog genres (Deezer, iTunes) and words in video titles, most specific first:
 * "funk" alone is Brazilian baile funk in these rooms, while "soul & funk" is R&B.
 */
const RULES: readonly [RegExp, GenreFamily][] = [
  [/soul\s*(&|and|e)\s*funk|r\s*&\s*b|\brnb\b|\bsoul\b|neo.?soul|motown/i, "rnb"],
  [/baile|\bphonk\b|\bmc\s|\bfunk\b/i, "funk"],
  [/sertanej|pagode|\bsamba\b|forr[oó]|\bax[eé]\b|arrocha|piseiro|\bbrega\b|brazilian|brasileira|m[uú]sica popular/i, "brazil"],
  [/\bmpb\b|bossa|lo.?fi|ambient|\bchill|acoustic|ac[uú]stic|\bfolk\b|singer.?songwriter|new age|\brelax|\blounge\b/i, "chill"],
  [/reggaet[oó]n|\blatin|salsa|bachata|cumbia|merengue|dembow|perreo/i, "latin"],
  [/reggae|\bdub\b|\bska\b|dancehall/i, "reggae"],
  [/metal|thrash|grindcore|djent|deathcore/i, "metal"],
  [/hip.?hop|\brap\b|\btrap\b|\bdrill\b|\bgrime\b|boom.?bap|gangsta/i, "hiphop"],
  [/k-?pop|j-?pop|dance.?pop|synth.?pop/i, "pop"],
  [/electro|\bdance\b|\bhouse\b|techno|trance|\bedm\b|dubstep|drum.?(&|and|n).?bass|\bdnb\b|\bgarage\b|hardstyle|eurodance|future bass/i, "electronic"],
  [/\brock|\bpunk|grunge|alternativ|\bindie\b|\bemo\b|shoegaze|new wave/i, "rock"],
  [/jazz|\bblues\b|\bswing\b|bebop/i, "jazz"],
  [/classical|cl[aá]ssic|orchestra|orquestra|soundtrack|trilha sonora|films?\/games|\bopera\b|piano solo/i, "classical"],
  [/country|bluegrass|americana/i, "country"],
  [/\bpop\b/i, "pop"],
];

/** The scene a track belongs to: from the catalog's genre first, then from the words in its title. */
export function genreFamily(genre: string | null | undefined, title = ""): GenreFamily | null {
  for (const text of [genre ?? "", title]) {
    if (!text.trim()) continue;
    for (const [pattern, family] of RULES) if (pattern.test(text)) return family;
  }
  return null;
}

export const familyHue = (family: GenreFamily | null): number | null => (family ? SCENES[family].hue : null);

/** A number from text that is the same on every device, so every listener picks the same transition. */
function stable(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return hash;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export interface TrackFacts {
  id: string;
  title: string;
  genre?: string | null;
  bpm?: number | null;
}

export interface MixPlan {
  preset: MixPreset;
  /** How long both tracks play together. */
  seconds: number;
  /** One beat of the outgoing track, so echoes repeat on the beat. */
  beat: number;
  family: GenreFamily | null;
}

/**
 * How `from` hands over to `to`. A chosen style is kept and only timed to the music;
 * "auto" lets the scene choose. Two scenes meet on a transition both use, or blend smoothly.
 */
export function planMix(style: DjStyle | undefined, from: TrackFacts | null, to: TrackFacts): MixPlan {
  const outgoing = from ? genreFamily(from.genre, from.title) : null;
  const incoming = genreFamily(to.genre, to.title);
  const family = outgoing ?? incoming;
  const scene = family ? SCENES[family] : null;
  const other = incoming && incoming !== family ? SCENES[incoming] : null;
  const bpm = from?.bpm || scene?.bpm || 120;
  const beat = 60 / bpm;

  let preset: MixPreset;
  if (style && style !== "auto") preset = style;
  else if (!scene) preset = ROTATION[stable(to.id) % ROTATION.length]!;
  else {
    const shared = other ? scene.presets.filter((p) => other.presets.includes(p)) : scene.presets;
    const choices = shared.length ? shared : (["smooth", "filter"] as const);
    preset = choices[stable(to.id) % choices.length]!;
  }

  let seconds = scene ? clamp(scene.beats * beat, scene.min, scene.max) : DEFAULT_SECONDS[preset];
  // Different scenes meet halfway; the short effects keep their own length.
  if (scene && other) seconds = (seconds + clamp(other.beats * (60 / (to.bpm || other.bpm)), other.min, other.max)) / 2;
  if (preset === "brake") seconds = 2.5;
  else if (preset === "cut") seconds = clamp(4 * beat, 1.5, 3);
  return { preset, seconds: Math.round(seconds * 10) / 10, beat: Math.round(beat * 1000) / 1000, family };
}
