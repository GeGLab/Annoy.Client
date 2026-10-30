import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app, ipcMain, session, shell, type BrowserWindow, type Session, WebContentsView } from "electron";
import { ElectronBlocker } from "@ghostery/adblocker-electron";

// Theater and song rooms play YouTube and other websites in their own view, with ads
// blocked. A preload in every frame finds the page's video so the room can keep it in
// sync: the renderer sends play/pause/seek and hears back what the viewer did.

type Slot = "theater" | "music";
const PARTITION = "persist:theater";
/** YouTube refuses embeds that come with no referrer. */
const REFERRER = "https://annoy.geg.dev.br/";

interface Entry {
  view: WebContentsView;
  url: string;
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

/** youtube.com/watch?v=, youtu.be/, /shorts/ and /embed/ links become the bare player. */
export function youtubeEmbed(raw: string): string | null {
  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^(www|m|music)\./, "");
    let id: string | null = null;
    if (host === "youtu.be") id = url.pathname.slice(1);
    else if (host === "youtube.com" || host === "youtube-nocookie.com") {
      id = url.searchParams.get("v") ?? /^\/(embed|shorts|live)\/([\w-]+)/.exec(url.pathname)?.[2] ?? null;
    }
    if (!id || !/^[\w-]{6,20}$/.test(id)) return null;
    const start = Number.parseInt(url.searchParams.get("t") ?? "", 10);
    return `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&playsinline=1&rel=0${start > 0 ? `&start=${start}` : ""}`;
  } catch {
    return null;
  }
}

async function open(slot: Slot, raw: string, kind: string): Promise<void> {
  if (!window) return;
  let url: URL;
  try {
    url = new URL(kind === "youtube" ? (youtubeEmbed(raw) ?? raw) : raw);
  } catch {
    return;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return;
  const existing = views.get(slot);
  if (existing?.url === url.toString()) return;
  wanted.set(slot, url.toString());
  const s = theaterSession();
  await loadBlocker(s);
  if (wanted.get(slot) !== url.toString() || !window) return;
  let entry = views.get(slot);
  if (!entry) {
    const view = new WebContentsView({
      webPreferences: {
        partition: PARTITION,
        contextIsolation: true,
        sandbox: true,
        // Players often live in iframes; the sync preload has to reach them.
        nodeIntegrationInSubFrames: true,
        preload: join(import.meta.dirname, "../preload/theater.cjs"),
        backgroundThrottling: false,
        autoplayPolicy: "no-user-gesture-required",
      },
    });
    view.setBackgroundColor("#000000");
    const wc = view.webContents;
    // Pop-ups are the classic ad trick on streaming sites: never open windows.
    wc.setWindowOpenHandler(() => ({ action: "deny" }));
    wc.on("page-title-updated", (_e, title) => window?.webContents.send("theater:title", slot, title));
    window.contentView.addChildView(view);
    entry = { view, url: "" };
    views.set(slot, entry);
    place(slot);
  }
  entry.url = url.toString();
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

const slotOf = (raw: unknown): Slot | null => (raw === "theater" || raw === "music" ? raw : null);

let registered = false;

export function registerTheater(win: BrowserWindow): void {
  window = win;
  views.clear();
  if (registered) return;
  registered = true;
  const fromApp = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => event.sender === window?.webContents;

  ipcMain.on("theater:open", (event, slot: unknown, url: unknown, kind: unknown) => {
    const s = slotOf(slot);
    if (fromApp(event) && s && typeof url === "string" && typeof kind === "string") void open(s, url, kind);
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
    if (!fromApp(event) || !entry || !command || typeof command !== "object") return;
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

  // From the pages: forwarded to the app with the slot they came from.
  const slotOfSender = (sender: Electron.WebContents) => [...views].find(([, e]) => e.view.webContents === sender)?.[0];
  for (const channel of ["theater:status", "theater:user", "theater:ended"]) {
    ipcMain.on(channel, (event, payload: unknown) => {
      const slot = slotOfSender(event.sender);
      if (slot && payload && typeof payload === "object") window?.webContents.send(channel, slot, payload);
    });
  }
}
