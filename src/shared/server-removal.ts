export const OWNER_OFFLINE_GRACE_MS = 7 * 24 * 60 * 60_000;

/** A failed login is not an offline server. Retry/startup must not reset an existing outage. */
export function connectionOfflineSince(
  previous: number | undefined,
  status: "connecting" | "ready" | "offline" | "invalid",
  now: number,
  online = true,
): number | undefined {
  if (status === "ready" || status === "invalid") return undefined;
  if (status === "connecting") return previous;
  return previous ?? (online ? now : undefined);
}

/** Member IDs include offline members. Unknown membership never proves that an owner is alone. */
export function canRemoveServer({ ownerId, userId, status, memberIds, offlineSince, now = Date.now() }: {
  ownerId: string;
  userId: string;
  status: "connecting" | "ready" | "offline" | "invalid";
  memberIds?: readonly string[];
  offlineSince?: number;
  now?: number;
}): boolean {
  if (!ownerId || !userId) return false;
  if (ownerId !== userId) return true;
  if (status === "ready") return memberIds?.length === 1 && memberIds[0] === userId;
  if (status === "invalid") return false;
  return typeof offlineSince === "number" && Number.isFinite(offlineSince) && offlineSince >= 0 &&
    now - offlineSince >= OWNER_OFFLINE_GRACE_MS;
}
