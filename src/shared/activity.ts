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
