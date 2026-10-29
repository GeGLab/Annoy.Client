import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { setState, useStore } from "../../store.ts";
import { Icon } from "../ui.tsx";

type Panel = "channels" | "members";
const limits = { channels: { min: 220, max: 380, initial: 252 }, members: { min: 180, max: 340, initial: 220 } };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));

// Both panels must calculate their allocation from the same drag preview.
// This transient UI state never enters the persisted application settings.
let dragPreview: { panel: Panel; width: number } | null = null;
const previewListeners = new Set<() => void>();
const subscribePreview = (listener: () => void) => {
  previewListeners.add(listener);
  return () => {
    previewListeners.delete(listener);
  };
};
const getPreview = () => dragPreview;
function setPreview(value: typeof dragPreview) {
  dragPreview = value;
  for (const listener of previewListeners) listener();
}

export function togglePanel(panel: "members") {
  setState((s) => {
    s.settings.membersOpen = !s.settings.membersOpen;
  });
}

/** Local drag preview; persist once on release rather than writing storage per pixel. */
export function ResizablePanel({ panel, children, otherVisible = false }: { panel: Panel; children: ReactNode; otherVisible?: boolean }) {
  const settings = useStore((s) => s.settings);
  const saved = panel === "channels" ? settings.channelsWidth : settings.membersWidth;
  const open = panel === "channels" ? true : settings.membersOpen;
  const preview = useSyncExternalStore(subscribePreview, getPreview);
  const [viewport, setViewport] = useState(window.innerWidth);
  const drag = useRef<{ pointer: number; start: number; width: number; value: number } | null>(null);
  const limit = limits[panel];
  useEffect(() => {
    const resize = () => setViewport(window.innerWidth);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  useEffect(
    () => () => {
      if (drag.current) {
        drag.current = null;
        setPreview(null);
      }
    },
    [],
  );
  const requested = clamp(preview?.panel === panel ? preview.width : saved, limit.min, limit.max);
  const otherOpen = otherVisible && (panel === "channels" ? settings.membersOpen : true);
  const otherWidth =
    panel === "channels"
      ? clamp(preview?.panel === "members" ? preview.width : settings.membersWidth, 180, 340)
      : clamp(preview?.panel === "channels" ? preview.width : settings.channelsWidth, 220, 380);
  const otherMinimum = panel === "channels" ? 180 : 220;
  const budget = Math.max(limit.min, viewport - 76 - 360);
  const desiredTotal = requested + (otherOpen ? otherWidth : 0);
  const remaining = Math.max(0, budget - limit.min - (otherOpen ? otherMinimum : 0));
  const extras = requested - limit.min + (otherOpen ? otherWidth - otherMinimum : 0);
  const width =
    desiredTotal <= budget ? requested : Math.floor(limit.min + (extras > 0 ? (remaining * (requested - limit.min)) / extras : 0));
  const persist = (value: number) =>
    setState((s) => {
      if (panel === "channels") s.settings.channelsWidth = clamp(value, limit.min, limit.max);
      else s.settings.membersWidth = clamp(value, limit.min, limit.max);
    });
  const finish = () => {
    if (drag.current) {
      persist(drag.current.value);
      drag.current = null;
      setPreview(null);
    }
  };
  const label = panel === "channels" ? "canais" : "membros";
  if (!open)
    return null;
  return (
    <aside className={`${panel} resizable-panel`} style={{ width }} aria-label={`Painel de ${label}`}>
      <div className="panel-content">{children}</div>
      <div
        className={`panel-resize panel-resize-${panel}`}
        role="separator"
        aria-orientation="vertical"
        aria-label={`Largura do painel de ${label}`}
        aria-valuemin={limit.min}
        aria-valuemax={limit.max}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { pointer: event.pointerId, start: event.clientX, width, value: width };
        }}
        onPointerMove={(event) => {
          const current = drag.current;
          if (!current || current.pointer !== event.pointerId) return;
          current.value = clamp(current.width + (event.clientX - current.start) * (panel === "channels" ? 1 : -1), limit.min, limit.max);
          setPreview({ panel, width: current.value });
        }}
        onPointerUp={finish}
        onPointerCancel={finish}
        onLostPointerCapture={finish}
        onDoubleClick={() => persist(limit.initial)}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 24 : 8;
          const direction = panel === "channels" ? 1 : -1;
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            persist(width + (event.key === "ArrowRight" ? step : -step) * direction);
          } else if (event.key === "Home" || event.key === "End") {
            event.preventDefault();
            persist(event.key === "Home" ? limit.min : limit.max);
          }
        }}
      />
    </aside>
  );
}
