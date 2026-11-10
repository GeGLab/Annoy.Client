/// <reference types="vite/client" />
import type { AnnoyBridge } from "../../preload/index.ts";
import type { OverlayBridge } from "../../preload/overlay.ts";

declare global {
  interface Window {
    /** Absent when the renderer runs in a plain browser during development. */
    annoy?: AnnoyBridge;
    /** Only in the overlay layer that draws menus above browser services. */
    annoyOverlay?: OverlayBridge;
  }
}

export {};
