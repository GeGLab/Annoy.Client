import { t } from "../../../shared/localization/index.ts";
import type { Settings } from "../store.ts";
import { captureScreen } from "../media-profiles.ts";
import { screenProfile } from "./screen-profile.ts";

export type ScreenSettings = Pick<Settings, "screenHeight" | "screenFps">;
export const screenContentHint = (settings: ScreenSettings) => settings.screenFps > 0 && settings.screenFps <= 30 ? "detail" : "motion";

/** Acquire first: cancellation or a failed replacement leaves the current share alone.
 * System audio keeps its existing sender/capture (including Linux's virtual mic). */
export async function replaceScreenCapture(options: {
  settings: Settings; previous: MediaStreamTrack; captured: Set<MediaStreamTrack>;
  current: () => boolean; replace: (track: MediaStreamTrack) => Promise<void>;
  commit: (track: MediaStreamTrack) => void;
}): Promise<void> {
  const stream = await captureScreen(screenProfile(options.settings).constraints, false);
  const track = stream.getVideoTracks()[0];
  const stop = () => { for (const captured of stream.getTracks()) { captured.stop(); options.captured.delete(captured); } };
  if (!track) { stop(); throw new Error(t("common.5641e70d7b1b")); }
  for (const captured of stream.getTracks()) options.captured.add(captured);
  try {
    if (!options.current()) return stop();
    track.contentHint = screenContentHint(options.settings);
    await options.replace(track);
    if (!options.current()) return stop();
    options.commit(track);
    options.previous.stop();
    options.captured.delete(options.previous);
  } catch (error) { stop(); throw error; }
}

/** Apply capture and encoder changes together, restoring the previous profile on failure. */
export async function applyScreenQuality(track: MediaStreamTrack, settings: ScreenSettings, previous: ScreenSettings, setBitrate: (bitrate: number) => Promise<void>, current: () => boolean): Promise<void> {
  const constraints = track.getConstraints();
  try {
    await track.applyConstraints(screenProfile(settings).constraints);
    if (!current()) throw new Error(t("common.99e2847d16e5"));
    await setBitrate(screenProfile(settings).maxBitrate);
    if (!current()) throw new Error(t("common.99e2847d16e5"));
    track.contentHint = screenContentHint(settings);
  } catch (error) {
    if (current()) {
      await track.applyConstraints(constraints).catch(() => undefined);
      await setBitrate(screenProfile(previous).maxBitrate).catch(() => undefined);
      track.contentHint = screenContentHint(previous);
    }
    throw error;
  }
}
