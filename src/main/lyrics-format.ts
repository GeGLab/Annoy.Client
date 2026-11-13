import type { LyricLine, LyricWord } from "../shared/song-info.ts";

// The two synced-lyrics formats LRCLIB serves, read without any dependency (tested on its own).

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

/** A YAML scalar as LRCLIB writes them: plain, 'single' ('' escapes a quote) or "double". */
function scalar(raw: string): string {
  const value = raw.trim();
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try { return JSON.parse(value) as string; } catch { return value.slice(1, -1); }
  }
  return value;
}

/**
 * Whether a quoted scalar is closed within `body` (its text after the opening quote). Inside
 * 'single' quotes '' is an escaped quote, so '' alone is an empty string and 'it''s' one word;
 * inside "double" quotes a backslash escapes the next character.
 */
function quoteClosed(quote: string, body: string): boolean {
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quote === '"' && ch === "\\") { i++; continue; }
    if (ch !== quote) continue;
    if (quote === "'" && body[i + 1] === "'") { i++; continue; }
    return true;
  }
  return false;
}

/** A line that starts a new entry or field: a quoted value can never run on into one. */
const STRUCTURAL = /^(?:[A-Za-z_][\w-]*:|- text:| {2}(?:start_ms|end_ms|words):| {2}- text:| {4}start_ms:)/;

/**
 * LRCLIB's word-synced "lyricsfile" (a small YAML document): `lines:` with start/end and, for
 * each word, when it is sung; then other top-level keys (`plain: |-` holds the whole text
 * again). Only the shapes LRCLIB writes are understood; anything else is skipped rather than
 * guessed, and nothing outside `lines:` is ever read as a line.
 */
export function parseLyricsfile(source: string): LyricLine[] {
  const lines: (LyricLine & { words: LyricWord[] })[] = [];
  let line: (LyricLine & { words: LyricWord[] }) | null = null;
  let word: LyricWord | null = null;
  let inWords = false;
  /** A quoted value continued on the next lines (long lines are wrapped). */
  // Declared through a cast: it is only ever assigned inside start(), which TypeScript doesn't follow.
  let open = null as { into: { text: string }; quote: string; parts: string[] } | null;
  const finish = () => { if (open) { open.into.text = scalar(open.parts.join(" ")); open = null; } };
  const start = (into: { text: string }, raw: string) => {
    const value = raw.trim();
    const quote = value[0] === "'" || value[0] === '"' ? value[0] : null;
    if (!quote || quoteClosed(quote, value.slice(1))) into.text = scalar(value);
    else open = { into, quote, parts: [value] };
  };
  for (const raw of source.split(/\r?\n/).slice(0, 40_000)) {
    if (open) {
      // A quote misread somewhere must not swallow the entries after it.
      if (STRUCTURAL.test(raw)) finish();
      else {
        open.parts.push(raw.trim());
        if (quoteClosed(open.quote, open.parts.join(" ").slice(1))) finish();
        continue;
      }
    }
    let m: RegExpExecArray | null;
    if ((m = /^- text:(.*)$/.exec(raw))) {
      line = { time: NaN, text: "", words: [] };
      lines.push(line);
      word = null;
      inWords = false;
      start(line, m[1]!);
    } else if (/^[A-Za-z_][\w-]*:/.test(raw)) {
      // A top-level key (`lines:`, `plain: |-`, `metadata:`…): whatever follows isn't part of the last line.
      line = null;
      word = null;
      inWords = false;
    } else if (!line) {
      continue;
    } else if ((m = /^ {2}start_ms:\s*(\d+)/.exec(raw))) {
      line.time = Number(m[1]) / 1000;
    } else if ((m = /^ {2}end_ms:\s*(\d+)/.exec(raw))) {
      line.end = Number(m[1]) / 1000;
    } else if (/^ {2}words:\s*$/.test(raw)) {
      inWords = true;
    } else if (inWords && (m = /^ {2}- text:(.*)$/.exec(raw))) {
      word = { time: NaN, text: "" };
      line.words.push(word);
      start(word, m[1]!);
    } else if (inWords && word && (m = /^ {4}start_ms:\s*(\d+)/.exec(raw))) {
      word.time = Number(m[1]) / 1000;
    } else if (/^ {2,}\S/.test(raw) && !/^ *[a-z_]+:/.test(raw) && !/^ *- /.test(raw)) {
      // A plain value wrapped onto the next line.
      const target: { text: string } | null = word ?? line;
      if (target) target.text = `${target.text} ${raw.trim()}`.trim();
    }
  }
  finish();
  return lines
    .filter((l) => Number.isFinite(l.time))
    .map((l) => {
      const words = l.words.filter((w) => Number.isFinite(w.time) && w.text.trim());
      return { time: l.time, text: l.text.trim(), ...(l.end !== undefined && Number.isFinite(l.end) ? { end: l.end } : {}), ...(words.length ? { words } : {}) };
    })
    .sort((a, b) => a.time - b.time);
}
