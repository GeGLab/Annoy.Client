// Update policy: never force a regular update, always tell the user about it.
// The single exception is a critical security advisory affecting the running
// version; then the update downloads immediately and the renderer blocks the
// app until the user restarts into the fixed version.
import { app, ipcMain, type BrowserWindow } from "electron";
import updaterPkg from "electron-updater";
import { blockingAdvisory, compareVersions, RELEASES_URL, type Advisory, type UpdateState } from "../shared/update.ts";

const { autoUpdater } = updaterPkg;

/** Public, versioned list of security advisories for the client. */
const POLICY_URL = process.env.ANNOY_UPDATE_POLICY_URL || "https://raw.githubusercontent.com/GeGLab/annoy-client/main/security/advisories.json";
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

let win: BrowserWindow | null = null;
let state: UpdateState = { status: "idle", currentVersion: app.getVersion() };
let advisory: Advisory | null = null;
let pendingVersion: string | null = null;

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
    const res = await fetch(POLICY_URL, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const body = (await res.json()) as { advisories?: Advisory[] };
    return blockingAdvisory(Array.isArray(body.advisories) ? body.advisories : [], app.getVersion());
  } catch {
    return null;
  }
}

async function check(): Promise<void> {
  if (!updatable()) return publish({ status: "disabled", currentVersion: app.getVersion() });
  if (state.status === "downloading" || state.status === "ready") return;
  publish({ status: "checking", currentVersion: app.getVersion() });
  advisory = await loadAdvisory();
  try {
    const result = await autoUpdater.checkForUpdates();
    const version = result?.updateInfo.version;
    if (!version || compareVersions(version, app.getVersion()) <= 0) {
      if (advisory) publish({ status: "blocked", currentVersion: app.getVersion(), advisory, releaseUrl: RELEASES_URL });
      else publish({ status: "none", currentVersion: app.getVersion() });
      return;
    }
    pendingVersion = version;
    // An update that doesn't reach the fixed version can't clear the advisory.
    const mandatory = advisory !== null && compareVersions(version, advisory.fixedIn) >= 0;
    publish({ status: "available", currentVersion: app.getVersion(), version, mandatory, advisory: mandatory ? advisory : null, releaseUrl: releaseUrl(version) });
    if (mandatory) void download();
    else if (advisory) publish({ status: "blocked", currentVersion: app.getVersion(), advisory, releaseUrl: RELEASES_URL });
  } catch (err) {
    publish({
      status: "error",
      currentVersion: app.getVersion(),
      message: err instanceof Error ? err.message : String(err),
      mandatory: advisory !== null,
      advisory,
      releaseUrl: RELEASES_URL,
    });
  }
}

async function download(): Promise<void> {
  if (!pendingVersion || state.status === "downloading" || state.status === "ready") return;
  const version = pendingVersion;
  const mandatory = state.status === "available" && state.mandatory;
  publish({ status: "downloading", currentVersion: app.getVersion(), version, mandatory, advisory: mandatory ? advisory : null, percent: 0, releaseUrl: releaseUrl(version) });
  try {
    await autoUpdater.downloadUpdate();
  } catch (err) {
    publish({
      status: "error",
      currentVersion: app.getVersion(),
      message: err instanceof Error ? err.message : String(err),
      mandatory,
      advisory: mandatory ? advisory : null,
      releaseUrl: releaseUrl(version),
    });
  }
}

export function startUpdater(window: BrowserWindow): void {
  win = window;
  autoUpdater.autoDownload = false;
  // A downloaded update installs on the next quit even if the user never clicks "restart".
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;
  autoUpdater.logger = null;
  // Lets self-hosters or tests point at a mirror (electron-builder "generic" layout).
  if (process.env.ANNOY_UPDATE_FEED) {
    autoUpdater.forceDevUpdateConfig = !app.isPackaged;
    autoUpdater.setFeedURL({ provider: "generic", url: process.env.ANNOY_UPDATE_FEED });
  }

  autoUpdater.on("download-progress", (p) => {
    if (state.status === "downloading") publish({ ...state, percent: Math.round(p.percent) });
  });
  autoUpdater.on("update-downloaded", (info) => {
    const mandatory = state.status === "downloading" && state.mandatory;
    publish({ status: "ready", currentVersion: app.getVersion(), version: info.version, mandatory, advisory: mandatory ? advisory : null, releaseUrl: releaseUrl(info.version) });
  });

  ipcMain.handle("update:get", () => state);
  ipcMain.handle("update:check", () => check());
  ipcMain.handle("update:download", () => download());
  ipcMain.handle("update:install", () => {
    if (state.status === "ready") autoUpdater.quitAndInstall(false, true);
  });

  win.webContents.once("did-finish-load", () => setTimeout(() => void check(), 5000));
  setInterval(() => void check(), CHECK_EVERY_MS).unref();
}
