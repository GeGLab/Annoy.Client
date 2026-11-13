import type { IpcMain, IpcMainInvokeEvent } from "electron";
import { youtubeId } from "./theater.ts";
import type { LyricLine, SongInfo } from "../shared/song-info.ts";
import { parseLrc, parseLyricsfile } from "./lyrics-format.ts";

export type { LyricLine, SongInfo };
export { parseLrc, parseLyricsfile };

// Song rooms show the cover, album and synced lyrics of what's playing. A room only knows a
// title ("Slipknot - Nero Forte (Official Video)"), so it is cleaned up and looked up in
// public catalogs that need no account: LRCLIB for lyrics, Deezer (then iTunes) for the
// album and its cover. Lookups run here, away from the page, and are cached for the session.
//
// Lyrics are timed to one recording. A music video is often another (an intro, a scene, an
// edit), so the video's real length is read first and the lyrics timed to it are preferred;
// the room aligns the rest by ear (see the song room's alignment).

const TIMEOUT_MS = 8000;
const NOISE = /\b(official|oficial|video|v[ií]deo|clipe|videoclipe|lyrics?|letra|legendad[oa]|tradu[çc][ãa]o|audio|áudio|visuali[sz]er|hd|hq|4k|remaster(ed)?|mv|m\/v|music video|explicit|color coded|live|ao vivo|full album)\b/i;
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

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

