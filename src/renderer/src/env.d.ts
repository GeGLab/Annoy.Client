/// <reference types="vite/client" />
import type { DistopicBridge } from "../../preload/index.ts";

declare global {
  interface Window {
    /** Absent when the renderer runs in a plain browser during development. */
    distopic?: DistopicBridge;
  }
}

export {};
