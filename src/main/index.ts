import {onLocalizationChange} from "../shared/localization/index.ts";
import { appIconController } from "./app-icon.ts";
import {desktopController,supportsTray} from "./desktop.ts";
import {registerLocalization} from "./localization.ts";
import {t as translate} from "../shared/localization/index.ts";
import {trustedRenderer} from './trusted-renderer.ts';
import {secureHttpUrl} from '../shared/transport.ts';
import {nativeApiFetch} from './native-api-fetch.ts';
import {registerPrivateDownload} from './private-download.ts';
import {registerIntegrationHttp} from './integrations/http.ts';
import {registerVpngo} from './integrations/vpngo.ts';
import { osStorage } from "./safe-storage.ts";
import { SecretStore } from "./secrets.ts";
import { appendFileSync, existsSync,mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join,isAbsolute } from "node:path";
import { parseOverlayMenuPick, parseOverlayMenuSpec, type OverlayMenuPick } from "../shared/overlay-menu.ts";
import { app, BrowserWindow, clipboard, desktopCapturer, ipcMain, nativeImage, powerMonitor, powerSaveBlocker, safeStorage, session, shell, Tray, Menu, WebContentsView, type Session } from "electron";
import { sitesFor, type Service } from "../shared/services.ts";
import { startUpdater } from "./updater.ts";
import { windowStateController } from "./window-state.ts";
import { allowDevOriginForCloud } from "./dev-cors.ts";
import { registerActivity } from "./activity/index.ts";
import { createAppAccess, SessionRefused } from "./app-access.ts";
import { registerTheater, closeAllTheater } from "./theater.ts";
import { startScreenAudio, stopScreenAudio, stopScreenAudioNow } from "./screen-audio-linux.ts";

const mediaWindowIds = new Set<number>();
const MEDIA_PERMISSIONS = new Set(["media", "display-capture", "notifications", "fullscreen", "clipboard-sanitized-write", "speaker-selection"]);

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let trayCapable=false;
const selectedProfile=app.commandLine.getSwitchValue("user-data-dir");
if(selectedProfile){if(!isAbsolute(selectedProfile)||selectedProfile.includes("\0"))throw new Error("Invalid profile path");mkdirSync(selectedProfile,{recursive:true});app.setPath("userData",selectedProfile);}
const appIcon = appIconController(() => win, () => tray);
appIcon.register(ipcMain);
let quitting = false;
app.on("before-quit", () => { quitting = true; });
// Released builds never keep DevTools open (Electron's default menu still binds Ctrl+Shift+I):
// code pasted there could read the account's keys and sessions. Development builds keep them.
if (app.isPackaged) app.on("web-contents-created", (_event, contents) => contents.on("devtools-opened", () => contents.closeDevTools()));
function restoreWindow(): void {
  if (!win) return;
  win.show();
  if (win.isMinimized()) win.restore();
  win.focus();
}
function createTray(): void {
  // Like other chat apps, Annoy always sits in the tray where one is available;
  // "close to tray" only decides what the window's close button does.
  if (!trayCapable) {
    tray?.destroy();tray=null;
    if(win&&!win.isVisible()&&!win.isMinimized())restoreWindow();
    return;
  }
  if(!tray){try{tray = new Tray(appIcon.trayPath());tray.on("double-click", restoreWindow);tray.on("click",restoreWindow);}catch{trayCapable=false;if(win&&!win.isVisible()&&!win.isMinimized())restoreWindow();return;}}
  tray.setToolTip("Annoy");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: translate("desktop.94a2df2e44ec"), click: restoreWindow },
    { type: "separator" },
    { label: translate("desktop.b08423738547"), click: () => {restoreWindow();if(!win||win.webContents.isCrashed()||win.webContents.isLoadingMainFrame())app.quit();else win.webContents.send("desktop:quit-requested");} },
  ]));
}
const stopActivity = registerActivity(ipcMain, () => win, () => appAccess.getState().allowed, event => trustedRenderer(event, win));
app.on("will-quit", stopActivity);
app.on("will-quit", stopScreenAudioNow);
/** One sandboxed view per browser service, created on first open and kept alive. */
const views = new Map<string, { view: WebContentsView; service: Service }>();
let shownService: string | null = null;
const serviceWindows = new Set<BrowserWindow>();
/** The account website (sign-up, password, recovery). */
const globalUrl = (process.env.ANNOY_GLOBAL_URL || "https://global.geg.dev.br").replace(/\/+$/, "");
/** authannoy: the Annoy account API (TODO item 2). */
// A development or test Global given alone also answers for the account.
const authUrl = (process.env.ANNOY_AUTH_URL || process.env.ANNOY_GLOBAL_URL || "https://authannoy.geg.dev.br").replace(/\/+$/, "");
/** Annoy cloud services (TODO item 1): friends, DMs, status and images, outside any server. */
const cloudUrls = {
  users: (process.env.ANNOY_USERS_URL || "https://usersannoy.geg.dev.br").replace(/\/+$/, ""),
  chat: (process.env.ANNOY_CHAT_URL || "https://chatannoy.geg.dev.br").replace(/\/+$/, ""),
  cdn: (process.env.ANNOY_CDN_URL || "https://cdnannoy.geg.dev.br").replace(/\/+$/, ""),
  dev: (process.env.ANNOY_DEV_URL || "https://devannoy.geg.dev.br").replace(/\/+$/, ""),
};
let resettingRenderer = false;
const appAccess = createAppAccess(authUrl, state => {
  if (!state.allowed) {
    showService(null);
    for (const entry of views.values()) {
      win?.contentView.removeChildView(entry.view);
      entry.view.webContents.close();
    }
    views.clear();
    for (const popup of serviceWindows) if (!popup.isDestroyed()) popup.destroy();
    serviceWindows.clear();
    closeAllTheater();
    stopActivity();
  }
  if (!resettingRenderer && win && !win.isDestroyed()) win.webContents.send("auth:state", state);
},authenticatedMainFetch);
async function authenticatedMainFetch(input:Parameters<typeof fetch>[0],init?:RequestInit):Promise<Response>{
 secureHttpUrl(String(input));
 return nativeApiFetch(input,{...init,redirect:'error'});
}

