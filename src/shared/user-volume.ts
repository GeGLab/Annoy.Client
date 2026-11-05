export const MAX_USER_VOLUME = 300;

export const userVolumeKey = (accountId: string, userId: string) => JSON.stringify([accountId, userId]);

export function normalizeUserVolume(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(Math.max(0, Math.min(MAX_USER_VOLUME, value))) : 100;
}

export function userVolume(volumes: Record<string, number> | undefined, accountId: string, userId: string): number {
  return normalizeUserVolume(volumes?.[userVolumeKey(accountId, userId)]);
}

/** Which volume a remote audio track follows: the voice, or the sound of a screen share. */
export type VolumeKind = "voice" | "stream";

export const volumeKindOf = (source: string): VolumeKind => (source === "screen_audio" ? "stream" : "voice");

export function playbackVolume(settings: { userVolumes?: Record<string, number>; streamVolumes?: Record<string, number> }, kind: VolumeKind, accountId: string, userId: string): number {
  return userVolume(kind === "stream" ? settings.streamVolumes : settings.userVolumes, accountId, userId);
}
