import { useEffect, useRef, useState } from "react";
import type { UserActivity } from "@distopic/protocol";
import { withSteamFallback } from "../../../../shared/steam-activity.ts";
import { apiFor, gatewayFor } from "../../client.ts";
import { getState, setState, useStore } from "../../store.ts";
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
    const activity = window.distopic?.activity;
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
    void window.distopic?.activity?.configure({ games: sharing, music: sharing, development: sharing });
  }, [sharing]);
  const snapshot = useStore((s) => s.desktopActivity);
  useEffect(() => {
    const controller = new AbortController();
    let inFlight = false;
    if (!sharing || invisible) online.current.clear();
    for (const id of online.current.keys()) if (!ready.split("|").includes(id)) online.current.delete(id);
    const send = (id: string) => {
      const s = getState(), instance = s.instances[id];
      if (controller.signal.aborted || instance?.status !== "ready") return;
      const visible = s.settings.shareActivity && s.settings.manualPresence !== "offline";
      const local = visible ? (s.desktopActivity?.activities ?? []) : [];
      const remote = visible && !local.some((a) => a.kind === "game") ? online.current.get(id) : undefined;
      const activities = withSteamFallback(local, remote);
      gatewayFor(id)?.send({
        op: "activity",
        // Older instances validate activity strictly: don't disconnect their users with a new field.
        activities: activities.filter((activity) => activity.kind !== "development" || instance.instance?.developmentActivity).map((activity) => {
          if (instance.instance?.activityArtwork) return activity;
          const { artwork: _artwork, ...legacy } = activity;
          return legacy;
        }),
      });
    };
    const publish = () => {
      const s = getState();
      for (const [id, instance] of Object.entries(s.instances)) if (instance.status === "ready") send(id);
      if (inFlight || !s.settings.shareActivity || s.settings.manualPresence === "offline" || s.desktopActivity?.activities.some((a) => a.kind === "game")) return;
      inFlight = true;
      void Promise.all(Object.entries(s.instances).map(async ([id, instance]) => {
        if (instance.status !== "ready" || !instance.instance?.steamConnection) return;
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
      })).finally(() => { inFlight = false; });
    };
    publish();
    const timer = setInterval(publish, 25_000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [snapshot, ready, sharing, invisible, connectionsVersion]);
}
