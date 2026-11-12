import {rich} from "../../lib/localization.ts";
import {t as translate,counted} from "../../../../shared/localization/index.ts";
import { Gamepad2, Headphones, ExternalLink,Monitor,Activity } from "lucide-react";
import type { UserActivity } from "@annoy/protocol";
import { useEffect, useRef, useState } from "react";
import { ProviderIcon } from "./ProviderIcon.tsx";
import { DevelopmentIcon } from "./DevelopmentIcon.tsx";
import { GameIcon } from "./GameIcon.tsx";

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
  const video=activity.kind==="video",generic=activity.kind==="generic";
  // Media with an artist is music (a song room, or a player the system reports).
  const listening = generic && !!activity.artist;
  const [failedArtwork, setFailedArtwork] = useState<string | null>(null);
  const artwork = activity.artwork ?? (game && activity.provider === "steam" && /^\d{1,10}$/.test(activity.appId ?? "")
    ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${activity.appId}/header.jpg` : undefined);
  const image = artwork && artwork !== failedArtwork;
  return (
    <div className={`activity-card activity-${activity.kind}${compact ? " compact" : ""}`}>
      <span className={`activity-artwork${image ? "" : " no-artwork"}`}>
        {development ? <DevelopmentIcon name={activity.file ? activity.language ?? "code" : activity.provider} size={compact ? 28 : 44} /> : image ? <img src={artwork} alt={game ? translate("activity.29532ceb0b3e",{p0:(activity.name)}) : translate("activity.f3023eeabae2",{p0:(activity.album || activity.name)})} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedArtwork(artwork)} />
          : game ? <Gamepad2 size={compact ? 20 : 28} aria-hidden /> : video?<Monitor size={compact?20:28} aria-hidden/>:generic&&!listening?<Activity size={compact?20:28} aria-hidden/>:<Headphones size={compact ? 20 : 28} aria-hidden />}
      </span>
      <div>
        <small className="activity-provider">{game ? <GameIcon activity={activity} size={compact ? 12 : 16} /> : <ProviderIcon provider={activity.provider} size={compact ? 12 : 16} />}{development ? translate("common.1fdb45064aad",{p0:({ vscode: "VS Code", intellij: "IntelliJ", dbeaver: "DBeaver", ssms: "SQL Server", "visual-studio": translate("activity.026bf2b64617") }[activity.provider as "vscode"] ?? activity.provider)}) : game ? translate("activity.476e526adee7") : video?translate("activity.e3f1fb46cae7"):listening?translate("activity.listening"):generic?translate("activity.575a3b4743ee"):translate("activity.007e5ab5ceee",{p0:(activity.provider === "spotify" ? "Spotify" : translate("activity.3b00b32d64af"))})}</small>
        <strong title={activity.name}>{activity.name}</strong>
        {activity.startedAt != null && Number.isFinite(activity.startedAt) && <span className="activity-elapsed" aria-label={translate("activity.8eb5c9eabcfb",{p0:(elapsed)})}>{rich("common.74971f0a4dcd",{p0:(elapsed)})}</span>}
        {activity.artist && <span title={activity.artist}>{activity.artist}</span>}
        {development && activity.file && <span className="activity-file" title={activity.file}><DevelopmentIcon name={activity.language ?? "code"} size={14} />{activity.file}</span>}
      </div>
      {!compact && game && activity.provider === "steam" && activity.appId && (
        <a
          href={`https://store.steampowered.com/app/${activity.appId}/`}
          target="_blank"
          rel="noreferrer"
          aria-label={translate("activity.65a776e333d0",{p0:(activity.name)})}
        >
          <ExternalLink size={16} />
        </a>
      )}
      {!compact && activity.provider === "spotify" && (
        <a href={`https://open.spotify.com/search/${encodeURIComponent(`${activity.name} ${activity.artist ?? ""}`.trim())}`} target="_blank" rel="noreferrer" aria-label={translate("activity.ae2c69b17ec6",{p0:(activity.name)})}><ExternalLink size={16} /></a>
      )}
      {!compact && activity.provider === "apple-music" && (
        <a href={`https://music.apple.com/br/search?term=${encodeURIComponent(`${activity.name} ${activity.artist ?? ""}`.trim())}`} target="_blank" rel="noreferrer" aria-label={translate("activity.7033911a5781",{p0:(activity.name)})}><ExternalLink size={16} /></a>
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
  const signature = activities.map((activity) => `${activity.kind}:${activity.provider}:${activity.appId ?? activity.name}`).join("|");
  useEffect(() => {
    const elements = Array.from(cards.current?.children ?? []) as HTMLElement[];
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = elements.map((element) => element.offsetHeight);
        setHeights((previous) => previous.length === next.length && previous.every((height, index) => height === next[index]) ? previous : next);
      });
    });
    elements.forEach((element) => observer.observe(element));
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [signature, compact]);
  if (!activities.length) return null;
  if(compact)return <div className="activity-summary"><button className="activity-summary-toggle" aria-expanded={intent===true} aria-label={translate("activity.9d47c960ad08",{p0:(activities[0]!.name),p1:(activities.length>1?counted(activities.length-1,"counts.activity.one","counts.activity.other"):"")})} onClick={()=>setIntent(intent!==true)}><ProviderIcon provider={activities[0]!.provider} size={14}/><span>{activities[0]!.name}</span>{activities.length>1&&<strong>+{activities.length-1}</strong>}</button>{intent===true&&<div className="activity-summary-details">{activities.map(activity=><ActivityCard key={`${activity.kind}:${activity.provider}`} activity={activity} compact/>)}</div>}</div>;
  return <div className={`activity-stack${activities.length > 1 ? " multiple" : ""}${open ? " expanded" : ""}`} onMouseEnter={() => { setHovered(true); setIntent(null); }} onMouseLeave={() => setHovered(false)} onFocusCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setIntent(null); setFocused(true); }} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
    {activities.length > 1 && <button className="activity-stack-toggle" aria-expanded={open} onClick={() => setIntent(!open)}>{activities.length}{translate("activity.948d3744fc44")}<span>{open ? translate("activity.2225d4a9a607") : translate("activity.e095e6d5592b")}</span></button>}
    <div className="activity-stack-cards" ref={cards}>{activities.map((activity, index) => <div className="activity-stack-item" key={`${activity.kind}:${activity.provider}:${activity.appId ?? activity.name}`} style={{ zIndex: activities.length - index, marginTop: index && !open && heights[index] ? -heights[index]! + 14 : 0 }}><ActivityCard activity={activity} compact={compact} /></div>)}</div>
  </div>;
}




