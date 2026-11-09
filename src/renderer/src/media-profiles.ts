import {t as translate,onLocalizationChange} from "../../shared/localization/index.ts";
// Capture and encoding choices shared by both voice backends.

export type ScreenQuality = "30" | "60" | "max";

export let SCREEN_QUALITIES: { value: ScreenQuality; label: string; hint: string }[] = [
  { value: "60", label: translate("common.225e1c6af8cb"), hint: translate("common.4cf6b4a50ee8") },
  { value: "30", label: translate("common.5e119b2325ce"), hint: translate("common.ccc2f6390b73") },
  { value: "max", label: translate("common.b669ba5781e9"), hint: translate("common.ff7bff9dec7d") },
];

/** Sender caps; the SFU forwards one encoding, so these bound everyone's download too. */
export const CAMERA_PROFILE = {
  constraints: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
  maxBitrate: 1_200_000,
};

/**
 * More frames per second share the same bitrate cap more thinly, so higher
 * qualities raise the cap. The Cloudflare budget counts each stream at its cap.
 */
export function screenProfile(quality: ScreenQuality): { constraints: MediaTrackConstraints; maxBitrate: number } {
  switch (quality) {
    case "30":
      return { constraints: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30, max: 30 } }, maxBitrate: 3_500_000 };
    case "60":
      return { constraints: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 60, max: 60 } }, maxBitrate: 6_000_000 };
    case "max":
      return { constraints: { frameRate: { ideal: 144 } }, maxBitrate: 8_000_000 };
  }
}

/** Windows captures the system's sound with the screen (WASAPI loopback); Linux through a PipeWire virtual microphone. */
export const screenAudioSupported = () => window.annoy?.platform === "win32" || window.annoy?.platform === "linux";

/** Name of the Linux screen-share microphone (see src/main/screen-audio-linux.ts); never offered as a microphone. */
export const SCREEN_AUDIO_DEVICE = "Annoy screen audio";

/**
 * The screen, plus its sound when asked. On Linux Chromium's loopback would
 * also record the call, so the sound comes from Annoy's virtual microphone,
 * which stops together with its track.
 */
export async function captureScreen(video: MediaTrackConstraints, withAudio: boolean): Promise<MediaStream> {
  const linux = window.annoy?.platform === "linux";
  const stream = await navigator.mediaDevices.getDisplayMedia({ video, audio: withAudio && !linux ? SCREEN_AUDIO_CONSTRAINTS : false });
  if (!withAudio || !linux || !window.annoy) return stream;
  const bridge = window.annoy.screenAudio;
  try {
    const label = await bridge.start();
    const device = label ? (await navigator.mediaDevices.enumerateDevices()).find((d) => d.kind === "audioinput" && d.label === label) : undefined;
    if (!device) throw new Error("screen audio device missing");
    const sound = (
      await navigator.mediaDevices.getUserMedia({ audio: { ...SCREEN_AUDIO_CONSTRAINTS, deviceId: { exact: device.deviceId }, channelCount: 2 } })
    ).getAudioTracks()[0];
    if (!sound) throw new Error("screen audio track missing");
    // Every path that ends the share stops this track; the virtual microphone goes with it.
    const stop = sound.stop.bind(sound);
    sound.stop = () => {
      stop();
      void bridge.stop();
    };
    stream.addTrack(sound);
  } catch (error) {
    console.warn("screen audio failed", error);
    void bridge.stop();
  }
  return stream;
}

/**
 * Audio for a screen share, minus Annoy's own playback so viewers don't hear
 * the call echoed back. Voice processing would damage music and game sound.
 */
export const SCREEN_AUDIO_CONSTRAINTS = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  restrictOwnAudio: true,
} as MediaTrackConstraints;

/** Opus settings: 64 kbps voice like Discord, and stereo at 128 kbps for a screen's sound. */
export const OPUS_VOICE = { maxaveragebitrate: 64000, useinbandfec: 1, usedtx: 1 };
export const OPUS_SCREEN = { maxaveragebitrate: 128000, stereo: 1, "sprop-stereo": 1, useinbandfec: 1, usedtx: 0 };

/**
 * Browsers encode Opus by what the remote description asks for, so the
 * bitrate is raised by editing the fmtp line of each of our audio sections.
 */
export function tuneOpus(sdp: string, byMid: ReadonlyMap<string, Record<string, number>>): string {
  if (byMid.size === 0) return sdp;
  const eol = sdp.includes("\r\n") ? "\r\n" : "\n";
  const [head, ...sections] = sdp.split(/(?=^m=)/m);
  return (
    head +
    sections
      .map((section) => {
        const mid = /^a=mid:(\S+)/m.exec(section)?.[1];
        const params = mid ? byMid.get(mid) : undefined;
        const pt = /^a=rtpmap:(\d+) opus\/48000/im.exec(section)?.[1];
        if (!section.startsWith("m=audio") || !params || !pt) return section;
        const line = new RegExp(`^a=fmtp:${pt} (.*)$`, "m");
        const current = new Map(
          (line.exec(section)?.[1] ?? "")
            .split(";")
            .map((kv) => kv.trim().split("="))
            .filter(([k]) => k)
            .map(([k, v]) => [k!, v ?? ""]),
        );
        for (const [k, v] of Object.entries(params)) current.set(k, String(v));
        const fmtp = `a=fmtp:${pt} ${[...current].map(([k, v]) => `${k}=${v}`).join(";")}`;
        return line.test(section) ? section.replace(line, fmtp) : section.replace(new RegExp(`^(a=rtpmap:${pt} .*)$`, "m"), `$1${eol}${fmtp}`);
      })
      .join("")
  );
}

/**
 * Cloudflare's answers may renumber RTP header extensions on a section that is
 * already negotiated (closing a track does it), which Chromium refuses and
 * leaves the connection stuck. Keep the numbers we already agreed on: for each
 * section we know, extensions take our ID by URI, and unknown ones are dropped.
 */
export function alignExtmap(remote: string, local: string | undefined): string {
  if (!local) return remote;
  const idsByMid = new Map<string, Map<string, string>>();
  for (const section of local.split(/(?=^m=)/m).slice(1)) {
    const mid = /^a=mid:(\S+)/m.exec(section)?.[1];
    if (!mid) continue;
    const ids = new Map<string, string>();
    for (const [, id, uri] of section.matchAll(/^a=extmap:(\d+)(?:\/\w+)? (\S+)/gm)) ids.set(uri!, id!);
    idsByMid.set(mid, ids);
  }
  const [head, ...sections] = remote.split(/(?=^m=)/m);
  return (
    head +
    sections
      .map((section) => {
        const mid = /^a=mid:(\S+)/m.exec(section)?.[1];
        const ids = mid ? idsByMid.get(mid) : undefined;
        if (!ids) return section;
        return section.replace(/^a=extmap:(\d+)((?:\/\w+)?) (\S+)(.*)(\r?\n)/gm, (_line, _id, dir: string, uri: string, rest: string, eol: string) => {
          const id = ids.get(uri);
          return id ? `a=extmap:${id}${dir} ${uri}${rest}${eol}` : "";
        });
      })
      .join("")
  );
}



onLocalizationChange(()=>{SCREEN_QUALITIES=[
  { value: "60", label: translate("common.225e1c6af8cb"), hint: translate("common.4cf6b4a50ee8") },
  { value: "30", label: translate("common.5e119b2325ce"), hint: translate("common.ccc2f6390b73") },
  { value: "max", label: translate("common.b669ba5781e9"), hint: translate("common.ff7bff9dec7d") },
];});
