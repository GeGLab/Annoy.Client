import { cloudUrls } from "../../social/cloud.ts";
import { pruneCache, readCache, writeCache } from "./storage.ts";
import { searchText, type MediaItem, type MediaKind } from "./types.ts";

/**
 * The Annoy emoji set on cdnannoy: the same for every user, changed on the
 * server without an app release. The list and the images live in a local
 * cache; the list is asked again at most once every 2 hours (a 304 when
 * nothing changed). Images never change (content-hash URLs), so each one is
 * downloaded once.
 */
export const REFRESH_MS = 2 * 60 * 60_000;
/** After a failed check, wait before trying again; the cached set keeps working. */
const RETRY_MS = 10 * 60_000;
const SET_KEY = "annoy-set";
const imageKey = (url: string) => `annoy-image:${url}`;

interface RemoteItem { id: string; name: string; kind: MediaKind; url: string; size?: number; animated?: boolean }
export const STICKER_SIZE = { min: 32, max: 512, default: 160 } as const;
const IMAGE_URL = /^https?:\/\/[^/\s]+\/i\/[a-f0-9]{40}\.(png|jpg|webp|gif)$/;
interface Cached { checkedAt: number; etag: string | null; version: string; items: RemoteItem[] }

let memory: Cached | null = null;
let pending: Promise<Cached | null> | null = null;
let failedAt = 0;
const now = () => Date.now();

function valid(raw: unknown): raw is { version: string; items: RemoteItem[] } {
  if (!raw || typeof raw !== "object") return false;
  const value = raw as { version?: unknown; items?: unknown };
  return typeof value.version === "string" && Array.isArray(value.items) && value.items.length <= 500 && value.items.every((item) =>
    !!item && typeof item === "object" && typeof item.id === "string" && typeof item.name === "string" && item.name.length <= 32 &&
    ["emoji", "sticker", "gif"].includes(item.kind) && typeof item.url === "string" && IMAGE_URL.test(item.url) &&
    (item.size === undefined || (Number.isInteger(item.size) && item.size >= STICKER_SIZE.min && item.size <= STICKER_SIZE.max)));
}

async function refresh(cached: Cached | null): Promise<Cached | null> {
  const { cdn } = await cloudUrls();
  const response = await fetch(`${cdn}/v1/emojis`, {
    credentials: "omit",
    cache: "no-store",
    headers: cached?.etag ? { "if-none-match": cached.etag } : {},
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 304 && cached) return { ...cached, checkedAt: now() };
  if (!response.ok) throw new Error(`emojis ${response.status}`);
  const raw: unknown = await response.json();
  if (!valid(raw)) throw new Error("invalid emoji set");
  const next: Cached = { checkedAt: now(), etag: response.headers.get("etag"), version: raw.version, items: raw.items };
  // Drop images that left the set (and old catalog pages from earlier versions).
  if (raw.version !== cached?.version) void pruneCache(new Set([SET_KEY, ...next.items.map((item) => imageKey(item.url))])).catch(() => undefined);
  return next;
}

/**
 * The set from the cache; asks cdnannoy when the cache is older than 2 hours,
 * or right away with `fresh` (the picker opening), so new items show at once.
 * An unchanged set answers 304 with no body.
 */
export function annoySet(fresh = false): Promise<Cached | null> {
  if (pending) return pending;
  // Clear only after the assignment: the body can finish without awaiting anything.
  const current = (async () => {
    memory ??= (await readCache<Cached>(SET_KEY).catch(() => undefined)) ?? null;
    const due = fresh || !memory || now() - memory.checkedAt >= REFRESH_MS;
    if (!due || (!fresh && now() - failedAt < RETRY_MS)) return memory;
    try {
      memory = await refresh(memory);
      if (memory) void writeCache(SET_KEY, memory).catch(() => undefined);
    } catch {
      failedAt = now();
    }
    return memory;
  })();
  pending = current;
  void current.finally(() => { if (pending === current) pending = null; });
  return current;
}

/** Asks cdnannoy for changes now (when a picker opens). */
export const refreshAnnoySet = () => annoySet(true);

export async function readAnnoyItems(kind: MediaKind, query = ""): Promise<MediaItem[]> {
  const set = await annoySet();
  const needle = searchText(query.trim());
  return (set?.items ?? [])
    .filter((item) => item.kind === kind && (!needle || searchText(item.name).includes(needle)))
    .map((item) => ({ id: `annoy-${item.id}`, name: item.name, kind: item.kind, url: item.url, remote: true, size: item.size ?? STICKER_SIZE.default }));
}

/**
 * Annoy stickers are sent as the image link on cdnannoy (like GIPHY), so the
 * animation stays and every app draws them at the size set in admannoy.
 */
export function isAnnoySticker(content: string, cdn: string): boolean {
  const text = content.trim();
  return IMAGE_URL.test(text) && text.startsWith(`${cdn.replace(/\/+$/, "")}/i/`);
}
/** The display size from the cached set; the default when the item left the set. */
export async function stickerSize(url: string): Promise<number> {
  const set = await annoySet();
  return set?.items.find((item) => item.url === url)?.size ?? STICKER_SIZE.default;
}

/** The image bytes, from the local cache first; downloaded once otherwise. */
export async function annoyImage(url: string): Promise<Blob> {
  const cached = await readCache<Blob>(imageKey(url)).catch(() => undefined);
  if (cached instanceof Blob && cached.size) return cached;
  const response = await fetch(url, { credentials: "omit", signal: AbortSignal.timeout(20_000) });
  const type = response.headers.get("content-type")?.split(";")[0] ?? "";
  if (!response.ok || !/^image\/(png|jpeg|webp|gif)$/.test(type)) throw new Error(`emoji image ${response.status}`);
  const blob = await response.blob();
  if (blob.size > 8 * 1024 * 1024) throw new Error("emoji image too large");
  void writeCache(imageKey(url), new Blob([blob], { type })).catch(() => undefined);
  return new Blob([blob], { type });
}
