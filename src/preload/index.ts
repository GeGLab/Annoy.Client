import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { Service } from "../shared/services.ts";
import type { UpdateState } from "../shared/update.ts";
import type { ActivityPreferences, DesktopActivitySnapshot } from "../shared/activity.ts";

export type TheaterSlot = "theater" | "music";
export interface TheaterEvents {
  status: { position: number; duration: number | null; paused: boolean; ended: boolean };
  user: { action: "play" | "pause" | "seek"; position: number };
  ended: { position: number };
  title: string;
}

const bridge = {
  platform: process.platform,
  idleSeconds: () => ipcRenderer.invoke("system:idle") as Promise<number>,
  activity: {
    configure: (preferences: ActivityPreferences) =>
      ipcRenderer.invoke("activity:configure", preferences) as Promise<DesktopActivitySnapshot>,
    get: () => ipcRenderer.invoke("activity:get") as Promise<DesktopActivitySnapshot>,
    gameIcon: (appId: string) => ipcRenderer.invoke("activity:game-icon", appId) as Promise<string | null>,
    onSnapshot(listener: (snapshot: DesktopActivitySnapshot) => void): () => void {
      const handler = (_event: IpcRendererEvent, snapshot: DesktopActivitySnapshot) => listener(snapshot);
      ipcRenderer.on("activity:snapshot", handler);
      return () => ipcRenderer.off("activity:snapshot", handler);
    },
  },
  /** Appends to errors.log in the app's data folder; nothing leaves the computer. */
  logError: (text: string) => ipcRenderer.send("log:error", text),
  /** Kept by the OS keychain; null when there's none (the value isn't stored then). */
  secrets: {
    get: (name: "global") => ipcRenderer.invoke("secrets:get", name) as Promise<string | null>,
    set: (name: "global", value: string | null) => ipcRenderer.invoke("secrets:set", name, value) as Promise<boolean>,
  },
  window: {
    minimize: () => ipcRenderer.send("window:control", "minimize"),
    maximize: () => ipcRenderer.send("window:control", "maximize"),
    close: () => ipcRenderer.send("window:control", "close"),
    isMaximized: () => ipcRenderer.invoke("window:maximized") as Promise<boolean>,
    onMaximized(listener: (maximized: boolean) => void): () => void {
      const handler = (_event: IpcRendererEvent, maximized: boolean) => listener(maximized);
      ipcRenderer.on("window:maximized", handler);
      return () => ipcRenderer.off("window:maximized", handler);
    },
  },
  flashWindow: () => ipcRenderer.send("window:flash"),
  services: {
    show: (service: Service) => ipcRenderer.send("service:show", { id: service.id, kind: service.kind, name: service.name, url: service.url }),
    hide: () => ipcRenderer.send("service:hide"),
    reload: (id: string) => ipcRenderer.send("service:reload", id),
    /** Closes the view and clears its login. */
    remove: (id: string) => ipcRenderer.invoke("service:remove", id) as Promise<void>,
    /** Where the native view goes: the page's main area, in window coordinates. */
    setBounds: (rect: { x: number; y: number; width: number; height: number }) => ipcRenderer.send("service:bounds", rect),
    onBadge(listener: (id: string, badge: string | null) => void): () => void {
      const handler = (_e: IpcRendererEvent, id: string, badge: string | null) => listener(id, badge);
      ipcRenderer.on("service:badge", handler);
      return () => ipcRenderer.off("service:badge", handler);
    },
  },
  /** Theater and song rooms: YouTube and websites in a native view, ads blocked. */
  theater: {
    open: (slot: TheaterSlot, url: string, kind: string) => ipcRenderer.send("theater:open", slot, url, kind),
    close: (slot: TheaterSlot) => ipcRenderer.send("theater:close", slot),
    /** Window coordinates; an empty rect hides the view. */
    setBounds: (slot: TheaterSlot, rect: { x: number; y: number; width: number; height: number }) => ipcRenderer.send("theater:bounds", slot, rect),
    control: (slot: TheaterSlot, command: { action: "play" | "pause" | "seek"; position?: number }) => ipcRenderer.send("theater:control", slot, command),
    openExternal: (slot: TheaterSlot) => ipcRenderer.send("theater:open-external", slot),
    on<K extends keyof TheaterEvents>(name: K, listener: (slot: TheaterSlot, payload: TheaterEvents[K]) => void): () => void {
      const handler = (_e: IpcRendererEvent, slot: TheaterSlot, payload: TheaterEvents[K]) => listener(slot, payload);
      ipcRenderer.on(`theater:${name}`, handler);
      return () => ipcRenderer.off(`theater:${name}`, handler);
    },
  },
  /** Saves an http(s) file through the system's save dialog. */
  download: (url: string) => ipcRenderer.send("file:download", url),
  openTeamSpeak: (link: string) => ipcRenderer.send("teamspeak:open", link),
  screen: {
    /** "system": the OS portal picks the source (Wayland); "app": show Annoy's own picker. */
    mode: () => ipcRenderer.invoke("screen:mode") as Promise<"system" | "app">,
    sources: () =>
      ipcRenderer.invoke("screen:sources") as Promise<{ id: string; name: string; kind: "screen" | "window"; thumbnail: string }[]>,
    choose: (id: string) => ipcRenderer.send("screen:choose", id),
  },
  updates: {
    get: () => ipcRenderer.invoke("update:get") as Promise<UpdateState>,
    check: () => ipcRenderer.invoke("update:check") as Promise<void>,
    download: () => ipcRenderer.invoke("update:download") as Promise<void>,
    install: () => ipcRenderer.invoke("update:install") as Promise<void>,
    onState(listener: (state: UpdateState) => void): () => void {
      const handler = (_e: IpcRendererEvent, state: UpdateState) => listener(state);
      ipcRenderer.on("update:state", handler);
      return () => ipcRenderer.off("update:state", handler);
    },
  },
};

export type DistopicBridge = typeof bridge;

contextBridge.exposeInMainWorld("distopic", bridge);
