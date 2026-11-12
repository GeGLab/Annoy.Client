import {t as translate} from "../../../../shared/localization/index.ts";
import { useEffect, useRef, useState } from "react";
import type { UserActivity } from "@annoy/protocol";
import { withSteamFallback } from "../../../../shared/steam-activity.ts";
import { apiFor, gatewayFor } from "../../client.ts";
import { getState, setState, useStore } from "../../store.ts";
import { publishPresence } from "../../social/index.ts";
import { cloudSteam } from "../../social/details.ts";

/** Key of the Annoy account's Steam game in the online map (the others are server account IDs). */
const ANNOY_STEAM = "annoy";
/**
 * Last activity payload sent to each server connection. Servers disconnect a
 * client that sends more than 10 updates in 10 s, and desktop snapshots can
 * arrive in bursts, so an unchanged payload is only re-sent as a refresh.
 */
const lastSent = new Map<string, { payload: string; at: number }>();
const REFRESH_MS = 20_000;

/** OS adapter -> sanitized preload -> authenticated gateways. No OS fields in profile entities. */
export function useDesktopActivity() {
  const [connectionsVersion, setConnectionsVersion] = useState(0);
  const online = useRef(new Map<string, UserActivity>());
  useEffect(() => {
    const changed = () => { online.current.clear(); setConnectionsVersion((v) => v + 1); };
    window.addEventListener("steam-connection-changed", changed);
    return () => window.removeEventListener("steam-connection-changed", changed);
  }, []);
  const sharing = useStore((s) => s.settings.shareActivity);
  const invisible = useStore((s) => s.settings.manualPresence === "offline");
  const ready = useStore((s) =>
    Object.entries(s.instances)
      .filter(([, i]) => i.status === "ready")
      .map(([id]) => id)
      .join("|"),
  );
  useEffect(() => {
    const activity = window.annoy?.activity;
    if (!activity) return;
    const unsubscribe = activity.onSnapshot((snapshot) =>
      setState((s) => {
        s.desktopActivity = snapshot;
      }),
    );
    void activity.get()
      .then((snapshot) => setState((s) => { s.desktopActivity = snapshot; }))
      .catch(() => undefined);
    return unsubscribe;
  }, []);
  useEffect(() => {
    void window.annoy?.activity?.configure({ games: sharing, music: sharing, development: sharing });
  }, [sharing]);
  const screenSharing=useStore(s=>s.voice?.screen?s.voice.accountId:null);
  const cloud = useStore((s) => s.social.status);
  const snapshot = useStore((s) => s.desktopActivity);
  const song = useStore((s) => s.songActivity);
  useEffect(() => {
    const controller = new AbortController();
    let inFlight = false;
    if (!sharing || invisible) online.current.clear();
    for (const id of online.current.keys()) if (id !== ANNOY_STEAM && !ready.split("|").includes(id)) online.current.delete(id);
    if (cloud !== "ready") online.current.delete(ANNOY_STEAM);
    // A reconnected server starts with no activity: send it again right away.
    for (const id of lastSent.keys()) if (!ready.split("|").includes(id)) lastSent.delete(id);
    const send = (id: string) => {
      const s = getState(), instance = s.instances[id];
      if (controller.signal.aborted || instance?.status !== "ready") return;
      const visible = s.settings.shareActivity && s.settings.manualPresence !== "offline";
      const local = visible ? (s.desktopActivity?.activities ?? []) : [];
      const remote = visible && !local.some((a) => a.kind === "game") ? online.current.get(id) : undefined;
      const activities:UserActivity[] = [...withSteamFallback(local, remote)];
      if(visible&&s.voice?.accountId===id&&s.voice.screen&&instance.instance?.extendedActivity)activities.push({kind:"video",provider:"annoy-screen",name:translate("activity.81dadf9352cb")});
      // A song room: servers only accept music from Spotify or Apple Music, so it goes as media.
      if (visible && s.songActivity) activities.push(s.songActivity);
      const gateway = gatewayFor(id);
      if (!gateway) return;
      // Older instances validate activity strictly: don't disconnect their users with a new field.
      const filtered = activities.filter((activity) => (activity.kind !== "development" || instance.instance?.developmentActivity) && (!["video","generic"].includes(activity.kind) || instance.instance?.extendedActivity)).map((activity) => {
          if (instance.instance?.activityArtwork) return activity;
          const { artwork: _artwork, ...legacy } = activity;
          return legacy;
        });
      const payload = JSON.stringify(filtered), previous = lastSent.get(id), now = Date.now();
      if (previous?.payload === payload && now - previous.at < REFRESH_MS) return;
      // Only a delivered payload counts: a dropped one is sent again next time.
      if (gateway.send({ op: "activity", activities: filtered })) lastSent.set(id, { payload, at: now });
    };
    // Annoy account: activities go to chatannoy only, never to its servers (TODO item 1).
    const sendCloud = () => {
      const s = getState();
      if (s.social.status !== "ready") return;
      const visible = s.settings.shareActivity && s.settings.manualPresence !== "offline";
      const local = visible ? (s.desktopActivity?.activities ?? []) : [];
      const remote = visible && !local.some((a) => a.kind === "game") ? online.current.get(ANNOY_STEAM) : undefined;
      const activities: UserActivity[] = [...withSteamFallback(local, remote)];
      if (visible && s.voice?.screen) activities.push({ kind: "video", provider: "annoy-screen", name: translate("activity.81dadf9352cb") });
      if (visible && s.songActivity) activities.push(s.songActivity);
      publishPresence({ activities });
    };
    const publish = () => {
      const s = getState();
      sendCloud();
      for (const [id, instance] of Object.entries(s.instances)) if (instance.status === "ready" && !instance.instance?.annoySocial) send(id);
      if (inFlight || !s.settings.shareActivity || s.settings.manualPresence === "offline" || s.desktopActivity?.activities.some((a) => a.kind === "game")) return;
      inFlight = true;
      // The Annoy account's Steam link (usersannoy).
      const annoySteam = async () => {
        if (getState().social.status !== "ready") return;
        let game: UserActivity | undefined;
        try {
          const result = await cloudSteam.activity(AbortSignal.any([controller.signal, AbortSignal.timeout(7000)]));
          game = result.activities.find((a) => a.kind === "game" && a.provider === "steam" && /^\d{1,10}$/.test(a.appId ?? ""));
        } catch { /* A failed online lookup clears the fallback and retains local activity. */ }
        if (controller.signal.aborted) return;
        const previous = online.current.get(ANNOY_STEAM);
        if (game) online.current.set(ANNOY_STEAM, { ...game, startedAt: previous?.appId === game.appId ? previous?.startedAt : Date.now() });
        else online.current.delete(ANNOY_STEAM);
        if (JSON.stringify(previous) !== JSON.stringify(online.current.get(ANNOY_STEAM))) sendCloud();
      };
      void Promise.all([annoySteam(), ...Object.entries(s.instances).map(async ([id, instance]) => {
        // Servers signed in with the Annoy account have no Steam link of their own.
        if (instance.status !== "ready" || !instance.instance?.steamConnection || instance.instance?.annoySocial) return;
        let game: UserActivity | undefined;
        try {
          const result = await apiFor(id).request<{ activities: UserActivity[] }>("GET", "/users/@me/steam/activity", undefined,
            AbortSignal.any([controller.signal, AbortSignal.timeout(7000)]));
          game = result.activities.find((a) => a.kind === "game" && a.provider === "steam" && /^\d{1,10}$/.test(a.appId ?? ""));
        } catch { /* A failed online lookup clears the fallback and retains local activity. */ }
        if (controller.signal.aborted) return;
        const previous = online.current.get(id);
        if (game) online.current.set(id, { ...game, startedAt: previous?.appId === game.appId ? previous?.startedAt : Date.now() });
        else online.current.delete(id);
        if (JSON.stringify(previous) !== JSON.stringify(online.current.get(id))) send(id);
      })]).finally(() => { inFlight = false; });
    };
    publish();
    const timer = setInterval(publish, 25_000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [snapshot, song, ready, sharing, invisible, connectionsVersion, screenSharing, cloud]);
}


