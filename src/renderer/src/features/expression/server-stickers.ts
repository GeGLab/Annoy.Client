// The sticker packs of the servers the user is in. Members can send them
// anywhere; the message is the sticker's public link on its server.
import type { ServerSticker, ServerStickerList } from "@distopic/protocol";
import { apiFor } from "../../client.ts";
import { getState } from "../../store.ts";

export interface ServerStickerPack {
  key: string;
  serverName: string;
  iconUrl: string | null;
  stickers: ServerSticker[];
}

/** Every pack with at least one sticker, from all connected servers that support them. */
export async function readServerStickerPacks(signal: AbortSignal): Promise<ServerStickerPack[]> {
  const jobs: Promise<ServerStickerPack | null>[] = [];
  for (const [accountId, inst] of Object.entries(getState().instances)) {
    if (inst.status !== "ready" || !inst.instance?.serverStickers) continue;
    for (const server of inst.servers) {
      jobs.push(apiFor(accountId).get<ServerStickerList>(`/servers/${server.id}/stickers`, signal)
        .then((list) => list.stickers.length ? { key: `${accountId}:${server.id}`, serverName: server.name, iconUrl: server.iconUrl, stickers: list.stickers } : null)
        .catch(() => null));
    }
  }
  return (await Promise.all(jobs)).filter((pack): pack is ServerStickerPack => !!pack);
}
