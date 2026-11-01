import {trustedRenderer} from './trusted-renderer.ts';
import {secureHttpUrl} from '../shared/transport.ts';
import {nativeApiFetch} from './native-api-fetch.ts';
import {registerPrivateDownload} from './private-download.ts';
import { registerCrypto } from "./crypto/ipc.ts";
import { appendFileSync, existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app, BrowserWindow, clipboard, dialog, desktopCapturer, ipcMain, powerMonitor, safeStorage, session, shell, Tray, Menu, WebContentsView, type Session } from "electron";
import { sitesFor, type Service } from "../shared/services.ts";
import { startUpdater } from "./updater.ts";
import { registerActivity } from "./activity/index.ts";
import { createAppAccess } from "./app-access.ts";
import { registerTheater, closeAllTheater } from "./theater.ts";

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
const stopActivity = registerActivity(ipcMain, () => win, () => appAccess.getState().allowed, event => trustedRenderer(event, win));
app.on("before-quit", stopActivity);
/** One sandboxed view per browser service, created on first open and kept alive. */
const views = new Map<string, { view: WebContentsView; service: Service }>();
let shownService: string | null = null;
const serviceWindows = new Set<BrowserWindow>();
const globalUrl = (process.env.ANNOY_GLOBAL_URL || "https://global.geg.dev.br").replace(/\/+$/, "");
let resettingRenderer = false;
let stopCrypto = () => {};
let proofCrypto:((url:string,token:string,method:string,path:string,nonce?:string)=>Promise<string|null>)|null=null;
const appAccess = createAppAccess(globalUrl, state => {
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
 const url=secureHttpUrl(String(input)),original=new Headers(init?.headers),token=original.get("authorization")?.match(/^(?:Bearer|DPoP) (.+)$/)?.[1];
 const execute=async(nonce?:string)=>{const headers=new Headers(original);
  if(token&&url.pathname.startsWith("/api/")&&proofCrypto){const proof=await proofCrypto(url.origin,token,init?.method??"GET",url.pathname+url.search,nonce);if(proof){headers.set("authorization","DPoP "+token);headers.set("dpop",proof);}}
  return nativeApiFetch(input,{...init,headers,redirect:'error'});};
 let response=await execute();const nonce=response.headers.get("dpop-nonce");
 if(response.status===401&&token&&nonce&&/^[A-Za-z0-9_-]{43}$/.test(nonce)){await response.body?.cancel();response=await execute(nonce);}
 return response;
}

const fromRenderer = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) =>
  trustedRenderer(event,win);
