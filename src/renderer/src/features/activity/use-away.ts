import { useEffect } from "react";
import { gatewayFor } from "../../client.ts";
import { getState, setState, useStore } from "../../store.ts";
import { effectivePresence, isAway } from "../../../../shared/presence.ts";

export function useAwayStatus() {
  const minutes = useStore((s) => s.settings.awayMinutes);
  const manual = useStore((s) => s.settings.manualPresence);
  const ready = useStore((s) => Object.entries(s.instances).filter(([, i]) => i.status === "ready").map(([id, i]) => `${id}:${!!i.instance?.presenceStatus}:${!!i.instance?.manualPresence}`).join("|"));
  useEffect(() => {
    let lastInput = Date.now(), lastCheck = 0, stopped = false, sequence = 0;
    const published = new Map<string, string>();
    const check = async () => {
      const request = ++sequence;
      let seconds = (Date.now() - lastInput) / 1000;
      try {
        const native = await window.distopic?.idleSeconds?.();
        if (typeof native === "number" && Number.isFinite(native) && native >= 0) seconds = native;
      } catch { /* Keep the input fallback if native IPC fails. */ }
      if (stopped || request !== sequence) return;
      const presence = effectivePresence(manual, seconds, minutes);
      for (const [id, instance] of Object.entries(getState().instances)) {
        if (instance.status !== "ready" || !instance.user) continue;
        const key = `${presence}:${manual}`;
        if (published.get(id) !== key && instance.instance?.presenceStatus) {
          gatewayFor(id)?.send({ op: "presence", idle: isAway(seconds, minutes), ...(instance.instance.manualPresence && !published.has(id) && { status: manual }) });
          published.set(id, key);
        }
        // Keep local presence working on instances that have not upgraded yet.
        if (!instance.instance?.manualPresence) setState((s) => {
          const current = s.instances[id];
          if (!current?.user) return;
          current.presences[current.user.id] = presence;
          for (const server of Object.values(current.serverStates)) for (const member of server.members) if (member.user.id === current.user.id) member.presence = presence;
        });
      }
    };
    const input = () => { lastInput = Date.now(); if (Date.now() - lastCheck > 1000) { lastCheck = Date.now(); void check(); } };
    window.addEventListener("pointermove", input);
    window.addEventListener("pointerdown", input);
    window.addEventListener("keydown", input);
    void check();
    const timer = setInterval(() => void check(), 5000);
    return () => { stopped = true; clearInterval(timer); window.removeEventListener("pointermove", input); window.removeEventListener("pointerdown", input); window.removeEventListener("keydown", input); };
  }, [minutes, manual, ready]);
}
