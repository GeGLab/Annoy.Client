// Live video tiles (cameras and screens) for the current voice session.
// MediaStreams are live objects, so they stay out of the immutable app store;
// components subscribe here instead.
import { useSyncExternalStore } from "react";

export interface VideoTile {
  /** Producer id for remote media, "local:<source>" for our own preview. */
  key: string;
  userId: string;
  source: "camera" | "screen";
  stream: MediaStream;
  local: boolean;
}

let tiles: VideoTile[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function putTile(tile: VideoTile): void {
  tiles = [...tiles.filter((t) => t.key !== tile.key), tile];
  emit();
}

export function dropTile(key: string): void {
  if (!tiles.some((t) => t.key === key)) return;
  tiles = tiles.filter((t) => t.key !== key);
  emit();
}

export function clearTiles(): void {
  if (tiles.length === 0) return;
  tiles = [];
  emit();
}

export function useVideoTiles(): VideoTile[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => tiles,
  );
}
