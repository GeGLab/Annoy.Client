import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type {DesktopPreferences,DesktopSnapshot} from "../shared/desktop.ts";
import type { Service } from "../shared/services.ts";
import type { AppIcon } from "../shared/app-icon.ts";
import type { AppAccessState } from "../shared/app-access.ts";
import type { UpdateState } from "../shared/update.ts";
import type { UpdateChannel, UpdateChannelInfo } from "../shared/update-channels.ts";
import type { ActivityPreferences, DesktopActivitySnapshot } from "../shared/activity.ts";
import type { OverlayMenuPick, OverlayMenuSpec } from "../shared/overlay-menu.ts";
import type { IntegrationRequest, IntegrationResponse } from "../main/integrations/http.ts";
import type { VpngoApplied, VpngoRoutes, VpngoStatus } from "../main/integrations/vpngo.ts";

export type TheaterSlot = "theater" | "music";
export interface TheaterEvents {
  status: { position: number; duration: number | null; paused: boolean; ended: boolean };
  user: { action: "play" | "pause" | "seek"; position: number };
  ended: { position: number };
  title: string;
}

const bridge = {
  desktop: {
    get:()=>ipcRenderer.invoke("desktop:get") as Promise<DesktopSnapshot>,
    set:(values:DesktopPreferences)=>ipcRenderer.invoke("desktop:set",values) as Promise<DesktopSnapshot>,
    restart:()=>ipcRenderer.invoke("desktop:restart") as Promise<void>,
    quit:()=>ipcRenderer.invoke("desktop:quit") as Promise<void>,
    onQuitRequested(listener:()=>void):()=>void{const handler=()=>listener();ipcRenderer.on("desktop:quit-requested",handler);return()=>{ipcRenderer.off("desktop:quit-requested",handler);};},
  },
  appIcon: {
    set: (icon: AppIcon) => ipcRenderer.invoke("app-icon:set", icon) as Promise<AppIcon>,
  },
  localization: {
    get: () => ipcRenderer.invoke("localization:get") as Promise<{saved:LocalizationPreferences;systemLocale:string}>,
    set: (values:LocalizationPreferences) => ipcRenderer.invoke("localization:set",values) as Promise<LocalizationPreferences>,
  },
  platform: process.platform,
  /** Linux only: the device name of a virtual microphone with the computer's sound minus Annoy's, or null. */
  screenAudio: {
    start: () => ipcRenderer.invoke("screen-audio:start") as Promise<string | null>,
    stop: () => ipcRenderer.invoke("screen-audio:stop") as Promise<void>,
  },

  auth: {
    get: () => ipcRenderer.invoke("auth:get") as Promise<AppAccessState>,
    globalUrl: () => ipcRenderer.invoke("auth:global-url") as Promise<string>,
    authUrl: () => ipcRenderer.invoke("auth:auth-url") as Promise<string>,
    wipe: (serviceIds: string[]) => ipcRenderer.invoke("auth:wipe", serviceIds) as Promise<void>,
    cloudUrls: () => ipcRenderer.invoke("auth:cloud-urls") as Promise<{ users: string; chat: string; cdn: string; dev: string }>,
    global: (token: string) => ipcRenderer.invoke("auth:global", token) as Promise<{ id: string; name: string; email: string; cryptoMigrationRequired?:boolean }>,
    local: async (account: { id: string; url: string; token: string; userId: string }): Promise<void> => {
      const response = await ipcRenderer.invoke("auth:local", account) as { ok: true } | { ok: false; message: string };
      if (!response.ok) throw new Error(response.message);
    },
    logoutGlobal: () => ipcRenderer.invoke("auth:logout-global") as Promise<void>,
    logoutLocal: (id: string, lock=true) => ipcRenderer.invoke("auth:logout-local", id, lock) as Promise<void>,
    onState(listener: (state: AppAccessState) => void): () => void {
      const handler = (_event: IpcRendererEvent, state: AppAccessState) => listener(state);
      ipcRenderer.on("auth:state", handler);
      return () => ipcRenderer.off("auth:state", handler);
    },
  },

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
  /** Store integrations: calls leave this computer from the main process (public HTTPS only). */
  integrations: {
    request: (input: IntegrationRequest) => ipcRenderer.invoke("integrations:request", input) as Promise<IntegrationResponse>,
  },
  /** VPNGo integration: connections to chosen annoy-servers go through a VPNGo profile. */
  vpngo: {
    status: () => ipcRenderer.invoke("vpngo:status") as Promise<VpngoStatus>,
    apply: (routes: VpngoRoutes) => ipcRenderer.invoke("vpngo:apply", routes) as Promise<VpngoApplied>,
    voice: (host: string | null) => ipcRenderer.invoke("vpngo:voice", host) as Promise<boolean>,
  },
  /** Appends to errors.log in the app's data folder; nothing leaves the computer. */
  logError: (text: string) => ipcRenderer.send("log:error", text),
  /** Kept by the OS keychain; null when there's none (the value isn't stored then). */
  secrets: {
    get: (name: "global" | "accounts") => ipcRenderer.invoke("secrets:get", name) as Promise<string | null>,
    set: (name: "global" | "accounts", value: string | null) => ipcRenderer.invoke("secrets:set", name, value) as Promise<boolean>,
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
  /** Context menus drawn in a transparent layer above browser services; resolves with the chosen row. */
  overlayMenu: {
    open: (spec: OverlayMenuSpec) => ipcRenderer.invoke("overlay-menu:open", spec) as Promise<OverlayMenuPick | null>,
  },
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
  downloadPrivate: (baseUrl:string,token:string,path:string,name:string)=>ipcRenderer.invoke("file:private-download",{baseUrl,token,path,name}) as Promise<{saved:boolean}>,
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
    configure:(values:{notifications:boolean;channel?:UpdateChannel})=>ipcRenderer.invoke("update:configure",values) as Promise<void>,
    channel:()=>ipcRenderer.invoke("update:channel") as Promise<UpdateChannelInfo>,
    /** Go to the selected channel now, even to an older version (asks the user first in the renderer). */
    leaveChannel:()=>ipcRenderer.invoke("update:leave-channel") as Promise<UpdateChannelInfo>,
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

export type AnnoyBridge = typeof bridge;

contextBridge.exposeInMainWorld("annoy", bridge);
import type {LocalizationPreferences} from "../shared/localization/preferences.ts";
