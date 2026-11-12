/** What the music room shows about a track: album, cover and lyrics (looked up by the main process). */
export interface LyricLine { time: number; text: string }
export interface SongInfo {
  artist: string | null;
  track: string;
  album: string | null;
  year: number | null;
  /** Album cover, or the video's thumbnail when the catalogs don't know the song. */
  cover: string | null;
  /** Lines with the second they start at, when the lyrics are synced. */
  synced: LyricLine[] | null;
  plain: string | null;
  instrumental: boolean;
  /** Track length from the catalogs, for players that don't report one. */
  duration: number | null;
}
