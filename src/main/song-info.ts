import type { IpcMain, IpcMainInvokeEvent } from "electron";
import { youtubeId } from "./theater.ts";
import type { LyricLine, SongInfo } from "../shared/song-info.ts";

export type { LyricLine, SongInfo };

// Song rooms show the cover, album and synced lyrics of what's playing. A room only knows a
// title ("Slipknot - Nero Forte (Official Video)"), so it is cleaned up and looked up in two
// public catalogs that need no account: LRCLIB for lyrics, Deezer (then iTunes) for the
// album and its cover. Lookups run here, away from the page, and are cached for the session.

const TIMEOUT_MS = 8000;
const NOISE = /\b(official|oficial|video|v[ií]deo|clipe|videoclipe|lyrics?|letra|legendad[oa]|tradu[çc][ãa]o|audio|áudio|visuali[sz]er|hd|hq|4k|remaster(ed)?|mv|m\/v|music video|explicit|color coded|live|ao vivo|full album)\b/i;

/** "Artist - Track (Official Video) [4K]" → artist and track, without the decoration. */
export function parseTitle(raw: string): { artist: string | null; track: string } {
  let title = raw
    .replace(/\.(mp3|m4a|flac|wav|ogg|opus|webm|mp4|mkv|aac)$/i, "")
    .replace(/[_]+/g, " ")
    .replace(/【[^】]*】|\[[^\]]*\]/g, " ")
    .replace(/\(([^)]*)\)/g, (whole, inner: string) => (NOISE.test(inner) ? " " : whole))
    .replace(/\s+[|｜/]\s+.*$/, "")
    .replace(/\b(official (music )?video|lyric video|official audio|clipe oficial|v[ií]deo oficial)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  title = title.replace(/[\s\-–—:]+$/, "");
  const split = /^(.+?)\s+[-–—~]\s+(.+)$/.exec(title);
  const clean = (text: string) => text.replace(/^["“'‘]+|["”'’]+$/g, "").trim();
  if (split) return { artist: clean(split[1]!), track: clean(split[2]!.replace(/\s+(ft\.?|feat\.?|featuring)\s+.*$/i, "")) };
  return { artist: null, track: clean(title) };
}

/** An answer the catalog gave (even "nothing") is null; no answer at all throws, so it isn't cached. */
async function getJson<T>(url: string): Promise<T | null> {
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "error", headers: { accept: "application/json" } });
  if (response.status >= 500 || response.status === 429) throw new Error(`catalog ${response.status}`);
  if (!response.ok) return null;
  const text = await response.text();
  if (text.length > 4_000_000) return null;
  try { return JSON.parse(text) as T; } catch { return null; }
}

/** LRC text ("[01:02.50] line", several stamps allowed) → lines in time order. */
export function parseLrc(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const row of lrc.split(/\r?\n/).slice(0, 4000)) {
    const stamps = [...row.matchAll(/\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g)];
    if (!stamps.length) continue;
    const text = row.replace(/\[[^\]]*\]/g, "").trim();
    for (const [, min, sec] of stamps) lines.push({ time: Number(min) * 60 + Number(sec!.replace(":", ".")), text });
  }
  return lines.filter((line) => Number.isFinite(line.time)).sort((a, b) => a.time - b.time);
}

interface LrcRecord { trackName: string; artistName: string; albumName: string | null; duration: number | null; instrumental: boolean; plainLyrics: string | null; syncedLyrics: string | null }

