import {t as translate} from "../../../../shared/localization/index.ts";
import { useEffect, useRef, useState } from "react";
import type { SteamConnectionStatus, SteamLinkBegin, SteamLinkPoll, UserActivity } from "@annoy/protocol";
import { apiFor } from "../../client.ts";
import { useStore, type AppState } from "../../store.ts";
import { cloudSteam } from "../../social/details.ts";
import { Button } from "../../components/ui/button.tsx";
import { ProviderIcon } from "./ProviderIcon.tsx";
import { Check, ExternalLink, Info, Link2, LoaderCircle, Unplug, UserRound } from "lucide-react";
import { ActivityCard } from "./ActivityCard.tsx";

interface SteamApi {
  status(signal?: AbortSignal): Promise<SteamConnectionStatus>;
  begin(signal?: AbortSignal): Promise<SteamLinkBegin>;
  poll(handoff: string, signal?: AbortSignal): Promise<SteamLinkPoll>;
  disconnect(signal?: AbortSignal): Promise<SteamConnectionStatus>;
}
const serverSteam = (accountId: string): SteamApi => ({
  status: (signal) => apiFor(accountId).request<SteamConnectionStatus>("GET", "/users/@me/steam", undefined, signal),
  begin: (signal) => apiFor(accountId).request<SteamLinkBegin>("POST", "/auth/steam/begin", {}, signal),
  poll: (handoff, signal) => apiFor(accountId).request<SteamLinkPoll>("POST", "/auth/steam/poll", { handoff }, signal),
  disconnect: (signal) => apiFor(accountId).del<SteamConnectionStatus>("/users/@me/steam", signal),
});

const noGame = (s: AppState) => !s.settings.shareActivity || !!s.desktopActivity?.activities.some((a) => a.kind === "game");

/** Steam of the Annoy account: one link for the person, on every server. */
export function AnnoySteamConnection() {
  const ready = useStore((s) => s.social.status === "ready");
  const ownGame = useStore((s): UserActivity | undefined => {
    const me = s.social.me;
    if (noGame(s) || !me) return undefined;
    return s.social.presences[me.id]?.activities.find((a) => a.kind === "game");
  });
  if (!ready) return null;
  return <SteamCard api={cloudSteam} title={translate("activity.annoySteamTitle")} description={translate("activity.annoySteamHelp")} ownGame={ownGame} />;
}

/** Steam linked to a server account (servers with their own accounts only). */
export function SteamConnection({ accountId }: { accountId: string }) {
  const account = useStore((s) => s.accounts.find((item) => item.id === accountId));
  const supported = useStore((s) => s.instances[accountId]?.instance?.steamConnection);
  const ownGame = useStore((s) => {
    const instance = s.instances[accountId];
    if (noGame(s) || !instance?.user) return undefined;
    return instance.activities[instance.user.id]?.find((a) => a.kind === "game");
  });
  const [api] = useState(() => serverSteam(accountId));
  if (!account || !supported) return null;
  return <SteamCard api={api} title={translate("activity.c85c3636aafe",{p0:(account.instanceName)})} description={translate("activity.c01de0aeccbc")} ownGame={ownGame} />;
}

