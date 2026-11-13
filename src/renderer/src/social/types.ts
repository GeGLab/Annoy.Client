import type { UserActivity } from "@annoy/protocol";

/** Public data of an Annoy account (usersannoy). */
export interface CloudProfile {
  id: string;
  username: string;
  displayName: string | null;
  bio: string | null;
  avatar: string | null;
  banner: string | null;
  accentColor: number | null;
  dmKey: string | null;
  dmKeyVersion: number | null;
}

export type ServerVisibility = "shared" | "friends" | "public";

export interface CloudRelationship {
  user: CloudProfile;
  status: "friend" | "outgoing" | "incoming";
  nickname: string | null;
  since: string;
}

/** "Which server I'm in", once opened in the app. */
export interface WhereInfo {
  server: string;
  channel?: string | null;
}

export interface CloudPresence {
  status: "online" | "idle" | "dnd" | "offline";
  /** Only for the account's own presence: what it chose ("invisible" included). */
  chosen?: "online" | "idle" | "dnd" | "invisible" | null;
  activities: UserActivity[];
  where: WhereInfo | null;
}

export interface CloudDm {
  id: string;
  recipientId: string;
  store: { mine: boolean; theirs: boolean };
  lastMessageId: string | null;
  createdAt: string;
}

export interface DmAttachment {
  blobId: string;
  key: string;
  nonce: string;
  name: string;
  type: string;
  size: number;
}

/**
 * A store integration in a DM (features/integrations/dm.ts). "request", "accept",
 * "decline" and "remove" manage it between the two people; "reply" marks an answer
 * of the integration, sent by the app of whoever added it.
 */
export type DmIntegrationMeta =
  | { op: "request" | "accept" | "decline" | "remove"; id: string; name: string }
  | { op: "reply"; id: string; name: string; icon: string | null };

export function readDmIntegrationMeta(raw: unknown): DmIntegrationMeta | undefined {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!r || typeof r.id !== "string" || !/^[a-z][a-z0-9-]{2,31}$/.test(r.id) || typeof r.name !== "string" || !r.name || r.name.length > 32) return undefined;
  if (r.op === "reply") return { op: "reply", id: r.id, name: r.name, icon: typeof r.icon === "string" && r.icon.length <= 300 ? r.icon : null };
  if (r.op === "request" || r.op === "accept" || r.op === "decline" || r.op === "remove") return { op: r.op, id: r.id, name: r.name };
  return undefined;
}

/**
 * A reaction travels as its own encrypted message (chatannoy never sees it):
 * `add` puts the sender's emoji on message `to`, `add: false` takes it back.
 * The conversation folds these in order and never shows them as rows.
 */
export interface DmReaction {
  to: string;
  emoji: string;
  add: boolean;
}

export function readDmReaction(raw: unknown): DmReaction | undefined {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!r || typeof r.to !== "string" || !r.to || r.to.length > 64 || typeof r.emoji !== "string" || !r.emoji.trim() || r.emoji.length > 64 || typeof r.add !== "boolean") return undefined;
  return { to: r.to, emoji: r.emoji, add: r.add };
}

/** What goes inside the encrypted message. */
export interface DmPayload {
  v: 1;
  content: string;
  attachments?: DmAttachment[];
  replyTo?: string | null;
  integration?: DmIntegrationMeta;
  invite?: GameInvite;
  reaction?: DmReaction;
}

export interface DmMessage {
  /** Server message ID (time-ordered); a temporary ID while sending. */
  id: string;
  clientId: string;
  conversationId: string;
  senderId: string;
  content: string;
  attachments: DmAttachment[];
  replyTo: string | null;
  createdAt: string;
  editedAt: string | null;
  state?: "sending" | "failed" | "undecryptable";
  integration?: DmIntegrationMeta;
  /** "Come play with me": the sender's game when the invite was sent. */
  invite?: GameInvite;
  /** A reaction to another message: folded into that message, never drawn as a row. */
  reaction?: DmReaction;
}

/** A game invite travels inside the encrypted message; older clients just show its text. */
export interface GameInvite {
  name: string;
  provider: string;
  /** Steam app ID: lets the recipient launch the game. */
  appId?: string;
  /** Official HTTPS artwork only (never a data URL from the sender's machine). */
  artwork?: string;
  startedAt?: number;
}

export function readGameInvite(raw: unknown): GameInvite | undefined {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!r || typeof r.name !== "string" || !r.name.trim() || r.name.length > 128 || typeof r.provider !== "string" || r.provider.length > 32) return undefined;
  const appId = typeof r.appId === "string" && /^\d{1,10}$/.test(r.appId) ? r.appId : undefined;
  const artwork = typeof r.artwork === "string" && r.artwork.length <= 500 && /^https:\/\//.test(r.artwork) ? r.artwork : undefined;
  const startedAt = typeof r.startedAt === "number" && Number.isFinite(r.startedAt) ? r.startedAt : undefined;
  return { name: r.name.trim(), provider: r.provider, ...(appId && { appId }), ...(artwork && { artwork }), ...(startedAt && { startedAt }) };
}

export interface DmThread {
  items: DmMessage[];
  loaded: boolean;
  /** More stored history on chatannoy (only with "store"). */
  hasMoreRemote: boolean;
  /** More history in this device's own copy. */
  hasMoreLocal?: boolean;
  /** An older page is on its way. */
  loadingOlder?: boolean;
  pins?: DmPin[];
  pinsLoading?: boolean;
  pinsError?: string | null;
}

export interface DmPin { message: DmMessage; pinnedBy: string; pinnedAt: string }

export interface SocialState {
  /** "off": no Annoy account signed in. */
  status: "off" | "connecting" | "ready" | "offline";
  me: (CloudProfile & { serverVisibility: ServerVisibility }) | null;
  profiles: Record<string, CloudProfile>;
  relationships: CloudRelationship[];
  presences: Record<string, CloudPresence>;
  dms: CloudDm[];
  threads: Record<string, DmThread>;
  /** userId -> expiry (ms) */
  typing: Record<string, number>;
  unread: Record<string, number>;
  /** Bumped when someone's profile contacts or activity history change. */
  detailsRevision: number;
}

export const emptySocial = (): SocialState => ({
  status: "off",
  me: null,
  profiles: {},
  relationships: [],
  presences: {},
  dms: [],
  threads: {},
  typing: {},
  unread: {},
  detailsRevision: 0,
});

/** The pseudo account ID of the Annoy cloud in places that take an account (calls, views). */
export const CLOUD_ACCOUNT = "annoy-cloud";
