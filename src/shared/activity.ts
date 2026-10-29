import type { UserActivity } from "@distopic/protocol";
export interface ActivityPreferences {
  games: boolean;
  music: boolean;
  development?: boolean;
}
export interface DesktopActivitySnapshot {
  supported: boolean;
  activities: UserActivity[];
  error: string | null;
}

/** Local activity takes precedence for self; only confirmed friends expose reported activity. */
export function visibleUserActivities({ isSelf, sharing, isFriend, local = [], reported = [] }: {
  isSelf: boolean;
  sharing: boolean;
  isFriend: boolean;
  local?: readonly UserActivity[];
  reported?: readonly UserActivity[];
}): readonly UserActivity[] {
  if (!isSelf) return isFriend ? reported : [];
  if (!sharing) return [];
  if (local.some((activity) => activity.kind === "game")) return local;
  const game = reported.find((activity) => activity.kind === "game");
  return game ? [...local, game] : local;
}
