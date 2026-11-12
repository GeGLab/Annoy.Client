import { ipcRenderer } from "electron";

// Runs in every frame of a theater page. The frame whose video is the biggest one on
// screen reports its time and the viewer's own play/pause/seek, and obeys the room.
// Song rooms also ask it for their volume, a spectrum for the visualizer and, in DJ mode,
// the transition effects that mix one deck into the other.

type Preset = "smooth" | "filter" | "echo" | "brake" | "bassswap" | "riser";
interface Command {
  action: "play" | "pause" | "seek" | "volume" | "levels" | "fx";
  position?: number;
  /** 0 to 1, for "volume": how loud the room wants this device's player. */
  volume?: number;
  /** For "levels": whether the room wants the music's spectrum for its visualizer. */
  on?: boolean;
  /** For "fx": the transition, which side of it this deck is, and how long it lasts. */
  preset?: Preset;
  role?: "in" | "out";
  seconds?: number;
}

let video: HTMLVideoElement | null = null;
/** The room's volume (song rooms lower it while people talk); null until it asks for one. */
let wanted: number | null = null;
let fade: ReturnType<typeof setInterval> | null = null;
/** Loaded ahead for a DJ transition: kept paused and silent until the room starts it. */
let holding = (() => {
  try { return new URLSearchParams(location.search).get("annoy_hold") === "1"; } catch { return false; }
})();
/** Transition loudness when the media can't go through WebAudio (fallback fades use the element). */
let fxVolume = 1;

/** Events caused by our own commands are not the viewer's and must not echo back. */
let quietUntil = 0;

// Audio graph ------------------------------------------------------------------
// Only DJ transitions route the video through WebAudio. Routing media the page may not read
// would silence it, so a video is routed only after captureStream() proved it readable.

interface Graph {
  el: HTMLVideoElement;
  context: AudioContext;
  low: BiquadFilterNode;
  high: BiquadFilterNode;
  lowpass: BiquadFilterNode;
  dry: GainNode;
  delay: DelayNode;
  feedback: GainNode;
  wet: GainNode;
  fade: GainNode;
  master: GainNode;
}
let graph: Graph | null = null;

