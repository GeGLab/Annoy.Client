import { Gamepad2, Headphones, ExternalLink } from "lucide-react";
import type { UserActivity } from "@distopic/protocol";
export function ActivityCard({ activity, compact = false }: { activity: UserActivity; compact?: boolean }) {
  const game = activity.kind === "game";
  return (
    <div className={`activity-card${compact ? " compact" : ""}`}>
      {game ? <Gamepad2 size={compact ? 15 : 24} /> : <Headphones size={compact ? 15 : 24} />}
      <div>
        <small>{game ? "Jogando na Steam" : `Ouvindo no ${activity.provider === "spotify" ? "Spotify" : "Apple Music"}`}</small>
        <strong title={activity.name}>{activity.name}</strong>
        {activity.artist && <span>{activity.artist}</span>}
      </div>
      {!compact && game && activity.appId && (
        <a
          href={`https://store.steampowered.com/app/${activity.appId}/`}
          target="_blank"
          rel="noreferrer"
          aria-label={`Ver ${activity.name} na Steam`}
        >
          <ExternalLink size={16} />
        </a>
      )}
    </div>
  );
}
