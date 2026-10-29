// Capture and encoding choices shared by both voice backends.

export type ScreenQuality = "30" | "60" | "max";

export const SCREEN_QUALITIES: { value: ScreenQuality; label: string; hint: string }[] = [
  { value: "60", label: "60 fps", hint: "Fluido para jogos, em até 1080p." },
  { value: "30", label: "30 fps", hint: "Gasta menos internet. Bom para mostrar documentos e código." },
  { value: "max", label: "Sem limite", hint: "Usa a resolução e a taxa de quadros da sua tela." },
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

/** Only Windows can capture the system's sound together with the screen (WASAPI loopback). */
export const screenAudioSupported = () => window.distopic?.platform === "win32";

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