function readable(el: HTMLVideoElement): boolean {
  try {
    const capture = (el as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream?.();
    return !!capture && capture.getAudioTracks().length > 0;
  } catch {
    return false;
  }
}

function ensureGraph(): Graph | null {
  if (graph?.el === video) return graph;
  if (!video || !readable(video)) return null;
  try {
    const context = new AudioContext();
    const source = context.createMediaElementSource(video);
    const low = new BiquadFilterNode(context, { type: "lowshelf", frequency: 220, gain: 0 });
    const high = new BiquadFilterNode(context, { type: "highpass", frequency: 10, Q: 0.7 });
    const lowpass = new BiquadFilterNode(context, { type: "lowpass", frequency: 22000, Q: 0.7 });
    const dry = new GainNode(context, { gain: 1 });
    const delay = new DelayNode(context, { delayTime: 0.375, maxDelayTime: 2 });
    const feedback = new GainNode(context, { gain: 0 });
    const wet = new GainNode(context, { gain: 0 });
    const fadeNode = new GainNode(context, { gain: fxVolume });
    const master = new GainNode(context, { gain: holding ? 0 : wanted ?? 1 });
    source.connect(low).connect(high).connect(lowpass);
    lowpass.connect(dry).connect(fadeNode);
    lowpass.connect(delay).connect(feedback).connect(delay);
    delay.connect(wet).connect(fadeNode);
    fadeNode.connect(master).connect(context.destination);
    // From here the graph sets the loudness; the element stays at full volume.
    video.volume = 1;
    graph = { el: video, context, low, high, lowpass, dry, delay, feedback, wet, fade: fadeNode, master };
    return graph;
  } catch {
    return null;
  }
}

/** Eases the player to the wanted volume instead of jumping, so ducking doesn't pump. */
function fadeVolume(): void {
  if (fade) clearInterval(fade);
  fade = null;
  if (!video) return;
  if (graph?.el === video) {
    graph.master.gain.setTargetAtTime(holding ? 0 : wanted ?? 1, graph.context.currentTime, 0.08);
    return;
  }
  if (wanted === null && !holding && fxVolume === 1) return;
  const target = holding ? 0 : (wanted ?? 1) * fxVolume;
  const el = video;
  const step = () => {
    const diff = target - el.volume;
    if (Math.abs(diff) <= 0.04) { el.volume = target; if (fade) clearInterval(fade); fade = null; return; }
    el.volume = Math.min(1, Math.max(0, el.volume + Math.sign(diff) * Math.max(0.04, Math.abs(diff) * 0.25)));
  };
  step();
  if (el.volume !== target) fade = setInterval(step, 30);
}

// Transitions --------------------------------------------------------------------

let fxTimers: ReturnType<typeof setInterval>[] = [];
function clearFx(): void {
  fxTimers.forEach((timer) => clearInterval(timer));
  fxTimers = [];
}

function params(g: Graph): AudioParam[] {
  return [g.low.gain, g.high.frequency, g.lowpass.frequency, g.dry.gain, g.wet.gain, g.feedback.gain, g.fade.gain];
}

/** Back to a clean signal once a transition is over. */
function neutral(g: Graph): void {
  const t = g.context.currentTime;
  for (const param of params(g)) param.cancelScheduledValues(t);
  g.low.gain.setTargetAtTime(0, t, 0.1);
  g.high.frequency.setTargetAtTime(10, t, 0.1);
  g.lowpass.frequency.setTargetAtTime(22000, t, 0.1);
  g.dry.gain.setTargetAtTime(1, t, 0.1);
  g.wet.gain.setTargetAtTime(0, t, 0.1);
  g.feedback.gain.setTargetAtTime(0, t, 0.1);
  g.fade.gain.setTargetAtTime(1, t, 0.1);
}

/** An equal-power curve, so a crossfade keeps the same loudness all the way through. */
function curve(from: number, to: number): Float32Array<ArrayBuffer> {
  const points = new Float32Array(new ArrayBuffer(64 * 4));
  for (let i = 0; i < 64; i++) {
    const p = i / 63;
    points[i] = from + (to - from) * (from < to ? Math.sin((p * Math.PI) / 2) : 1 - Math.cos((p * Math.PI) / 2));
  }
  return points;
}

/** Slows the record down to a stop, pitch and all, like a hand on the platter. */
function brake(el: HTMLVideoElement, seconds: number): void {
  const started = performance.now();
  el.preservesPitch = false;
  const timer = setInterval(() => {
    const p = Math.min(1, (performance.now() - started) / (seconds * 1000));
    el.playbackRate = Math.max(0.0625, 1 - p * p * 0.94);
    if (p >= 1) { clearInterval(timer); el.pause(); }
  }, 30);
  fxTimers.push(timer);
}

function runFx(preset: Preset, role: "in" | "out", seconds: number): void {
  clearFx();
  const el = video;
  if (!el) return;
  quietUntil = Date.now() + (seconds + 2) * 1000;
  const out = role === "out";
  const g = ensureGraph();
  // Without WebAudio only the loudness can move: every preset becomes an equal-power
  // crossfade, except the brake, which only needs the element.
  if (!g) {
    if (preset === "brake" && out) { brake(el, Math.min(seconds, 2)); return; }
    const started = performance.now();
    fxVolume = out ? 1 : 0;
    fadeVolume();
    const timer = setInterval(() => {
      const p = Math.min(1, (performance.now() - started) / (seconds * 1000));
      fxVolume = out ? Math.cos((p * Math.PI) / 2) : Math.sin((p * Math.PI) / 2);
      fadeVolume();
      if (p >= 1) { clearInterval(timer); fxVolume = out ? 0 : 1; fadeVolume(); }
    }, 60);
    fxTimers.push(timer);
    return;
  }
  const t = g.context.currentTime, d = seconds;
  for (const param of params(g)) param.cancelScheduledValues(t);
  switch (preset) {
    case "smooth":
      g.fade.gain.setValueCurveAtTime(curve(out ? 1 : 0, out ? 0 : 1), t, d);
      break;
    case "filter":
      // The outgoing track closes down to its bass while the incoming one opens up from the top.
      if (out) {
        g.lowpass.frequency.setValueAtTime(22000, t);
        g.lowpass.frequency.exponentialRampToValueAtTime(260, t + d * 0.85);
        g.fade.gain.setValueAtTime(1, t + d * 0.55);
        g.fade.gain.linearRampToValueAtTime(0, t + d);
      } else {
        g.high.frequency.setValueAtTime(2200, t);
        g.high.frequency.exponentialRampToValueAtTime(10, t + d * 0.85);
        g.fade.gain.setValueCurveAtTime(curve(0, 1), t, d * 0.45);
      }
      break;
    case "echo":
      // The outgoing track repeats itself away; the incoming one enters as the echoes thin out.
      if (out) {
        g.delay.delayTime.setValueAtTime(0.375, t);
        g.feedback.gain.setValueAtTime(0.55, t);
        g.wet.gain.setValueAtTime(0, t);
        g.wet.gain.linearRampToValueAtTime(0.75, t + d * 0.2);
        g.dry.gain.setValueAtTime(1, t + d * 0.15);
        g.dry.gain.linearRampToValueAtTime(0, t + d * 0.4);
        g.fade.gain.setValueAtTime(1, t + d * 0.5);
        g.fade.gain.linearRampToValueAtTime(0, t + d);
      } else {
        // Silent until the echoes thin out (a curve can't share its start with another event).
        g.fade.gain.setValueAtTime(0, t);
        g.fade.gain.setValueCurveAtTime(curve(0, 1), t + d * 0.35, d * 0.3);
      }
      break;
    case "brake":
      if (out) {
        brake(el, Math.min(d, 2));
      } else {
        g.fade.gain.setValueAtTime(0, t);
        g.fade.gain.setValueAtTime(0, t + Math.min(d, 2) * 0.85);
        g.fade.gain.linearRampToValueAtTime(1, t + Math.min(d, 2) + 0.15);
      }
      break;
    case "bassswap":
      // Both play together; halfway through, the bass hands over from one to the other.
      if (out) {
        g.low.gain.setValueAtTime(0, t + d * 0.48);
        g.low.gain.linearRampToValueAtTime(-28, t + d * 0.52);
        g.fade.gain.setValueAtTime(1, t);
        g.fade.gain.setValueCurveAtTime(curve(1, 0), t + d * 0.55, d * 0.45);
      } else {
        g.low.gain.setValueAtTime(-28, t);
        g.low.gain.setValueAtTime(-28, t + d * 0.48);
        g.low.gain.linearRampToValueAtTime(0, t + d * 0.52);
        g.fade.gain.setValueCurveAtTime(curve(0, 1), t, d * 0.45);
      }
      break;
    case "riser":
      // The outgoing track thins out and rises; the incoming one drops in at the top.
      if (out) {
        g.high.frequency.setValueAtTime(10, t);
        g.high.frequency.exponentialRampToValueAtTime(3500, t + d * 0.88);
        g.feedback.gain.setValueAtTime(0.35, t + d * 0.5);
        g.wet.gain.setValueAtTime(0, t + d * 0.5);
        g.wet.gain.linearRampToValueAtTime(0.5, t + d * 0.85);
        g.fade.gain.setValueAtTime(1, t + d * 0.86);
        g.fade.gain.linearRampToValueAtTime(0, t + d * 0.9);
      } else {
        g.fade.gain.setValueAtTime(0, t);
        g.fade.gain.setValueAtTime(0, t + d * 0.86);
        g.fade.gain.linearRampToValueAtTime(1, t + d * 0.9);
      }
      break;
  }
  // The incoming deck goes back to a clean signal once it's in; the outgoing one gets closed.
  if (!out) fxTimers.push(setTimeout(() => { if (graph) neutral(graph); }, (d + 0.3) * 1000));
}

// Spectrum ------------------------------------------------------------------------
// For the song room's visualizer, focused on the voice: about 140 Hz to 5 kHz, where
// singing lives. The video is tapped through captureStream(), which copies its sound
// instead of rerouting it. Media the page may not read throws, and the room animates on its own.
//
// Alongside, how much singing there is: lead vocals are mixed in the centre, so in the
// singing band they show up in the centre (L+R) and cancel from the sides (L−R), while
// double-tracked guitars, keys and reverbs fill both. The room lines the lyrics up with it.

const BANDS = 48;
const VOICE_LOW = 140, VOICE_HIGH = 5000;
let levelsWanted = false;
let tap: { el: HTMLVideoElement; context: AudioContext; timer: ReturnType<typeof setInterval> } | null = null;

function untap(): void {
  if (!tap) return;
  clearInterval(tap.timer);
  void tap.context.close().catch(() => {});
  tap = null;
}

function bands(bins: Uint8Array, hzPerBin: number): number[] {
  const out: number[] = [];
  const first = Math.max(1, Math.floor(VOICE_LOW / hzPerBin)), last = Math.min(bins.length - 1, Math.ceil(VOICE_HIGH / hzPerBin));
  for (let band = 0; band < BANDS; band++) {
    const from = Math.floor(first * Math.pow(last / first, band / BANDS));
    const to = Math.max(from + 1, Math.floor(first * Math.pow(last / first, (band + 1) / BANDS)));
    let sum = 0;
    for (let i = from; i < to; i++) sum += bins[i]!;
    out.push(Math.round(sum / (to - from)));
  }
  return out;
}

const SINGING_LOW = 300, SINGING_HIGH = 3400;

/**
 * Centre against sides in the singing band, in dB (vr), and the centre's loudness (vl).
 * Mono media has no sides to compare: it reports nothing, and the room leaves the lyrics be.
 */
function voiceMeter(context: AudioContext, source: AudioNode, hzPerBin: number): () => { vr?: number; vl?: number } {
  const split = context.createChannelSplitter(2);
  source.connect(split);
  const centre = new AnalyserNode(context, { fftSize: 1024, smoothingTimeConstant: 0.6 });
  const sides = new AnalyserNode(context, { fftSize: 1024, smoothingTimeConstant: 0.6 });
  const half = (gain: number) => new GainNode(context, { gain });
  split.connect(half(0.5), 0).connect(centre);
  split.connect(half(0.5), 1).connect(centre);
  split.connect(half(0.5), 0).connect(sides);
  split.connect(half(-0.5), 1).connect(sides);
  const centreDb = new Float32Array(new ArrayBuffer(centre.frequencyBinCount * 4));
  const sidesDb = new Float32Array(new ArrayBuffer(sides.frequencyBinCount * 4));
  const from = Math.max(1, Math.floor(SINGING_LOW / hzPerBin)), to = Math.min(centre.frequencyBinCount - 1, Math.ceil(SINGING_HIGH / hzPerBin));
  return () => {
    centre.getFloatFrequencyData(centreDb);
    sides.getFloatFrequencyData(sidesDb);
    let c = 0, side = 0;
    for (let i = from; i <= to; i++) {
      c += 10 ** (centreDb[i]! / 10);
      side += 10 ** (sidesDb[i]! / 10);
    }
    if (!(c > 0) || !Number.isFinite(c)) return {};
    // Identical channels (mono) leave the sides empty: nothing to tell singing apart with.
    if (side < c * 1e-6) return {};
    const vr = 10 * Math.log10(c / side), vl = 10 * Math.log10(c);
    return Number.isFinite(vr) && Number.isFinite(vl) ? { vr: Math.round(Math.max(-20, Math.min(40, vr)) * 10) / 10, vl: Math.round(Math.max(-140, Math.min(20, vl)) * 10) / 10 } : {};
  };
}

function retap(): void {
  if (!levelsWanted || !video || holding) return untap();
  if (tap?.el === video) return;
  untap();
  try {
    const capture = (video as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream?.();
    // Before the media starts there may be no audio track yet: the next status tick tries again.
    if (!capture?.getAudioTracks().length) return;
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.78;
    // Loud masters fill the default -100…-30 dB window and every band reads full: widen it.
    analyser.minDecibels = -88;
    analyser.maxDecibels = -14;
    // Analysed only, never connected to the speakers: the element already plays it.
    const source = context.createMediaStreamSource(capture);
    source.connect(analyser);
    const bins = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
    const hzPerBin = context.sampleRate / analyser.fftSize;
    const voice = voiceMeter(context, source, hzPerBin);
    const el = video;
    const timer = setInterval(() => {
      if (el.paused || el.ended) return;
      analyser.getByteFrequencyData(bins);
      ipcRenderer.send("theater:levels", { position: el.currentTime, levels: bands(bins, hzPerBin), ...voice() });
    }, 33);
    tap = { el, context, timer };
  } catch {
    untap();
  }
}

// The player -----------------------------------------------------------------------

/**
 * The biggest playing video on the page. A song room plays with its view hidden, where
 * every video may measure 0×0: one that has media still counts, or the room loses control
 * of it (no pause, no volume, and the end of the track never reaches the queue).
 */
function pick(): HTMLVideoElement | null {
  let best: HTMLVideoElement | null = null;
  let area = -1;
  for (const el of document.querySelectorAll("video")) {
    if (!el.currentSrc && !el.srcObject) continue;
    const rect = el.getBoundingClientRect();
    const size = rect.width * rect.height;
    if (size > area) {
      best = el;
      area = size;
    }
  }
  return best;
}

function user(action: "play" | "pause" | "seek"): void {
  if (!video || Date.now() < quietUntil || holding) return;
  ipcRenderer.send("theater:user", { action, position: video.currentTime });
}

const onPlay = () => {
  // A held player starts on its own (autoplay): stop it where it is until the room plays.
  if (holding && video) { video.pause(); return; }
  user("play");
};
const onPause = () => {
  if (!video?.ended) user("pause");
};
const onSeeked = () => user("seek");
const onEnded = () => { if (!holding) ipcRenderer.send("theater:ended", { position: video?.currentTime ?? 0 }); };

function attach(next: HTMLVideoElement | null): void {
  if (video) {
    video.removeEventListener("play", onPlay);
    video.removeEventListener("pause", onPause);
    video.removeEventListener("seeked", onSeeked);
    video.removeEventListener("ended", onEnded);
  }
  video = next;
  if (!video) return;
  video.addEventListener("play", onPlay);
  video.addEventListener("pause", onPause);
  video.addEventListener("seeked", onSeeked);
  video.addEventListener("ended", onEnded);
  if (holding) { video.volume = 0; if (!video.paused) video.pause(); }
  fadeVolume();
  retap();
}

// Find the video as soon as the page has one (not on the first status tick a second later):
// an autoplay that starts before then would go unseen, and the room would stop it after 1 s.
const early = setInterval(() => {
  const found = pick();
  if (!found) return;
  clearInterval(early);
  if (found !== video) attach(found);
}, 150);
setTimeout(() => clearInterval(early), 30_000);

setInterval(() => {
  const found = pick();
  if (found !== video) attach(found);
  if (!video) return;
  // A held player still reports (paused), so the room's sync can see it and play it when due.
  if (holding) {
    if (!video.paused) video.pause();
  } else {
    if (wanted !== null && !fade && !graph && Math.abs(video.volume - wanted * fxVolume) > 0.01) fadeVolume();
    if (levelsWanted && tap?.el !== video) retap();
  }
  ipcRenderer.send("theater:status", {
    position: video.currentTime,
    duration: Number.isFinite(video.duration) ? video.duration : null,
    paused: video.paused,
    ended: video.ended,
  });
}, 1000);

ipcRenderer.on("theater:control", (_event, command: Command) => {
  if (command.action === "levels") {
    levelsWanted = command.on === true;
    if (!video) attach(pick());
    retap();
    return;
  }
  if (command.action === "volume") {
    if (typeof command.volume !== "number" || !Number.isFinite(command.volume)) return;
    const next = Math.min(1, Math.max(0, command.volume));
    if (next === wanted) return;
    wanted = next;
    if (!video) attach(pick());
    fadeVolume();
    return;
  }
  if (command.action === "fx") {
    if (!video) attach(pick());
    const presets: Preset[] = ["smooth", "filter", "echo", "brake", "bassswap", "riser"];
    if (!command.preset || !presets.includes(command.preset) || (command.role !== "in" && command.role !== "out")) return;
    const seconds = typeof command.seconds === "number" && command.seconds > 0 && command.seconds <= 30 ? command.seconds : 8;
    runFx(command.preset, command.role, seconds);
    return;
  }
  const target = video ?? pick();
  if (!target) return;
  if (target !== video) attach(target);
  // The room starting a held deck: it plays from here on, and its transition takes it in.
  if (holding && command.action === "play") {
    holding = false;
    fadeVolume();
    retap();
  }
  quietUntil = Math.max(quietUntil, Date.now() + 800);
  if (typeof command.position === "number" && Math.abs(target.currentTime - command.position) > 0.5) target.currentTime = command.position;
  if (command.action === "play" && target.paused) void target.play().catch(() => {});
  if (command.action === "pause" && !target.paused) target.pause();
});
