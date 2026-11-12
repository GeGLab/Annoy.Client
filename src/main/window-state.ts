import { app, screen, type BrowserWindow, type Rectangle } from "electron";
import { join } from "node:path";
import { readPreferences, writePreferences } from "./settings-file.ts";

export interface WindowState { x?: number; y?: number; width: number; height: number; maximized: boolean }

const DEFAULT: WindowState = { width: 1320, height: 840, maximized: false };
const int = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? Math.round(value) : undefined);

function normalize(value: unknown, min: { width: number; height: number }): WindowState {
  const raw = (value ?? {}) as Record<string, unknown>;
  const width = int(raw.width), height = int(raw.height);
  if (!width || !height) return { ...DEFAULT };
  const state: WindowState = { width: Math.max(min.width, width), height: Math.max(min.height, height), maximized: raw.maximized === true };
  const x = int(raw.x), y = int(raw.y);
  if (x === undefined || y === undefined) return state;
  // A monitor that was unplugged must not leave the window off screen: keep the position
  // only while a reasonable part of the title bar is on some display.
  const titleBar: Rectangle = { x, y, width: state.width, height: 40 };
  const visible = screen.getAllDisplays().some(({ workArea: a }) => {
    const w = Math.min(titleBar.x + titleBar.width, a.x + a.width) - Math.max(titleBar.x, a.x);
    const h = Math.min(titleBar.y + titleBar.height, a.y + a.height) - Math.max(titleBar.y, a.y);
    return w >= 120 && h >= 20;
  });
  return visible ? { ...state, x, y } : state;
}

/** Remembers the main window's size, position and maximized state between launches. */
export function windowStateController(min: { width: number; height: number }) {
  const file = join(app.getPath("userData"), "window-state.json");
  const initial = readPreferences(file, (value) => normalize(value, min));
  return {
    initial,
    track(win: BrowserWindow): void {
      let timer: NodeJS.Timeout | null = null;
      const save = () => {
        if (timer) { clearTimeout(timer); timer = null; }
        if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
        // Normal bounds are kept while maximized, so un-maximizing after a restart restores them.
        const bounds = win.isMaximized() ? win.getNormalBounds() : win.getBounds();
        try { writePreferences(file, { ...bounds, maximized: win.isMaximized() } satisfies WindowState); } catch { /* best effort */ }
      };
      const later = () => { if (timer) clearTimeout(timer); timer = setTimeout(save, 400); };
      win.on("resize", later);
      win.on("move", later);
      win.on("maximize", save);
      win.on("unmaximize", save);
      win.on("close", save);
    },
  };
}
