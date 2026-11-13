import {t as translate} from "../../../../shared/localization/index.ts";
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
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

/**
 * Below these window widths a panel stops taking room from the conversation and floats over
 * it instead: the member list first (tablets, small or zoomed windows), then the channel list
 * too (phones), which becomes a drawer pulled from the left edge.
 */
export const COMPACT_BELOW = { members: 900, channels: 640 } as const;

/** The window width, shared by every panel. */
let viewportWidth = typeof window === "undefined" ? 1280 : window.innerWidth;
const viewportListeners = new Set<() => void>();
if (typeof window !== "undefined") {
  window.addEventListener("resize", () => {
    if (window.innerWidth === viewportWidth) return;
    viewportWidth = window.innerWidth;
    for (const listener of viewportListeners) listener();
  });
}
const subscribeViewport = (listener: () => void) => {
  viewportListeners.add(listener);
  return () => {
    viewportListeners.delete(listener);
  };
};
export const useViewportWidth = () => useSyncExternalStore(subscribeViewport, () => viewportWidth);
const isCompact = (panel: Panel, width = viewportWidth) => width < COMPACT_BELOW[panel];

// A floating panel is open for the moment only: it never changes the saved desktop layout.
let floating: Record<Panel, boolean> = { channels: false, members: false };
const floatingListeners = new Set<() => void>();
const subscribeFloating = (listener: () => void) => {
  floatingListeners.add(listener);
  return () => {
    floatingListeners.delete(listener);
  };
};
const getFloating = () => floating;
function setFloating(panel: Panel, open: boolean) {
  if (floating[panel] === open) return;
  floating = { ...floating, [panel]: open };
  for (const listener of floatingListeners) listener();
}

export function togglePanel(panel: "members") {
  if (isCompact(panel)) {
    setFloating(panel, !floating[panel]);
    return;
  }
  setState((s) => {
    s.settings.membersOpen = !s.settings.membersOpen;
  });
}

/** Whether the member list shows right now: the saved preference, or the floating panel on small windows. */
export function useMembersShown(): boolean {
  const width = useViewportWidth();
  const saved = useStore((s) => s.settings.membersOpen);
  const open = useSyncExternalStore(subscribeFloating, getFloating);
  return isCompact("members", width) ? open.members : saved;
}

/** Local drag preview; persist once on release rather than writing storage per pixel. */
export function ResizablePanel({ panel, children, otherVisible = false, reservedWidth = 0 }: { panel: Panel; children: ReactNode; otherVisible?: boolean; reservedWidth?: number }) {
  const settings = useStore((s) => s.settings);
  const view = useStore((s) => s.view);
  const saved = panel === "channels" ? settings.channelsWidth : settings.membersWidth;
  const viewport = useViewportWidth();
  const compact = isCompact(panel, viewport);
  const floatingOpen = useSyncExternalStore(subscribeFloating, getFloating)[panel];
  const open = compact ? floatingOpen : panel === "channels" ? true : settings.membersOpen;
  const preview = useSyncExternalStore(subscribePreview, getPreview);
  const drag = useRef<{ pointer: number; start: number; width: number; value: number } | null>(null);
  const limit = limits[panel];
  // A floating panel closes once you pick where to go (a server opened without a channel shows
  // its channel list right away), and when the window grows out of it.
  useEffect(() => setFloating(panel, panel === "channels" && view.kind === "server" && !view.channelId), [panel, view]);
  useEffect(() => {
    if (!compact) setFloating(panel, false);
  }, [panel, compact]);
  useEffect(() => {
    if (!compact || !floatingOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFloating(panel, false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panel, compact, floatingOpen]);
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
  // Only a panel that takes room beside the conversation counts against its width.
  const otherOpen = otherVisible && (panel === "channels" ? settings.membersOpen && !isCompact("members", viewport) : !isCompact("channels", viewport));
  const otherWidth =
    panel === "channels"
      ? clamp(preview?.panel === "members" ? preview.width : settings.membersWidth, 180, 340)
      : clamp(preview?.panel === "channels" ? preview.width : settings.channelsWidth, 220, 380);
  const otherMinimum = panel === "channels" ? 180 : 220;
  // A side panel that floats (the DM profile on small windows) takes no room from the list either.
  const reserved = isCompact("members", viewport) ? 0 : reservedWidth;
  const budget = Math.max(limit.min, viewport - 76 - 360 - reserved);
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
  const label = panel === "channels" ? "canais" : translate("common.6e1304653447");
  if (compact) {
    if (!open) {
      // The channel list waits behind a pull tab on the left edge; the member list behind its header button.
      return panel === "channels" ? (
        <button type="button" className="panel-drawer-handle" onClick={() => setFloating(panel, true)} aria-label={translate("layout.showChannels")} title={translate("layout.showChannels")}>
          <Icon name="panelLeft" size={16} />
        </button>
      ) : null;
    }
    const floatingWidth = Math.max(200, Math.min(clamp(saved, limit.min, limit.max), viewport - 64));
    return (
      <>
        <div className={`panel-scrim panel-scrim-${panel}`} aria-hidden="true" onClick={() => setFloating(panel, false)} />
        <aside className={`${panel} resizable-panel floating`} style={{ width: floatingWidth }} aria-label={translate("common.f9b39aab493b",{p0:(label)})}>
          <div className="panel-content">{children}</div>
          <button type="button" className="panel-floating-close" onClick={() => setFloating(panel, false)} aria-label={translate("layout.closePanel")} title={translate("layout.closePanel")}>
            <Icon name="x" size={15} />
          </button>
        </aside>
      </>
    );
  }
  if (!open)
    return null;
  return (
    <aside className={`${panel} resizable-panel`} style={{ width }} aria-label={translate("common.f9b39aab493b",{p0:(label)})}>
      <div className="panel-content">{children}</div>
      <div
        className={`panel-resize panel-resize-${panel}`}
        role="separator"
        aria-orientation="vertical"
        aria-label={translate("common.5ad5e7f00749",{p0:(label)})}
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


