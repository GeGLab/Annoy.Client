import type { Settings } from "../store.ts";
export const SCREEN_RESOLUTIONS = [
  { value: 480, label: "480p", width: 854, height: 480 },
  { value: 720, label: "720p HD", width: 1280, height: 720 },
  { value: 1080, label: "1080p Full HD", width: 1920, height: 1080 },
  { value: 1440, label: "1440p QHD", width: 2560, height: 1440 },
  { value: 2048, label: "2K (2048 × 1080)", width: 2048, height: 1080 },
  { value: 2160, label: "4K (3840 × 2160)", width: 3840, height: 2160 },
];
export function screenProfile(settings: Pick<Settings, "screenHeight" | "screenFps">) {
  const resolution = SCREEN_RESOLUTIONS.find((r) => r.value === settings.screenHeight) ?? SCREEN_RESOLUTIONS[2]!;
  const fps = [15, 24, 30, 60, 120].includes(settings.screenFps) ? settings.screenFps : 30;
  return { constraints: { width: { ideal: resolution.width, max: resolution.width }, height: { ideal: resolution.height, max: resolution.height }, frameRate: { ideal: fps, max: fps } }, maxBitrate: Math.round(Math.min(60_000_000, Math.max(800_000, resolution.width * resolution.height * fps * .085))), quality: { width: resolution.width, height: resolution.height, fps } };
}
export const screenQualityLabel = (quality?: { width?: number; height: number; fps: number }) => quality ? `${quality.width === 2048 ? "2K" : quality.height === 2160 ? "4K" : `${quality.height}p`} ${quality.fps} FPS` : "Ao vivo";
