import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app, ipcMain, session, shell, type BrowserWindow, type Session, WebContentsView } from "electron";
import { ElectronBlocker } from "@ghostery/adblocker-electron";

// Theater and song rooms play YouTube and other websites in their own view, with ads
// blocked. A preload in every frame finds the page's video so the room can keep it in
// sync: the renderer sends play/pause/seek and hears back what the viewer did.

/** "music" and "musicB" are the song room's two decks: DJ mode mixes from one into the other. */
type Slot = "theater" | "music" | "musicB";
const isMusic = (slot: Slot) => slot !== "theater";
const PARTITION = "persist:theater";
/** YouTube refuses embeds that come with no referrer. */
const REFERRER = "https://annoy.geg.dev.br/";

interface Entry {
  view: WebContentsView;
  url: string;
  /** What the app asked to play (its own link and kind), so asking again never reloads it. */
  source: string;
  /**
   * The page being replaced keeps running until the next one commits. Until then nothing goes
   * to it or comes from it: its last word ("paused at 3:36, ended") would be taken for the new
   * track's, and the room's "play at 0:01" meant for the new track would start the old one over.
   */
  stale: boolean;
}

interface OpenOptions {
  /** Seconds in: joining a room mid-song starts there instead of from the top. */
  start?: number;
  /** Load paused and silent, ready for a DJ transition to start it. */
  hold?: boolean;
}

const views = new Map<Slot, Entry>();
/** Last place the renderer asked for, kept for views that are still being created. */
const bounds = new Map<Slot, Electron.Rectangle>();
/** What each slot should show; a close during the adblock download cancels the open. */
const wanted = new Map<Slot, string>();
let window: BrowserWindow | null = null;
let blocker: Promise<ElectronBlocker | null> | null = null;

function enginePath(): string {
  return join(app.getPath("userData"), "adblock-engine.bin");
}

/** Ads and trackers lists, cached on disk so the next start works offline. */
function loadBlocker(s: Session): Promise<ElectronBlocker | null> {
  blocker ??= ElectronBlocker.fromPrebuiltAdsAndTracking(fetch, {
    path: enginePath(),
    read: async (path) => readFileSync(path),
    write: async (path, data) => writeFileSync(path, data),
  })
    .catch(() => (existsSync(enginePath()) ? ElectronBlocker.deserialize(readFileSync(enginePath())) : null))
    .then((engine) => {
      engine?.enableBlockingInSession(s);
      return engine;
    })
    .catch(() => null);
  return blocker;
}

function theaterSession(): Session {
  const s = session.fromPartition(PARTITION);
  s.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === "fullscreen"));
  s.setPermissionCheckHandler((_wc, permission) => permission === "fullscreen");
  return s;
}

/** The video id of youtube.com/watch?v=, youtu.be/, /shorts/, /live/ and /embed/ links. */
export function youtubeId(raw: string): string | null {
  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^(www|m|music)\./, "");
    let id: string | null = null;
    if (host === "youtu.be") id = url.pathname.slice(1);
    else if (host === "youtube.com" || host === "youtube-nocookie.com") {
      id = url.searchParams.get("v") ?? /^\/(embed|shorts|live)\/([\w-]+)/.exec(url.pathname)?.[2] ?? null;
    }
    return id && /^[\w-]{6,20}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/**
 * YouTube links become the bare player. Song rooms drive it entirely from the app, so their
 * player comes without controls, keyboard, annotations or fullscreen.
 */
export function youtubeEmbed(raw: string, bare = false, options: OpenOptions = {}): string | null {
  const id = youtubeId(raw);
  if (!id) return null;
  const linked = Number.parseInt(new URL(raw).searchParams.get("t") ?? "", 10);
  const start = options.start !== undefined ? Math.floor(options.start) : linked;
  const chrome = bare ? "&controls=0&disablekb=1&fs=0&iv_load_policy=3&cc_load_policy=0" : "";
  // annoy_hold is read by the theater preload only; YouTube ignores parameters it doesn't know.
  return `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&playsinline=1&rel=0${chrome}${start > 0 ? `&start=${start}` : ""}${options.hold ? "&annoy_hold=1" : ""}`;
}

/**
 * What YouTube still draws over a player without controls (title, channel avatar, logo, pause
 * overlays, end cards), hidden; and no pointer, so hovering or clicking the song room's video
 * never brings any of it back. The room's own buttons are the only controls.
 */
