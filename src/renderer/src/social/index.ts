import { t as translate } from "../../../shared/localization/index.ts";
import type { UserActivity } from "@annoy/protocol";
import { handleAccountEvent, signedIn as globalSignedIn } from "../auth/session.ts";
import { getState, setState, subscribe, toast } from "../store.ts";
import { cloud, cloudUrls } from "./cloud.ts";
import * as dm from "./dm-crypto.ts";
import { loadDms, myDmKeys, publishDmKey, receiveEnvelope, resetDms, syncPending } from "./dms.ts";
import { CloudGateway, type CloudEvent } from "./gateway.ts";
import * as local from "./local-db.ts";
import { cloudDevice, runtime, setSocial, social } from "./runtime.ts";
import { emptySocial, type CloudPresence, type CloudProfile, type CloudRelationship, type ServerVisibility, type WhereInfo } from "./types.ts";

/**
 * The Annoy account's social layer (TODO item 1). Friends, DMs, status and
 * direct calls live in the Annoy cloud, not in any annoy-server: this runs
 * whenever an Annoy account is signed in, with zero or many servers open.
 * Servers with local accounts keep their own flows (client.ts).
 */

type ManualPresence = "online" | "idle" | "dnd" | "offline";
const statusOf = (manual: ManualPresence) => (manual === "offline" ? "invisible" : manual);

const own = {
  idle: false,
  activities: [] as UserActivity[],
  where: null as WhereInfo | null,
};
const interest = new Map<string, number>();
const callHandlers = new Set<(event: CloudEvent) => void>();

// --- Lifecycle ----------------------------------------------------------------------

/** Starts or stops with the Annoy account. Called once at app start. */
let initialized = false;
export function initSocial(): void {
  if (initialized) return;
  initialized = true;
  let signedIn = false;
  const check = () => {
    const now = !!getState().global && globalSignedIn();
    if (now === signedIn) return;
    signedIn = now;
    if (now) void start();
    else stop();
  };
  subscribe(check);
  subscribe(bridgeServers);
  check();
  window.addEventListener("online", () => runtime.gateway?.nudge());
}

async function start(): Promise<void> {
  const generation = ++runtime.generation;
  setSocial((s) => Object.assign(s, emptySocial(), { status: "connecting" }));
  try {
    await cloudUrls();
    const me = await cloud<CloudProfile & { serverVisibility: ServerVisibility }>("users", "/v1/users/@me");
    if (generation !== runtime.generation) return;
    runtime.me = me.id;
    setSocial((s) => {
      s.me = me;
      s.profiles[me.id] = me;
    });
    await Promise.all([publishDmKey().catch(() => undefined), loadRelationships(), loadDms()]);
  } catch (error) {
    if (generation !== runtime.generation) return;
    setSocial((s) => void (s.status = "offline"));
    console.warn("Annoy cloud unavailable", (error as Error).message);
  }
  if (generation !== runtime.generation) return;
  runtime.gateway = new CloudGateway({
    device: cloudDevice(),
    hello: () => ({ status: statusOf(getState().settings.manualPresence), idle: own.idle, activities: own.activities, features: ["directCalls"], where: null }),
    onEvent: (event) => handle(event, generation),
    onStatus: (status) => {
      if (generation === runtime.generation) setSocial((s) => void (s.status = status));
    },
  });
  void runtime.gateway.connect();
}

function stop(): void {
  runtime.generation++;
  const userId = runtime.me;
  runtime.gateway?.close();
  runtime.gateway = null;
  runtime.me = null;
  resetDms();
  setSocial((s) => Object.assign(s, emptySocial()));
  // Signing out removes this device's copy of the DMs (TODO item 2.3).
  if (userId) void local.wipe(userId);
  for (const handler of callHandlers) handler({ t: "SIGNED_OUT", d: null });
}

// --- Events -------------------------------------------------------------------------