const fromRenderer = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) =>
  trustedRenderer(event,win);
const authorized = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => fromRenderer(event) && appAccess.getState().allowed;
const stopDownloads=registerPrivateDownload(()=>win,authorized,authenticatedMainFetch);
app.on("before-quit",stopDownloads);
registerIntegrationHttp(ipcMain,authorized);
const stopVpngo=registerVpngo(ipcMain,authorized,()=>win);
app.on("before-quit",stopVpngo);

/** The page's main area, reported by the renderer: the bar can sit on the side or on top, with banners above. */
let serviceArea = { x: 0, y: 0, width: 0, height: 0 };

// 0.3 renamed the app from Distopic to Annoy; keep the existing profile (accounts, Discord login).
const legacyProfile = join(app.getPath("appData"), "Distopic");
if (!selectedProfile&&!existsSync(app.getPath("userData")) && existsSync(legacyProfile)) {
  try {
    renameSync(legacyProfile, app.getPath("userData"));
  } catch {
    app.setPath("userData", legacyProfile);
  }
}

registerLocalization(ipcMain,()=>win);
const desktop=desktopController(()=>win,createTray,()=>!!tray&&!tray.isDestroyed(),()=>trayCapable,()=>{trayCapable=supportsTray();createTray();});
onLocalizationChange(()=>{if(tray)createTray();});
if (process.platform === "linux") app.commandLine.appendSwitch("enable-features", "WebRTCPipeWireCapturer");
// Capture, VAD and neural filters must keep their scheduling priority when another
// window covers Annoy. backgroundThrottling:false controls page timers/rendering;
// Windows renderer priority and native occlusion are separate Chromium policies.
if (process.platform === "win32") {
  app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
  app.commandLine.appendSwitch("disable-renderer-backgrounding");
  // Covering the window still let Windows mark it occluded and move the renderer into
  // efficiency mode (EcoQoS), which starves WebRTC's audio decode and makes voices crackle.
  app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion,IntensiveWakeUpThrottling,UseEcoQoSForBackgroundProcess");
  // The out-of-process audio service gets the same priority Chrome gives it by policy.
  app.commandLine.appendSwitch("audio-process-high-priority");
}
// Chromium picks the keychain by desktop name and falls back to no encryption
// on ones it doesn't know (Hyprland, Sway…), even with a Secret Service running
// (KWallet's ksecretd, GNOME Keyring, KeePassXC). Ask for it by its standard
// interface there; without one, Chromium still falls back. Existing cookies
// (service logins) keep working either way.
if (process.platform === "linux" && !app.commandLine.hasSwitch("password-store") && !/KDE|GNOME|Unity|Cinnamon|Pantheon|XFCE|Deepin/i.test(process.env.XDG_CURRENT_DESKTOP ?? "")) {
  app.commandLine.appendSwitch("password-store", "gnome-libsecret");
}
// Windows only shows notifications for apps with an explicit AppUserModelID; it must match build.appId.
if (process.platform === "win32") app.setAppUserModelId("br.dev.geg.annoy");

