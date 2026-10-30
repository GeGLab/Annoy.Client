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

export const NOISE_FILTERS: { value: NoiseFilter; label: string; hint: string }[] = [
  { value: "gtcrn", label: "IA forte (recomendado)", hint: "Remove teclado, cliques e ventilador. Atraso de ~30 ms." },
  { value: "rnnoise", label: "RNNoise (IA)", hint: "Mais leve. Ótimo para ventilador e ar-condicionado, fraco com teclado." },
  { value: "max", label: "Máximo", hint: "As duas IAs juntas: o mínimo de ruído, com a voz um pouco mais processada. Atraso de ~50 ms." },
  { value: "browser", label: "Do navegador", hint: "O filtro padrão do Chromium, mais fraco." },
  { value: "off", label: "Desligado", hint: "Áudio do microfone sem filtro." },
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
    toast("Não foi possível carregar a redução de ruído. O microfone continua disponível; confira o filtro nas configurações de voz.", 10000);
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
