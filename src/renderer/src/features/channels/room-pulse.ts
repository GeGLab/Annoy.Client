import type { PlaybackState } from "@annoy/protocol";
import { useEffect, useSyncExternalStore } from "react";
import { apiFor } from "../../client.ts";
import { useStore } from "../../store.ts";
import { onRoomEvent } from "./events.ts";

/**
 * What a song room is doing, for the channel list: what plays and who listens, without
 * joining it. The server announces every change to everyone who can see the room; a quiet
 * look now and then catches listeners that came or went without one.
 */

const rooms = new Map<string, PlaybackState>();
const subscribers = new Set<() => void>();
const subscribe = (fn: () => void) => {
  subscribers.add(fn);
  return () => void subscribers.delete(fn);
};
const LOOK_AGAIN_MS = 45_000;

export function useRoomPulse(accountId: string, channelId: string): PlaybackState | null {
  const key = `${accountId}:${channelId}`;
  const connected = useStore((s) => s.instances[accountId]?.status === "ready");
  const state = useSyncExternalStore(subscribe, () => rooms.get(key) ?? null);
  useEffect(() => {
    if (!connected) return;
    const set = (next: PlaybackState) => {
      rooms.set(key, next);
      subscribers.forEach((fn) => fn());
    };
    const controller = new AbortController();
    const look = () => void apiFor(accountId).get<PlaybackState>(`/channels/${channelId}/playback`, controller.signal).then(set, () => {});
    look();
    const timer = setInterval(look, LOOK_AGAIN_MS);
    const off = onRoomEvent(accountId, channelId, (event) => {
      if (event.t === "PLAYBACK_UPDATE") set(event.d);
    });
    return () => {
      controller.abort();
      clearInterval(timer);
      off();
    };
  }, [accountId, channelId, connected, key]);
  return connected ? state : null;
}
