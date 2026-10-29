import { existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { app, BrowserWindow, desktopCapturer, ipcMain, session, shell, WebContentsView, type Session } from "electron";
import { sitesFor, type Service } from "../shared/services.ts";
import { startUpdater } from "./updater.ts";

/** Must match --topbar-height in the renderer stylesheet; service views sit below the tab bar. */
const TOPBAR_HEIGHT = 56;
const MEDIA_PERMISSIONS = new Set(["media", "notifications", "fullscreen", "clipboard-sanitized-write", "speaker-selection"]);

let win: BrowserWindow | null = null;
/** One sandboxed view per browser service, created on first open and kept alive. */
const views = new Map<string, { view: WebContentsView; service: Service }>();
let shownService: string | null = null;
/** Space reserved above service views for in-app banners (e.g. an available update). */
let serviceTopInset = 0;

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

/** Discord and WhatsApp gate features on the user agent; present plain Chrome like Vesktop does. */
function chromeUserAgent(s: Session): string {
  // Drops the "Electron/x" and app ("Annoy/x", "annoy-client/x") tokens.
  return s.getUserAgent().replace(/\s(Electron|annoy[\w-]*|distopic[\w-]*)\/\S+/gi, "");
}

function inSites(raw: string, sites: readonly string[]): boolean {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && sites.some((site) => host === site || host.endsWith(`.${site}`));
  } catch {
    return false;
  }
}

function openExternal(raw: string): void {
  try {
    const url = new URL(raw);
    if (["https:", "http:", "mailto:", "ts3server:"].includes(url.protocol)) void shell.openExternal(url.toString());
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
      // Annoy's own UI picks a source first; services (and the portal case) take what the system offers.
      const picked = own && chosenScreenSource ? sources.find((src) => src.id === chosenScreenSource) : sources[0];
      chosenScreenSource = null;
      callback(picked ? { video: picked, audio: !own && process.platform === "win32" ? "loopback" : undefined } : {});
    },
    { useSystemPicker: true },
  );
}

function layoutService(): void {
  const entry = shownService ? views.get(shownService) : undefined;
  if (!win || !entry) return;
  const { width, height } = win.getContentBounds();
  const top = TOPBAR_HEIGHT + serviceTopInset;
  entry.view.setBounds({ x: 0, y: top, width, height: Math.max(0, height - top) });
}

/** The Discord tab of 0.3 and earlier keeps its login in this partition. */
const partitionFor = (service: Service) => (service.id === "discord" ? "persist:discord" : `persist:service-${service.id}`);

function ensureView(service: Service): WebContentsView {
  const existing = views.get(service.id);
  if (existing) return existing.view;
  const name = partitionFor(service);
  const s = session.fromPartition(name);
  configureSession(s, false);
  s.setUserAgent(chromeUserAgent(s));
  const view = new WebContentsView({ webPreferences: { partition: name, contextIsolation: true, sandbox: true, spellcheck: true } });
  const sites = sitesFor(service);
  const wc = view.webContents;
  wc.setWindowOpenHandler(({ url }) => {
    if (inSites(url, sites)) return { action: "allow" };
    openExternal(url);
    return { action: "deny" };
  });
  wc.on("will-navigate", (event, url) => {
    if (!inSites(url, sites)) {
      event.preventDefault();
      openExternal(url);
    }
  });
  // "(3) Discord", "(2) WhatsApp" or "• Discord" in the title carries the unread state.
  wc.on("page-title-updated", (_e, title) => {
    const match = /^\((\d+)\)/.exec(title);
    const badge = match ? match[1]! : /^[•*]/.test(title) ? "•" : null;
    win?.webContents.send("service:badge", service.id, badge);
  });
  void wc.loadURL(service.url);
  win?.contentView.addChildView(view);
  view.setVisible(false);
  views.set(service.id, { view, service });
  return view;
}

function showService(service: Service | null): void {
  for (const [id, entry] of views) if (id !== service?.id) entry.view.setVisible(false);
  shownService = service?.id ?? null;
  if (!service) {
    win?.webContents.focus();
    return;
  }
  const view = ensureView(service);
  layoutService();
  view.setVisible(true);
  view.webContents.focus();
}

/** Closes a removed service and forgets its login. */
async function removeService(id: string): Promise<void> {
  const entry = views.get(id);
  if (entry) {
    win?.contentView.removeChildView(entry.view);
    entry.view.webContents.close();
    views.delete(id);
    await session.fromPartition(partitionFor(entry.service)).clearStorageData();
  }
  if (shownService === id) shownService = null;
}

/** Only services the renderer describes with an https start page are hosted. */
function parseService(raw: unknown): Service | null {
  if (!raw || typeof raw !== "object") return null;
  const { id, kind, name, url } = raw as Record<string, unknown>;
  if (typeof id !== "string" || !/^[\w-]{1,64}$/.test(id) || typeof kind !== "string" || typeof name !== "string" || typeof url !== "string") return null;
  try {
    if (new URL(url).protocol !== "https:") return null;
  } catch {
    return null;
  }
  return { id, kind: kind as Service["kind"], name, url };
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
  win.on("resize", layoutService);
  win.on("closed", () => {
    win = null;
    views.clear();
    shownService = null;
  });

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(join(import.meta.dirname, "../renderer/index.html"));
}

ipcMain.on("service:show", (_e, raw: unknown) => {
  const service = parseService(raw);
  if (service) showService(service);
});
ipcMain.on("service:hide", () => showService(null));
ipcMain.on("service:reload", (_e, id: unknown) => {
  if (typeof id === "string") views.get(id)?.view.webContents.reload();
});
ipcMain.handle("service:remove", (_e, id: unknown) => (typeof id === "string" ? removeService(id) : undefined));
ipcMain.on("service:inset", (_e, top: unknown) => {
  serviceTopInset = typeof top === "number" && Number.isFinite(top) ? Math.max(0, Math.min(200, Math.round(top))) : 0;
  layoutService();
});
ipcMain.on("teamspeak:open", (_e, link: unknown) => {
  if (typeof link === "string" && link.startsWith("ts3server://")) openExternal(link);
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