if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => {
  restoreWindow();
});

/** Discord and WhatsApp gate features on the user agent; present plain Chrome like Vesktop does. */
function chromeUserAgent(s: Session): string {
  // Drops the "Electron/x" and app ("Annoy/x", "annoy-client/x") tokens.
  return s.getUserAgent().replace(/\s(Electron|annoy[\w-]*)\/\S+/gi, "");
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
    // Game invites: only "launch this Steam game", never other steam:// commands.
    else if (url.protocol === "steam:" && /^steam:\/\/rungameid\/\d{1,10}$/.test(raw)) void shell.openExternal(raw);
  } catch {
    // Ignore malformed URLs.
  }
}

/** On Wayland only the desktop portal may pick what to capture, so the app shows no picker of its own. */
const systemPicker = process.platform === "linux" && (process.env.XDG_SESSION_TYPE === "wayland" || !!process.env.WAYLAND_DISPLAY);
/** Source the user picked in the app's screen picker, consumed by the next capture request. */
let chosenScreenSource: string | null = null;

function configureSession(s: Session, own: boolean): void {
  const trusted = (wc:Electron.WebContents|null,origin:string) => {
    if (!wc || !appAccess.getState().allowed) return false;
    if (own) return wc === win?.webContents;
    const entry=[...views.values()].find(e=>e.view.webContents===wc);
    return !!entry && inSites(origin,sitesFor(entry.service)) && shownService===entry.service.id;
  };
  // Using the app is consent to its terms: media is granted without asking, but only to
  // Annoy's own window and to the service tab on screen, never to other or hidden content.
  const allowed = (wc: Electron.WebContents | null, permission: string, origin: string) =>
    MEDIA_PERMISSIONS.has(permission) && (trusted(wc, origin) || (own && permission === "fullscreen" && !!wc && appAccess.getState().allowed && mediaWindowIds.has(wc.id)));
  s.setPermissionRequestHandler((wc,permission,callback,details) => callback(allowed(wc,permission,details.requestingUrl||wc.getURL())));
  s.setPermissionCheckHandler((wc,permission,origin) => allowed(wc,permission,origin));
  s.setDisplayMediaRequestHandler(
    async (request, callback) => {
      if (!appAccess.getState().allowed) { callback({}); return; }
      const sources = await desktopCapturer.getSources({ types: ["screen", "window"] });
      // Annoy's own UI picks a source first; services (and the portal case) take what the system offers.
      const picked = own && chosenScreenSource ? sources.find((src) => src.id === chosenScreenSource) : sources[0];
      chosenScreenSource = null;
      // Windows can add the system's sound (WASAPI loopback); Annoy asks for it only when the user shares audio.
      const loopback = process.platform === "win32" && (!own || request.audioRequested);
      callback(picked ? { video: picked, audio: loopback ? "loopback" : undefined } : {});
    },
    { useSystemPicker: true },
  );
}

