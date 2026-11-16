import type { SteamCommonGames, SteamProfileLink } from "@annoy/protocol";
import { ExternalLink, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { localizationPreferences, t as translate } from "../../../../shared/localization/index.ts";
import { isCancellation } from "../../../../shared/requests.ts";
import { Button } from "../../components/ui/button.tsx";
import { openModal } from "../../components/ui.tsx";
import { cloudSteam } from "../../social/details.ts";

/** The Steam account someone shows on their Annoy profile, and the games the viewer has in common with it. */
export function SteamProfileSection({ steam, annoyId, name, self }: { steam: SteamProfileLink; annoyId: string; name: string; self: boolean }) {
  const persona = steam.personaName || steam.steamId;
  return (
    <section className="steam-profile-section">
      <h3>Steam</h3>
      <a className="steam-profile-link" href={steam.profileUrl} target="_blank" rel="noreferrer" aria-label={translate("common.13e868e9ba0d", { p0: persona })}>
        <span className="steam-profile-symbol">{steam.avatarUrl ? <img src={steam.avatarUrl} alt="" width={40} height={40} referrerPolicy="no-referrer" /> : <UserRound size={22} aria-hidden />}</span>
        <span className="steam-profile-copy"><strong>{persona}</strong><span>{translate("activity.steam.viewProfile")}</span></span>
        <ExternalLink size={16} aria-hidden />
      </a>
      {!self && <CommonGames annoyId={annoyId} name={name} />}
    </section>
  );
}

const hours = (value: number) => value.toLocaleString(localizationPreferences().region, { maximumFractionDigits: value < 10 ? 1 : 0 });

function CommonGames({ annoyId, name }: { annoyId: string; name: string }) {
  const [result, setResult] = useState<{ id: string; data?: SteamCommonGames; error?: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setResult(null);
    cloudSteam.commonGames(annoyId, controller.signal).then(
      (data) => { if (!controller.signal.aborted) setResult({ id: annoyId, data }); },
      (err) => { if (!controller.signal.aborted && !isCancellation(err)) setResult({ id: annoyId, error: true }); },
    );
    return () => controller.abort();
  }, [annoyId, attempt]);
  const data = result?.id === annoyId ? result.data : undefined;
  if (!result) return <p className="muted small" role="status">{translate("activity.steam.commonLoading")}</p>;
  if (result.error || data?.status === "unavailable")
    return <p className="muted small">{translate("activity.steam.commonUnavailable")} <button type="button" className="link-button" onClick={() => setAttempt((n) => n + 1)}>{translate("common.b9e10688be01")}</button></p>;
  if (!data || data.status === "hidden") return null;
  if (data.status === "not_linked")
    return (
      <div className="steam-common-empty">
        <p className="muted small">{translate("activity.steam.commonLink")}</p>
        <Button size="sm" variant="secondary" onClick={() => openModal({ kind: "userSettings", section: "activity" })}>{translate("activity.94665f4f307d")}</Button>
      </div>
    );
  if (data.status === "private") return <p className="muted small">{data.who === "you" ? translate("activity.steam.commonPrivateYou") : translate("activity.steam.commonPrivateThem", { p0: name })}</p>;
  const games = data.games ?? [];
  return (
    <div className="steam-common">
      <h4>{translate("activity.steam.common", { p0: data.total ?? games.length })}</h4>
      {games.length === 0 ? <p className="muted small">{translate("activity.steam.commonNone")}</p> : (
        <ul className="steam-common-list">
          {games.map((game) => (
            <li key={game.appId}>
              <img src={`https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${game.appId}/capsule_sm_120.jpg`} alt="" width={60} height={22} loading="lazy" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.visibility = "hidden"; }} />
              <a href={`https://store.steampowered.com/app/${game.appId}/`} target="_blank" rel="noreferrer" title={game.name}>{game.name}</a>
              <span className="muted small">{translate("activity.steam.commonHours", { p0: hours(game.mine), p1: name, p2: hours(game.theirs) })}</span>
            </li>
          ))}
        </ul>
      )}
      {(data.total ?? 0) > games.length && <p className="muted small">{translate("activity.steam.commonMore", { p0: (data.total ?? 0) - games.length })}</p>}
    </div>
  );
}
