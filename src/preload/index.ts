import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { Service } from "../shared/services.ts";
import type { AppAccessState } from "../shared/app-access.ts";
import type { UpdateState } from "../shared/update.ts";
import type { ActivityPreferences, DesktopActivitySnapshot } from "../shared/activity.ts";

export type TheaterSlot = "theater" | "music";
export interface TheaterEvents {
  status: { position: number; duration: number | null; paused: boolean; ended: boolean };
  user: { action: "play" | "pause" | "seek"; position: number };
  ended: { position: number };
  title: string;
}

async function cryptoInvoke(channel:string,payload:unknown):Promise<any>{
 const response=await ipcRenderer.invoke(channel,payload) as {ok:boolean;value?:unknown;name?:string;message?:string};
 if(!response?.ok){const error=new Error(response?.message??'Serviço criptográfico indisponível');error.name=response?.name??'Error';throw error;}
 return response.value;
}
// The SFrame key port goes straight to the page, which transfers it to its worker.
ipcRenderer.on("media:port", (event, data: { handle?: unknown }) => {
  if (typeof data?.handle === "string" && event.ports[0]) window.postMessage({ annoyMediaPort: data.handle }, "*", [event.ports[0]]);
});
type MediaBinding = import("@distopic/protocol").VoiceMediaBinding;
const bridge = {
  platform: process.platform,
  media: {
    open: (url: string, token: string, channel: string, userId: string) => cryptoInvoke("media:open", { url, token, channel, userId }) as Promise<{ handle: string }>,
    create: (handle: string) => cryptoInvoke("media:create", { handle }) as Promise<{ callId: string; binding: MediaBinding }>,
    propose: (handle: string, callId: string) => cryptoInvoke("media:propose", { handle, callId }) as Promise<{ keyPackage: string; binding: MediaBinding }>,
    commit: (handle: string, proposals: unknown) => cryptoInvoke("media:commit", { handle, proposals }) as Promise<{ epoch: number; commit: string; welcome: string | null; adds: number[]; removes: number[]; delivery: string } | null>,
    settle: (handle: string, delivery: string, accepted: boolean) => cryptoInvoke("media:settle", { handle, delivery, accepted }) as Promise<void>,
    accept: (handle: string, event: unknown) => cryptoInvoke("media:accept", { handle, event }) as Promise<{ removed: boolean }>,
    welcome: (handle: string, event: unknown) => cryptoInvoke("media:welcome", { handle, event }) as Promise<void>,
    roster: (handle: string) => cryptoInvoke("media:roster", { handle }) as Promise<{ userId: string; deviceId: string }[]>,
    close: (handle: string) => cryptoInvoke("media:close", { handle }) as Promise<void>,
  },
  auth: {
    get: () => ipcRenderer.invoke("auth:get") as Promise<AppAccessState>,
    globalUrl: () => ipcRenderer.invoke("auth:global-url") as Promise<string>,
    global: (token: string) => ipcRenderer.invoke("auth:global", token) as Promise<{ id: string; name: string; email: string; cryptoMigrationRequired?:boolean }>,
    local: (account: { id: string; url: string; token: string; userId: string }) => ipcRenderer.invoke("auth:local", account) as Promise<void>,
    logoutGlobal: () => ipcRenderer.invoke("auth:logout-global") as Promise<void>,
    logoutLocal: (id: string, lock=true) => ipcRenderer.invoke("auth:logout-local", id, lock) as Promise<void>,
    onState(listener: (state: AppAccessState) => void): () => void {
      const handler = (_event: IpcRendererEvent, state: AppAccessState) => listener(state);
      ipcRenderer.on("auth:state", handler);
      return () => ipcRenderer.off("auth:state", handler);
    },
  },
  crypto: {
    localChannels: (url:string,userId:string)=>cryptoInvoke('crypto:local-channels',{url,userId}) as Promise<{id:string;kind:'messages'|'legacy';count:number}[]>,
    localMessages: (url:string,userId:string,channel:string,kind:'messages'|'legacy',before?:string)=>cryptoInvoke('crypto:local-messages',{url,userId,channel,kind,before}) as Promise<import('@distopic/protocol').Message[]>,
    localFileSave: (url:string,userId:string,channel:string,messageId:string,fileId:string)=>cryptoInvoke('crypto:local-file-save',{url,userId,channel,messageId,fileId}) as Promise<{saved:boolean}>,
    localBackup: ()=>cryptoInvoke('crypto:local-backup',null) as Promise<{saved:boolean}>,
    importLegacy: (url:string,token:string,channel:string)=>cryptoInvoke('crypto:import-legacy',{url,token,channel}) as Promise<{cancelled?:boolean;complete?:boolean;messages?:number;attachments?:number;reason?:string}>,
    guard: (url:string,token:string,channel:string,userId:string)=>cryptoInvoke("crypto:guard",{url,token,channel,userId}) as Promise<boolean>,
    proof: (url:string,token:string,method:string,path:string,nonce?:string)=>cryptoInvoke("crypto:proof",{url,token,method,path,nonce}) as Promise<string|null>,
    authorize: (url:string,token:string,channel:string)=>cryptoInvoke("crypto:authorize",{url,token,channel}) as Promise<{authorized:boolean}>,
    attachment: (url:string,token:string,channel:string,messageId:string,id:string)=>cryptoInvoke("crypto:attachment",{url,token,channel,messageId,id}) as Promise<{bytes:ArrayBuffer;type:string;name:string}>,
    backup: (url:string,token:string,channel:string)=>cryptoInvoke('crypto:backup',{url,token,channel}) as Promise<{saved:boolean}>,
    restore: (url:string,token:string,channel:string,recoveryKey:string)=>cryptoInvoke('crypto:restore',{url,token,channel,recoveryKey}) as Promise<{restored:boolean}>,
    devices: (url:string,token:string,channel:string)=>cryptoInvoke('crypto:devices',{url,token,channel}) as Promise<{id:string;public_key:string;revoked_at:string|null}[]>,
    revoke: (url:string,token:string,channel:string,deviceId:string)=>cryptoInvoke('crypto:revoke',{url,token,channel,deviceId}) as Promise<void>,
    unlock: (password:string) => cryptoInvoke("crypto:unlock",password) as Promise<{unlocked:boolean}>,
    bind: (url:string,token:string,userId:string) => cryptoInvoke("crypto:bind",{url,token,channel:'account',userId}) as Promise<{deviceId:string}>,
    status: (url:string,token:string,channel:string) => cryptoInvoke("crypto:status",{url,token,channel}) as Promise<{active:boolean;deviceId:string;instanceId:string}>,
    sync: (url:string,token:string,channel:string,before?:string) => cryptoInvoke("crypto:sync",{url,token,channel,before}) as Promise<import("@distopic/protocol").Message[]>,
    reconcile: (url:string,token:string,channel:string,knownIds:string[]) => cryptoInvoke("crypto:reconcile",{url,token,channel,knownIds}) as Promise<{items:import("@distopic/protocol").Message[];deletedIds:string[];newIds:string[]}>,
    action: (url:string,token:string,channel:string,kind:'edit'|'delete'|'reaction',targetId:string,content='',add=true) => cryptoInvoke("crypto:action",{url,token,channel,kind,targetId,content,add}) as Promise<import("@distopic/protocol").Message|null>,
    search: (url:string,token:string,query:Record<string,string>) => cryptoInvoke("crypto:search",{url,token,channel:query.channelId||'search',query}) as Promise<import("@distopic/protocol").MessageSearchPage>,
    policy: (url:string,token:string,channel:string,history:'since_join'|'share_permanent',owner:string|null=null) => cryptoInvoke("crypto:policy",{url,token,channel,history,owner}) as Promise<void>,
    send: (url:string,token:string,channel:string,content:string,replyToId:string|null,files:{name:string;type:string;bytes:ArrayBuffer}[]=[],expiresAt:string|null=null,requestId=globalThis.crypto.randomUUID()) => cryptoInvoke("crypto:send",{url,token,channel,content,replyToId,files,expiresAt,requestId}) as Promise<import("@distopic/protocol").Message>,
    cancel: (requestId:string) => cryptoInvoke('crypto:cancel',requestId) as Promise<void>,
    code: (url:string,token:string,channel:string,userId:string) => cryptoInvoke("crypto:code",{url,token,channel,userId}) as Promise<{code:string;verified:boolean}>,
    verify: (url:string,token:string,channel:string,userId:string,code:string) => cryptoInvoke("crypto:verify",{url,token,channel,userId,code}) as Promise<void>,
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