const BARE_PLAYER_CSS = `
.ytp-chrome-top, .ytp-chrome-bottom, .ytp-gradient-top, .ytp-gradient-bottom, .ytp-watermark,
.ytp-youtube-button, .ytp-pause-overlay, .ytp-large-play-button, .ytp-cued-thumbnail-overlay-image + .ytp-large-play-button,
.ytp-ce-element, .ytp-cards-teaser, .ytp-cards-button, .ytp-paid-content-overlay, .ytp-impression-link,
.ytp-show-cards-title, .ytp-title, .ytp-chrome-controls, .ytp-contextmenu, .ytp-tooltip, .branding-img, .iv-branding,
.ytp-embed-overlays, .ytp-overflow-button, .ytp-share-button, .ytp-watch-later-button { display: none !important; }
html, body, #player, .html5-video-player { pointer-events: none !important; cursor: default !important; }
`;

async function open(slot: Slot, raw: string, kind: string, options: OpenOptions = {}): Promise<void> {
  if (!window || !canOpen()) return;
  let url: URL;
  try {
    url = new URL(kind === "youtube" ? (youtubeEmbed(raw, isMusic(slot), options) ?? raw) : raw);
  } catch {
    return;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return;
  const source = `${kind}
${raw}`;
  const existing = views.get(slot);
  // Same media already there (maybe opened held, or at another start): keep it playing.
  if (existing?.source === source) return;
  // The page there is on its way out from now on (see Entry.stale).
  if (existing) existing.stale = true;
  wanted.set(slot, url.toString());
  const s = theaterSession();
  await loadBlocker(s);
  if (wanted.get(slot) !== url.toString() || !window || !canOpen()) return;
  let entry = views.get(slot);
  if (!entry) {
    const view = new WebContentsView({
      webPreferences: {
        partition: PARTITION,
        contextIsolation: true,
        sandbox: true,
        // Players often live in iframes; the sync preload has to reach them.
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        preload: join(import.meta.dirname, "../preload/theater.cjs"),
        backgroundThrottling: false,
        autoplayPolicy: "no-user-gesture-required",
      },
    });
    view.setBackgroundColor("#000000");
    // Song rooms usually play with the view hidden (the room shows the cover): give the page a
    // real viewport anyway, or it lays out at 0×0 and players treat it as having no screen.
    view.setBounds({ x: 0, y: 0, width: 640, height: 360 });
    const wc = view.webContents;
    // Pop-ups are the classic ad trick on streaming sites: never open windows.
    wc.setWindowOpenHandler(() => ({ action: "deny" }));
    wc.on("page-title-updated", (_e, title) => window?.webContents.send("theater:title", slot, title));
    if (isMusic(slot)) wc.on("dom-ready", () => { if (/^https:\/\/www\.youtube(-nocookie)?\.com\/embed\//.test(wc.getURL())) void wc.insertCSS(BARE_PLAYER_CSS).catch(() => {}); });
    const made: Entry = { view, url: "", source: "", stale: false };
    // The new page took over (or the load failed for good): it speaks for the slot from here on.
    wc.on("did-navigate", () => { made.stale = false; });
    wc.on("did-fail-load", (_e, code, _description, _url, mainFrame) => { if (mainFrame && code !== -3) made.stale = false; });
    window.contentView.addChildView(view);
    entry = made;
    views.set(slot, entry);
    place(slot);
  }
  // Only a new link fragment keeps the same page (no commit follows); anything else replaces it.
  const keepsPage = url.hash !== "" && entry.view.webContents.getURL().split("#")[0] === url.toString().split("#")[0];
  entry.url = url.toString();
  entry.source = source;
  entry.stale = !keepsPage;
  void entry.view.webContents.loadURL(entry.url, { httpReferrer: REFERRER }).catch(() => {});
}

function place(slot: Slot): void {
  const entry = views.get(slot);
  const rect = bounds.get(slot);
  if (!entry) return;
  const visible = !!rect && rect.width > 1 && rect.height > 1;
  entry.view.setVisible(visible);
  if (visible) entry.view.setBounds(rect);
}

function close(slot: Slot): void {
  wanted.delete(slot);
  const entry = views.get(slot);
  if (!entry) return;
  window?.contentView.removeChildView(entry.view);
  entry.view.webContents.close();
  views.delete(slot);
}

const slotOf = (raw: unknown): Slot | null => (raw === "theater" || raw === "music" || raw === "musicB" ? raw : null);

export function closeAllTheater(): void {
  close("theater");
  close("music");
  close("musicB");
}
let canOpen = () => false;
let registered = false;

export function registerTheater(win: BrowserWindow, allowed: () => boolean): void {
  canOpen = allowed;
  window = win;
  views.clear();
  if (registered) return;
  registered = true;
  const fromApp = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => event.sender === window?.webContents && event.senderFrame === window?.webContents.mainFrame;

  ipcMain.on("theater:open", (event, slot: unknown, url: unknown, kind: unknown, options: unknown) => {
    const s = slotOf(slot);
    if (!canOpen() || !fromApp(event) || !s || typeof url !== "string" || typeof kind !== "string") return;
    const raw = options && typeof options === "object" ? options as Record<string, unknown> : {};
    const start = typeof raw.start === "number" && Number.isFinite(raw.start) && raw.start > 0 && raw.start < 86400 ? raw.start : undefined;
    void open(s, url, kind, { start, hold: raw.hold === true });
  });
  ipcMain.on("theater:close", (event, slot: unknown) => {
    const s = slotOf(slot);
    if (fromApp(event) && s) close(s);
  });
  ipcMain.on("theater:bounds", (event, slot: unknown, rect: unknown) => {
    const s = slotOf(slot);
    if (!fromApp(event) || !s || !rect || typeof rect !== "object") return;
    const { x, y, width, height } = rect as Record<string, unknown>;
    if (typeof x !== "number" || typeof y !== "number" || typeof width !== "number" || typeof height !== "number") return;
    if (![x, y, width, height].every((n) => Number.isFinite(n))) return;
    bounds.set(s, { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) });
    place(s);
  });
  ipcMain.on("theater:control", (event, slot: unknown, command: unknown) => {
    const entry = views.get(slotOf(slot) as Slot);
    if (!fromApp(event) || !entry || entry.stale || !command || typeof command !== "object") return;
    for (const frame of entry.view.webContents.mainFrame.framesInSubtree) {
      try {
        frame.send("theater:control", command);
      } catch {
        // Frame went away mid-loop.
      }
    }
  });
  ipcMain.on("theater:open-external", (event, slot: unknown) => {
    const entry = views.get(slotOf(slot) as Slot);
    if (fromApp(event) && entry) void shell.openExternal(entry.view.webContents.getURL());
  });

  // From the pages: forwarded to the app with the slot they came from. A page on its way out has nothing to say.
  const slotOfSender = (sender: Electron.WebContents) => [...views].find(([, e]) => e.view.webContents === sender && !e.stale)?.[0];

  // The song room's visualizer: a small spectrum about 20 times a second, music slot only.
  ipcMain.on("theater:levels", (event, payload: unknown) => {
    const slot = slotOfSender(event.sender);
    if (!slot || !isMusic(slot) || !payload || typeof payload !== "object") return;
    const { position, levels, vr, vl } = payload as Record<string, unknown>;
    if (typeof position !== "number" || !Number.isFinite(position) || !Array.isArray(levels) || levels.length > 64) return;
    if (!levels.every((level) => typeof level === "number" && level >= 0 && level <= 255)) return;
    // How much singing there is, for lining the lyrics up (absent for mono media).
    const voice = typeof vr === "number" && typeof vl === "number" && Number.isFinite(vr) && Number.isFinite(vl) && Math.abs(vr) <= 60 && vl >= -200 && vl <= 40 ? { vr, vl } : {};
    window?.webContents.send("theater:levels", slot, { position, levels, ...voice });
  });
  for (const channel of ["theater:status", "theater:user", "theater:ended"]) {
    ipcMain.on(channel, (event, payload: unknown) => {
      const slot = slotOfSender(event.sender);
      if (slot && payload && typeof payload === "object") {
        const value=payload as Record<string,unknown>;
        if (typeof value.position!=="number" || !Number.isFinite(value.position) || value.position<0 || value.position>8640000) return;
        if (channel==="theater:user" && !["play","pause","seek"].includes(String(value.action))) return;
        const duration=typeof value.duration==="number" && Number.isFinite(value.duration) && value.duration>0 && value.duration<=8640000 ? value.duration : null;
        // Song rooms' DJ: whether the media finished, and how loud its last second was (dBFS).
        const extra=channel!=="theater:status"?{}:{duration,...(typeof value.ended==="boolean"?{ended:value.ended}:{}),...(typeof value.loud==="number" && Number.isFinite(value.loud) && value.loud>=-200 && value.loud<=20 && isMusic(slot)?{loud:value.loud}:{})};
        window?.webContents.send(channel, slot, {position:value.position,...(typeof value.action==="string"?{action:value.action}:{}),...(typeof value.paused==="boolean"?{paused:value.paused}:{}),...extra});
      }
    });
  }
}