const authorized = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => fromRenderer(event) && appAccess.getState().allowed;
const stopDownloads=registerPrivateDownload(()=>win,authorized,authenticatedMainFetch);
app.on("before-quit",stopDownloads);

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
  const granted = new Set<string>();
  const trusted = (wc:Electron.WebContents|null,origin:string) => {
    if (!wc || !appAccess.getState().allowed) return false;
    if (own) return wc === win?.webContents;
    const entry=[...views.values()].find(e=>e.view.webContents===wc);
    return !!entry && inSites(origin,sitesFor(entry.service)) && shownService===entry.service.id;
  };
  s.setPermissionRequestHandler(async (wc,permission,callback,details) => {
    const origin=details.requestingUrl||wc.getURL();
    if (!trusted(wc,origin) || !MEDIA_PERMISSIONS.has(permission)) return callback(false);
    if (['fullscreen','clipboard-sanitized-write','speaker-selection'].includes(permission)) return callback(true);
    const key=origin+'|'+permission;
    if(granted.has(key))return callback(true);
    const result=await dialog.showMessageBox(win!,{type:'question',message:'Permitir '+permission+'?',detail:own?'Solicitado pelo Annoy.':origin,buttons:['Negar','Permitir'],defaultId:0,cancelId:0});
    if(result.response===1 && trusted(wc,origin)){granted.add(key);callback(true);}else callback(false);
  });
  s.setPermissionCheckHandler((wc,permission,origin) => trusted(wc,origin) && (['fullscreen','clipboard-sanitized-write','speaker-selection'].includes(permission)||granted.has(origin+'|'+permission)));
  s.setDisplayMediaRequestHandler(
    async (request, callback) => {
      if (!appAccess.getState().allowed) { callback({}); return; }
      const sources = await desktopCapturer.getSources({ types: ["screen", "window"] });
      // Annoy's own UI picks a source first; services (and the portal case) take what the system offers.
      let picked = own && chosenScreenSource ? sources.find((src) => src.id === chosenScreenSource) : undefined;
      if (!picked && win) {
        const offered=sources.slice(0,20);
        const choice=await dialog.showMessageBox(win,{type:'question',message:'Escolha o conteúdo para compartilhar',buttons:['Cancelar',...offered.map(source=>source.name)],defaultId:0,cancelId:0});
        if(choice.response>0)picked=offered[choice.response-1];
      }
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
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      backgroundThrottling: false,
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
  // A crashed or killed renderer leaves an empty window; bring the app back.
  win.webContents.on("render-process-gone", (_event, details) => {
    logError(`renderer gone: ${details.reason} (exit ${details.exitCode})`);
    if (details.reason !== "clean-exit") win?.webContents.reload();
  });
  registerTheater(win, () => appAccess.getState().allowed);
  const resetRendererAccess = () => {
    // Close native pages without sending a logout into the departing document.
    resettingRenderer = true;
    stopCrypto();
    try { appAccess.reset(); } finally { resettingRenderer = false; }
  };
  win.webContents.on("did-start-loading", resetRendererAccess);
  win.webContents.on("render-process-gone", resetRendererAccess);
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
  if (!fromRenderer(event) || typeof name !== "string" || !SECRET_NAMES.has(name) || !keychainAvailable()) return null;
  const sealed = readSecrets()[name];
  try {
    return sealed ? safeStorage.decryptString(Buffer.from(sealed, "base64")) : null;
  } catch {
    return null;
  }
});
ipcMain.handle("secrets:set", (event, name: unknown, value: unknown) => {
  if (!fromRenderer(event) || typeof name !== "string" || !SECRET_NAMES.has(name)) return false;
  const all = readSecrets();
  if (typeof value === "string" && keychainAvailable()) all[name] = safeStorage.encryptString(value).toString("base64");
  else delete all[name];
  writeFileSync(secretsFile(), JSON.stringify(all), { mode: 0o600 });
  return name in all;
});

// Native browsing stays locked until credentials are independently validated here.
ipcMain.handle("auth:get", event => fromRenderer(event) ? appAccess.getState() : { allowed: false, global: false, localAccounts: [] });
ipcMain.handle("auth:global-url", event => fromRenderer(event) ? globalUrl : null);
ipcMain.handle("auth:global", (event, token: unknown) => {
  if (!fromRenderer(event)) throw new Error("Invalid authentication sender");
  return appAccess.verifyGlobal(token);
});
ipcMain.handle("auth:local", (event, account: unknown) => {
  if (!fromRenderer(event)) throw new Error("Invalid authentication sender");
  return appAccess.verifyLocal(account);
});
ipcMain.handle("auth:logout-global", event => { if (fromRenderer(event)) {stopCrypto();appAccess.revokeGlobal();} });
ipcMain.handle("auth:logout-local", (event, id: unknown, lock:unknown=true) => { if (fromRenderer(event) && typeof id === "string") {if(lock!==false)stopCrypto();appAccess.revokeLocal(id);} });

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
ipcMain.on("window:flash", event => {
  if (!authorized(event)) return;
  if (win && !win.isFocused()) win.flashFrame(true);
});

app.whenReady().then(() => {
  createWindow();
  const crypto=registerCrypto(() => win, () => appAccess.getState().allowed);
  stopCrypto = crypto; proofCrypto=crypto.proof;
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
