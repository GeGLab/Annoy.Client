import { useRef, type ReactNode } from "react";
import type { OverlayMenuEntry, OverlayMenuPick, OverlayMenuTheme } from "../../../../shared/overlay-menu.ts";
import { getState } from "../../store.ts";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "./context-menu.tsx";
import type { IconName } from "./icon.tsx";
import { MenuEntries } from "./menu-entries.tsx";

/** A context menu entry with its action; the action stays in this page, only the data travels. */
export type MenuEntry =
  | { kind: "label"; text: string }
  | { kind: "separator" }
  | { kind: "item"; id: string; text: string; icon?: IconName; destructive?: boolean; disabled?: boolean; run: () => void }
  | { kind: "radio"; id: string; value: string; options: { value: string; text: string }[]; run: (value: string) => void };

const toWire = (entries: MenuEntry[]): OverlayMenuEntry[] => entries.map((entry) => {
  if (entry.kind === "item") { const { run: _run, ...data } = entry; return data; }
  if (entry.kind === "radio") { const { run: _run, ...data } = entry; return data; }
  return entry;
});

export function runPick(entries: MenuEntry[], pick: OverlayMenuPick): void {
  const entry = entries.find((item) => "id" in item && item.id === pick.id);
  if (entry?.kind === "item" && !entry.disabled) entry.run();
  else if (entry?.kind === "radio" && pick.value !== undefined && entry.options.some((option) => option.value === pick.value)) entry.run(pick.value);
}

/** The page's theme as the overlay needs it. */
export function themeSnapshot(): OverlayMenuTheme {
  const root = document.documentElement;
  return { theme: root.dataset.theme ?? "dark", className: root.className, style: root.style.cssText, lang: root.lang };
}

/** A browser service is a native layer above the page; a menu drawn in the page would sit behind it. */
const nativeLayerShown = () => {
  const s = getState();
  if (s.view.kind !== "service" || s.modal) return false;
  const serviceId = s.view.serviceId;
  return s.services.some((service) => service.id === serviceId && service.kind !== "teamspeak");
};

/**
 * Context menu built from data. Over a browser service it opens in the overlay layer the main
 * process keeps above native views, with the same look; elsewhere it opens in the page.
 */
export function EntryContextMenu({ label, entries, children }: { label: string; entries: MenuEntry[]; children: ReactNode }) {
  const current = useRef(entries);
  current.current = entries;
  const intercept = (point: { x: number; y: number }) => {
    const overlay = window.annoy?.overlayMenu;
    if (!overlay || !nativeLayerShown()) return false;
    void overlay.open({ x: point.x, y: point.y, label, entries: toWire(current.current), theme: themeSnapshot() })
      .then((pick: OverlayMenuPick | null) => { if (pick) runPick(current.current, pick); });
    return true;
  };
  return <ContextMenu intercept={intercept}>
    <ContextMenuTrigger>{children}</ContextMenuTrigger>
    <ContextMenuContent aria-label={label}>
      <MenuEntries entries={toWire(entries)} onPick={(pick) => runPick(entries, pick)} />
    </ContextMenuContent>
  </ContextMenu>;
}
