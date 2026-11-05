import type { MediaSource } from "@distopic/protocol";
import type { StreamOffer } from "../media.ts";

/** A screen share's picture and sound are only received when the user chooses to watch. */
export const isStreamSource = (source: MediaSource): boolean => source === "screen" || source === "screen_audio";

/** One offer per person sharing a screen, from the tracks we know of (received or not). */
export function streamOffers(tracks: Iterable<{ userId: string; source: MediaSource }>, watching: ReadonlySet<string>): StreamOffer[] {
  const users = new Set<string>();
  for (const { userId, source } of tracks) if (source === "screen") users.add(userId);
  return [...users].sort().map((userId) => ({ userId, watching: watching.has(userId) }));
}
