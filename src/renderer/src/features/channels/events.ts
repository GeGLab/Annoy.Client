import type { GatewayEventOf } from "@distopic/protocol";

// Gateway events only the open room cares about: they skip the global store.

type RoomEvent = GatewayEventOf<"PLAYBACK_UPDATE"> | GatewayEventOf<"CODE_UPDATE"> | GatewayEventOf<"MESSAGE_CREATE"> | GatewayEventOf<"MESSAGE_UPDATE"> | GatewayEventOf<"MESSAGE_DELETE">;
type Listener = (event: RoomEvent) => void;

const listeners = new Map<string, Set<Listener>>();
const key = (accountId: string, channelId: string) => `${accountId}:${channelId}`;

export function onRoomEvent(accountId: string, channelId: string, listener: Listener): () => void {
  const set = listeners.get(key(accountId, channelId)) ?? new Set();
  set.add(listener);
  listeners.set(key(accountId, channelId), set);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(key(accountId, channelId));
  };
}

export function emitRoomEvent(accountId: string, event: RoomEvent): void {
  for (const listener of listeners.get(key(accountId, event.d.channelId)) ?? []) listener(event);
}
