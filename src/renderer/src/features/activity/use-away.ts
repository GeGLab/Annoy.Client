import { useEffect } from "react";
import { gatewayFor } from "../../client.ts";
import { getState, setState, useStore } from "../../store.ts";
import { isAway } from "../../../../shared/presence.ts";

export function useAwayStatus() {
  const minutes = useStore((s) => s.settings.awayMinutes);
  const ready = useStore((s) => Object.entries(s.instances).filter(([, value]) => value.status === "ready").map(([id]) => id).join("|"));
  useEffect(() => {
    let lastInput = Date.now(), lastCheck = 0, stopped = false;
    const check = async () => {
      const seconds = window.distopic?.idleSeconds ? await window.distopic.idleSeconds().catch(() => 0) : (Date.now() - lastInput) / 1000;
      if (stopped) return;
      for (const [id, instance] of Object.entries(getState().instances)) {
        if (instance.status === "ready" && instance.instance?.presenceStatus) {
          const idle = isAway(seconds, minutes);
          gatewayFor(id)?.send({ op: "presence", idle });
          if (instance.user) setState((s) => { const current = s.instances[id]; if (current?.user) current.presences[current.user.id] = idle ? "idle" : "online"; });
        }
      }
    };
    const input = () => { lastInput = Date.now(); if (Date.now() - lastCheck > 2000) { lastCheck = Date.now(); void check(); } };
    window.addEventListener("pointermove", input);
    window.addEventListener("pointerdown", input);
    window.addEventListener("keydown", input);
    void check();
    const timer = setInterval(() => void check(), 15_000);
    return () => { stopped = true; clearInterval(timer); window.removeEventListener("pointermove", input); window.removeEventListener("pointerdown", input); window.removeEventListener("keydown", input); };
  }, [minutes, ready]);
}
