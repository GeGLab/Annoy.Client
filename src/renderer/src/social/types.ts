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

/** What goes inside the encrypted message. */
export interface DmPayload {
  v: 1;
  content: string;
  attachments?: DmAttachment[];
  replyTo?: string | null;
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
}

export interface DmThread {
  items: DmMessage[];
  loaded: boolean;
  /** More stored history on chatannoy (only with "store"). */
  hasMoreRemote: boolean;
}

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