async function handle(event: CloudEvent, generation: number): Promise<void> {
  if (generation !== runtime.generation) return;
  switch (event.t) {
    case "READY":
      sendWatch();
      void publishWhere();
      void syncPending().catch((error) => console.warn("DM sync failed", (error as Error).message));
      // A reconnect may have missed relationship or DM changes.
      void loadRelationships().catch(() => undefined);
      void loadDms().catch(() => undefined);
      return;
    case "PRESENCES":
      for (const view of Object.values(event.d as Record<string, PresenceView>)) await applyPresence(view);
      return;
    case "PRESENCE_UPDATE":
      return applyPresence(event.d as PresenceView);
    case "PROFILE_DETAILS_UPDATE":
      setSocial((s) => { s.detailsRevision++; });
      return;
    case "USER_UPDATE": {
      const p = event.d as CloudProfile;
      setSocial((s) => {
        s.profiles[p.id] = p;
        for (const r of s.relationships) if (r.user.id === p.id) r.user = p;
        if (s.me?.id === p.id) Object.assign(s.me, p);
      });
      return;
    }
    case "RELATIONSHIP_UPDATE": {
      const rel = event.d as CloudRelationship;
      const before = social().relationships.find((r) => r.user.id === rel.user.id);
      setSocial((s) => {
        const i = s.relationships.findIndex((r) => r.user.id === rel.user.id);
        if (i >= 0) s.relationships[i] = rel;
        else s.relationships.push(rel);
        s.profiles[rel.user.id] = rel.user;
      });
      if (rel.status === "incoming" && !before) toast(translate("social.friendRequestFrom", { p0: rel.user.displayName || rel.user.username }));
      sendWatch();
      void publishWhere();
      return;
    }
    case "RELATIONSHIP_REMOVE":
      setSocial((s) => {
        s.relationships = s.relationships.filter((r) => r.user.id !== event.d.userId);
      });
      sendWatch();
      for (const handler of callHandlers) handler(event);
      return;
    case "DM_CREATE":
    case "DM_UPDATE":
      setSocial((s) => {
        const i = s.dms.findIndex((d) => d.id === event.d.id);
        if (i >= 0) s.dms[i] = event.d;
        else s.dms.unshift(event.d);
      });
      sendWatch();
      return;
    case "ENVELOPE":
      return receiveEnvelope(event.d, true).catch((error) => console.warn("DM receive failed", (error as Error).message));
    case "TYPING":
      setSocial((s) => void (s.typing[event.d.userId] = Date.now() + 8000));
      return;
    case "CALL_UPDATE":
    case "CALL_SIGNAL":
    case "CALL_ERROR":
      for (const handler of callHandlers) handler(event);
      return;
    case "NEW_LOGIN":
    case "SESSION_REVOKED":
      handleAccountEvent(event);
      return;
    case "VAULT_CHANGED":
      // A server was added or removed on another install: follow it now.
      void import("../auth/servers.ts").then((m) => m.vaultChanged());
      return;
    case "INVALID_SESSION":
      return;
  }
}

/** Direct calls (features/direct-calls.ts) listen here. */
export function onCallEvent(handler: (event: CloudEvent) => void): () => void {
  callHandlers.add(handler);
  return () => callHandlers.delete(handler);
}

interface PresenceView {
  userId: string;
  status: CloudPresence["status"];
  chosen?: CloudPresence["chosen"];
  activities: UserActivity[];
  where: { public?: unknown; sealed?: dm.Sealed; friends?: unknown } | null;
}

async function applyPresence(view: PresenceView): Promise<void> {
  let where: WhereInfo | null = null;
  const me = runtime.me;
  if (view.userId === me) where = own.where;
  else if (view.where?.public && typeof view.where.public === "object") where = cleanWhere(view.where.public);
  else if (view.where?.sealed && me) {
    try {
      const other = social().profiles[view.userId] ?? social().relationships.find((r) => r.user.id === view.userId)?.user;
      if (other?.dmKey) {
        const key = await dm.conversationKey(await myDmKeys(), me, other.dmKey, other.id);
        where = cleanWhere(await dm.openFromFriend(key, other.id, me, view.where.sealed));
      }
    } catch {
      where = null;
    }
  }
  const presence: CloudPresence = { status: view.status, ...(view.chosen !== undefined && { chosen: view.chosen }), activities: Array.isArray(view.activities) ? view.activities : [], where };
  setSocial((s) => {
    if (JSON.stringify(s.presences[view.userId]) !== JSON.stringify(presence)) s.presences[view.userId] = presence;
  });
}

