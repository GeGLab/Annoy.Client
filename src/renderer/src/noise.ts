import {t as translate,onLocalizationChange} from "../../shared/localization/index.ts";
// Microphone capture with optional neural noise suppression, shared by voice
// sessions and the settings meter. Everything runs locally in AudioWorklets;
// no audio leaves the machine before the filters.
import { getState, setState, toast } from "./store.ts";
import { GtcrnWorkletNode, loadGtcrn, loadRnnoise, loadSpeex, RnnoiseWorkletNode, SpeexWorkletNode } from "@sapphi-red/web-noise-suppressor";
import gtcrnWasm from "@sapphi-red/web-noise-suppressor/gtcrn.wasm?url";
import gtcrnWorklet from "@sapphi-red/web-noise-suppressor/gtcrnWorklet.js?url";
import rnnoiseWasm from "@sapphi-red/web-noise-suppressor/rnnoise.wasm?url";
import rnnoiseSimdWasm from "@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url";
import rnnoiseWorklet from "@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url";
import speexWasm from "@sapphi-red/web-noise-suppressor/speex.wasm?url";
import speexWorklet from "@sapphi-red/web-noise-suppressor/speexWorklet.js?url";
import gateWorklet from "./audio/noise-gate-worklet.js?url";
import { DEFAULT_MIC_FILTERS, MicFilterChain, type MicFilters } from "./audio/mic-filters.ts";

/**
 * - gtcrn: neural model, strongest on keyboards and clicks (default)
 * - rnnoise: lighter model, strongest on steady noise like fans
 * - speex: classic DSP suppression (OBS's "Speex"), lightest on the CPU
 * - max: both in sequence; removes the most, colours the voice a little more
 * - browser: Chromium's WebRTC suppression, the behaviour up to 0.3
 */
export type NoiseFilter = "gtcrn" | "rnnoise" | "speex" | "max" | "browser" | "off";

export let NOISE_FILTERS: { value: NoiseFilter; label: string; hint: string }[] = [
  { value: "gtcrn", label: translate("common.8ccce6fcaec1"), hint: translate("common.51a652e6241a") },
  { value: "rnnoise", label: translate("common.5f1104865a91"), hint: translate("common.05237f96876b") },
  { value: "speex", label: translate("voice.noise.speex"), hint: translate("voice.noise.speexHint") },
  { value: "max", label: translate("common.994d51043f7d"), hint: translate("common.366ba4ffb33d") },
  { value: "browser", label: translate("common.31204f8019ef"), hint: translate("common.b45117f459b3") },
  { value: "off", label: translate("common.20324fbd274a"), hint: translate("common.19fdba9b1e25") },
];

type Model = "gtcrn" | "rnnoise" | "speex";
type ModelNode = GtcrnWorkletNode | RnnoiseWorkletNode | SpeexWorkletNode;
const CHAINS: Record<NoiseFilter, Model[]> = { gtcrn: ["gtcrn"], rnnoise: ["rnnoise"], speex: ["speex"], max: ["rnnoise", "gtcrn"], browser: [], off: [] };

const binaries = new Map<Model, Promise<ArrayBuffer>>();
function binary(model: Model): Promise<ArrayBuffer> {
  let p = binaries.get(model);
  if (!p) {
    p = model === "gtcrn" ? loadGtcrn({ url: gtcrnWasm }) : model === "speex" ? loadSpeex({ url: speexWasm }) : loadRnnoise({ url: rnnoiseWasm, simdUrl: rnnoiseSimdWasm });
    // A failed load (e.g. offline asset) may succeed next time.
    p.catch(() => binaries.delete(model));
    binaries.set(model, p);
  }
  return p;
}

async function createNode(ctx: AudioContext, model: Model): Promise<ModelNode> {
  const wasmBinary = await binary(model);
  await ctx.audioWorklet.addModule(model === "gtcrn" ? gtcrnWorklet : model === "speex" ? speexWorklet : rnnoiseWorklet);
  if (model === "gtcrn") return new GtcrnWorkletNode(ctx, { maxChannels: 1, wasmBinary });
  if (model === "speex") return new SpeexWorkletNode(ctx, { maxChannels: 1, wasmBinary });
  return new RnnoiseWorkletNode(ctx, { maxChannels: 1, wasmBinary });
}

