import { existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { app, BrowserWindow, desktopCapturer, ipcMain, session, shell, WebContentsView, type Session } from "electron";
import { startUpdater } from "./updater.ts";

/** Must match --topbar-height in the renderer stylesheet; the Discord view sits below the tab bar. */
const TOPBAR_HEIGHT = 56;
const DISCORD_URL = "https://discord.com/app";
const DISCORD_HOSTS = /^(?:[a-z0-9-]+\.)*(discord\.com|discordapp\.com|discord\.gg|discord\.new|discordapp\.net|discord\.media)$/;
const MEDIA_PERMISSIONS = new Set(["media", "notifications", "fullscreen", "clipboard-sanitized-write", "speaker-selection"]);

let win: BrowserWindow | null = null;
let discord: WebContentsView | null = null;
let discordVisible = false;
/** Space reserved above the Discord view for in-app banners (e.g. an available update). */
let discordTopInset = 0;

// 0.3 renamed the app from Distopic to Annoy; keep the existing profile (accounts, Discord login).
const legacyProfile = join(app.getPath("appData"), "Distopic");
if (!existsSync(app.getPath("userData")) && existsSync(legacyProfile)) {
  try {
    renameSync(legacyProfile, app.getPath("userData"));
  } catch {
    app.setPath("userData", legacyProfile);
  }
}

if (process.platform === "linux") app.commandLine.appendSwitch("enable-features", "WebRTCPipeWireCapturer");
// Windows only shows notifications for apps with an explicit AppUserModelID; it must match build.appId.
if (process.platform === "win32") app.setAppUserModelId("br.dev.geg.distopic");

if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => {
  if (win?.isMinimized()) win.restore();
  win?.focus();
});

/** Discord gates features on the user agent; present plain Chrome like Vesktop does. */
function chromeUserAgent(s: Session): string {
  // Drops the "Electron/x" and app ("Annoy/x", "annoy-client/x") tokens.
  return s.getUserAgent().replace(/\s(Electron|annoy[\w-]*|distopic[\w-]*)\/\S+/gi, "");
}

function isDiscordUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && DISCORD_HOSTS.test(url.hostname);
  } catch {
    return false;
  }
}

function openExternal(raw: string): void {
  try {
    const url = new URL(raw);
    if (url.protocol === "https:" || url.protocol === "http:" || url.protocol === "mailto:") void shell.openExternal(url.toString());
  } catch {
    // Ignore malformed URLs.
  }
}

/** On Wayland only the desktop portal may pick what to capture, so the app shows no picker of its own. */
const systemPicker = process.platform === "linux" && (process.env.XDG_SESSION_TYPE === "wayland" || !!process.env.WAYLAND_DISPLAY);
/** Source the user picked in the app's screen picker, consumed by the next capture request. */
let chosenScreenSource: string | null = null;

function configureSession(s: Session, own: boolean): void {
  s.setPermissionRequestHandler((_wc, permission, callback) => callback(MEDIA_PERMISSIONS.has(permission)));
  s.setPermissionCheckHandler((_wc, permission) => MEDIA_PERMISSIONS.has(permission));
  s.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      const sources = await desktopCapturer.getSources({ types: ["screen", "window"] });
      // Annoy's own UI picks a source first; Discord (and the portal case) take what the system offers.
      const picked = own && chosenScreenSource ? sources.find((src) => src.id === chosenScreenSource) : sources[0];
      chosenScreenSource = null;
      callback(picked ? { video: picked, audio: !own && process.platform === "win32" ? "loopback" : undefined } : {});
    },
    { useSystemPicker: true },
  );
}

function layoutDiscord(): void {
  if (!win || !discord) return;
  const { width, height } = win.getContentBounds();
  const top = TOPBAR_HEIGHT + discordTopInset;
  discord.setBounds({ x: 0, y: top, width, height: Math.max(0, height - top) });
}

/** Created lazily and kept alive, so switching back is instant and the session persists. */
function ensureDiscord(): WebContentsView {
  if (discord) return discord;
  const partition = session.fromPartition("persist:discord");
  configureSession(partition, false);
  partition.setUserAgent(chromeUserAgent(partition));
  discord = new WebContentsView({
    webPreferences: { partition: "persist:discord", contextIsolation: true, sandbox: true, spellcheck: true },
  });
  const wc = discord.webContents;
  wc.setWindowOpenHandler(({ url }) => {
    if (isDiscordUrl(url)) return { action: "allow" };
    openExternal(url);
    return { action: "deny" };
  });
  wc.on("will-navigate", (event, url) => {
    if (!isDiscordUrl(url)) {
      event.preventDefault();
      openExternal(url);
    }
  });
  // "(3) Discord" or "• Discord" in the title carries the unread state.
  wc.on("page-title-updated", (_e, title) => {
    const match = /^\((\d+)\)/.exec(title);
    const badge = match ? match[1]! : title.startsWith("•") ? "•" : null;
    win?.webContents.send("discord:badge", badge);
  });
  void wc.loadURL(DISCORD_URL);
  win?.contentView.addChildView(discord);
  discord.setVisible(false);
  return discord;
}

function setDiscordVisible(visible: boolean): void {
  discordVisible = visible;
  if (visible) {
    const view = ensureDiscord();
    layoutDiscord();
    view.setVisible(true);
    view.webContents.focus();
  } else {
    discord?.setVisible(false);
    win?.webContents.focus();
  }
}

function createWindow(): void {
  configureSession(session.defaultSession, true);
  win = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 940,
    minHeight: 560,
    backgroundColor: "#1e1f24",
    title: "Annoy",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (url !== win?.webContents.getURL()) {
      event.preventDefault();
      openExternal(url);
    }
  });
  win.on("resize", layoutDiscord);
  win.on("closed", () => {
    win = null;
    discord = null;
  });

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(join(import.meta.dirname, "../renderer/index.html"));
}

ipcMain.on("discord:show", () => setDiscordVisible(true));
ipcMain.on("discord:hide", () => setDiscordVisible(false));
ipcMain.on("discord:reload", () => discord?.webContents.reload());
ipcMain.handle("discord:visible", () => discordVisible);
ipcMain.on("discord:inset", (_e, top: unknown) => {
  discordTopInset = typeof top === "number" && Number.isFinite(top) ? Math.max(0, Math.min(200, Math.round(top))) : 0;
  layoutDiscord();
});
ipcMain.handle("screen:mode", () => (systemPicker ? "system" : "app"));
ipcMain.handle("screen:sources", async () => {
  const sources = await desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 320, height: 180 } });
  return sources.map((src) => ({ id: src.id, name: src.name, kind: src.id.startsWith("screen:") ? "screen" : "window", thumbnail: src.thumbnail.toDataURL() }));
});
ipcMain.on("screen:choose", (_e, id: unknown) => {
  chosenScreenSource = typeof id === "string" ? id : null;
});
ipcMain.on("window:flash", () => {
  if (win && !win.isFocused()) win.flashFrame(true);
});

app.whenReady().then(() => {
  createWindow();
  if (win) startUpdater(win);
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