function cleanWhere(value: unknown): WhereInfo | null {
  const w = value as Record<string, unknown> | null;
  if (!w || typeof w.server !== "string") return null;
  return { server: w.server.slice(0, 100), channel: typeof w.channel === "string" ? w.channel.slice(0, 100) : null };
}

// --- Watch list: whose status this app needs --------------------------------------

let watchTimer: ReturnType<typeof setTimeout> | null = null;
function sendWatch(): void {
  if (watchTimer) return;
  watchTimer = setTimeout(() => {
    watchTimer = null;
    const s = social();
    const ids = new Set<string>();
    for (const r of s.relationships) ids.add(r.user.id);
    for (const d of s.dms) ids.add(d.recipientId);
    for (const id of interest.keys()) if (ids.size < 1900) ids.add(id);
    for (const id of serverInterest) if (ids.size < 1900) ids.add(id);
    runtime.gateway?.send({ op: "watch", ids: [...ids] });
  }, 150);
}

/**
 * Members of an open server that use Annoy accounts: the app shows their
 * status from chatannoy. Returns a function that drops the interest.
 */
export function watchPresence(ids: string[]): () => void {
  for (const id of ids) interest.set(id, (interest.get(id) ?? 0) + 1);
  sendWatch();
  return () => {
    for (const id of ids) {
      const n = (interest.get(id) ?? 1) - 1;
      if (n <= 0) interest.delete(id);
      else interest.set(id, n);
    }
    sendWatch();
  };
}

/**
 * Servers in Annoy-account mode no longer send status (TODO item 1). Members
 * that carry an Annoy ID get their status and activity from chatannoy here,
 * written into the server's state so the member list works as before.
 */
let serverInterest = new Set<string>();
let bridged: { presences: unknown; instances: unknown } = { presences: null, instances: null };
function bridgeServers(): void {
  const s = getState();
  if (s.social.presences === bridged.presences && s.instances === bridged.instances) return;
  bridged = { presences: s.social.presences, instances: s.instances };
  const wanted = new Set<string>();
  const pairs: [string, string, string][] = [];
  for (const [accountId, inst] of Object.entries(s.instances)) {
    if (!inst.instance?.annoySocial) continue;
    for (const server of Object.values(inst.serverStates))
      for (const m of server.members)
        if (m.user.annoyId) {
          wanted.add(m.user.annoyId);
          pairs.push([accountId, m.user.id, m.user.annoyId]);
        }
  }
  if (wanted.size !== serverInterest.size || [...wanted].some((id) => !serverInterest.has(id))) {
    serverInterest = wanted;
    sendWatch();
  }
  const changes = pairs.filter(([accountId, userId, annoyId]) => {
    const p = s.social.presences[annoyId];
    const inst = s.instances[accountId]!;
    return (inst.presences[userId] ?? "offline") !== (p?.status ?? "offline") || JSON.stringify(inst.activities[userId] ?? []) !== JSON.stringify(p?.activities ?? []);
  });
  const memberChanges = pairs.some(([accountId, userId, annoyId]) =>
    Object.values(s.instances[accountId]!.serverStates).some((st) => st.members.some((m) => m.user.id === userId && m.presence !== (s.social.presences[annoyId]?.status ?? "offline"))),
  );
  if (!changes.length && !memberChanges) return;
  setState((draft) => {
    for (const [accountId, userId, annoyId] of pairs) {
      const p = draft.social.presences[annoyId];
      const inst = draft.instances[accountId];
      if (!inst) continue;
      const status = p?.status ?? "offline";
      if ((inst.presences[userId] ?? "offline") !== status) inst.presences[userId] = status;
      if (JSON.stringify(inst.activities[userId] ?? []) !== JSON.stringify(p?.activities ?? [])) inst.activities[userId] = (p?.activities ?? []) as UserActivity[];
      for (const st of Object.values(inst.serverStates)) for (const m of st.members) if (m.user.id === userId && m.presence !== status) m.presence = status;
    }
  });
}

