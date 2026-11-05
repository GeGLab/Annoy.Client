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

/**
 * Screen shares going on in the call. Watching is opt-in: nothing of a share
 * (picture or sound) is received until the user chooses to watch it.
 */
export interface StreamOffer {
  userId: string;
  watching: boolean;
}

let offers: StreamOffer[] = [];
const offerListeners = new Set<() => void>();

export function setStreamOffers(next: StreamOffer[]): void {
  const same = next.length === offers.length && next.every((o, i) => o.userId === offers[i]!.userId && o.watching === offers[i]!.watching);
  if (same) return;
  offers = next;
  for (const l of offerListeners) l();
}

export function useStreamOffers(): StreamOffer[] {
  return useSyncExternalStore(
    (l) => {
      offerListeners.add(l);
      return () => offerListeners.delete(l);
    },
    () => offers,
  );
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
  setStreamOffers([]);
  if (tiles.length === 0) return;
  tiles = [];
  emit();
}

/** Current tiles outside React. */
export function videoTiles(): VideoTile[] {
  return tiles;
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
