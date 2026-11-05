import {trustedRenderer} from "./trusted-renderer.ts";
import { app, ipcMain, type BrowserWindow } from "electron";
import { join } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  localMainFrame,
  normalizeDesktop,
  parseDesktop,
  type DesktopPreferences,
  type DesktopSnapshot,
} from "../shared/desktop.ts";
import { readPreferences, writePreferences } from "./settings-file.ts";
import {
  readXdgAutostart,
  setXdgAutostart,
  stableAppImage,
  xdgAutostartPath,
} from "./autostart.ts";

/** Construct before app.ready: Chromium's acceleration decision cannot be changed later. */
export function desktopController(
  window: () => BrowserWindow | null,
  applyTray: () => void,
  trayAvailable: () => boolean,
  traySupported: () => boolean,
  refreshTray: () => void,
) {
  const platform = process.platform,
    file = join(app.getPath("userData"), "desktop.json");
  let saved = readPreferences(file, (value) =>
    normalizeDesktop(value, platform),
  );
  const acceleration = saved.hardwareAcceleration;
  if (!acceleration) app.disableHardwareAcceleration();
  const appImage = process.env.APPIMAGE;
  const autostartSupported =
    app.isPackaged &&
    (platform === "win32" ||
      (platform === "linux" && stableAppImage(appImage)));
  const autostartFile = xdgAutostartPath(
    process.env.XDG_CONFIG_HOME,
    homedir(),
  );
  let error: string | null = null;
  const firstRun = !existsSync(file);
  function autostartEnabled(): boolean {
    if (!autostartSupported) return false;
    if (platform === "win32") {
      const state = app.getLoginItemSettings({
        path: process.execPath,
        args: ["--annoy-autostart"],
      });
      return state.openAtLogin && state.executableWillLaunchAtLogin !== false;
    }
    return readXdgAutostart(autostartFile, appImage!);
  }
  function setAutostart(enabled: boolean): void {
    if (!autostartSupported)
      throw new Error("Autostart unavailable in this build");
    if (platform === "win32")
      app.setLoginItemSettings({
        openAtLogin: enabled,
        path: process.execPath,
        args: ["--annoy-autostart"],
      });
    else setXdgAutostart(autostartFile, appImage!, enabled);
    // Enabling can remain disabled by the Windows startup-apps UI. Do not claim it was applied.
  }
  function snapshot(): DesktopSnapshot {
    let startAtLogin = false;
    try {
      startAtLogin = autostartEnabled();
    } catch {
      error = "desktop.autostartError";
    }
    return {
      saved: { ...saved },
      applied: {
        ...saved,
        hardwareAcceleration: acceleration,
        startAtLogin,
        closeToTray: saved.closeToTray && trayAvailable(),
      },
      supported: {
        hardwareAcceleration: true,
        startAtLogin: autostartSupported,
        startMinimized: true,
        closeToTray: traySupported(),
      },
      restartRequired: acceleration !== saved.hardwareAcceleration,
      externalAutostartDisabled:
        autostartSupported && saved.startAtLogin && !startAtLogin,
      error,
    };
  }
  function save(raw: unknown): DesktopSnapshot {
    const next = parseDesktop(raw),
      previous = saved;
    error = null;
    if (next.startAtLogin !== previous.startAtLogin && !autostartSupported)
      throw new Error("Autostart unavailable in this build");
    // Persistence must succeed before any external registration changes. Roll back both on failure.
    writePreferences(file, next);
    try {
      if (next.startAtLogin !== previous.startAtLogin)
        setAutostart(next.startAtLogin);
    } catch (cause) {
      try {
        writePreferences(file, previous);
        if (autostartSupported) setAutostart(previous.startAtLogin);
      } catch {}
      saved = readPreferences(file, (value) =>
        normalizeDesktop(value, platform),
      );
      error = "desktop.autostartError";
      throw cause;
    }
    saved = next;
    applyTray();
    return snapshot();
  }
  // A new installation starts with the system by default. Register it once, on the first run only:
  // later runs respect the user's choice and the operating system's startup-apps settings.
  if (firstRun) {
    try {
      writePreferences(file, saved);
      if (autostartSupported && saved.startAtLogin) setAutostart(true);
    } catch {
      error = "desktop.autostartError";
    }
  }
  const secure = (event: Electron.IpcMainInvokeEvent) => {
    if (!trustedRenderer(event, window()))
      throw new Error("Invalid desktop sender");
  };
  ipcMain.handle("desktop:get", (event) => {
    secure(event);
    refreshTray();
    return snapshot();
  });
  ipcMain.handle("desktop:set", (event, value: unknown) => {
    secure(event);
    return save(value);
  });
  ipcMain.handle("desktop:restart", (event) => {
    secure(event);
    if (!snapshot().restartRequired) return;
    app.relaunch();
    app.exit(0);
  });
  ipcMain.handle("desktop:quit",event=>{secure(event);app.quit();});
  return { preferences: () => saved, snapshot };
}
/** A successful DBus watcher probe is required before offering Linux tray hiding. */
export function supportsTray(): boolean {
  if (process.platform === "win32") return true;
  if (process.platform !== "linux" || !process.env.DBUS_SESSION_BUS_ADDRESS)
    return false;
  try {
    return execFileSync(
      "gdbus",
      [
        "call",
        "--session",
        "--dest",
        "org.freedesktop.DBus",
        "--object-path",
        "/org/freedesktop/DBus",
        "--method",
        "org.freedesktop.DBus.NameHasOwner",
        "org.kde.StatusNotifierWatcher",
      ],
      { timeout: 2000, encoding: "utf8", windowsHide: true },
    ).includes("true");
  } catch {
    return false;
  }
}
