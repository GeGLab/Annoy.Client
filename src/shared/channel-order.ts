import type { Channel, ChannelType } from "@annoy/protocol";

/** Same rule as annoy-server: text-like rooms are named lowercase, with dashes and no spaces. */
const SLUG_TYPES = new Set<ChannelType>(["text", "files", "code"]);
const slug = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^\p{L}\p{N}_-]/gu, "").slice(0, 100) || "canal";
export const storedChannelName = (type: ChannelType, name: string) => (SLUG_TYPES.has(type) ? slug(name) : name.trim());

/** Another room of the same type with this name in the same place (temporary voice rooms aside), as annoy-server refuses it. */
export function channelNameTaken(channels: readonly Channel[], type: ChannelType, name: string, parentId: string | null, exceptId: string | null = null): boolean {
  const wanted = name.trim().toLocaleLowerCase();
  const place = type === "category" ? null : parentId;
  return channels.some((c) => c.id !== exceptId && c.type === type && !c.temporary && (c.parentId ?? null) === place && c.name.toLocaleLowerCase() === wanted);
}

/** Where a dragged row lands: the place it goes and the row it goes before (null: the end of that place). */
export interface ChannelDrop { parentId: string | null; beforeId: string | null }

/**
 * annoy-server's move, applied locally so the list changes at once: the room goes before
 * `beforeId` (or to the end of its category) and every room is renumbered.
 */
export function moveInOrder<T extends Pick<Channel, "id" | "type" | "parentId" | "position">>(channels: readonly T[], id: string, drop: ChannelDrop): T[] {
  const sorted = [...channels].sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : 1));
  const moving = sorted.find((c) => c.id === id);
  if (!moving) return [...channels];
  const category = moving.type === "category";
  const parentId = category ? null : drop.parentId;
  const rest = sorted.filter((c) => c.id !== id);
  const before = drop.beforeId ? rest.findIndex((c) => c.id === drop.beforeId) : -1;
  let at: number;
  if (before >= 0) at = before;
  else if (category) at = rest.length;
  else {
    const last = rest.findLastIndex((c) => c.type !== "category" && (c.parentId ?? null) === parentId);
    at = last >= 0 ? last + 1 : parentId ? rest.findIndex((c) => c.id === parentId) + 1 : 0;
  }
  rest.splice(at, 0, { ...moving, parentId });
  return rest.map((c, position) => ({ ...c, position }));
}

/**
 * The drop for a row released on `target` (a room or a category header), in the order the
 * list shows: `siblings` are the rows of the target's place, as displayed.
 */
export function dropFor(dragged: Pick<Channel, "type">, target: Pick<Channel, "id" | "type">, edge: "before" | "after" | "into", targetPlace: string | null, siblings: readonly Pick<Channel, "id">[]): ChannelDrop | null {
  if (dragged.type === "category") {
    if (target.type !== "category" || edge === "into") return null;
  } else if (target.type === "category") {
    return { parentId: target.id, beforeId: null };
  }
  if (edge === "before") return { parentId: targetPlace, beforeId: target.id };
  const index = siblings.findIndex((s) => s.id === target.id);
  return { parentId: targetPlace, beforeId: siblings[index + 1]?.id ?? null };
}