function SteamCard({ api, title, description, ownGame }: { api: SteamApi; title: string; description: string; ownGame: UserActivity | undefined }) {
  const [status, setStatus] = useState<SteamConnectionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    void api.status(abort.signal)
      .then(setStatus).catch((error) => { if (!abort.signal.aborted) setError(error.message); });
    return () => { abort.abort(); controller.current?.abort(); };
  }, [api]);

  const connect = async () => {
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true); setWaiting(true); setError(null);
    try {
      const { url, handoff } = await api.begin(abort.signal);
      window.open(url, "_blank");
      const deadline = Date.now() + 10 * 60_000;
      while (Date.now() < deadline) {
        await new Promise<void>((resolve) => {
          const done = () => { clearTimeout(timer); abort.signal.removeEventListener("abort", done); resolve(); };
          const timer = setTimeout(done, 1500);
          abort.signal.addEventListener("abort", done, { once: true });
        });
        abort.signal.throwIfAborted();
        const result = await api.poll(handoff, abort.signal);
        if (result.status === "error") throw new Error(result.message);
        if (result.status === "done") {
          setStatus(await api.status(abort.signal));
          window.dispatchEvent(new Event("steam-connection-changed"));
          return;
        }
      }
      throw new Error(translate("activity.de798be734d3"));
    } catch (error) {
      if (!abort.signal.aborted) setError((error as Error).message);
    } finally {
      if (controller.current === abort) { controller.current = null; setBusy(false); setWaiting(false); }
    }
  };
  const disconnect = async () => {
    controller.current?.abort();
    controller.current = null;
    setWaiting(false);
    setBusy(true); setError(null);
    try {
      setStatus(await api.disconnect());
      window.dispatchEvent(new Event("steam-connection-changed"));
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  };
  const connection = status?.connection;
  const profileName = connection?.personaName || connection?.steamId;
  return <section className="preference-card steam-connection-card" aria-label={title}>
    <header className="steam-connection-header">
      <span className="steam-connection-logo"><ProviderIcon provider="steam" size={28} /></span>
      <div className="steam-connection-heading">
        <h4>{title}</h4>
        <p>{connection ? translate("activity.steam.connectedHelp") : description}</p>
      </div>
      {status && <span className={`steam-connection-status${connection ? " is-connected" : ""}`}>
        {connection && <Check size={12} aria-hidden />}
        {translate(connection ? "common.79c5eb4810e5" : "common.c1f272b304da")}
      </span>}
    </header>
    <div className="steam-connection-body">
      {connection && <a className="steam-profile-link" href={connection.profileUrl} target="_blank" rel="noreferrer"
        aria-label={translate("common.13e868e9ba0d", { p0: profileName })}>
        <span className="steam-profile-symbol"><UserRound size={22} aria-hidden /></span>
        <span className="steam-profile-copy"><strong>{profileName}</strong><span>{translate("activity.steam.viewProfile")}</span></span>
        <ExternalLink size={16} aria-hidden />
      </a>}
      {connection && ownGame && <ActivityCard activity={ownGame} />}
      {status && <div className="steam-activity-note">
        <Info size={16} aria-hidden />
        <div><strong>{translate(status.onlineActivityAvailable ? "activity.steam.onlineAvailable" : "activity.steam.onlineUnavailable")}</strong>
          <p>{status.onlineActivityAvailable ? translate("activity.53b4251b7285") : translate("activity.f309480a1c0d")}</p>
        </div>
      </div>}
      {!status && !error && <p className="steam-connection-loading" role="status"><LoaderCircle size={16} className="animate-spin" aria-hidden />{translate("activity.steam.loading")}</p>}
      {waiting && <p role="status" className="steam-connection-loading"><LoaderCircle size={16} className="animate-spin" aria-hidden />{translate("activity.bdb251f0da37")}</p>}
      {error && <p className="error small" role="alert">{error}</p>}
    </div>
    {(status || error) && <footer className="steam-connection-actions">
      {status && !connection && !busy && <Button size="sm" onClick={() => void connect()}><Link2 size={15} aria-hidden />{translate("activity.94665f4f307d")}</Button>}
      {waiting && <Button variant="secondary" size="sm" onClick={() => { void disconnect(); }}>{translate("activity.c41cf256486d")}</Button>}
      {connection && !waiting && <Button className="steam-disconnect" variant="ghost" size="sm" loading={busy} onClick={() => void disconnect()}><Unplug size={14} aria-hidden />{translate("activity.a606bbae3955")}</Button>}
      {!status && error && <Button variant="secondary" size="sm" onClick={() => { void api.status().then(setStatus).catch((error) => setError(error.message)); }}>{translate("common.b9e10688be01")}</Button>}
    </footer>}
  </section>;
}
