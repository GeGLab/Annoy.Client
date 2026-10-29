export function isAway(idleSeconds: number, minutes: number): boolean {
  return Number.isFinite(idleSeconds) && Number.isFinite(minutes) && minutes > 0 && idleSeconds >= minutes * 60;
}

export type ManualPresence = "online" | "idle" | "dnd" | "offline";
export const presenceLabel = (presence: ManualPresence) => ({ online: "Online", idle: "Ausente", dnd: "Não incomodar", offline: "Aparecer como offline" })[presence];
export function effectivePresence(manual: ManualPresence, seconds: number, minutes: number): ManualPresence {
  return manual === "online" && isAway(seconds, minutes) ? "idle" : manual;
}
