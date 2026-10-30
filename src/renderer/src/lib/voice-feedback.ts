/** Short original cues; reuse one context and keep feedback independent of call output mute. */
let context: AudioContext | null = null;
export function playVoiceFeedback(disabled: boolean): void {
  playCue(disabled ? [620, 440] : [440, 740]);
}

/** Distinct membership cues for both the local participant and people already in the room. */
export function playCallFeedback(event: "join" | "leave"): void {
  playCue(event === "join" ? [392, 523, 659] : [659, 523, 392]);
}

export function playStreamFeedback(): void { playCue([523, 784, 1047, 784]); }

export function playMessageFeedback(): void {
  playCue([880, 1175]);
}

function playCue(frequencies: number[]): void {
  try {
    const audio = context ??= new AudioContext();
    void audio.resume().then(() => {
      const start = audio.currentTime;
      for (const [index, frequency] of frequencies.entries()) {
        const tone = audio.createOscillator();
        const gain = audio.createGain();
        tone.type = "sine";
        tone.frequency.value = frequency;
        const at = start + index * 0.075;
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(0.09, at + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.001, at + 0.09);
        tone.connect(gain).connect(audio.destination);
        tone.start(at);
        tone.stop(at + 0.1);
        tone.onended = () => { tone.disconnect(); gain.disconnect(); };
      }
    }).catch(() => undefined);
  } catch { /* Feedback must never prevent changing voice state. */ }
}
