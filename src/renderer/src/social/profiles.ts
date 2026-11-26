// One place for a person's profile (decided 2026-11-26).
//
// - Annoy accounts: the profile (name, photo, bio and @username) exists only in usersannoy. Servers
//   send just the Annoy ID; the app reads the profile here, by ID, in batches.
// - Local accounts (local-mode servers, no Annoy account): the server's own profile, sent in
//   `User.profile`. It is the only exception.
// - A minimal local cache keeps the last answer of usersannoy for each ID. Every answer and every
//   change (own edits, cloud events) updates it at once; it is read only while the Annoy cloud does
//   not answer at all.
import { useEffect, useSyncExternalStore } from "react";
import type { User } from "@annoy/protocol";
import { getState, subscribe, useStore } from "../store.ts";
import { cloud, cloudReachable, imageUrl, onCloudReachability } from "./cloud.ts";
import { setSocial } from "./runtime.ts";
import type { CloudProfile } from "./types.ts";

/** What the app shows for someone: the profile's attributes with the @username. */
export interface Person {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio?: string;
}

export const isPerson = (value: User | Person): value is Person => "displayName" in value;

export const personFromCloud = (profile: CloudProfile): Person => ({
  id: profile.id,
  username: profile.username,
  displayName: profile.displayName || profile.username,
  avatarUrl: imageUrl(profile.avatar),
  bio: profile.bio ?? "",
});

/** Someone whose profile is not known yet: no name, no photo (initials from nothing). */
const unknownPerson = (id: string): Person => ({ id, username: "", displayName: "", avatarUrl: null, bio: "" });

// --- Minimal cache (localStorage) -------------------------------------------------------

type Cached = Pick<CloudProfile, "id" | "username" | "displayName" | "avatar" | "bio">;
const CACHE_KEY = "annoy.profileCache.v1";
const MAX_CACHED = 2000;
const cache = new Map<string, Cached>();
try {
  const raw = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "[]") as unknown;
  if (Array.isArray(raw)) for (const item of raw as Cached[]) if (item && typeof item.id === "string" && typeof item.username === "string") cache.set(item.id, item);
} catch { /* no cache */ }

let writeTimer: ReturnType<typeof setTimeout> | null = null;
function remember(profiles: Iterable<CloudProfile>): void {
  let changed = false;
  for (const p of profiles) {
    const next: Cached = { id: p.id, username: p.username, displayName: p.displayName, avatar: p.avatar, bio: p.bio };
    const old = cache.get(p.id);
    if (old && old.username === next.username && old.displayName === next.displayName && old.avatar === next.avatar && old.bio === next.bio) continue;
    cache.delete(p.id);
    cache.set(p.id, next);
    changed = true;
  }
  if (!changed) return;
  while (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    try { localStorage.setItem(CACHE_KEY, JSON.stringify([...cache.values()])); } catch { /* storage full: keep in memory */ }
  }, 300);
}

// Every profile that reaches the app (batches, own edits, cloud events, friends) updates the cache.
let lastProfiles = getState().social.profiles;
subscribe(() => {
  const profiles = getState().social.profiles;
  if (profiles === lastProfiles) return;
  const previous = lastProfiles;
  lastProfiles = profiles;
  remember(Object.values(profiles).filter((p) => previous[p.id] !== p));
});

// --- Reading ------------------------------------------------------------------------------

const useReachable = () => useSyncExternalStore(onCloudReachability, cloudReachable);

/** The Annoy profile of an ID: from usersannoy; from the cache only while the cloud does not answer. */
export function annoyProfileOf(annoyId: string, profiles = getState().social.profiles, reachable = cloudReachable()): CloudProfile | Cached | undefined {
  return profiles[annoyId] ?? (reachable ? undefined : cache.get(annoyId));
}

/** What to show for a server user (or an already shown person). */
export function personOf(user: User | Person, profiles = getState().social.profiles, reachable = cloudReachable()): Person {
  if (isPerson(user)) return user;
  if (user.annoyId) {
    const profile = annoyProfileOf(user.annoyId, profiles, reachable);
    return profile ? { ...personFromCloud(profile as CloudProfile), id: user.id } : unknownPerson(user.id);
  }
  if (user.profile) return { id: user.id, username: user.username ?? "", displayName: user.profile.displayName, avatarUrl: user.profile.avatarUrl, bio: user.profile.bio ?? "" };
  return unknownPerson(user.id);
}

/** Hook form of personOf: re-renders when the profile arrives or changes, and asks for it when missing. */
export function usePerson(user: User | Person | null | undefined): Person | null {
  const annoyId = user && !isPerson(user) ? user.annoyId ?? null : null;
  const profile = useStore((s) => (annoyId ? s.social.profiles[annoyId] : undefined));
  const reachable = useReachable();
  useEffect(() => { if (annoyId) requestProfiles([annoyId]); }, [annoyId]);
  if (!user) return null;
  return personOf(user, annoyId && profile ? { [annoyId]: profile } : {}, reachable);
}

/** Re-renders a list when any profile arrives (member lists, messages). */
export function useProfilesRevision(): void {
  useStore((s) => s.social.profiles);
  useReachable();
}

// --- Asking usersannoy --------------------------------------------------------------------

const STALE_MS = 5 * 60_000;
const fetchedAt = new Map<string, number>();
const queued = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/** Reads these Annoy IDs from usersannoy (batched; again after 5 minutes, so names stay current). */
export function requestProfiles(ids: Iterable<string>): void {
  const now = Date.now();
  for (const id of ids) {
    if (!id || queued.has(id)) continue;
    if (now - (fetchedAt.get(id) ?? 0) < STALE_MS && getState().social.profiles[id]) continue;
    queued.add(id);
  }
  if (!queued.size || flushTimer) return;
  flushTimer = setTimeout(flush, 30);
}

async function flush(): Promise<void> {
  flushTimer = null;
  if (!getState().global) { queued.clear(); return; }
  const ids = [...queued];
  queued.clear();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    try {
      const { users } = await cloud<{ users: CloudProfile[] }>("users", "/v1/users/batch", { body: { ids: chunk } });
      const now = Date.now();
      for (const id of chunk) fetchedAt.set(id, now);
      setSocial((s) => { for (const u of users) s.profiles[u.id] = u; });
    } catch {
      /* not now: the next request tries again */
    }
  }
}

/** Annoy IDs of the users of every connected server, read as soon as the members arrive. */
export function requestServerProfiles(): () => void {
  let last: unknown = null;
  const seen = new WeakSet<object>();
  return subscribe(() => {
    const instances = getState().instances;
    if (instances === last) return;
    last = instances;
    const ids: string[] = [];
    for (const inst of Object.values(instances)) {
      if (inst.user?.annoyId) ids.push(inst.user.annoyId);
      for (const state of Object.values(inst.serverStates)) {
        // Member lists are immutable: only a new list is read again.
        if (seen.has(state.members)) continue;
        seen.add(state.members);
        for (const m of state.members) if (m.user.annoyId) ids.push(m.user.annoyId);
      }
    }
    if (ids.length) requestProfiles(ids);
  });
}
