import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { Service } from "../shared/services.ts";
import type { UpdateState } from "../shared/update.ts";

const bridge = {
  platform: process.platform,
  flashWindow: () => ipcRenderer.send("window:flash"),
  services: {
    show: (service: Service) => ipcRenderer.send("service:show", { id: service.id, kind: service.kind, name: service.name, url: service.url }),
    hide: () => ipcRenderer.send("service:hide"),
    reload: (id: string) => ipcRenderer.send("service:reload", id),
    /** Closes the view and clears its login. */
    remove: (id: string) => ipcRenderer.invoke("service:remove", id) as Promise<void>,
    setTopInset: (px: number) => ipcRenderer.send("service:inset", px),
    onBadge(listener: (id: string, badge: string | null) => void): () => void {
      const handler = (_e: IpcRendererEvent, id: string, badge: string | null) => listener(id, badge);
      ipcRenderer.on("service:badge", handler);
      return () => ipcRenderer.off("service:badge", handler);
    },
  },
  openTeamSpeak: (link: string) => ipcRenderer.send("teamspeak:open", link),
  screen: {
    /** "system": the OS portal picks the source (Wayland); "app": show Annoy's own picker. */
    mode: () => ipcRenderer.invoke("screen:mode") as Promise<"system" | "app">,
    sources: () => ipcRenderer.invoke("screen:sources") as Promise<{ id: string; name: string; kind: "screen" | "window"; thumbnail: string }[]>,
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
