// Update policy: never force a regular update, always tell the user about it.
// The single exception is a critical security advisory affecting the running
// version; then the update downloads immediately and the renderer blocks the
// app until the user restarts into the fixed version.
import { app, ipcMain, Notification, type BrowserWindow } from "electron";
import { localMainFrame } from "../shared/desktop.ts";
import { singleFlight } from "../shared/single-flight.ts";
import { t } from "../shared/localization/index.ts";
import { join } from "node:path";
import { readPreferences, writePreferences } from "./settings-file.ts";
import updaterPkg from "electron-updater";
import {
  blockingAdvisory,
  compareVersions,
  RELEASES_URL,
  type Advisory,
  type UpdateState,
} from "../shared/update.ts";

const { autoUpdater } = updaterPkg;

/** Public, versioned list of security advisories for the client. */
const POLICY_URL =
  process.env.ANNOY_UPDATE_POLICY_URL ||
  "https://raw.githubusercontent.com/GeGLab/annoy-client/main/security/advisories.json";
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

let win: BrowserWindow | null = null;
let state: UpdateState = { status: "idle", currentVersion: app.getVersion() };
let advisory: Advisory | null = null;
let pendingVersion: string | null = null;
let notifications = true;
const notified = new Set<string>();
function notifyVersion(version: string): void {
  if (!notifications || notified.has(version) || !Notification.isSupported())
    return;
  try {
    const notification = new Notification({
      title: t("update.notificationTitle"),
      body: t("update.notificationBody", { p0: version }),
    });
    notification.on("click", () => {
      win?.show();
      if (win?.isMinimized()) win.restore();
      win?.focus();
    });
    notification.show();
    notified.add(version);
  } catch {}
}
function errorMessage(error: unknown): string {
  return t(
    /checksum|sha512|sha256|integrity/i.test(String(error))
      ? "update.integrityError"
      : "update.networkError",
  );
}

const releaseUrl = (version: string) => `${RELEASES_URL}/tag/v${version}`;

function publish(next: UpdateState): void {
  state = next;
  win?.webContents.send("update:state", state);
}

/** Only packaged AppImage (Linux) and NSIS (Windows) builds can replace themselves. */
function updatable(): boolean {
  if (!app.isPackaged && !process.env.ANNOY_UPDATE_FEED) return false;
  if (process.platform === "linux" && !process.env.APPIMAGE) return false;
  return true;
}

