import type { Message } from "@distopic/protocol";

export const CHANNEL_MESSAGE_LIMIT = 500;
export const TOTAL_MESSAGE_LIMIT = 5000;
export function boundMessageCaches<
  T extends { items: Message[]; lastAccessed?: number },
>(cache: Record<string, T>, protectedIds: readonly string[]): void {
  let overflow =
    Object.values(cache).reduce((sum, entry) => sum + entry.items.length, 0) -
    TOTAL_MESSAGE_LIMIT;
  const candidates = Object.entries(cache)
    .filter(([id]) => !protectedIds.includes(id))
    .sort((a, b) => (a[1].lastAccessed ?? 0) - (b[1].lastAccessed ?? 0));
  for (const [id, entry] of candidates) {
    if (overflow <= 0) break;
    overflow -= entry.items.length;
    delete cache[id];
  }
}
export interface MessageMutation {
  sequence: number;
  kind: "create" | "update" | "delete";
  message: Message | null;
  messageId: string;
}
export function reconcileMessageWindow(
  items: readonly Message[],
  changes: Iterable<MessageMutation>,
  afterSequence: number,
  atLatest: boolean,
): Message[] {
  const current = new Map(items.map((message) => [message.id, message]));
  const first = items[0]?.id ?? "",
    last = items.at(-1)?.id ?? "";
  for (const change of changes) {
    if (change.sequence <= afterSequence) continue;
    if (change.kind === "delete") current.delete(change.messageId);
    else if (
      change.message &&
      (current.has(change.messageId) ||
        (change.kind === "create" &&
          ((change.messageId >= first && change.messageId <= last) ||
            (atLatest && change.messageId > last))))
    )
      current.set(change.messageId, change.message);
  }
  return [...current.values()].sort((a, b) => a.id.localeCompare(b.id));
}
export function mergeMessageWindow(
  previous: readonly Message[],
  incoming: readonly Message[],
  direction: "before" | "after" | "replace",
) {
  const byId = new Map(
    (direction === "replace" ? [] : previous).map((message) => [
      message.id,
      message,
    ]),
  );
  for (const message of incoming) byId.set(message.id, message);
  const sorted = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  const overflow = sorted.length > CHANNEL_MESSAGE_LIMIT;
  return {
    items:
      direction === "before"
        ? sorted.slice(0, CHANNEL_MESSAGE_LIMIT)
        : sorted.slice(-CHANNEL_MESSAGE_LIMIT),
    evictedBefore: overflow && direction !== "before",
    evictedAfter: overflow && direction === "before",
  };
}
