import {t as translate,onLocalizationChange} from "../../../shared/localization/index.ts";
import type { Settings } from "../store.ts";
export let SCREEN_RESOLUTIONS = [
  { value: 0, label: translate("common.4641f969baef"), width: 0, height: 0 },
  { value: 480, label: translate("common.beaed8907c17"), width: 854, height: 480 },
  { value: 720, label: translate("common.045272540d8c"), width: 1280, height: 720 },
  { value: 1080, label: translate("common.387b5691c622"), width: 1920, height: 1080 },
  { value: 1440, label: translate("common.db4475135161"), width: 2560, height: 1440 },
  { value: 2048, label: translate("common.db66a42549fa"), width: 2048, height: 1080 },
  { value: 2160, label: translate("common.51710172c476"), width: 3840, height: 2160 },
];
export function screenProfile(settings: Pick<Settings, "screenHeight" | "screenFps">) {
  const resolution = SCREEN_RESOLUTIONS.find((r) => r.value === settings.screenHeight) ?? SCREEN_RESOLUTIONS[3]!;
  const fps = [0, 15, 24, 30, 60, 120].includes(settings.screenFps) ? settings.screenFps : 30;
  return { constraints: { ...(resolution.width ? { width: { ideal: resolution.width, max: resolution.width }, height: { ideal: resolution.height, max: resolution.height } } : {}), frameRate: fps ? { ideal: fps, max: fps } : { ideal: 144 } }, maxBitrate: Math.round(Math.min(60_000_000, Math.max(800_000, (resolution.width || 3840) * (resolution.height || 2160) * (fps || 144) * .085))), quality: { width: resolution.width, height: resolution.height, fps } };
}
export const screenQualityLabel = (quality?: { width?: number; height: number; fps: number }) => quality ? `${quality.height === 0 ? translate("common.da1276388e49") : quality.width === 2048 ? "2K" : quality.height === 2160 ? "4K" : `${quality.height}p`} ${quality.fps ? `${quality.fps} FPS` : translate("common.b669ba5781e9")}` : translate("common.6872fc989a63");





onLocalizationChange(()=>{SCREEN_RESOLUTIONS=[
  { value: 0, label: translate("common.4641f969baef"), width: 0, height: 0 },
  { value: 480, label: translate("common.beaed8907c17"), width: 854, height: 480 },
  { value: 720, label: translate("common.045272540d8c"), width: 1280, height: 720 },
  { value: 1080, label: translate("common.387b5691c622"), width: 1920, height: 1080 },
  { value: 1440, label: translate("common.db4475135161"), width: 2560, height: 1440 },
  { value: 2048, label: translate("common.db66a42549fa"), width: 2048, height: 1080 },
  { value: 2160, label: translate("common.51710172c476"), width: 3840, height: 2160 },
];});