/** A policy fetch failure means "no known advisory": updates stay optional, never silently forced. */
async function loadAdvisory(): Promise<Advisory | null> {
  try {
    const res = await fetch(POLICY_URL, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { advisories?: Advisory[] };
    return blockingAdvisory(
      Array.isArray(body.advisories) ? body.advisories : [],
      app.getVersion(),
    );
  } catch {
    return null;
  }
}

async function performCheck(): Promise<void> {
  if (!updatable())
    return publish({ status: "disabled", currentVersion: app.getVersion() });
  if (state.status === "downloading" || state.status === "ready") return;
  publish({ status: "checking", currentVersion: app.getVersion() });
  advisory = await loadAdvisory();
  try {
    const result = await autoUpdater.checkForUpdates();
    const version = result?.updateInfo.version;
    if (!version || compareVersions(version, app.getVersion()) <= 0) {
      if (advisory)
        publish({
          status: "blocked",
          currentVersion: app.getVersion(),
          advisory,
          releaseUrl: RELEASES_URL,
        });
      else publish({ status: "none", currentVersion: app.getVersion() });
      return;
    }
    pendingVersion = version;
    // An update that doesn't reach the fixed version can't clear the advisory.
    const mandatory =
      advisory !== null && compareVersions(version, advisory.fixedIn) >= 0;
    publish({
      status: "available",
      currentVersion: app.getVersion(),
      version,
      mandatory,
      advisory: mandatory ? advisory : null,
      releaseUrl: releaseUrl(version),
    });
    notifyVersion(version);
    if (mandatory) void download();
    else if (advisory)
      publish({
        status: "blocked",
        currentVersion: app.getVersion(),
        advisory,
        releaseUrl: RELEASES_URL,
      });
  } catch (err) {
    publish({
      status: "error",
      currentVersion: app.getVersion(),
      message: errorMessage(err),
      mandatory: advisory !== null,
      advisory,
      releaseUrl: RELEASES_URL,
    });
  }
}
const check = singleFlight(performCheck);

async function download(): Promise<void> {
  if (
    !pendingVersion ||
    state.status === "downloading" ||
    state.status === "ready"
  )
    return;
  const version = pendingVersion;
  const mandatory =
    advisory !== null && compareVersions(version, advisory.fixedIn) >= 0;
  publish({
    status: "downloading",
    currentVersion: app.getVersion(),
    version,
    mandatory,
    advisory: mandatory ? advisory : null,
    percent: 0,
    releaseUrl: releaseUrl(version),
  });
  try {
    await autoUpdater.downloadUpdate();
  } catch (err) {
    publish({
      status: "error",
      currentVersion: app.getVersion(),
      message: errorMessage(err),
      mandatory,
      advisory: mandatory ? advisory : null,
      releaseUrl: releaseUrl(version),
    });
  }
}

export function startUpdater(window: BrowserWindow): void {
  win = window;
  const preferencesFile = join(app.getPath("userData"), "updates.json");
  notifications = readPreferences(preferencesFile, (value) =>
    !!value &&
    typeof value === "object" &&
    "notifications" in value &&
    typeof value.notifications === "boolean"
      ? value.notifications
      : true,
  );
  autoUpdater.autoDownload = false;
  // Installation requires the explicit, guarded restart action in the renderer.
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.logger = null;
  autoUpdater.on("error", (error) => {
    if (state.status === "ready")
      publish({
        status: "error",
        currentVersion: app.getVersion(),
        message: errorMessage(error),
        mandatory: state.mandatory,
        advisory: state.advisory,
        releaseUrl: state.releaseUrl,
      });
  });
  // Lets self-hosters or tests point at a mirror (electron-builder "generic" layout).
  if (process.env.ANNOY_UPDATE_FEED) {
    autoUpdater.forceDevUpdateConfig = !app.isPackaged;
    autoUpdater.setFeedURL({
      provider: "generic",
      url: process.env.ANNOY_UPDATE_FEED,
    });
  }

  autoUpdater.on("download-progress", (p) => {
    if (state.status === "downloading")
      publish({ ...state, percent: Math.round(p.percent) });
  });
  autoUpdater.on("update-downloaded", (info) => {
    if (state.status !== "downloading" || info.version !== pendingVersion)
      return;
    const mandatory = state.status === "downloading" && state.mandatory;
    publish({
      status: "ready",
      currentVersion: app.getVersion(),
      version: info.version,
      mandatory,
      advisory: mandatory ? advisory : null,
      releaseUrl: releaseUrl(info.version),
    });
  });

  const secure = (event: Electron.IpcMainInvokeEvent) => {
    if (!localMainFrame(event, win?.webContents))
      throw new Error("Invalid updater sender");
  };
  ipcMain.handle("update:get", (event) => {
    secure(event);
    return state;
  });
  ipcMain.handle("update:configure", (event, values: unknown) => {
    secure(event);
    if (
      !values ||
      typeof values !== "object" ||
      !("notifications" in values) ||
      typeof values.notifications !== "boolean"
    )
      throw new Error("Invalid update preferences");
    if (notifications !== values.notifications)
      writePreferences(preferencesFile, {
        notifications: values.notifications,
      });
    notifications = values.notifications;
  });
  ipcMain.handle("update:check", (event) => {
    secure(event);
    return check();
  });
  ipcMain.handle("update:download", (event) => {
    secure(event);
    return download();
  });
  ipcMain.handle("update:install", (event) => {
    secure(event);
    if (state.status === "ready") autoUpdater.quitAndInstall(false, true);
  });

  let initial: ReturnType<typeof setTimeout> | undefined;
  win.webContents.once("did-finish-load", () => {
    initial = setTimeout(() => void check(), 5000);
    initial.unref();
  });
  const interval = setInterval(() => void check(), CHECK_EVERY_MS);
  interval.unref();
  win.once("closed", () => {
    clearTimeout(initial);
    clearInterval(interval);
  });
}
