import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { UpdateState } from "../shared/update.ts";

const bridge = {
  platform: process.platform,
  showDiscord: () => ipcRenderer.send("discord:show"),
  hideDiscord: () => ipcRenderer.send("discord:hide"),
  reloadDiscord: () => ipcRenderer.send("discord:reload"),
  flashWindow: () => ipcRenderer.send("window:flash"),
  setDiscordTopInset: (px: number) => ipcRenderer.send("discord:inset", px),
  screen: {
    /** "system": the OS portal picks the source (Wayland); "app": show Distopic's own picker. */
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
  onDiscordBadge(listener: (badge: string | null) => void): () => void {
    const handler = (_e: IpcRendererEvent, badge: string | null) => listener(badge);
    ipcRenderer.on("discord:badge", handler);
    return () => ipcRenderer.off("discord:badge", handler);
  },
};

export type DistopicBridge = typeof bridge;

contextBridge.exposeInMainWorld("distopic", bridge);
