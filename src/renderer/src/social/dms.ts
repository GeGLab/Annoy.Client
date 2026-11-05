import { t as translate } from "../../../shared/localization/index.ts";
import { accountIdentityKey } from "../auth/session.ts";
import { getState, toast } from "../store.ts";
import { playMessageFeedback } from "../lib/voice-feedback.ts";
import { cloud, cloudFetch } from "./cloud.ts";
import * as dm from "./dm-crypto.ts";
import * as local from "./local-db.ts";
import { cloudDevice, displayName, runtime, setSocial, social } from "./runtime.ts";
import type { CloudDm, CloudProfile, DmAttachment, DmMessage, DmPayload } from "./types.ts";

/**
 * DMs (TODO item 1.2 and 3.4): encrypted here, delivered by chatannoy, kept on
 * this device. chatannoy sees who wrote to whom and when, never the content.
 */

interface Envelope {
  id: string;
  conversationId: string;
  kind: "message" | "edit" | "delete";
  messageId: string;
  senderId: string;
  senderDevice: string;
  clientId: string;
  nonce: string | null;
  ciphertext: string | null;
  blobs: string[];
  createdAt: string;
}

const MAX_FILE = 25 * 1024 * 1024;
let myKeys: Promise<dm.DmKeyPair> | null = null;
const keys = new Map<string, Promise<CryptoKey>>();

export function resetDms(): void {
  myKeys = null;
  keys.clear();
  pendingAcks.clear();
  if (ackTimer) clearTimeout(ackTimer);
  ackTimer = null;
}

export function myDmKeys(): Promise<dm.DmKeyPair> {
  const identity = accountIdentityKey();
  if (!identity) return Promise.reject(new Error(translate("auth.signInFirst")));
  return (myKeys ??= dm.dmKeyPair(identity));
}

/** Registers this account's DM public key (derived, the same on every device). */
export async function publishDmKey(): Promise<void> {
  const mine = await myDmKeys();
  if (social().me?.dmKey === mine.publicKey) return;
  await cloud("users", "/v1/users/@me/dm-key", { method: "PUT", body: { publicKey: mine.publicKey, version: dm.DM_KEY_VERSION } });
  setSocial((s) => {
    if (s.me) s.me.dmKey = mine.publicKey;
  });
}

async function profileOf(id: string, fresh = false): Promise<CloudProfile> {
  const known = social().profiles[id];
  if (known && !fresh) return known;
  const p = await cloud<CloudProfile>("users", `/v1/users/${id}`);
  setSocial((s) => {
    s.profiles[id] = p;
  });
  return p;
}

async function keyFor(otherId: string): Promise<CryptoKey> {
  let other = await profileOf(otherId);
  if (!other.dmKey) other = await profileOf(otherId, true);
  if (!other.dmKey) throw new Error(translate("social.needsUpdate", { p0: displayName(other) }));
  const cacheKey = `${otherId}:${other.dmKey}`;
  let key = keys.get(cacheKey);
  if (!key) {
    key = myDmKeys().then((mine) => dm.conversationKey(mine, runtime.me!, other.dmKey!, otherId));
    keys.set(cacheKey, key);
  }
  return key;
}

const recipientOf = (conversationId: string) => social().dms.find((d) => d.id === conversationId)?.recipientId;

async function decrypt(stored: local.StoredMessage): Promise<DmMessage> {
  const base = { id: stored.id, clientId: stored.clientId, conversationId: stored.conversationId, senderId: stored.senderId, createdAt: stored.createdAt, editedAt: stored.editedAt };
  try {
    const other = recipientOf(stored.conversationId);
    if (!other) throw new Error("unknown conversation");
    const payload = await dm.openMessage<DmPayload>(await keyFor(other), { conversationId: stored.conversationId, senderId: stored.senderId, clientId: stored.clientId }, stored);
    return { ...base, content: String(payload.content ?? "").slice(0, 4000), attachments: Array.isArray(payload.attachments) ? payload.attachments.slice(0, 10) : [], replyTo: payload.replyTo ?? null };
  } catch {
    return { ...base, content: "", attachments: [], replyTo: null, state: "undecryptable" };
  }
}

function upsertMessage(message: DmMessage, replaceId?: string): void {
  setSocial((s) => {
    const thread = s.threads[message.conversationId];
    if (!thread) return;
    const i = thread.items.findIndex((m) => m.id === (replaceId ?? message.id) || m.id === message.id);
    if (i >= 0) thread.items[i] = message;
    else {
      thread.items.push(message);
      thread.items.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    }
  });
}

// --- Conversations ------------------------------------------------------------------