const norm = (text: string | null | undefined) => (text ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const alike = (a: string | null | undefined, b: string | null | undefined) => {
  const x = norm(a), y = norm(b);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
};

function score(record: LrcRecord, wanted: { artist: string | null; track: string }, duration: number | null): number {
  let points = 0;
  if (record.syncedLyrics) points += 3;
  else if (record.plainLyrics || record.instrumental) points += 1;
  if (alike(record.trackName, wanted.track)) points += 3;
  if (wanted.artist && alike(record.artistName, wanted.artist)) points += 3;
  // Without an artist the "track" may hold both: reward records whose artist appears in it.
  if (!wanted.artist && norm(wanted.track).includes(norm(record.artistName))) points += 2;
  if (duration && record.duration) {
    const off = Math.abs(record.duration - duration);
    points += off <= 3 ? 3 : off <= 8 ? 1 : off > 25 ? -4 : 0;
  }
  return points;
}

async function lyricsFor(wanted: { artist: string | null; track: string }, duration: number | null): Promise<LrcRecord | null> {
  const base = "https://lrclib.net/api/search?";
  const queries = wanted.artist
    ? [new URLSearchParams({ track_name: wanted.track, artist_name: wanted.artist }), new URLSearchParams({ q: `${wanted.artist} ${wanted.track}` })]
    : [new URLSearchParams({ q: wanted.track })];
  for (const query of queries) {
    const found = await getJson<LrcRecord[]>(base + query.toString());
    if (!Array.isArray(found) || !found.length) continue;
    const best = found.slice(0, 20).map((record) => ({ record, points: score(record, wanted, duration) })).sort((a, b) => b.points - a.points)[0]!;
    // A weak match shows someone else's song's lyrics; nothing is better than that.
    if (best.points >= 5) return best.record;
  }
  return null;
}

/** A release in a music catalog: names as the catalog spells them, and the album cover. */
interface Release { artist: string; track: string; album: string | null; year: number | null; cover: string | null; duration: number | null }

function best<T>(items: readonly T[], names: (item: T) => { artist: string; track: string; duration: number | null }, artist: string | null, track: string, duration: number | null): T | null {
  const ranked = items
    .map((item) => {
      const found = names(item);
      let points = alike(found.track, track) ? 3 : 0;
      // A cover or karaoke version shows the wrong cover: the artist must match when it's known.
      if (artist) points += alike(found.artist, artist) ? 3 : -3;
      if (duration && found.duration) points += Math.abs(found.duration - duration) <= 5 ? 1 : 0;
      return { item, points };
    })
    .sort((a, b) => b.points - a.points);
  return ranked[0] && ranked[0].points >= 3 ? ranked[0].item : null;
}

interface DeezerTrack { title: string; duration?: number; artist?: { name: string }; album?: { id: number; title: string; cover_xl?: string; cover_big?: string } }

async function fromDeezer(artist: string | null, track: string, duration: number | null): Promise<Release | null> {
  const q = [artist, track].filter(Boolean).join(" ").slice(0, 200);
  const found = await getJson<{ data?: DeezerTrack[] }>(`https://api.deezer.com/search?${new URLSearchParams({ q, limit: "15" })}`);
  const song = best(found?.data ?? [], (t) => ({ artist: t.artist?.name ?? "", track: t.title, duration: t.duration ?? null }), artist, track, duration);
  if (!song) return null;
  // The search leaves the release date out; the album has it.
  const album = song.album ? await getJson<{ release_date?: string }>(`https://api.deezer.com/album/${encodeURIComponent(String(song.album.id))}`).catch(() => null) : null;
  const year = Number.parseInt(album?.release_date?.slice(0, 4) ?? "", 10);
  const cover = song.album?.cover_xl ?? song.album?.cover_big ?? null;
  return {
    artist: song.artist?.name ?? artist ?? "",
    track: song.title,
    album: song.album?.title ?? null,
    year: Number.isFinite(year) && year > 1000 ? year : null,
    cover: cover?.startsWith("https://") ? cover : null,
    duration: song.duration ?? null,
  };
}

interface ItunesSong { artistName: string; trackName: string; collectionName?: string; releaseDate?: string; artworkUrl100?: string; trackTimeMillis?: number }

async function fromItunes(artist: string | null, track: string, duration: number | null): Promise<Release | null> {
  const term = [artist, track].filter(Boolean).join(" ").slice(0, 200);
  const found = await getJson<{ results?: ItunesSong[] }>(`https://itunes.apple.com/search?${new URLSearchParams({ term, media: "music", entity: "song", limit: "15" })}`);
  const song = best(found?.results ?? [], (s) => ({ artist: s.artistName, track: s.trackName, duration: s.trackTimeMillis ? s.trackTimeMillis / 1000 : null }), artist, track, duration);
  if (!song) return null;
  const year = Number.parseInt(song.releaseDate?.slice(0, 4) ?? "", 10);
  return {
    artist: song.artistName,
    track: song.trackName,
    album: song.collectionName ?? null,
    year: Number.isFinite(year) ? year : null,
    cover: song.artworkUrl100?.startsWith("https://") ? song.artworkUrl100.replace(/\/\d+x\d+bb\./, "/600x600bb.") : null,
    duration: song.trackTimeMillis ? song.trackTimeMillis / 1000 : null,
  };
}

/** Deezer knows more of the catalog (iTunes misses many originals); iTunes covers the rest. */
async function releaseFor(artist: string | null, track: string, duration: number | null): Promise<Release | null> {
  const deezer = await fromDeezer(artist, track, duration).catch(() => null);
  if (deezer?.cover) return deezer;
  return (await fromItunes(artist, track, duration).catch(() => null)) ?? deezer;
}

function youtubeCover(url: string): string | null {
  const id = youtubeId(url);
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
}

async function lookup(url: string, title: string, duration: number | null): Promise<SongInfo> {
  const wanted = parseTitle(title);
  const lyrics = await lyricsFor(wanted, duration);
  // The lyrics catalog's names are cleaner than a video title: use them for the album search.
  const artist = lyrics?.artistName ?? wanted.artist;
  const track = lyrics?.trackName ?? wanted.track;
  const release = await releaseFor(artist, track, duration ?? lyrics?.duration ?? null);
  const synced = lyrics?.syncedLyrics ? parseLrc(lyrics.syncedLyrics) : null;
  return {
    artist: release?.artist || artist || null,
    track: release?.track ?? track,
    album: release?.album ?? lyrics?.albumName ?? null,
    year: release?.year ?? null,
    cover: release?.cover ?? youtubeCover(url),
    synced: synced?.length ? synced : null,
    plain: lyrics?.plainLyrics?.trim() || null,
    instrumental: !!lyrics?.instrumental,
    duration: lyrics?.duration ?? release?.duration ?? null,
  };
}

const cache = new Map<string, Promise<SongInfo>>();

export function registerSongInfo(ipc: IpcMain, allowed: (event: IpcMainInvokeEvent) => boolean): void {
  ipc.handle("song:info", (event, url: unknown, title: unknown, duration: unknown) => {
    if (!allowed(event) || typeof url !== "string" || typeof title !== "string" || url.length > 2048 || !title.trim() || title.length > 300) return null;
    const seconds = typeof duration === "number" && Number.isFinite(duration) && duration > 0 && duration < 86400 ? duration : null;
    const key = `${url}\n${title}`;
    let pending = cache.get(key);
    if (!pending) {
      pending = lookup(url, title, seconds);
      cache.set(key, pending);
      if (cache.size > 200) cache.delete(cache.keys().next().value!);
      // A failure isn't remembered: the next visit tries again.
      pending.catch(() => cache.delete(key));
    }
    return pending.catch(() => null);
  });
}
