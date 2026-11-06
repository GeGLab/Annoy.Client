/// <reference types="vite/client" />
import type { AnnoyBridge } from "../../preload/index.ts";

declare global {
  interface Window {
    /** Absent when the renderer runs in a plain browser during development. */
    annoy?: AnnoyBridge;
  }
}

export {};