function layoutService(): void {
  const entry = shownService ? views.get(shownService) : undefined;
  if (!win || !entry) return;
  const { width, height } = win.getContentBounds();
  const x = Math.min(serviceArea.x, width),
    y = Math.min(serviceArea.y, height);
  entry.view.setBounds({ x, y, width: Math.max(0, Math.min(serviceArea.width, width - x)), height: Math.max(0, Math.min(serviceArea.height, height - y)) });
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
  const view = new WebContentsView({ webPreferences: { partition: name, contextIsolation: true, sandbox: true, nodeIntegration: false, nodeIntegrationInSubFrames: false, spellcheck: true } });
  const sites = sitesFor(service);
  const wc = view.webContents;
  wc.setWindowOpenHandler(({ url }) => {
    if (!appAccess.getState().allowed) return { action: "deny" };
    if (inSites(url, sites)) return { action: "allow" };
    openExternal(url);
    return { action: "deny" };
  });
  wc.on("did-create-window", popup => { serviceWindows.add(popup); popup.on("closed", () => serviceWindows.delete(popup)); });
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
  void wc.loadURL(service.url).catch(() => undefined);
  win?.contentView.addChildView(view);
  view.setVisible(false);
  views.set(service.id, { view, service });
  return view;
}

function showService(service: Service | null): void {
  if (service && !appAccess.getState().allowed) return;
  if (menuPending) closeMenuOverlay(null);
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
  // Load the menu layer while the service is on screen, so the first right-click opens at once.
  ensureMenuOverlay();
}

/**
 * Native views cover the page, so a menu drawn in it would sit behind a browser service.
 * Menus opened over a service are drawn in this transparent layer, put above every view
 * only while a menu is open; it uses the app's own page and styles.
 */
let menuOverlay: { view: WebContentsView; ready: Promise<void> } | null = null;
let menuPending: { token: number; resolve: (pick: OverlayMenuPick | null) => void } | null = null;
let menuToken = 0;

