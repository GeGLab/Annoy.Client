import { useSyncExternalStore } from "react";
import { cloud, cloudUrls } from "../../social/cloud.ts";
import { seenKey, dueOn, type Announcement, type PollDef, type PollState } from "./model.ts";
export * from "./model.ts";

/**
 * Announcements ("Comunicados") written in admannoy and served by cdnannoy.
 * On app open, with an Annoy account signed in, the ones this device has not
 * seen open once in a tabbed dialog, only on the local day they were
 * published (or reopened). "Seen" lives only on this device. All of them stay
 * in Settings → Updates → Announcements.
 */
const CACHE_KEY = "annoy.announcements";
const SEEN_KEY = "annoy.announcements.seen";
const MAX_SEEN = 500;

interface Cached { etag: string | null; items: Announcement[] }

function valid(raw: unknown): raw is { items: Announcement[] } {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as { items?: unknown }).items)) return false;
  return (raw as { items: unknown[] }).items.every((item) => {
    const a = item as Partial<Announcement>;
    return typeof a?.id === "string" && Number.isInteger(a.revision) && Array.isArray(a.polls) && !!a.locales && typeof a.locales === "object" &&
      typeof a.locales.en?.title === "string" && typeof a.locales.en.body === "string";
  });
}

function readCache(): Cached | null {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null") as unknown;
    return raw && valid(raw) ? (raw as Cached) : null;
  } catch {
    return null;
  }
}

let items: Announcement[] = readCache()?.items ?? [];
const listeners = new Set<() => void>();
const emit = () => { for (const listener of listeners) listener(); };

/** The published announcements, newest first. Keeps the cached list when cdnannoy can't be reached. */
export async function loadAnnouncements(): Promise<Announcement[]> {
  const cached = readCache();
  try {
    const { cdn } = await cloudUrls();
    const response = await fetch(`${cdn}/v1/announcements`, {
      credentials: "omit",
      cache: "no-store",
      headers: cached?.etag ? { "if-none-match": cached.etag } : {},
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 304 && cached) items = cached.items;
    else {
      if (!response.ok) throw new Error(`announcements ${response.status}`);
      const raw: unknown = await response.json();
      if (!valid(raw)) throw new Error("invalid announcements");
      items = raw.items;
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ etag: response.headers.get("etag"), items } satisfies Cached)); } catch { /* full storage: keep it in memory */ }
    }
  } catch {
    items = cached?.items ?? items;
  }
  emit();
  return items;
}

export function useAnnouncements(): Announcement[] {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => items);
}

// Seen, on this device only. A reopened announcement has a new revision.
function readSeen(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}
export function markSeen(list: Announcement[]): void {
  const seen = readSeen();
  for (const a of list) if (!seen.includes(seenKey(a))) seen.push(seenKey(a));
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(seen.slice(-MAX_SEEN))); } catch { /* ignore */ }
}

/** Not seen on this device and published (or reopened) today on its clock. */
export const dueToday = (list: Announcement[], now = new Date()) => dueOn(list, new Set(readSeen()), now);

// The dialog: which announcements and which tab.
export interface DialogState { ids: string[]; selected: string }
let dialog: DialogState | null = null;
const dialogListeners = new Set<() => void>();
export function openAnnouncements(ids: string[], selected = ids[0]): void {
  if (!ids.length || !selected) return;
  dialog = { ids, selected };
  for (const l of dialogListeners) l();
}
export function selectAnnouncement(id: string): void {
  if (!dialog) return;
  dialog = { ...dialog, selected: id };
  for (const l of dialogListeners) l();
}
export function closeAnnouncements(): void {
  dialog = null;
  for (const l of dialogListeners) l();
}
export function useAnnouncementDialog(): DialogState | null {
  return useSyncExternalStore((listener) => { dialogListeners.add(listener); return () => dialogListeners.delete(listener); }, () => dialog);
}

let checked = false;
/** Once per app launch, after the Annoy account is signed in. */
export async function showDueAnnouncements(): Promise<void> {
  if (checked) return;
  checked = true;
  const due = dueToday(await loadAnnouncements());
  if (!due.length) return;
  markSeen(due);
  openAnnouncements(due.map((a) => a.id));
}

// Polls: the account's vote is stored only as an anonymous marker on cdnannoy.
const pollPath = (a: Announcement, poll: PollDef) => `/v1/announcements/${encodeURIComponent(a.id)}/polls/${encodeURIComponent(poll.id)}`;
export const fetchPoll = (a: Announcement, poll: PollDef) => cloud<PollState>("cdn", pollPath(a, poll));
export const sendVote = (a: Announcement, poll: PollDef, options: string[]) => cloud<PollState>("cdn", pollPath(a, poll), { method: "PUT", body: { options } });
