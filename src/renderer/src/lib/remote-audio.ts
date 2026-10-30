import { normalizeUserVolume } from "../../../shared/user-volume.ts";

export interface AmplifiedAudio {
  readonly stream: MediaStream;
  setVolume(percent: number): void;
  close(): void;
}

function processingContext(): AudioContext {
  const options: AudioContextOptions & { sinkId?: { type: "none" } } = { latencyHint: "interactive" };
  // The audio element owns the actual output device; processing must not open a second physical sink.
  if ("setSinkId" in AudioContext.prototype) options.sinkId = { type: "none" };
  return new AudioContext(options);
}

/** Native RTC playback up to 100%; optional processing only when amplification is requested. */
export class RemoteAudioMixer {
  private context: AudioContext | null = null;
  private outputs = new Set<AmplifiedAudio>();
  private closed = false;
  private createContext: () => AudioContext;
  private createAudio: () => HTMLAudioElement;

  constructor(createContext = processingContext, createAudio: () => HTMLAudioElement = () => new Audio()) {
    this.createContext = createContext;
    this.createAudio = createAudio;
  }

  connect(stream: MediaStream, percent: number, audio: HTMLAudioElement): AmplifiedAudio {
    if (this.closed) throw new Error("Audio session is closed");
    audio.srcObject = stream;
    let closed = false, value = 100, revision = 0;
    let graph: { source: MediaStreamAudioSourceNode; gain: GainNode; destination: MediaStreamAudioDestinationNode; pull: HTMLAudioElement } | null = null;
    const play = () => { void audio.play().catch(() => undefined); };
    const native = () => {
      audio.volume = Math.min(value / 100, 1);
      if (audio.srcObject !== stream) { audio.srcObject = stream; play(); }
      graph?.pull.pause();
    };
    const stateChanged = () => {
      if (!closed && this.context?.state !== "running" && audio.srcObject === graph?.destination.stream) native();
    };
    const amplify = async (requested: number) => {
      try {
        const context = this.context ??= this.createContext();
        if (!graph) {
          // Chromium's remote RTC source needs a live native renderer even when Web Audio consumes it.
          const pull = this.createAudio();
          pull.muted = true; pull.srcObject = stream;
          const source = context.createMediaStreamSource(stream), gain = context.createGain(), destination = context.createMediaStreamDestination();
          source.connect(gain); gain.connect(destination);
          graph = { source, gain, destination, pull };
          context.addEventListener("statechange", stateChanged);
        }
        graph.gain.gain.cancelScheduledValues(context.currentTime);
        graph.gain.gain.setTargetAtTime(value / 100, context.currentTime, 0.01);
        await Promise.all([context.resume(), graph.pull.play()]);
        if (closed || requested !== revision || value <= 100 || context.state !== "running") return;
        audio.volume = 1;
        if (audio.srcObject !== graph.destination.stream) { audio.srcObject = graph.destination.stream; play(); }
      } catch (error) {
        if (closed || requested !== revision) return;
        native();
        console.warn("Audio amplification unavailable; keeping native playback", error);
      }
    };
    const output: AmplifiedAudio = {
      get stream() { return audio.srcObject as MediaStream; },
      setVolume: (percent) => {
        if (closed) return;
        value = normalizeUserVolume(percent);
        revision++;
        if (value <= 100) native();
        else void amplify(revision);
      },
      close: () => {
        if (closed) return;
        closed = true; revision++;
        audio.pause(); audio.srcObject = null;
        if (graph) {
          this.context?.removeEventListener("statechange", stateChanged);
          graph.pull.pause(); graph.pull.srcObject = null;
          graph.source.disconnect(); graph.gain.disconnect(); graph.destination.disconnect();
          // Receiver tracks are owned by WebRTC. Stop only our processed output.
          graph.destination.stream.getTracks().forEach((track) => track.stop());
        }
        this.outputs.delete(output);
      },
    };
    this.outputs.add(output);
    output.setVolume(percent);
    return output;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const output of this.outputs) output.close();
    void this.context?.close().catch(() => undefined);
    this.context = null;
  }
}
