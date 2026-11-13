/** What the music room shows about a track: album, cover and lyrics (looked up by the main process). */
export interface LyricWord { time: number; text: string }
export interface LyricLine {
  /** Seconds into the lyrics' own timing when the line starts. */
  time: number;
  text: string;
  /** When singing ends, if the source says (word-synced lyrics do). */
  end?: number;
  /** When each word starts, if the source has word timing. */
  words?: LyricWord[];
}
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
  /** Track length for players that don't report one: the media's own when known. */
  duration: number | null;
  /** Length of the recording the lyrics are timed to; null when the catalog can't tell. */
  lyricsDuration: number | null;
  /** Length of the media that plays (the YouTube video), when known. */
  mediaDuration: number | null;
  /** The catalog's genre ("Rock", "Rap/Hip Hop", "Dance"…): the DJ mixes and the room glows by it. */
  genre?: string | null;
  /** Beats per minute, when the catalog knows it: DJ transitions last whole bars and echo on the beat. */
  bpm?: number | null;
}
