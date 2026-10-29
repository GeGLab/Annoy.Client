import { useEffect } from "react";
import { gatewayFor } from "../../client.ts";
import { getState, setState, useStore } from "../../store.ts";
/** OS adapter -> sanitized preload -> authenticated gateways. No OS fields in profile entities. */
export function useDesktopActivity() {
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
    const publish = () => {
      const s = getState();
      const activities = s.settings.shareActivity && s.settings.manualPresence !== "offline" ? (s.desktopActivity?.activities ?? []) : [];
      for (const [id, instance] of Object.entries(s.instances))
        if (instance.status === "ready") gatewayFor(id)?.send({
          op: "activity",
          // Older instances validate activity strictly: don't disconnect their users with a new field.
          activities: activities.filter((activity) => activity.kind !== "development" || instance.instance?.developmentActivity).map((activity) => {
            if (instance.instance?.activityArtwork) return activity;
            const { artwork: _artwork, ...legacy } = activity;
            return legacy;
          }),
        });
    };
    publish();
    const timer = setInterval(publish, 25_000);
    return () => clearInterval(timer);
  }, [snapshot, ready, sharing, invisible]);
}
