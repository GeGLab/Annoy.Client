import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { OverlayMenuPick, OverlayMenuSpec } from "../shared/overlay-menu.ts";

// The overlay layer only draws menus: it receives one spec and answers with the chosen row.
const overlay = {
  onShow(listener: (token: number, spec: OverlayMenuSpec) => void): () => void {
    const handler = (_e: IpcRendererEvent, token: number, spec: OverlayMenuSpec) => listener(token, spec);
    ipcRenderer.on("overlay-menu:show", handler);
    return () => ipcRenderer.off("overlay-menu:show", handler);
  },
  onClose(listener: () => void): () => void {
    const handler = () => listener();
    ipcRenderer.on("overlay-menu:close", handler);
    return () => ipcRenderer.off("overlay-menu:close", handler);
  },
  /** Sent once the page listens, so the first menu is never lost. */
  ready: () => ipcRenderer.send("overlay-menu:ready"),
  done: (token: number, pick: OverlayMenuPick | null) => ipcRenderer.send("overlay-menu:done", token, pick),
};
export type OverlayBridge = typeof overlay;
contextBridge.exposeInMainWorld("annoyOverlay", overlay);
