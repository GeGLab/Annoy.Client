import * as Menu from "@radix-ui/react-menu";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { OverlayMenuPick, OverlayMenuSpec } from "../../shared/overlay-menu.ts";
import { MenuEntries } from "./components/ui/menu-entries.tsx";
import "./styles.css";

// This page is a transparent layer the main process puts above browser services while a menu is open.
// It draws the menu with the app's own styles and reports the chosen row; the action runs in the app.

function applyTheme(spec: OverlayMenuSpec): void {
  const root = document.documentElement;
  root.className = spec.theme.className;
  root.dataset.theme = spec.theme.theme;
  root.style.cssText = spec.theme.style;
  root.lang = spec.theme.lang;
}

function OverlayMenu() {
  const [shown, setShown] = useState<{ token: number; spec: OverlayMenuSpec } | null>(null);
  const answered = useRef(false);
  const point = useRef({ x: 0, y: 0 });
  const anchor = useRef({ getBoundingClientRect: () => DOMRect.fromRect({ ...point.current, width: 0, height: 0 }) });
  useEffect(() => {
    const bridge = window.annoyOverlay;
    if (!bridge) return;
    const offShow = bridge.onShow((token, spec) => {
      applyTheme(spec);
      point.current = { x: spec.x, y: spec.y };
      answered.current = false;
      setShown({ token, spec });
    });
    const offClose = bridge.onClose(() => setShown(null));
    bridge.ready();
    return () => { offShow(); offClose(); };
  }, []);
  if (!shown) return null;
  const finish = (pick: OverlayMenuPick | null) => {
    if (answered.current) return;
    answered.current = true;
    setShown(null);
    window.annoyOverlay?.done(shown.token, pick);
  };
  return <Menu.Root key={shown.token} open onOpenChange={(open) => { if (!open) finish(null); }}>
    <Menu.Anchor virtualRef={anchor} />
    <Menu.Portal>
      <Menu.Content side="right" align="start" sideOffset={2} collisionPadding={10} loop aria-label={shown.spec.label}
        className="ui-dropdown-content ui-context-content" onCloseAutoFocus={(event) => event.preventDefault()}>
        <MenuEntries entries={shown.spec.entries} onPick={finish} />
      </Menu.Content>
    </Menu.Portal>
  </Menu.Root>;
}

// Right-clicks anywhere on the layer only close the menu.
document.addEventListener("contextmenu", (event) => event.preventDefault());
createRoot(document.getElementById("overlay-root")!).render(<OverlayMenu />);
