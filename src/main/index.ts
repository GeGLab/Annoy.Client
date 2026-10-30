import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app, BrowserWindow, clipboard, desktopCapturer, ipcMain, powerMonitor, safeStorage, session, shell, Tray, Menu, WebContentsView, type Session } from "electron";
import { sitesFor, type Service } from "../shared/services.ts";
import { startUpdater } from "./updater.ts";
import { registerActivity } from "./activity/index.ts";

const MEDIA_PERMISSIONS = new Set(["media", "display-capture", "notifications", "fullscreen", "clipboard-sanitized-write", "speaker-selection"]);

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
app.on("before-quit", () => { quitting = true; });
function restoreWindow(): void {
  if (!win) return;
  win.show();
  if (win.isMinimized()) win.restore();
  win.focus();
}
function createTray(): void {
  if (process.platform !== "win32") return;
  tray = new Tray(join(import.meta.dirname, "../renderer/icon.png"));
  tray.setToolTip("Annoy");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Abrir Annoy", click: restoreWindow },
    { type: "separator" },
    { label: "Sair do Annoy", click: () => app.quit() },
  ]));
  tray.on("double-click", restoreWindow);
}
const stopActivity = registerActivity(ipcMain, () => win);
app.on("before-quit", stopActivity);
/** One sandboxed view per browser service, created on first open and kept alive. */
const views = new Map<string, { view: WebContentsView; service: Service }>();
let shownService: string | null = null;
/** The page's main area, reported by the renderer: the bar can sit on the side or on top, with banners above. */
let serviceArea = { x: 0, y: 0, width: 0, height: 0 };

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
// Chromium picks the keychain by desktop name and falls back to no encryption
// on ones it doesn't know (Hyprland, Sway…), even with a Secret Service running
// (KWallet's ksecretd, GNOME Keyring, KeePassXC). Ask for it by its standard
// interface there; without one, Chromium still falls back. Existing cookies
// (service logins) keep working either way.
if (process.platform === "linux" && !app.commandLine.hasSwitch("password-store") && !/KDE|GNOME|Unity|Cinnamon|Pantheon|XFCE|Deepin/i.test(process.env.XDG_CURRENT_DESKTOP ?? "")) {
  app.commandLine.appendSwitch("password-store", "gnome-libsecret");
}
// Windows only shows notifications for apps with an explicit AppUserModelID; it must match build.appId.
if (process.platform === "win32") app.setAppUserModelId("br.dev.geg.distopic");

if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => {
  restoreWindow();
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
    async (request, callback) => {
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
      { label: "Copiar imagem", click: () => wc.copyImageAt(params.x, params.y) },
      { label: "Salvar imagem como…", click: () => wc.downloadURL(params.srcURL) },
    );
    if (/^https?:/.test(params.srcURL)) {
      items.push(
        { label: "Copiar endereço da imagem", click: () => clipboard.writeText(params.srcURL) },
        { label: "Abrir original", click: () => openExternal(params.srcURL) },
      );
    }
  }
  if (params.linkURL && /^https?:/.test(params.linkURL) && params.linkURL !== params.srcURL) {
    if (items.length) items.push({ type: "separator" });
    items.push({ label: "Copiar link", click: () => clipboard.writeText(params.linkURL) });
  }
  if (params.isEditable) {
    if (items.length) items.push({ type: "separator" });
    items.push(
      { label: "Recortar", role: "cut", enabled: params.editFlags.canCut },
      { label: "Copiar", role: "copy", enabled: params.editFlags.canCopy },
      { label: "Colar", role: "paste", enabled: params.editFlags.canPaste },
      { type: "separator" },
      { label: "Selecionar tudo", role: "selectAll" },
    );
  } else if (params.selectionText.trim()) {
    if (items.length) items.push({ type: "separator" });
    items.push({ label: "Copiar", role: "copy" });
  }
  if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
}

function createWindow(): void {
  configureSession(session.defaultSession, true);
  win = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 940,
    minHeight: 560,
    backgroundColor: "#171621",
    title: "Annoy",
    titleBarStyle: "hidden",
    ...(process.platform === "darwin" ? { trafficLightPosition: { x: 14, y: 12 } } : { frame: false }),
    icon: join(import.meta.dirname, "../renderer/icon.png"),

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
  win.webContents.on("context-menu", (_event, params) => showNativeMenu(params));
  const sendWindowState = () => win?.webContents.send("window:maximized", win.isMaximized());
  win.on("maximize", sendWindowState);
  win.on("unmaximize", sendWindowState);
  win.on("close", (event) => {
    if (process.platform === "win32" && tray && !quitting) {
      event.preventDefault();
      win?.hide();
    }
  });
  win.on("closed", () => {
    win = null;
    views.clear();
    shownService = null;
  });

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(join(import.meta.dirname, "../renderer/index.html"));
}

// Secrets the renderer keeps across restarts (the Annoy Global keys), sealed by
// the OS keychain. Without a real keychain nothing is written: the app asks for
// the password again next time instead of storing keys in the clear.
const SECRET_NAMES = new Set(["global"]);
const secretsFile = () => join(app.getPath("userData"), "secrets.json");
const keychainAvailable = () =>
  safeStorage.isEncryptionAvailable() && (process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text");
function readSecrets(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(secretsFile(), "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}
ipcMain.handle("secrets:get", (event, name: unknown) => {
  if (event.sender !== win?.webContents || typeof name !== "string" || !SECRET_NAMES.has(name) || !keychainAvailable()) return null;
  const sealed = readSecrets()[name];
  try {
    return sealed ? safeStorage.decryptString(Buffer.from(sealed, "base64")) : null;
  } catch {
    return null;
  }
});
ipcMain.handle("secrets:set", (event, name: unknown, value: unknown) => {
  if (event.sender !== win?.webContents || typeof name !== "string" || !SECRET_NAMES.has(name)) return false;
  const all = readSecrets();
  if (typeof value === "string" && keychainAvailable()) all[name] = safeStorage.encryptString(value).toString("base64");
  else delete all[name];
  writeFileSync(secretsFile(), JSON.stringify(all), { mode: 0o600 });
  return name in all;
});

// Only the local, isolated renderer may control the desktop window.
ipcMain.on("window:control", (event, action: unknown) => {
  if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) return;
  if (action === "minimize") win.minimize();
  else if (action === "maximize") win.isMaximized() ? win.unmaximize() : win.maximize();
  else if (action === "close") win.close();
});
ipcMain.handle("system:idle", (event) => event.sender === win?.webContents ? powerMonitor.getSystemIdleTime() : 0);
ipcMain.handle("window:maximized", (event) => event.sender === win?.webContents && win.isMaximized());

ipcMain.on("service:show", (_e, raw: unknown) => {
  const service = parseService(raw);
  if (service) showService(service);
});
ipcMain.on("service:hide", () => showService(null));
ipcMain.on("service:reload", (_e, id: unknown) => {
  if (typeof id === "string") views.get(id)?.view.webContents.reload();
});
ipcMain.handle("service:remove", (_e, id: unknown) => (typeof id === "string" ? removeService(id) : undefined));
ipcMain.on("service:bounds", (_e, raw: unknown) => {
  const r = (raw ?? {}) as Record<string, unknown>;
  const px = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);
  serviceArea = { x: px(r.x), y: px(r.y), width: px(r.width), height: px(r.height) };
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
  createTray();
  if (win) startUpdater(win);
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
