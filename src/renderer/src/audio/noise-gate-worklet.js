// Noise gate with the same controls as OBS: open/close thresholds (dB),
// attack, hold and release (ms). Loaded as an AudioWorklet module.
class AnnoyNoiseGate extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    const k = (name, defaultValue) => ({ name, defaultValue, automationRate: "k-rate" });
    return [k("enabled", 0), k("openDb", -26), k("closeDb", -32), k("attackMs", 25), k("holdMs", 200), k("releaseMs", 150)];
  }

  constructor() {
    super();
    this.envelope = 0;
    this.open = false;
    this.held = 0;
    this.gain = 1;
    // Peak follower with a 10 ms fall, so single zero crossings don't close the gate.
    this.decay = Math.exp(-1 / (sampleRate * 0.01));
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0) return true;
    const enabled = parameters.enabled[0] >= 0.5;
    const openLevel = 10 ** (parameters.openDb[0] / 20);
    const closeLevel = 10 ** (Math.min(parameters.closeDb[0], parameters.openDb[0]) / 20);
    const attackStep = 1 / Math.max(1, (parameters.attackMs[0] * sampleRate) / 1000);
    const releaseStep = 1 / Math.max(1, (parameters.releaseMs[0] * sampleRate) / 1000);
    const holdSamples = (parameters.holdMs[0] * sampleRate) / 1000;
    const frames = input[0].length;
    for (let i = 0; i < frames; i++) {
      let peak = 0;
      for (let c = 0; c < input.length; c++) peak = Math.max(peak, Math.abs(input[c][i]));
      this.envelope = Math.max(peak, this.envelope * this.decay);
      if (!enabled) {
        this.open = true;
        this.gain = 1;
      } else {
        if (this.envelope > openLevel) this.open = true;
        else if (this.open && this.envelope < closeLevel) { this.open = false; this.held = 0; }
        if (this.open) this.gain = Math.min(1, this.gain + attackStep);
        else if (++this.held > holdSamples) this.gain = Math.max(0, this.gain - releaseStep);
      }
      for (let c = 0; c < output.length; c++) output[c][i] = (input[c] ?? input[0])[i] * this.gain;
    }
    return true;
  }
}

registerProcessor("annoy-noise-gate", AnnoyNoiseGate);
