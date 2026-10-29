import type { UserActivity } from "@distopic/protocol";

/** A connection belongs to one instance; local detection always takes precedence. */
export function withSteamFallback(local: readonly UserActivity[], remote?: UserActivity): readonly UserActivity[] {
  if (local.some((activity) => activity.kind === "game") || remote?.kind !== "game" ||
    remote.provider !== "steam" || !/^\d{1,10}$/.test(remote.appId ?? "")) return local;
  return [...local, remote];
}
