# Noise suppression

The microphone runs through a local neural filter before anything is sent. The
filters come from [`@sapphi-red/web-noise-suppressor`](https://github.com/sapphi-red/web-noise-suppressor)
(MIT) and run as AudioWorklets with WebAssembly, bundled with the app: no model
is downloaded at runtime and no audio leaves the machine unfiltered.

| Setting | Model | Added latency | Best at |
| --- | --- | --- | --- |
| IA forte (default) | [GTCRN](https://github.com/Xiaobin-Rong/gtcrn) | ~32 ms | keyboards, clicks, fans |
| RNNoise | [RNNoise](https://github.com/xiph/rnnoise) | ~21 ms | steady noise (fans, AC) |
| Máximo | RNNoise → GTCRN | ~52 ms | the least noise, more processed voice |
| Do navegador | Chromium WebRTC NS | ~0 | the behaviour up to 0.3 |
| Desligado | none | 0 | |

Voice-activity detection listens to the filtered signal, so with the neural
filters a keyboard no longer opens the microphone.

## How the filters were compared

20 s of clean studio speech (48 kHz, from
[voxserv/audio_quality_testing_samples](https://github.com/voxserv/audio_quality_testing_samples))
mixed with three noises at fixed SNRs:

- **fan**: brown-ish broadband plus 120/240 Hz hum, 5 dB SNR
- **keyboard**: synthetic bursts of mechanical key clicks, 10 dB SNR
- **babble**: two other speakers in the background, 5 dB SNR

Each filter processed the mixture and, separately, the noise alone. Reported:

- **SI-SDR** of the output against the clean speech, after compensating the
  filter's delay (higher is better; the unprocessed mixture scores its SNR).
- **Noise left**: energy of the filtered noise-only signal relative to the
  input, i.e. what others hear while you are silent (more negative is better).

| Noise | Metric | none | WebRTC | RNNoise | GTCRN | RNNoise→GTCRN |
| --- | --- | --- | --- | --- | --- | --- |
| clean speech | SI-SDR | ∞ | n/a | 12.4 | 12.9 | 9.5 |
| fan | SI-SDR | 5.0 | n/a | 8.8 | 8.7 | 7.6 |
| fan | noise left (dB) | 0 | -19.3 | **-40.4** | -21.4 | -57.5 |
| keyboard | SI-SDR | 10.0 | n/a | 10.2 | **12.0** | 9.0 |
| keyboard | noise left (dB) | 0 | -3.8 | -5.7 | **-52.5** | -54.9 |
| babble | SI-SDR | 5.0 | n/a | 3.7 | 4.0 | 3.6 |
| babble | noise left (dB) | 0 | -0.7 | -0.2 | -0.7 | -0.7 |

WebRTC was measured through a live capture (fake microphone), whose clock drift
makes its SI-SDR meaningless; only its noise-left figure is comparable.

In the app (Electron, fake microphone playing the keyboard-only noise), the
input meter peaked at 96% unfiltered, 99% with WebRTC, 21% with RNNoise and
0.8% with GTCRN, against a default voice-activation threshold of 18%.

CPU: offline, GTCRN processed 20 s in about 1.1 s and RNNoise in about 0.4 s
on one core, i.e. roughly 5% and 2% of a core in real time.

## Known limits and next steps

- **Background voices** (TV, people in the room) are untouched by every filter
  here: they are speech. Removing them needs target-speaker extraction (a model
  conditioned on the user's own voice), the next research step.
- The neural filters colour clean speech slightly (SI-SDR ~12-13 dB on clean
  input). A listening test with real microphones should confirm the default.
- Candidates to evaluate: DeepFilterNet 3 bundled locally (higher quality,
  more CPU), and a custom model trained on Annoy's own use (games, keyboards,
  headsets).
