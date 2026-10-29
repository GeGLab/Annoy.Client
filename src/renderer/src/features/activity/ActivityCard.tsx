import { Gamepad2, Headphones, ExternalLink } from "lucide-react";
import type { UserActivity } from "@distopic/protocol";
import { useState } from "react";
import { ProviderIcon } from "./ProviderIcon.tsx";
import { DevelopmentIcon } from "./DevelopmentIcon.tsx";
import { GameIcon } from "./GameIcon.tsx";

export function ActivityCard({ activity, compact = false }: { activity: UserActivity; compact?: boolean }) {
  const game = activity.kind === "game";
  const development = activity.kind === "development";
  const [failedArtwork, setFailedArtwork] = useState<string | null>(null);
  const artwork = activity.artwork ?? (game && activity.provider === "steam" && /^\d{1,10}$/.test(activity.appId ?? "")
    ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${activity.appId}/header.jpg` : undefined);
  const image = artwork && artwork !== failedArtwork;
  return (
    <div className={`activity-card activity-${activity.kind}${compact ? " compact" : ""}`}>
      <span className={`activity-artwork${image ? "" : " no-artwork"}`}>
        {development ? <DevelopmentIcon name={activity.provider} size={compact ? 28 : 44} /> : image ? <img src={artwork} alt={game ? `Capa de ${activity.name}` : `Capa do álbum ${activity.album || activity.name}`} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedArtwork(artwork)} />
          : game ? <Gamepad2 size={compact ? 20 : 28} aria-hidden /> : <Headphones size={compact ? 20 : 28} aria-hidden />}
      </span>
      <div>
        <small className="activity-provider">{game ? <GameIcon activity={activity} size={compact ? 12 : 16} /> : <ProviderIcon provider={activity.provider} size={compact ? 12 : 16} />}{development ? `Programando · ${{ vscode: "VS Code", intellij: "IntelliJ", dbeaver: "DBeaver", ssms: "SQL Server", "visual-studio": "Visual Studio" }[activity.provider as "vscode"] ?? activity.provider}` : game ? "Jogando" : `Ouvindo no ${activity.provider === "spotify" ? "Spotify" : "Apple Music"}`}</small>
        <strong title={activity.name}>{activity.name}</strong>
        {activity.artist && <span title={activity.artist}>{activity.artist}</span>}
        {development && activity.file && <span className="activity-file" title={activity.file}><DevelopmentIcon name={activity.language ?? "code"} size={14} />{activity.file}</span>}
      </div>
      {!compact && game && activity.provider === "steam" && activity.appId && (
        <a
          href={`https://store.steampowered.com/app/${activity.appId}/`}
          target="_blank"
          rel="noreferrer"
          aria-label={`Ver ${activity.name} na Steam`}
        >
          <ExternalLink size={16} />
        </a>
      )}
      {!compact && activity.provider === "spotify" && (
        <a href={`https://open.spotify.com/search/${encodeURIComponent(`${activity.name} ${activity.artist ?? ""}`.trim())}`} target="_blank" rel="noreferrer" aria-label={`Abrir ${activity.name} no Spotify`}><ExternalLink size={16} /></a>
      )}
      {!compact && activity.provider === "apple-music" && (
        <a href={`https://music.apple.com/br/search?term=${encodeURIComponent(`${activity.name} ${activity.artist ?? ""}`.trim())}`} target="_blank" rel="noreferrer" aria-label={`Abrir ${activity.name} no Apple Music`}><ExternalLink size={16} /></a>
      )}
    </div>
  );
}
