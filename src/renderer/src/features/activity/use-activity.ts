import { useEffect } from "react";
import { gatewayFor } from "../../client.ts";
import { getState, setState, useStore } from "../../store.ts";
/** OS adapter -> sanitized preload -> authenticated gateways. No OS fields in profile entities. */
export function useDesktopActivity() {
  const games = useStore((s) => s.settings.shareGames),
    music = useStore((s) => s.settings.shareMusic);
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
    void activity.get().then((snapshot) =>
      setState((s) => {
        s.desktopActivity = snapshot;
      }),
    );
    return unsubscribe;
  }, []);
  useEffect(() => {
    void window.distopic?.activity?.configure({ games, music });
  }, [games, music]);
  const snapshot = useStore((s) => s.desktopActivity);
  useEffect(() => {
    const publish = () => {
      const s = getState();
      const activities = (s.desktopActivity?.activities ?? []).filter((a) =>
        a.kind === "game" ? s.settings.shareGames : s.settings.shareMusic,
      );
      for (const [id, instance] of Object.entries(s.instances))
        if (instance.status === "ready") gatewayFor(id)?.send({ op: "activity", activities });
    };
    publish();
    const timer = setInterval(publish, 25_000);
    return () => clearInterval(timer);
  }, [snapshot, ready, games, music]);
}