/** The video's exact length, from its page: what plays, rather than what a catalog says. */
const videoLengths = new Map<string, Promise<number | null>>();
function youtubeLength(url: string): Promise<number | null> {
  const id = youtubeId(url);
  if (!id) return Promise.resolve(null);
  let pending = videoLengths.get(id);
  if (!pending) {
    pending = (async () => {
      try {
        const response = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(id)}`, {
          signal: AbortSignal.timeout(TIMEOUT_MS),
          // SOCS skips the cookie consent page some regions get instead of the video page.
          headers: { "accept-language": "en-US,en;q=0.8", "user-agent": BROWSER_UA, cookie: "SOCS=CAI" },
        });
        if (!response.ok) return null;
        const html = await response.text();
        const ms = /"approxDurationMs":"(\d+)"/.exec(html)?.[1];
        const seconds = ms ? Number(ms) / 1000 : Number(/"lengthSeconds":"(\d+)"/.exec(html)?.[1] ?? NaN);
        return Number.isFinite(seconds) && seconds > 0 && seconds < 86400 ? seconds : null;
      } catch {
        return null;
      }
    })();
    videoLengths.set(id, pending);
    if (videoLengths.size > 300) videoLengths.delete(videoLengths.keys().next().value!);
    void pending.then((value) => { if (value === null) videoLengths.delete(id); });
  }
  return pending;
}

// Lyrics ---------------------------------------------------------------------------------

interface LrcRecord {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string | null;
  duration: number | null;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
  hasWordSync?: boolean;
  lyricsfile?: string | null;
}

const norm = (text: string | null | undefined) => (text ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const alike = (a: string | null | undefined, b: string | null | undefined) => {
  const x = norm(a), y = norm(b);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
};

/** How well a record's names fit the title (timing aside). */
function textScore(record: LrcRecord, wanted: { artist: string | null; track: string }): number {
  let points = 0;
  if (record.syncedLyrics) points += 3;
  else if (record.plainLyrics || record.instrumental) points += 1;
  if (alike(record.trackName, wanted.track)) points += 3;
  if (wanted.artist && alike(record.artistName, wanted.artist)) points += 3;
  // Without an artist the "track" may hold both: reward records whose artist appears in it.
  if (!wanted.artist && norm(wanted.track).includes(norm(record.artistName))) points += 2;
  return points;
}

/** The first few line times: records sharing them share one timing, whatever length they claim. */
function signature(record: LrcRecord): string | null {
  if (!record.syncedLyrics) return null;
  const times = parseLrc(record.syncedLyrics).filter((line) => line.text).slice(0, 4).map((line) => line.time.toFixed(1));
  return times.length ? times.join("|") : null;
}

async function lyricsCandidates(wanted: { artist: string | null; track: string }): Promise<LrcRecord[]> {
  const base = "https://lrclib.net/api/search?";
  const queries = wanted.artist
    ? [new URLSearchParams({ track_name: wanted.track, artist_name: wanted.artist }), new URLSearchParams({ q: `${wanted.artist} ${wanted.track}` })]
    : [new URLSearchParams({ q: wanted.track })];
  const answers = await Promise.all(queries.map((query) => getJson<LrcRecord[]>(base + query.toString()).catch(() => undefined)));
  if (answers.every((answer) => answer === undefined)) throw new Error("lyrics catalog unreachable");
  const seen = new Set<number>();
  const out: LrcRecord[] = [];
  for (const answer of answers) for (const record of Array.isArray(answer) ? answer.slice(0, 25) : []) {
    if (!seen.has(record.id)) { seen.add(record.id); out.push(record); }
  }
  return out;
}

interface Picked { record: LrcRecord; /** Length of the recording its timing follows; null if the catalog can't tell. */ timedFor: number | null }

/**
 * The lyrics for the title, timed as close to the media as the catalog allows. LRCLIB holds
 * several takes per song: synced to the album, to a music video, to an edit, and copies of
 * one timing that claim another length. Records are grouped by their timing; a group that
 * holds the album's length is album-timed whatever its records claim.
 */
function pickLyrics(records: readonly LrcRecord[], wanted: { artist: string | null; track: string }, media: number | null, album: number | null): Picked | null {
  const fitting = records.map((record, index) => ({ record, index, text: textScore(record, wanted) })).filter((c) => c.text >= 5);
  if (!fitting.length) return null;
  const groups = new Map<string, LrcRecord[]>();
  for (const { record } of fitting) {
    const key = signature(record);
    if (key) groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  const timedFor = (record: LrcRecord): number | null => {
    const key = signature(record);
    const group = key ? groups.get(key)! : [record];
    if (album && group.some((r) => r.duration && Math.abs(r.duration - album) <= 2)) return album;
    // Full-length copies of one timing claiming lengths far apart: the timing fits one of them at best.
    const lengths = group.map((r) => r.duration ?? 0).filter((d) => d > 0);
    const longest = Math.max(0, ...lengths);
    const full = lengths.filter((d) => d >= longest * 0.6);
    if (full.length && Math.max(...full) - Math.min(...full) > 3) return album;
    return record.duration;
  };
  const ranked = fitting
    .map((c) => {
      const timing = timedFor(c.record);
      const off = media && timing ? Math.abs(timing - media) : null;
      return { ...c, timing, off };
    })
    .sort((a, b) =>
      Number(!!b.record.syncedLyrics) - Number(!!a.record.syncedLyrics)
      // Timed to what plays beats everything else; then the closest length.
      || (a.off === null ? 1 : a.off <= 2 ? 0 : 1) - (b.off === null ? 1 : b.off <= 2 ? 0 : 1)
      || (a.off ?? 999) - (b.off ?? 999)
      || b.text - a.text
      || Number(!!b.record.hasWordSync) - Number(!!a.record.hasWordSync)
      || a.index - b.index);
  const best = ranked[0]!;
  return { record: best.record, timedFor: best.timing };
}

/**
 * Word timing for lines that only have line timing, borrowed from another take of the same
 * song that has it: the same line's words keep their spacing, moved to this take's line start.
 */
function borrowWords(lines: LyricLine[], from: LyricLine[]): LyricLine[] {
  let cursor = 0;
  return lines.map((line) => {
    const key = norm(line.text);
    if (!key || line.words?.length) return line;
    for (let i = cursor; i < Math.min(from.length, cursor + 8); i++) {
      const source = from[i]!;
      if (norm(source.text) !== key || !source.words?.length) continue;
      cursor = i + 1;
      const shift = line.time - source.time;
      return {
        ...line,
        words: source.words.map((w) => ({ text: w.text, time: w.time + shift })),
        ...(source.end !== undefined ? { end: source.end + shift } : {}),
      };
    }
    return line;
  });
}

function syncedLines(picked: LrcRecord, all: readonly LrcRecord[]): LyricLine[] | null {
  let lines: LyricLine[] = [];
  if (picked.hasWordSync && picked.lyricsfile) lines = parseLyricsfile(picked.lyricsfile);
  if (!lines.length && picked.syncedLyrics) lines = parseLrc(picked.syncedLyrics);
  if (!lines.length) return null;
  if (!lines.some((line) => line.words?.length)) {
    const donor = all.find((record) => record !== picked && record.hasWordSync && record.lyricsfile && alike(record.trackName, picked.trackName) && alike(record.artistName, picked.artistName));
    if (donor?.lyricsfile) lines = borrowWords(lines, parseLyricsfile(donor.lyricsfile));
  }
  return lines;
}

// Releases -------------------------------------------------------------------------------

/** A release in a music catalog: names as the catalog spells them, and the album cover. */
interface Release { artist: string; track: string; album: string | null; year: number | null; cover: string | null; duration: number | null; genre: string | null; bpm: number | null }

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

interface DeezerTrack { id?: number; title: string; duration?: number; artist?: { name: string }; album?: { id: number; title: string; cover_xl?: string; cover_big?: string } }

/** A believable tempo: catalogs report 0 when they don't know, and some double or halve it. */
function tempo(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return null;
  let bpm = raw;
  while (bpm > 200) bpm /= 2;
  while (bpm < 60) bpm *= 2;
  return Math.round(bpm * 10) / 10;
}

async function fromDeezer(artist: string | null, track: string, duration: number | null): Promise<Release | null> {
  const q = [artist, track].filter(Boolean).join(" ").slice(0, 200);
  const found = await getJson<{ data?: DeezerTrack[] }>(`https://api.deezer.com/search?${new URLSearchParams({ q, limit: "15" })}`);
  const song = best(found?.data ?? [], (t) => ({ artist: t.artist?.name ?? "", track: t.title, duration: t.duration ?? null }), artist, track, duration);
  if (!song) return null;
  // The search leaves the release date and genre out (the album has them) and the tempo (the track has it).
  const [album, detail] = await Promise.all([
    song.album ? getJson<{ release_date?: string; genres?: { data?: { name?: string }[] } }>(`https://api.deezer.com/album/${encodeURIComponent(String(song.album.id))}`).catch(() => null) : null,
    song.id ? getJson<{ bpm?: number }>(`https://api.deezer.com/track/${encodeURIComponent(String(song.id))}`).catch(() => null) : null,
  ]);
  const year = Number.parseInt(album?.release_date?.slice(0, 4) ?? "", 10);
  const genre = album?.genres?.data?.map((g) => g.name).find((name): name is string => typeof name === "string" && !!name.trim()) ?? null;
  const cover = song.album?.cover_xl ?? song.album?.cover_big ?? null;
  return {
    artist: song.artist?.name ?? artist ?? "",
    track: song.title,
    album: song.album?.title ?? null,
    year: Number.isFinite(year) && year > 1000 ? year : null,
    cover: cover?.startsWith("https://") ? cover : null,
    duration: song.duration ?? null,
    genre: genre?.slice(0, 60) ?? null,
    bpm: tempo(detail?.bpm),
  };
}

interface ItunesSong { artistName: string; trackName: string; collectionName?: string; releaseDate?: string; artworkUrl100?: string; trackTimeMillis?: number; primaryGenreName?: string }

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
    genre: song.primaryGenreName?.trim().slice(0, 60) || null,
    bpm: null,
  };
}

/** Deezer knows more of the catalog (iTunes misses many originals); iTunes covers the rest. */
async function releaseFor(artist: string | null, track: string): Promise<Release | null> {
  // No length here: a music video's length would pull towards some other cut of the song.
  const deezer = await fromDeezer(artist, track, null).catch(() => null);
  if (deezer?.cover && deezer.genre) return deezer;
  const itunes = await fromItunes(artist, track, null).catch(() => null);
  if (deezer?.cover) return { ...deezer, genre: itunes?.genre ?? null };
  return itunes ? { ...itunes, bpm: deezer?.bpm ?? null, genre: itunes.genre ?? deezer?.genre ?? null } : deezer;
}

function youtubeCover(url: string): string | null {
  const id = youtubeId(url);
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
}

async function lookup(url: string, title: string, playerLength: number | null): Promise<SongInfo> {
  const wanted = parseTitle(title);
  // The video's own length beats the player's report (which may not be in yet) and the catalogs'.
  const [videoLength, records, firstRelease] = await Promise.all([youtubeLength(url), lyricsCandidates(wanted), releaseFor(wanted.artist, wanted.track)]);
  const media = videoLength ?? playerLength;
  const picked = pickLyrics(records, wanted, media, firstRelease?.duration ?? null);
  const lyrics = picked?.record ?? null;
  // The lyrics catalog's names are cleaner than a video title: retry the album with them.
  const release = firstRelease ?? (lyrics ? await releaseFor(lyrics.artistName, lyrics.trackName) : null);
  const synced = lyrics ? syncedLines(lyrics, records) : null;
  return {
    artist: release?.artist || lyrics?.artistName || wanted.artist || null,
    track: release?.track ?? lyrics?.trackName ?? wanted.track,
    album: release?.album ?? lyrics?.albumName ?? null,
    year: release?.year ?? null,
    cover: release?.cover ?? youtubeCover(url),
    synced: synced?.length ? synced : null,
    plain: lyrics?.plainLyrics?.trim() || null,
    instrumental: !!lyrics?.instrumental,
    duration: media ?? lyrics?.duration ?? release?.duration ?? null,
    lyricsDuration: picked?.timedFor ?? null,
    mediaDuration: media,
    genre: release?.genre ?? null,
    bpm: release?.bpm ?? null,
  };
}

const cache = new Map<string, Promise<SongInfo>>();

export function registerSongInfo(ipc: IpcMain, allowed: (event: IpcMainInvokeEvent) => boolean): void {
  ipc.handle("song:info", (event, url: unknown, title: unknown, duration: unknown) => {
    if (!allowed(event) || typeof url !== "string" || typeof title !== "string" || url.length > 2048 || !title.trim() || title.length > 300) return null;
    const seconds = typeof duration === "number" && Number.isFinite(duration) && duration > 0 && duration < 86400 ? duration : null;
    // YouTube lengths come from the video itself; for files the player's length is part of the question.
    const key = `${url}\n${title}\n${youtubeId(url) ? "" : Math.round(seconds ?? 0)}`;
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
