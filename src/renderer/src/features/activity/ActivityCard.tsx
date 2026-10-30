import { Gamepad2, Headphones, ExternalLink } from "lucide-react";
import type { UserActivity } from "@distopic/protocol";
import { useEffect, useRef, useState } from "react";
import { ProviderIcon } from "./ProviderIcon.tsx";
import { DevelopmentIcon } from "./DevelopmentIcon.tsx";

export function ActivityCard({ activity, compact = false }: { activity: UserActivity; compact?: boolean }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!activity.startedAt) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [activity.startedAt]);
  const seconds = Math.max(0, Math.floor((now - (activity.startedAt ?? now)) / 1000));
  const elapsed = `${Math.floor(seconds / 3600) ? `${Math.floor(seconds / 3600)}:` : ""}${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  const game = activity.kind === "game";
  const development = activity.kind === "development";
  const [failedArtwork, setFailedArtwork] = useState<string | null>(null);
  const artwork = activity.artwork ?? (game && /^\d{1,10}$/.test(activity.appId ?? "")
    ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${activity.appId}/header.jpg` : undefined);
  const image = artwork && artwork !== failedArtwork;
  return (
    <div className={`activity-card activity-${activity.kind}${compact ? " compact" : ""}`}>
      <span className={`activity-artwork${image ? "" : " no-artwork"}`}>
        {development ? <DevelopmentIcon name={activity.file ? activity.language ?? "code" : activity.provider} size={compact ? 28 : 44} /> : image ? <img src={artwork} alt={game ? `Capa de ${activity.name}` : `Capa do álbum ${activity.album || activity.name}`} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedArtwork(artwork)} />
          : game ? <Gamepad2 size={compact ? 20 : 28} aria-hidden /> : <Headphones size={compact ? 20 : 28} aria-hidden />}
      </span>
      <div>
        <small className="activity-provider"><ProviderIcon provider={activity.provider} size={compact ? 12 : 16} />{development ? `Programando · ${{ vscode: "VS Code", intellij: "IntelliJ", dbeaver: "DBeaver", ssms: "SQL Server", "visual-studio": "Visual Studio" }[activity.provider as "vscode"] ?? activity.provider}` : game ? "Jogando na Steam" : `Ouvindo no ${activity.provider === "spotify" ? "Spotify" : "Apple Music"}`}</small>
        <strong title={activity.name}>{activity.name}</strong>
        {activity.startedAt != null && Number.isFinite(activity.startedAt) && <span className="activity-elapsed" aria-label={`Tempo na atividade: ${elapsed}`}>{elapsed} decorridos</span>}
        {activity.artist && <span title={activity.artist}>{activity.artist}</span>}
        {development && activity.file && <span className="activity-file" title={activity.file}><DevelopmentIcon name={activity.language ?? "code"} size={14} />{activity.file}</span>}
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
      {!compact && activity.provider === "spotify" && (
        <a href={`https://open.spotify.com/search/${encodeURIComponent(`${activity.name} ${activity.artist ?? ""}`.trim())}`} target="_blank" rel="noreferrer" aria-label={`Abrir ${activity.name} no Spotify`}><ExternalLink size={16} /></a>
      )}
      {!compact && activity.provider === "apple-music" && (
        <a href={`https://music.apple.com/br/search?term=${encodeURIComponent(`${activity.name} ${activity.artist ?? ""}`.trim())}`} target="_blank" rel="noreferrer" aria-label={`Abrir ${activity.name} no Apple Music`}><ExternalLink size={16} /></a>
      )}
    </div>
  );
}


export function ActivityStack({ activities, compact = false }: { activities: readonly UserActivity[]; compact?: boolean }) {
  const [intent, setIntent] = useState<boolean | null>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [heights, setHeights] = useState<number[]>([]);
  const cards = useRef<HTMLDivElement>(null);
  const open = intent ?? (hovered || focused);
  useEffect(() => {
    const elements = Array.from(cards.current?.children ?? []) as HTMLElement[];
    const observer = new ResizeObserver(() => setHeights(elements.map((element) => element.getBoundingClientRect().height)));
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [activities.length, compact]);
  if (!activities.length) return null;
  return <div className={`activity-stack${activities.length > 1 ? " multiple" : ""}${open ? " expanded" : ""}`} onMouseEnter={() => { setHovered(true); setIntent(null); }} onMouseLeave={() => setHovered(false)} onFocusCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setIntent(null); setFocused(true); }} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
    {activities.length > 1 && <button className="activity-stack-toggle" aria-expanded={open} onClick={() => setIntent(!open)}>{activities.length} atividades <span>{open ? "Recolher" : "Expandir"}</span></button>}
    <div className="activity-stack-cards" ref={cards}>{activities.map((activity, index) => <div className="activity-stack-item" key={`${activity.kind}:${activity.provider}:${activity.appId ?? activity.name}`} style={{ zIndex: activities.length - index, marginTop: index && !open && heights[index] ? -heights[index]! + 14 : 0 }}><ActivityCard activity={activity} compact={compact} /></div>)}</div>
  </div>;
}
