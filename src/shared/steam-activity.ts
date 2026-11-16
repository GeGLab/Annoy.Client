import type { UserActivity } from "@annoy/protocol";

/**
 * A connection belongs to one instance; local detection always takes precedence.
 * When the computer runs the same game Steam reports, Steam only adds the lobby to join.
 */
export function withSteamFallback(local: readonly UserActivity[], remote?: UserActivity): readonly UserActivity[] {
  if (remote?.kind !== "game" || remote.provider !== "steam" || !/^\d{1,10}$/.test(remote.appId ?? "")) return local;
  const game = local.find((activity) => activity.kind === "game");
  if (!game) return [...local, remote];
  if (remote.lobbyId && game.provider === "steam" && game.appId === remote.appId) return local.map((activity) => activity === game ? { ...activity, lobbyId: remote.lobbyId } : activity);
  return local;
}

/** steam://joinlobby for a lobby, with the Steam account of someone in it. */
export const steamJoinUrl = (activity: UserActivity, steamId: string | null | undefined): string | null =>
  activity.kind === "game" && activity.provider === "steam" && /^\d{1,10}$/.test(activity.appId ?? "") && /^\d{17,20}$/.test(activity.lobbyId ?? "") && /^\d{17}$/.test(steamId ?? "")
    ? `steam://joinlobby/${activity.appId}/${activity.lobbyId}/${steamId}`
    : null;