export async function loadDms(): Promise<void> {
  const dms = await cloud<CloudDm[]>("chat", "/v1/dms");
  setSocial((s) => {
    s.dms = dms;
  });
}

export async function openDmWith(userId: string): Promise<CloudDm> {
  const existing = social().dms.find((d) => d.recipientId === userId);
  if (existing) return existing;
  const conversation = await cloud<CloudDm>("chat", "/v1/dms", { body: { userId } });
  setSocial((s) => {
    if (!s.dms.some((d) => d.id === conversation.id)) s.dms.unshift(conversation);
  });
  return conversation;
}

export async function setStore(conversationId: string, store: boolean): Promise<void> {
  const updated = await cloud<CloudDm>("chat", `/v1/dms/${conversationId}`, { method: "PATCH", body: { store } });
  setSocial((s) => {
    const i = s.dms.findIndex((d) => d.id === updated.id);
    if (i >= 0) s.dms[i] = updated;
  });
}

/** The local history; with "store" on, older messages come from chatannoy as well. */
export async function loadThread(conversationId: string, older = false): Promise<void> {
  const me = runtime.me;
  if (!me) return;
  const thread = social().threads[conversationId];
  if (thread?.loaded && !older) return;
  const before = older ? thread?.items.find((m) => !m.state)?.id : undefined;
  if (!thread) setSocial((s) => void (s.threads[conversationId] = { items: [], loaded: false, hasMoreRemote: false }));
  const conversation = social().dms.find((d) => d.id === conversationId);
  if (conversation && (conversation.store.mine || conversation.store.theirs)) {
    try {
      const remote = await cloud<{ id: string; senderId: string; clientId: string; nonce: string; ciphertext: string; createdAt: string; editedAt: string | null }[]>(
        "chat",
        `/v1/dms/${conversationId}/messages?limit=50${before ? `&before=${before}` : ""}`,
      );
      await local.putMessages(me, remote.map((r) => ({ id: r.id, conversationId, senderId: r.senderId, clientId: r.clientId, nonce: r.nonce, ciphertext: r.ciphertext, createdAt: r.createdAt, editedAt: r.editedAt })));
      setSocial((s) => {
        const t = s.threads[conversationId];
        if (t) t.hasMoreRemote = remote.length === 50;
      });
    } catch {
      /* the local copy still shows */
    }
  }
  const stored = await local.recentMessages(me, conversationId, 50, before);
  const messages = await Promise.all(stored.map(decrypt));
  if (runtime.me !== me) return;
  setSocial((s) => {
    const t = (s.threads[conversationId] ??= { items: [], loaded: false, hasMoreRemote: false });
    const known = new Set(t.items.map((m) => m.id));
    for (const m of messages) if (!known.has(m.id)) t.items.push(m);
    t.items.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    t.loaded = true;
  });
}

// --- Sending ------------------------------------------------------------------------

const newClientId = () => crypto.randomUUID().replace(/-/g, "");

async function uploadFile(file: File): Promise<DmAttachment> {
  if (file.size > MAX_FILE) throw new Error(translate("social.fileTooLarge", { p0: file.name }));
  const sealed = await dm.sealFile(new Uint8Array(await file.arrayBuffer()));
  const { id } = await cloud<{ id: string }>("cdn", "/v1/blobs", { raw: sealed.data, contentType: "application/octet-stream" });
  // The sender keeps its own copy too: the server one goes once delivered (without "store").
  if (runtime.me) await local.putFile(runtime.me, id, sealed.data);
  return { blobId: id, key: sealed.key, nonce: sealed.nonce, name: file.name.slice(0, 200), type: file.type.slice(0, 100) || "application/octet-stream", size: file.size };
}

