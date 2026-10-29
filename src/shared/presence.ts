export function isAway(idleSeconds: number, minutes: number): boolean {
  return Number.isFinite(idleSeconds) && Number.isFinite(minutes) && minutes > 0 && idleSeconds >= minutes * 60;
}
