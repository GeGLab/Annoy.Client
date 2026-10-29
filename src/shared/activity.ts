import type { UserActivity } from "@distopic/protocol";
export interface ActivityPreferences {
  games: boolean;
  music: boolean;
}
export interface DesktopActivitySnapshot {
  supported: boolean;
  activities: UserActivity[];
  error: string | null;
}