async function createGate(ctx: AudioContext): Promise<AudioWorkletNode | null> {
  try {
    await ctx.audioWorklet.addModule(gateWorklet);
    return new AudioWorkletNode(ctx, "annoy-noise-gate", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
  } catch (err) {
    console.warn("noise gate unavailable", err);
    return null;
  }
}

export interface Mic {
  ctx: AudioContext;
  /** Last node of the chain: what the others will hear. */
  output: AudioNode;
  /** Processed track to hand to the transport. */
  track: MediaStreamTrack;
  /** Applies new gate/EQ/gain/compressor/limiter values without reopening the microphone. */
  setFilters(filters: MicFilters): void;
  stop(): void;
}

/** Chromium rejects a saved device that is gone with an OverconstrainedError whose message is empty. */
const MISSING_DEVICE = new Set(["OverconstrainedError", "NotFoundError"]);

/** Turns getUserMedia failures into readable errors; several arrive with an empty message. */
function micError(err: unknown): Error {
  const name = (err as { name?: string } | null)?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError") return new Error(translate("voice.mic.denied"));
  if (MISSING_DEVICE.has(name)) return new Error(translate("voice.mic.notFound"));
  if (name === "NotReadableError" || name === "AbortError") return new Error(translate("voice.mic.busy"));
  const message = (err as { message?: string } | null)?.message;
  return err instanceof Error && message ? err : new Error(message || name || String(err));
}

/** Opens the chosen microphone, falling back to the system default when it is no longer connected. */
async function captureMic(deviceId: string, filter: NoiseFilter): Promise<MediaStream> {
  const open = (id: string | undefined) =>
    navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: id ? { exact: id } : undefined,
        echoCancellation: true,
        // Our models expect the untouched signal; stacking suppressors smears speech.
        noiseSuppression: filter === "browser",
        autoGainControl: true,
      },
    });
  try {
    return await open(deviceId === "default" ? undefined : deviceId);
  } catch (err) {
    if (deviceId === "default" || !MISSING_DEVICE.has((err as { name?: string } | null)?.name ?? "")) throw micError(err);
  }
  try {
    const stream = await open(undefined);
    // Device IDs change when the app's storage is cleared; forget the stale one so this happens once.
    if (getState().settings.inputDeviceId === deviceId) {
      setState((s) => { s.settings.inputDeviceId = "default"; });
      toast(translate("voice.mic.fallback"), 8000);
    }
    return stream;
  } catch (err) {
    throw micError(err);
  }
}

export async function openMic(deviceId: string, filter: NoiseFilter, filters: MicFilters = DEFAULT_MIC_FILTERS): Promise<Mic> {
  const stream = await captureMic(deviceId, filter);
  // The models run at 48 kHz, which is also what Opus sends.
  const ctx = new AudioContext({ sampleRate: 48000 });
  const nodes: ModelNode[] = [];
  let output: AudioNode = ctx.createMediaStreamSource(stream);
  try {
    for (const model of CHAINS[filter]) {
      const node = await createNode(ctx, model);
      output.connect(node);
      output = node;
      nodes.push(node);
    }
  } catch (err) {
    // Fall back to the unfiltered signal rather than losing the microphone.
    console.warn("noise filter unavailable", err);
    toast(translate("common.809333909b92"), 10000);
  }
  const chain = new MicFilterChain(ctx, await createGate(ctx), filters);
  output.connect(chain.input);
  output = chain.output;
  await ctx.resume();
  const dest = ctx.createMediaStreamDestination();
  output.connect(dest);
  return {
    ctx,
    output,
    track: dest.stream.getAudioTracks()[0]!,
    setFilters: (next) => chain.update(next),
    stop() {
      chain.disconnect();
      for (const node of nodes) node.destroy();
      for (const t of stream.getTracks()) t.stop();
      for (const t of dest.stream.getTracks()) t.stop();
      void ctx.close();
    },
  };
}



onLocalizationChange(()=>{NOISE_FILTERS=[
  { value: "gtcrn", label: translate("common.8ccce6fcaec1"), hint: translate("common.51a652e6241a") },
  { value: "rnnoise", label: translate("common.5f1104865a91"), hint: translate("common.05237f96876b") },
  { value: "speex", label: translate("voice.noise.speex"), hint: translate("voice.noise.speexHint") },
  { value: "max", label: translate("common.994d51043f7d"), hint: translate("common.366ba4ffb33d") },
  { value: "browser", label: translate("common.31204f8019ef"), hint: translate("common.b45117f459b3") },
  { value: "off", label: translate("common.20324fbd274a"), hint: translate("common.19fdba9b1e25") },
];});