// --- Own presence -------------------------------------------------------------------

export function publishPresence(update: { idle?: boolean; activities?: UserActivity[]; manual?: ManualPresence }): void {
  if (update.idle !== undefined) own.idle = update.idle;
  if (update.activities !== undefined) own.activities = update.activities;
  runtime.gateway?.send({ op: "presence", status: statusOf(update.manual ?? getState().settings.manualPresence), idle: own.idle, activities: own.activities });
}

/**
 * "Which server I'm in" (TODO item 1): nobody by default; friends get it
 * sealed one by one, so chatannoy can't read it; "public" sends it plain.
 * People who share the server see it inside the server anyway.
 */
export async function setWhere(where: WhereInfo | null): Promise<void> {
  own.where = where;
  await publishWhere();
}

async function publishWhere(): Promise<void> {
  const s = social();
  const me = runtime.me;
  if (!me || !s.me) return;
  const visibility = s.me.serverVisibility;
  let payload: unknown = null;
  if (own.where && getState().settings.manualPresence !== "offline") {
    if (visibility === "public") payload = { public: own.where };
    else if (visibility === "friends") {
      const friends: Record<string, dm.Sealed> = {};
      const mine = await myDmKeys();
      for (const r of s.relationships) {
        if (r.status !== "friend" || !r.user.dmKey) continue;
        try {
          friends[r.user.id] = await dm.sealForFriend(await dm.conversationKey(mine, me, r.user.dmKey, r.user.id), me, r.user.id, own.where);
        } catch {
          /* skip that friend */
        }
      }
      payload = { friends };
    }
  }
  runtime.gateway?.send({ op: "presence", where: payload });
}

// --- Profile and friends ------------------------------------------------------------

async function loadRelationships(): Promise<void> {
  const rels = await cloud<CloudRelationship[]>("users", "/v1/relationships");
  setSocial((s) => {
    s.relationships = rels;
    for (const r of rels) s.profiles[r.user.id] = r.user;
  });
  sendWatch();
}

export async function updateProfile(patch: { displayName?: string | null; bio?: string | null; avatar?: string | null; banner?: string | null; serverVisibility?: ServerVisibility }): Promise<void> {
  const me = await cloud<CloudProfile & { serverVisibility: ServerVisibility }>("users", "/v1/users/@me", { method: "PATCH", body: patch });
  setSocial((s) => {
    s.me = me;
    s.profiles[me.id] = me;
  });
  if (patch.serverVisibility) await publishWhere();
}

export async function uploadProfileImage(file: File, kind: "avatar" | "banner"): Promise<string> {
  const { id } = await cloud<{ id: string }>("cdn", `/v1/images?kind=${kind}`, { raw: file, contentType: file.type });
  return id;
}

export async function addFriend(nameOrId: string): Promise<void> {
  const value = nameOrId.trim();
  await cloud("users", "/v1/relationships", { body: /^U[0-9A-HJKMNP-TV-Z]{11}$/.test(value) ? { userId: value } : { username: value.replace(/^@/, "") } });
}

export const acceptFriend = (userId: string) => cloud("users", `/v1/relationships/${userId}`, { method: "PUT", body: {} });
export const removeFriend = (userId: string) => cloud("users", `/v1/relationships/${userId}`, { method: "DELETE" });
export const setFriendNickname = (userId: string, nickname: string | null) => cloud("users", `/v1/relationships/${userId}`, { method: "PATCH", body: { nickname } });

/** Profiles by Annoy ID (DM list, server members), fetched in batches. */
export async function ensureProfiles(ids: string[]): Promise<void> {
  const missing = [...new Set(ids)].filter((id) => !social().profiles[id]);
  for (let i = 0; i < missing.length; i += 200) {
    const { users } = await cloud<{ users: CloudProfile[] }>("users", "/v1/users/batch", { body: { ids: missing.slice(i, i + 200) } });
    setSocial((s) => {
      for (const u of users) s.profiles[u.id] = u;
    });
  }
}

export const socialReady = () => social().status === "ready";
export { displayName } from "./runtime.ts";