export async function sendDm(conversationId: string, content: string, files: File[] = [], replyTo: string | null = null): Promise<void> {
  const me = runtime.me;
  const other = recipientOf(conversationId);
  if (!me || !other) return;
  const clientId = newClientId();
  const temp = `~${Date.now().toString(36)}${clientId.slice(0, 6)}`;
  const optimistic: DmMessage = { id: temp, clientId, conversationId, senderId: me, content, attachments: [], replyTo, createdAt: new Date().toISOString(), editedAt: null, state: "sending" };
  upsertMessage(optimistic);
  try {
    const key = await keyFor(other);
    const attachments = await Promise.all(files.map(uploadFile));
    const payload: DmPayload = { v: 1, content, ...(attachments.length && { attachments }), ...(replyTo && { replyTo }) };
    const sealed = await dm.sealMessage(key, { conversationId, senderId: me, clientId }, payload);
    const envelope = await cloud<Envelope>("chat", `/v1/dms/${conversationId}/messages`, { body: { device: cloudDevice(), clientId, ...sealed, blobs: attachments.map((a) => a.blobId) } });
    const stored: local.StoredMessage = { id: envelope.messageId, conversationId, senderId: me, clientId, nonce: sealed.nonce, ciphertext: sealed.ciphertext, createdAt: envelope.createdAt, editedAt: null };
    await local.putMessages(me, [stored]);
    upsertMessage({ ...optimistic, id: envelope.messageId, attachments, createdAt: envelope.createdAt, state: undefined }, temp);
    setSocial((s) => {
      const d = s.dms.find((x) => x.id === conversationId);
      if (d) d.lastMessageId = envelope.messageId;
      s.dms.sort((a, b) => (b.lastMessageId ?? "").localeCompare(a.lastMessageId ?? ""));
    });
  } catch (error) {
    upsertMessage({ ...optimistic, state: "failed" }, temp);
    toast((error as Error).message);
  }
}

export async function editDm(message: DmMessage, content: string): Promise<void> {
  const me = runtime.me;
  const other = recipientOf(message.conversationId);
  if (!me || !other || message.senderId !== me) return;
  const payload: DmPayload = { v: 1, content, ...(message.attachments.length && { attachments: message.attachments }), ...(message.replyTo && { replyTo: message.replyTo }) };
  const sealed = await dm.sealMessage(await keyFor(other), { conversationId: message.conversationId, senderId: me, clientId: message.clientId }, payload);
  const envelope = await cloud<Envelope>("chat", `/v1/dms/${message.conversationId}/messages/${message.id}`, { method: "PATCH", body: { device: cloudDevice(), clientId: message.clientId, ...sealed } });
  const stored = await local.getMessage(me, message.id);
  if (stored) await local.putMessages(me, [{ ...stored, nonce: sealed.nonce, ciphertext: sealed.ciphertext, editedAt: envelope.createdAt }]);
  upsertMessage({ ...message, content, editedAt: envelope.createdAt });
}

export async function deleteDm(message: DmMessage): Promise<void> {
  const me = runtime.me;
  if (!me || message.senderId !== me) return;
  await cloudFetch("chat", `/v1/dms/${message.conversationId}/messages/${message.id}?device=${encodeURIComponent(cloudDevice())}&clientId=${message.clientId}`, { method: "DELETE" });
  await local.deleteMessage(me, message.id);
  setSocial((s) => {
    const t = s.threads[message.conversationId];
    if (t) t.items = t.items.filter((m) => m.id !== message.id);
  });
}

export function retryDm(message: DmMessage): void {
  setSocial((s) => {
    const t = s.threads[message.conversationId];
    if (t) t.items = t.items.filter((m) => m.id !== message.id);
  });
  void sendDm(message.conversationId, message.content, [], message.replyTo);
}

// --- Files --------------------------------------------------------------------------

/** Decrypted bytes of a DM file: the local copy first, then cdnannoy (saved locally after). */
export async function openAttachment(a: DmAttachment): Promise<Blob> {
  const me = runtime.me!;
  let data = await local.getFile(me, a.blobId);
  if (!data) {
    const res = await cloudFetch("cdn", `/v1/blobs/${a.blobId}`);
    data = new Uint8Array(await res.arrayBuffer());
    await local.putFile(me, a.blobId, data);
  }
  return new Blob([await dm.openFile(a.key, a.nonce, data)], { type: a.type });
}

// --- Receiving ----------------------------------------------------------------------

const pendingAcks = new Set<string>();
let ackTimer: ReturnType<typeof setTimeout> | null = null;

function ack(id?: string, delay = 400): void {
  if (id) pendingAcks.add(id);
  if (ackTimer || !pendingAcks.size) return;
  ackTimer = setTimeout(async () => {
    ackTimer = null;
    const ids = [...pendingAcks].slice(0, 500);
    try {
      await cloud("chat", "/v1/sync/ack", { body: { device: cloudDevice(), ids } });
      for (const done of ids) pendingAcks.delete(done);
      ack();
    } catch {
      // Still queued: the server keeps the envelopes until this device confirms them.
      ack(undefined, 10_000);
    }
  }, delay);
}

