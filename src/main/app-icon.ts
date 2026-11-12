import { trustedRenderer } from "./trusted-renderer.ts";
import { app, nativeImage, type BrowserWindow, type IpcMain, type Tray } from "electron";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { appIconFile, normalizeAppIcon, type AppIcon } from "../shared/app-icon.ts";
import { readPreferences, writePreferences } from "./settings-file.ts";

/** Read before the window exists, so it opens with the chosen icon. */
export function appIconController(window: () => BrowserWindow | null, tray: () => Tray | null) {
  const file = join(app.getPath("userData"), "app-icon.json");
  let saved = readPreferences(file, (value) => normalizeAppIcon((value as { icon?: unknown } | null)?.icon));
  const path = () => join(import.meta.dirname, "../renderer", appIconFile(saved));
  /** The tray always shows the bare glyph, like other chat apps, whatever the window icon is. */
  const trayPath = () => {
    const glyph = join(import.meta.dirname, "../renderer", "tray.png");
    return existsSync(glyph) ? glyph : path();
  };
  function apply(): void {
    const image = nativeImage.createFromPath(path());
    if (image.isEmpty()) return;
    const current = window();
    if (current && !current.isDestroyed()) current.setIcon(image);
    const icon = tray();
    const trayImage = nativeImage.createFromPath(trayPath());
    if (icon && !icon.isDestroyed()) icon.setImage(trayImage.isEmpty() ? image : trayImage);
  }
  function register(ipc: IpcMain): void {
    ipc.handle("app-icon:set", (event, value: unknown) => {
      if (!trustedRenderer(event, window())) throw new Error("Invalid app icon sender");
      const next: AppIcon = normalizeAppIcon(value);
      if (next !== saved) {
        writePreferences(file, { icon: next });
        saved = next;
      }
      apply();
      return saved;
    });
  }
  return { path, trayPath, apply, register };
}
