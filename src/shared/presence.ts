import {t as translate} from "./localization/index.ts";
export function isAway(idleSeconds: number, minutes: number): boolean {
  return Number.isFinite(idleSeconds) && Number.isFinite(minutes) && minutes > 0 && idleSeconds >= minutes * 60;
}

export type ManualPresence = "online" | "idle" | "dnd" | "offline";
export const presenceLabel = (presence: ManualPresence) => ({ online: translate("common.0d21bd52022c"), idle: translate("common.fd7f0836e8ad"), dnd: translate("common.976685dd88bf"), offline: translate("common.3c250593828b") })[presence];
export function effectivePresence(manual: ManualPresence, seconds: number, minutes: number): ManualPresence {
  return manual === "online" && isAway(seconds, minutes) ? "idle" : manual;
}




