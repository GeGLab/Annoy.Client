import {t as translate,onLocalizationChange} from "../../shared/localization/index.ts";
// Microphone capture with optional neural noise suppression, shared by voice
// sessions and the settings meter. Everything runs locally in AudioWorklets;
// no audio leaves the machine before the filters.
import { toast } from "./store.ts";
import { GtcrnWorkletNode, loadGtcrn, loadRnnoise, RnnoiseWorkletNode } from "@sapphi-red/web-noise-suppressor";
import gtcrnWasm from "@sapphi-red/web-noise-suppressor/gtcrn.wasm?url";
import gtcrnWorklet from "@sapphi-red/web-noise-suppressor/gtcrnWorklet.js?url";
import rnnoiseWasm from "@sapphi-red/web-noise-suppressor/rnnoise.wasm?url";
import rnnoiseSimdWasm from "@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url";
import rnnoiseWorklet from "@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url";

/**
 * - gtcrn: neural model, strongest on keyboards and clicks (default)
 * - rnnoise: lighter model, strongest on steady noise like fans
 * - max: both in sequence; removes the most, colours the voice a little more
 * - browser: Chromium's WebRTC suppression, the behaviour up to 0.3
 */
export type NoiseFilter = "gtcrn" | "rnnoise" | "max" | "browser" | "off";

export let NOISE_FILTERS: { value: NoiseFilter; label: string; hint: string }[] = [
  { value: "gtcrn", label: translate("common.8ccce6fcaec1"), hint: translate("common.51a652e6241a") },
  { value: "rnnoise", label: translate("common.5f1104865a91"), hint: translate("common.05237f96876b") },
  { value: "max", label: translate("common.994d51043f7d"), hint: translate("common.366ba4ffb33d") },
  { value: "browser", label: translate("common.31204f8019ef"), hint: translate("common.b45117f459b3") },
  { value: "off", label: translate("common.20324fbd274a"), hint: translate("common.19fdba9b1e25") },
];

type Model = "gtcrn" | "rnnoise";
const CHAINS: Record<NoiseFilter, Model[]> = { gtcrn: ["gtcrn"], rnnoise: ["rnnoise"], max: ["rnnoise", "gtcrn"], browser: [], off: [] };

const binaries = new Map<Model, Promise<ArrayBuffer>>();
function binary(model: Model): Promise<ArrayBuffer> {
  let p = binaries.get(model);
  if (!p) {
    p = model === "gtcrn" ? loadGtcrn({ url: gtcrnWasm }) : loadRnnoise({ url: rnnoiseWasm, simdUrl: rnnoiseSimdWasm });
    // A failed load (e.g. offline asset) may succeed next time.
    p.catch(() => binaries.delete(model));
    binaries.set(model, p);
  }
  return p;
}

async function createNode(ctx: AudioContext, model: Model): Promise<GtcrnWorkletNode | RnnoiseWorkletNode> {
  const wasmBinary = await binary(model);
  await ctx.audioWorklet.addModule(model === "gtcrn" ? gtcrnWorklet : rnnoiseWorklet);
  return model === "gtcrn" ? new GtcrnWorkletNode(ctx, { maxChannels: 1, wasmBinary }) : new RnnoiseWorkletNode(ctx, { maxChannels: 1, wasmBinary });
}

export interface Mic {
  ctx: AudioContext;
  /** Last node of the chain: what the others will hear. */
  output: AudioNode;
  /** Processed track to hand to the transport. */
  track: MediaStreamTrack;
  stop(): void;
}

export async function openMic(deviceId: string, filter: NoiseFilter): Promise<Mic> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: deviceId === "default" ? undefined : { exact: deviceId },
      echoCancellation: true,
      // Our models expect the untouched signal; stacking suppressors smears speech.
      noiseSuppression: filter === "browser",
      autoGainControl: true,
    },
  });
  // The models run at 48 kHz, which is also what Opus sends.
  const ctx = new AudioContext({ sampleRate: 48000 });
  const nodes: (GtcrnWorkletNode | RnnoiseWorkletNode)[] = [];
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
  await ctx.resume();
  const dest = ctx.createMediaStreamDestination();
  output.connect(dest);
  return {
    ctx,
    output,
    track: dest.stream.getAudioTracks()[0]!,
    stop() {
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
  { value: "max", label: translate("common.994d51043f7d"), hint: translate("common.366ba4ffb33d") },
  { value: "browser", label: translate("common.31204f8019ef"), hint: translate("common.b45117f459b3") },
  { value: "off", label: translate("common.20324fbd274a"), hint: translate("common.19fdba9b1e25") },
];});