/** An envelope from the gateway or from /v1/sync: save it, show it, confirm it. */
export async function receiveEnvelope(envelope: Envelope, live: boolean): Promise<void> {
  const me = runtime.me;
  if (!me) return;
  if (!social().dms.some((d) => d.id === envelope.conversationId)) await loadDms().catch(() => undefined);
  if (envelope.kind === "message" && envelope.nonce && envelope.ciphertext) {
    const stored: local.StoredMessage = { id: envelope.messageId, conversationId: envelope.conversationId, senderId: envelope.senderId, clientId: envelope.clientId, nonce: envelope.nonce, ciphertext: envelope.ciphertext, createdAt: envelope.createdAt, editedAt: null };
    // Delivered before but not confirmed (app closed first): save nothing new, count nothing twice.
    const seen = await local.getMessage(me, envelope.messageId);
    if (seen) return ack(envelope.id);
    await local.putMessages(me, [stored]);
    const message = await decrypt(stored);
    // Files are fetched now: without "store" the server copy goes once every device confirmed.
    await Promise.all(
      message.attachments.map(async (a) => {
        if (await local.getFile(me, a.blobId)) return;
        const res = await cloudFetch("cdn", `/v1/blobs/${a.blobId}`).catch(() => null);
        if (res) await local.putFile(me, a.blobId, new Uint8Array(await res.arrayBuffer()));
      }),
    );
    if (social().threads[envelope.conversationId]?.loaded) upsertMessage(message);
    setSocial((s) => {
      const d = s.dms.find((x) => x.id === envelope.conversationId);
      if (d && (!d.lastMessageId || d.lastMessageId < envelope.messageId)) d.lastMessageId = envelope.messageId;
      s.dms.sort((a, b) => (b.lastMessageId ?? "").localeCompare(a.lastMessageId ?? ""));
      delete s.typing[envelope.senderId];
    });
    if (envelope.senderId !== me) arrived(envelope.conversationId, message, live);
  } else {
    // Edits and deletes count only from the original author, with the original client ID.
    const original = await local.getMessage(me, envelope.messageId);
    if (original && original.senderId === envelope.senderId && original.clientId === envelope.clientId) {
      if (envelope.kind === "delete") {
        await local.deleteMessage(me, envelope.messageId);
        setSocial((s) => {
          const t = s.threads[envelope.conversationId];
          if (t) t.items = t.items.filter((m) => m.id !== envelope.messageId);
        });
      } else if (envelope.nonce && envelope.ciphertext) {
        const stored = { ...original, nonce: envelope.nonce, ciphertext: envelope.ciphertext, editedAt: envelope.createdAt };
        await local.putMessages(me, [stored]);
        if (social().threads[envelope.conversationId]?.loaded) upsertMessage(await decrypt(stored));
      }
    }
  }
  ack(envelope.id);
}

function arrived(conversationId: string, message: DmMessage, live: boolean): void {
  const s = getState();
  const viewing = s.view.kind === "home" && s.view.dmId === conversationId && document.hasFocus();
  if (!viewing) setSocial((x) => void (x.unread[conversationId] = (x.unread[conversationId] ?? 0) + 1));
  if (!live || viewing || s.settings.manualPresence === "dnd" || s.settings.mutedChannels.includes(`annoy:${conversationId}`)) return;
  if (s.settings.messageSounds) playMessageFeedback();
  if (!s.settings.notifications) return;
  window.distopic?.flashWindow();
  if (!document.hasFocus() || s.view.kind === "service") {
    const sender = social().profiles[message.senderId];
    try {
      const n = new Notification(displayName(sender) || "Annoy", { body: message.state === "undecryptable" ? translate("social.newMessage") : message.content.slice(0, 140) || translate("social.sentAttachment"), silent: true });
      n.onclick = () => window.focus();
    } catch {
      /* the badge remains */
    }
  }
}

/** Everything that waited for this device while it was off. */
export async function syncPending(): Promise<void> {
  const generation = runtime.generation;
  for (let round = 0; round < 20; round++) {
    const page = await cloud<{ envelopes: Envelope[]; more: boolean }>("chat", `/v1/sync?device=${encodeURIComponent(cloudDevice())}`);
    for (const envelope of page.envelopes) {
      if (generation !== runtime.generation) return;
      await receiveEnvelope(envelope, false).catch(() => ack(envelope.id));
    }
    if (!page.more) return;
    // Let the acks land before asking for the next page.
    await new Promise((r) => setTimeout(r, 600));
  }
}

export function markDmRead(conversationId: string): void {
  if (social().unread[conversationId]) setSocial((s) => void delete s.unread[conversationId]);
}

let lastTyping = 0;
export function sendDmTyping(recipientId: string): void {
  if (Date.now() - lastTyping < 3000) return;
  lastTyping = Date.now();
  runtime.gateway?.send({ op: "typing", recipientId });
}
