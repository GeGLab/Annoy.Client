export const userVolumeKey = (accountId: string, userId: string) => JSON.stringify([accountId, userId]);

export function normalizeUserVolume(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(Math.max(0, Math.min(200, value))) : 100;
}

export function userVolume(volumes: Record<string, number> | undefined, accountId: string, userId: string): number {
  return normalizeUserVolume(volumes?.[userVolumeKey(accountId, userId)]);
}
