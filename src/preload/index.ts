import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

const bridge = {
  platform: process.platform,
  showDiscord: () => ipcRenderer.send("discord:show"),
  hideDiscord: () => ipcRenderer.send("discord:hide"),
  reloadDiscord: () => ipcRenderer.send("discord:reload"),
  flashWindow: () => ipcRenderer.send("window:flash"),
  onDiscordBadge(listener: (badge: string | null) => void): () => void {
    const handler = (_e: IpcRendererEvent, badge: string | null) => listener(badge);
    ipcRenderer.on("discord:badge", handler);
    return () => ipcRenderer.off("discord:badge", handler);
  },
};

export type DistopicBridge = typeof bridge;

contextBridge.exposeInMainWorld("distopic", bridge);
