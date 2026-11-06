// Screen shares opened in their own window. While a share is in its window it
// is hidden from the call view; closing the window brings it back. The sound
// keeps playing from the call, so the stream volume still applies.
import { useSyncExternalStore } from "react";
import { onTilesChange, videoTiles, type VideoTile } from "../media.ts";

const windows = new Map<string, Window>();
let popped: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

function publish(): void {
  popped = new Set(windows.keys());
  for (const listener of listeners) listener();
}

function forget(key: string, child: Window): void {
  if (windows.get(key) !== child) return;
  windows.delete(key);
  publish();
}

/** Opens the share in its own window, or brings its window to the front. */
export function popOutStream(tile: VideoTile, title: string): void {
  const open = windows.get(tile.key);
  if (open && !open.closed) return void open.focus();
  // The main process only allows about:blank windows named "annoy-stream:…".
  const child = window.open("about:blank", `annoy-stream:${tile.key}`, "width=1280,height=720");
  if (!child) return;
  const doc = child.document;
  doc.title = title;
  doc.body.style.cssText = "margin:0;background:#000;overflow:hidden";
  const video = doc.createElement("video");
  video.autoplay = true;
  video.playsInline = true;
  video.muted = true;
  video.style.cssText = "display:block;width:100vw;height:100vh;object-fit:contain;background:#000";
  video.srcObject = tile.stream;
  doc.body.append(video);
  void video.play().catch(() => undefined);
  windows.set(tile.key, child);
  child.addEventListener("pagehide", () => forget(tile.key, child));
  // pagehide does not always reach the opener when the OS closes the window.
  const watch = setInterval(() => {
    if (!child.closed) return;
    clearInterval(watch);
    forget(tile.key, child);
  }, 1000);
  publish();
}

// The share ended, we stopped watching or left the call: its window goes too.
onTilesChange(() => {
  const live = new Set(videoTiles().map((tile) => tile.key));
  for (const [key, child] of [...windows]) {
    if (live.has(key)) continue;
    windows.delete(key);
    child.close();
  }
  if (popped.size !== windows.size) publish();
});

/** Keys of the shares that are in their own window. */
export function usePoppedOutStreams(): ReadonlySet<string> {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => popped,
  );
}
