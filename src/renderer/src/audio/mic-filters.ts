// Microphone filter chain modelled on OBS's audio filters. Order, after the
// noise suppression model: noise gate → 3-band EQ → gain → compressor → limiter.
// Every step runs locally in Web Audio and can change during a call.

export interface MicFilters {
  gate: { enabled: boolean; openDb: number; closeDb: number; attackMs: number; holdMs: number; releaseMs: number };
  eq: { enabled: boolean; lowDb: number; midDb: number; highDb: number };
  gain: { enabled: boolean; db: number };
  compressor: { enabled: boolean; thresholdDb: number; ratio: number; attackMs: number; releaseMs: number; outputDb: number };
  limiter: { enabled: boolean; thresholdDb: number; releaseMs: number };
}

/** OBS defaults; everything starts off so the voice is unchanged until the user opts in. */
export const DEFAULT_MIC_FILTERS: MicFilters = {
  gate: { enabled: false, openDb: -26, closeDb: -32, attackMs: 25, holdMs: 200, releaseMs: 150 },
  eq: { enabled: false, lowDb: 0, midDb: 0, highDb: 0 },
  gain: { enabled: false, db: 0 },
  compressor: { enabled: false, thresholdDb: -18, ratio: 10, attackMs: 6, releaseMs: 60, outputDb: 0 },
  limiter: { enabled: false, thresholdDb: -6, releaseMs: 60 },
};

/** Allowed range of each number, also used by the settings sliders. */
export const MIC_FILTER_RANGES = {
  gate: { openDb: [-96, 0], closeDb: [-96, 0], attackMs: [1, 500], holdMs: [0, 1000], releaseMs: [1, 1000] },
  eq: { lowDb: [-20, 20], midDb: [-20, 20], highDb: [-20, 20] },
  gain: { db: [-30, 30] },
  compressor: { thresholdDb: [-60, 0], ratio: [1, 20], attackMs: [1, 100], releaseMs: [10, 1000], outputDb: [-32, 32] },
  limiter: { thresholdDb: [-60, 0], releaseMs: [10, 1000] },
} as const satisfies { [K in keyof MicFilters]: { [P in Exclude<keyof MicFilters[K], "enabled">]: readonly [number, number] } };

/** Fills gaps and clamps values from storage (older installs have no filters at all). */
export function normalizeMicFilters(saved: unknown): MicFilters {
  const out = structuredClone(DEFAULT_MIC_FILTERS) as unknown as Record<string, Record<string, number | boolean>>;
  const input = (saved && typeof saved === "object" ? saved : {}) as Record<string, unknown>;
  for (const [group, ranges] of Object.entries(MIC_FILTER_RANGES) as [string, Record<string, readonly [number, number]>][]) {
    const value = (input[group] && typeof input[group] === "object" ? input[group] : {}) as Record<string, unknown>;
    if (typeof value.enabled === "boolean") out[group]!.enabled = value.enabled;
    for (const [key, [min, max]] of Object.entries(ranges)) {
      const n = value[key];
      if (typeof n === "number" && Number.isFinite(n)) out[group]![key] = Math.max(min, Math.min(max, n));
    }
  }
  const result = out as unknown as MicFilters;
  // The gate closes below where it opens, like OBS.
  if (result.gate.closeDb > result.gate.openDb) result.gate.closeDb = result.gate.openDb;
  return result;
}

const EQ_BANDS = { low: 250, mid: 1500, high: 5000 } as const;

/** The Web Audio part of the chain. `input` takes the suppressed signal; `output` is what the others hear. */
export class MicFilterChain {
  readonly input: AudioNode;
  readonly output: AudioNode;
  private gate: AudioWorkletNode | null;
  private low: BiquadFilterNode;
  private mid: BiquadFilterNode;
  private high: BiquadFilterNode;
  private gain: GainNode;
  private compressor: DynamicsCompressorNode;
  private makeup: GainNode;
  private limiter: DynamicsCompressorNode;
  private readonly ctx: AudioContext;

  constructor(ctx: AudioContext, gate: AudioWorkletNode | null, filters: MicFilters) {
    this.ctx = ctx;
    this.gate = gate;
    this.low = new BiquadFilterNode(ctx, { type: "lowshelf", frequency: EQ_BANDS.low });
    this.mid = new BiquadFilterNode(ctx, { type: "peaking", frequency: EQ_BANDS.mid, Q: 0.8 });
    this.high = new BiquadFilterNode(ctx, { type: "highshelf", frequency: EQ_BANDS.high });
    this.gain = new GainNode(ctx);
    this.compressor = new DynamicsCompressorNode(ctx, { knee: 0 });
    this.makeup = new GainNode(ctx);
    this.limiter = new DynamicsCompressorNode(ctx, { knee: 0, attack: 0.001 });
    const nodes: AudioNode[] = [...(gate ? [gate] : []), this.low, this.mid, this.high, this.gain, this.compressor, this.makeup, this.limiter];
    for (let i = 1; i < nodes.length; i++) nodes[i - 1]!.connect(nodes[i]!);
    this.input = nodes[0]!;
    this.output = this.limiter;
    this.update(filters);
  }

  update(filters: MicFilters): void {
    const now = this.ctx.currentTime;
    const set = (param: AudioParam, value: number) => { param.cancelScheduledValues(now); param.setTargetAtTime(value, now, 0.02); };
    const db = (value: number) => 10 ** (value / 20);
    const { gate, eq, gain, compressor, limiter } = filters;
    if (this.gate) {
      const p = this.gate.parameters;
      p.get("enabled")!.value = gate.enabled ? 1 : 0;
      p.get("openDb")!.value = gate.openDb;
      p.get("closeDb")!.value = Math.min(gate.closeDb, gate.openDb);
      p.get("attackMs")!.value = gate.attackMs;
      p.get("holdMs")!.value = gate.holdMs;
      p.get("releaseMs")!.value = gate.releaseMs;
    }
    set(this.low.gain, eq.enabled ? eq.lowDb : 0);
    set(this.mid.gain, eq.enabled ? eq.midDb : 0);
    set(this.high.gain, eq.enabled ? eq.highDb : 0);
    set(this.gain.gain, gain.enabled ? db(gain.db) : 1);
    // A ratio of 1 makes a DynamicsCompressorNode pass the signal unchanged.
    this.compressor.threshold.value = compressor.enabled ? compressor.thresholdDb : 0;
    this.compressor.ratio.value = compressor.enabled ? compressor.ratio : 1;
    this.compressor.attack.value = compressor.attackMs / 1000;
    this.compressor.release.value = compressor.releaseMs / 1000;
    set(this.makeup.gain, compressor.enabled ? db(compressor.outputDb) : 1);
    this.limiter.threshold.value = limiter.enabled ? limiter.thresholdDb : 0;
    this.limiter.ratio.value = limiter.enabled ? 20 : 1;
    this.limiter.release.value = limiter.releaseMs / 1000;
  }

  disconnect(): void {
    for (const node of [this.gate, this.low, this.mid, this.high, this.gain, this.compressor, this.makeup, this.limiter]) node?.disconnect();
  }
}