function ensureMenuOverlay(): { view: WebContentsView; ready: Promise<void> } | null {
  if (menuOverlay) return menuOverlay;
  if (!win) return null;
  const view = new WebContentsView({ webPreferences: { preload: join(import.meta.dirname, "../preload/overlay.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false, nodeIntegrationInSubFrames: false, spellcheck: false } });
  view.setBackgroundColor("#00000000");
  const wc = view.webContents;
  wc.setWindowOpenHandler(() => ({ action: "deny" }));
  wc.on("will-navigate", event => event.preventDefault());
  // Ready once the page itself says it listens; loading alone happens before React subscribes.
  const ready = new Promise<void>(resolve => {
    const onReady = (event: Electron.IpcMainEvent) => { if (event.sender === wc) { ipcMain.off("overlay-menu:ready", onReady); resolve(); } };
    ipcMain.on("overlay-menu:ready", onReady);
  });
  void (!app.isPackaged && process.env.ELECTRON_RENDERER_URL
    ? wc.loadURL(new URL("overlay.html", process.env.ELECTRON_RENDERER_URL.replace(/\/?$/, "/")).href)
    : wc.loadFile(join(import.meta.dirname, "../renderer/overlay.html"))).catch(() => undefined);
  view.setVisible(false);
  win.contentView.addChildView(view);
  wc.on("render-process-gone", () => { if (menuOverlay?.view === view) { closeMenuOverlay(null); win?.contentView.removeChildView(view); menuOverlay = null; } });
  menuOverlay = { view, ready };
  return menuOverlay;
}

function closeMenuOverlay(pick: OverlayMenuPick | null): void {
  const pending = menuPending;
  menuPending = null;
  if (menuOverlay) {
    menuOverlay.view.webContents.send("overlay-menu:close");
    menuOverlay.view.setVisible(false);
  }
  const shown = shownService ? views.get(shownService) : undefined;
  if (shown) shown.view.webContents.focus(); else win?.webContents.focus();
  pending?.resolve(pick);
}

function layoutMenuOverlay(): void {
  if (!win || !menuOverlay) return;
  const { width, height } = win.getContentBounds();
  menuOverlay.view.setBounds({ x: 0, y: 0, width, height });
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

/**
 * Fallback right-click menu for whatever the renderer has no menu of its own for (its menus call preventDefault,
 * so this never fires on them): images can be copied or saved, selections copied and text fields edited.
 */
function showNativeMenu(params: Electron.ContextMenuParams): void {
  if (!win) return;
  const wc = win.webContents;
  const items: Electron.MenuItemConstructorOptions[] = [];
  const image = params.mediaType === "image" && /^(https?|blob|data):/.test(params.srcURL);
  if (image) {
    items.push(
      { label: translate("desktop.6605544f120f"), click: () => wc.copyImageAt(params.x, params.y) },
      { label: translate("desktop.e7ff7c72cedc"), click: () => wc.downloadURL(params.srcURL) },
    );
    if (/^https?:/.test(params.srcURL)) {
      items.push(
        { label: translate("desktop.c727fdb5fd76"), click: () => clipboard.writeText(params.srcURL) },
        { label: translate("desktop.dd9bdbdc3f1f"), click: () => openExternal(params.srcURL) },
      );
    }
  }
  if (params.linkURL && /^https?:/.test(params.linkURL) && params.linkURL !== params.srcURL) {
    if (items.length) items.push({ type: "separator" });
    items.push({ label: translate("desktop.c19488a05564"), click: () => clipboard.writeText(params.linkURL) });
  }
  if (params.isEditable) {
    if (items.length) items.push({ type: "separator" });
    items.push(
      { label: translate("desktop.b659da7fa50d"), role: "cut", enabled: params.editFlags.canCut },
      { label: translate("desktop.39dcf1cbeb5a"), role: "copy", enabled: params.editFlags.canCopy },
      { label: translate("desktop.83229f4fb36b"), role: "paste", enabled: params.editFlags.canPaste },
      { type: "separator" },
      { label: translate("desktop.6dc56b9dcaea"), role: "selectAll" },
    );
  } else if (params.selectionText.trim()) {
    if (items.length) items.push({ type: "separator" });
    items.push({ label: translate("desktop.39dcf1cbeb5a"), role: "copy" });
  }
  if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
}

function createWindow(): void {
  configureSession(session.defaultSession, true);
  // `npm run dev` only: the Vite origin isn't on the production cloud's CORS allowlist.
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL)
    allowDevOriginForCloud(session.defaultSession, new URL(process.env.ELECTRON_RENDERER_URL).origin, [authUrl, ...Object.values(cloudUrls)]);
  const windowState = windowStateController({ width: 940, height: 560 });
  const { initial } = windowState;
  win = new BrowserWindow({
    width: initial.width,
    height: initial.height,
    ...(initial.x !== undefined && initial.y !== undefined ? { x: initial.x, y: initial.y } : {}),
    minWidth: 940,
    minHeight: 560,
    show:false,
    backgroundColor: "#0e151f",
    title: translate("desktop.7cd80ae96251"),
    titleBarStyle: "hidden",
    ...(process.platform === "darwin" ? { trafficLightPosition: { x: 14, y: 12 } } : { frame: false }),
    icon: appIcon.path(),

    autoHideMenuBar: true,
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      backgroundThrottling: false,
    },
  });
  win.webContents.setWindowOpenHandler(({ url, frameName }) => {
    // Media windows are filled by the original renderer; navigation and Node stay disabled.
    if (url === "about:blank" && (frameName.startsWith("annoy-stream:") || frameName.startsWith("annoy-image:"))) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 1280,
          height: 720,
          backgroundColor: "#000000",
          autoHideMenuBar: true,
          icon: appIcon.path(),
          webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
        },
      };
    }
    openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("did-create-window", (child) => {
    const id = child.webContents.id;
    mediaWindowIds.add(id);
    child.on("closed", () => mediaWindowIds.delete(id));
    child.setMenu(null);
    child.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    child.webContents.on("will-navigate", (event) => event.preventDefault());
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (url !== win?.webContents.getURL()) {
      event.preventDefault();
      openExternal(url);
    }
  });
  win.webContents.on("context-menu", (_event, params) => showNativeMenu(params));
  // A crashed or killed renderer leaves an empty window; bring the app back.
  win.webContents.on("render-process-gone", (_event, details) => {
    logError(`renderer gone: ${details.reason} (exit ${details.exitCode})`);
    if (details.reason !== "clean-exit") win?.webContents.reload();
  });
  registerTheater(win, () => appAccess.getState().allowed);
  const resetRendererAccess = () => {
    // Close native pages without sending a logout into the departing document.
    resettingRenderer = true;
    try { appAccess.reset(); } finally { resettingRenderer = false; }
  };
  win.webContents.on("did-start-loading", resetRendererAccess);
  win.webContents.on("render-process-gone", resetRendererAccess);
  // A reloaded or crashed renderer can't stop its screen share any more.
  win.webContents.on("did-start-loading", () => void stopScreenAudio());
  // A reloaded renderer has left its call; it asks again once it rejoins.
  win.webContents.on("did-start-loading", releaseCallBlocker);
  win.webContents.on("render-process-gone", releaseCallBlocker);
  win.webContents.on("render-process-gone", () => void stopScreenAudio());
  const sendWindowState = () => win?.webContents.send("window:maximized", win.isMaximized());
  win.on("maximize", sendWindowState);
  win.on("unmaximize", sendWindowState);
  win.on("close", (event) => {
    if (desktop.preferences().closeToTray&&tray&&!tray.isDestroyed() && !quitting) {
      event.preventDefault();
      win?.hide();
    }
  });
  win.on("closed", () => {
    win = null;
    views.clear();
    shownService = null;
    menuOverlay = null;
    menuPending?.resolve(null);
    menuPending = null;
  });
  // A menu belongs to the spot it opened at; moving or resizing the window closes it.
  win.on("resize", () => { if (menuPending) closeMenuOverlay(null); });
  win.on("move", () => { if (menuPending) closeMenuOverlay(null); });

  windowState.track(win);
  win.once("ready-to-show",()=>{if(initial.maximized)win?.maximize();win?.show();if(desktop.preferences().startMinimized)win?.minimize();});
  if (!app.isPackaged&&process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(join(import.meta.dirname, "../renderer/index.html"));
}

// Interface errors land in a local file (never sent anywhere) so a report can
// say what broke. Kept small: past 1 MB it starts over.
const errorLog = () => join(app.getPath("userData"), "errors.log");
function logError(text: string): void {
  try {
    if (existsSync(errorLog()) && statSync(errorLog()).size > 1_000_000) writeFileSync(errorLog(), "");
    appendFileSync(errorLog(), `${new Date().toISOString()} [${app.getVersion()}] ${text.slice(0, 8000)}\n`);
  } catch {
    // Logging must never take the app down.
  }
}
ipcMain.on("log:error", (event, text: unknown) => {
  if (fromRenderer(event) && typeof text === "string") logError("Renderer failure; content and stack omitted to protect secrets");
});

// Secrets the renderer keeps across restarts (the Annoy Global keys), sealed by
// the OS keychain. Without a real keychain nothing is written: the app asks for
// the password again next time instead of storing keys in the clear.
const SECRET_NAMES = new Set(["global", "accounts"]);
const secrets = new SecretStore(join(app.getPath("userData"), "secrets.json"), osStorage(safeStorage));
ipcMain.handle("secrets:get", (event, name: unknown) => {
  if (!fromRenderer(event) || typeof name !== "string" || !SECRET_NAMES.has(name)) return null;
  return secrets.get(name).catch(() => null);
});
ipcMain.handle("secrets:set", (event, name: unknown, value: unknown) => {
  if (!fromRenderer(event) || typeof name !== "string" || !SECRET_NAMES.has(name) || (value !== null && typeof value !== "string")) return false;
  return secrets.set(name, value).catch(() => false);
});

// Native browsing stays locked until credentials are independently validated here.
// Screen-share sound on Linux: a virtual microphone with every app's sound except Annoy's.
ipcMain.handle("screen-audio:start", event => fromRenderer(event) && appAccess.getState().allowed ? startScreenAudio() : null);
ipcMain.handle("screen-audio:stop", event => fromRenderer(event) ? stopScreenAudio() : undefined);

ipcMain.handle("auth:get", event => fromRenderer(event) ? appAccess.getState() : { allowed: false, global: false, localAccounts: [] });
ipcMain.handle("auth:global-url", event => fromRenderer(event) ? globalUrl : null);
ipcMain.handle("auth:cloud-urls", event => fromRenderer(event) ? cloudUrls : null);
ipcMain.handle("auth:global", async (event, token: unknown) => {
  if (!fromRenderer(event)) throw new Error("Invalid authentication sender");
  // The renderer must tell a refusal (sign in again) from a failure to reach authannoy (keep the session, retry).
  try { return await appAccess.verifyGlobal(token); }
  catch (error) {
    if (!(error instanceof SessionRefused)) {
      // Keep the real cause (status, DNS, TLS, timeout): "unreachable" alone can't be diagnosed.
      const cause = error instanceof Error ? `${error.name}: ${error.message}${error.cause ? ` <- ${String((error.cause as Error).message ?? error.cause)}` : ""}` : String(error);
      logError(`auth:global unreachable (${authUrl}/v1/me): ${cause}`);
      if (!app.isPackaged) console.error("[auth:global]", authUrl, error);
    }
    throw new Error(error instanceof SessionRefused ? "SESSION_REFUSED" : "SESSION_UNREACHABLE");
  }
});
ipcMain.handle("auth:local", async (event, account: unknown) => {
  if (!fromRenderer(event)) throw new Error("Invalid authentication sender");
  try { await appAccess.verifyLocal(account); return { ok: true }; }
  catch (error) { return { ok: false, message: error instanceof Error ? error.message : translate("common.2587fca90678") }; }
});
ipcMain.handle("auth:logout-global", event => { if (fromRenderer(event)) {appAccess.revokeGlobal();} });
ipcMain.handle("auth:auth-url", event => fromRenderer(event) ? authUrl : null);
/**
 * Sign-out wipes this install (TODO item 2.3): sessions, saved credentials,
 * every service tab's login and the web caches. The renderer keeps only the
 * username and the app's preferences, and reloads.
 */
ipcMain.handle("auth:wipe", async (event, serviceIds: unknown) => {
  if (!fromRenderer(event)) return;
  appAccess.reset();
  for (const id of [...views.keys()]) await removeService(id).catch(() => undefined);
  const ids = Array.isArray(serviceIds) ? serviceIds.filter((id): id is string => typeof id === "string" && /^[\w-]{1,64}$/.test(id)) : [];
  for (const partition of ["persist:discord", ...ids.map((id) => `persist:service-${id}`)]) await session.fromPartition(partition).clearStorageData().catch(() => undefined);
  for (const name of SECRET_NAMES) await secrets.set(name, null).catch(() => false);
  const own = win?.webContents.session ?? session.defaultSession;
  await own.clearCache().catch(() => undefined);
  // localStorage stays: the renderer already removed everything but the username and preferences.
  await own.clearStorageData({ storages: ["cookies", "indexdb", "cachestorage", "serviceworkers", "filesystem", "shadercache"] }).catch(() => undefined);
});
ipcMain.handle("auth:logout-local", (event, id: unknown, lock:unknown=true) => { if (fromRenderer(event) && typeof id === "string") {appAccess.revokeLocal(id);} });

// Only the local, isolated renderer may control the desktop window.
ipcMain.on("window:control", (event, action: unknown) => {
  if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) return;
  if (action === "minimize") win.minimize();
  else if (action === "maximize") win.isMaximized() ? win.unmaximize() : win.maximize();
  else if (action === "close") win.close();
});
ipcMain.on("file:download", (event, url: unknown) => {
  if (!authorized(event) || !win || typeof url !== "string" || !/^https?:\/\//.test(url)) return;
  win.webContents.downloadURL(url);
});
ipcMain.handle("system:idle", (event) => fromRenderer(event) ? powerMonitor.getSystemIdleTime() : 0);
ipcMain.handle("window:maximized", (event) => fromRenderer(event) && win!.isMaximized());

ipcMain.handle("overlay-menu:open", async (event, raw: unknown) => {
  if (!authorized(event) || !win) return null;
  const spec = parseOverlayMenuSpec(raw);
  const overlay = spec && ensureMenuOverlay();
  if (!spec || !overlay) return null;
  closeMenuOverlay(null);
  const loaded = await Promise.race([overlay.ready.then(() => true), new Promise<false>(resolve => setTimeout(() => resolve(false), 3000))]);
  if (!loaded || !win || menuOverlay !== overlay) return null;
  const token = ++menuToken;
  const answer = new Promise<OverlayMenuPick | null>(resolve => { menuPending = { token, resolve }; });
  // Adding a child view again moves it above the others.
  win.contentView.addChildView(overlay.view);
  layoutMenuOverlay();
  overlay.view.setVisible(true);
  overlay.view.webContents.focus();
  overlay.view.webContents.send("overlay-menu:show", token, spec);
  return answer;
});
ipcMain.on("overlay-menu:done", (event, token: unknown, raw: unknown) => {
  if (!menuOverlay || event.sender !== menuOverlay.view.webContents || token !== menuPending?.token) return;
  closeMenuOverlay(raw === null ? null : parseOverlayMenuPick(raw));
});
ipcMain.on("service:show", (event, raw: unknown) => {
  if (!authorized(event)) return;
  const service = parseService(raw);
  if (service) showService(service);
});
ipcMain.on("service:hide", event => { if (authorized(event)) showService(null); });
ipcMain.on("service:reload", (event, id: unknown) => {
  if (!authorized(event)) return;
  if (typeof id === "string") views.get(id)?.view.webContents.reload();
});
ipcMain.handle("service:remove", (event, id: unknown) => (authorized(event) && typeof id === "string" ? removeService(id) : undefined));
ipcMain.on("service:bounds", (event, raw: unknown) => {
  if (!authorized(event)) return;
  const r = (raw ?? {}) as Record<string, unknown>;
  const px = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);
  serviceArea = { x: px(r.x), y: px(r.y), width: px(r.width), height: px(r.height) };
  layoutService();
});
ipcMain.on("teamspeak:open", (event, link: unknown) => {
  if (!authorized(event)) return;
  if (typeof link === "string" && link.startsWith("ts3server://")) openExternal(link);
});
ipcMain.handle("screen:mode", event => authorized(event) ? (systemPicker ? "system" : "app") : null);
ipcMain.handle("screen:sources", async event => {
  if (!authorized(event)) return [];
  const sources = await desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 320, height: 180 } });
  return sources.map((src) => ({ id: src.id, name: src.name, kind: src.id.startsWith("screen:") ? "screen" : "window", thumbnail: src.thumbnail.toDataURL() }));
});
ipcMain.on("screen:choose", (event, id: unknown) => {
  if (!authorized(event)) return;
  chosenScreenSource = typeof id === "string" ? id : null;
});
// While a call is up, Windows must not suspend or deprioritize Annoy (voices would crackle).
let callBlocker: number | null = null;
function releaseCallBlocker(): void { if (callBlocker !== null) { powerSaveBlocker.stop(callBlocker); callBlocker = null; } }
ipcMain.on("voice:active", (event, active: unknown) => {
  if (!authorized(event)) return;
  if (active === true && callBlocker === null) callBlocker = powerSaveBlocker.start("prevent-app-suspension");
  else if (active !== true) releaseCallBlocker();
});
// Unread direct messages and mentions stay visible on the taskbar and in the tray until read.
const pngDataUrl = (value: unknown) => typeof value === "string" && value.length < 200_000 && value.startsWith("data:image/png;base64,") ? value : null;
ipcMain.on("unread:badge", (event, rawCount: unknown, rawOverlay: unknown, rawTray: unknown) => {
  if (!fromRenderer(event)) return;
  const count = typeof rawCount === "number" && Number.isFinite(rawCount) ? Math.max(0, Math.min(9999, Math.floor(rawCount))) : 0;
  const overlay = count > 0 ? pngDataUrl(rawOverlay) : null, trayDot = count > 0 ? pngDataUrl(rawTray) : null;
  if (process.platform === "win32" && win && !win.isDestroyed()) {
    win.setOverlayIcon(overlay ? nativeImage.createFromDataURL(overlay) : null, count > 0 ? translate("desktop.unreadBadge", { p0: count }) : "");
  } else app.setBadgeCount(count);
  if (tray && !tray.isDestroyed()) {
    const dotted = nativeImage.createEmpty();
    if (trayDot) dotted.addRepresentation({ scaleFactor: 2, dataURL: trayDot });
    tray.setImage(trayDot && !dotted.isEmpty() ? dotted : nativeImage.createFromPath(appIcon.trayPath()));
    tray.setToolTip(count > 0 ? `Annoy (${count})` : "Annoy");
  }
});
ipcMain.on("window:flash", event => {
  if (!authorized(event)) return;
  if (win && !win.isFocused()) win.flashFrame(true);
});

app.whenReady().then(() => {
  trayCapable=supportsTray();
  createWindow();
  createTray();
  setInterval(() => void appAccess.revalidate(), 60_000).unref();
  if (win) startUpdater(win);
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
