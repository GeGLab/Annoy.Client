/**
 * Announcements: types and pure rules (no browser or network), shared by the
 * dialog, the settings list and the tests.
 */
export type PollMode = "single" | "multiple";
export interface PollDef { id: string; mode: PollMode; showResults: boolean; closesAt: string | null; options: string[] }
export interface PollText { question: string; options: Record<string, string> }
export interface LocaleText { title: string; body: string; polls: Record<string, PollText> }
export interface Announcement { id: string; revision: number; publishedAt: string | null; shownAt: string | null; polls: PollDef[]; locales: Record<string, LocaleText | undefined> }
export interface PollState { open: boolean; mine: string[] | null; total: number | null; counts: Record<string, number> | null }


export const seenKey = (a: Announcement) => `${a.id}:${a.revision}`;
const sameLocalDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Not in `seen` and published (or reopened) on the same local day as `now`. */
export function dueOn(list: Announcement[], seen: Set<string>, now: Date): Announcement[] {
  return list.filter((a) => !!a.shownAt && !seen.has(seenKey(a)) && sameLocalDay(new Date(a.shownAt), now));
}

/** The person's language, else English (required for every announcement). */
export function localized(a: Announcement, language: string): LocaleText {
  return a.locales[language] ?? a.locales.en!;
}
export function pollText(a: Announcement, poll: PollDef, language: string): PollText {
  const own = a.locales[language]?.polls?.[poll.id];
  const en = a.locales.en?.polls?.[poll.id];
  return {
    question: own?.question || en?.question || "",
    options: Object.fromEntries(poll.options.map((o) => [o, own?.options?.[o] || en?.options?.[o] || ""])),
  };
}


// The Markdown of admannoy: # title, ![desc](image), [[Text]](https://…) button,
// {{enquete:N}} poll, - lists, **bold**, *italic*, __underline__, ~~strike~~, `code`, [link](https://…).
export const IMAGE_URL = /^https?:\/\/[^/\s]+\/i\/[a-f0-9]{40}\.(png|jpg|webp|gif)$/;
export const HTTPS = /^https:\/\/[^\s/]+/;
const POLL_LINE = /^\{\{enquete:(\d{1,2})\}\}$/;
const IMAGE_LINE = /^!\[([^\]\n]*)\]\((\S+)\)$/;
const BUTTON_LINE = /^\[\[([^\]\n]+)\]\]\((\S+)\)$/;
const HEADING_LINE = /^(#{1,3})\s+(.+)$/;

export type Block = { type: "heading"; text: string; level: number } | { type: "image"; alt: string; url: string } | { type: "button"; text: string; url: string } | { type: "poll"; n: number } | { type: "text"; text: string };

export function parseBlocks(body: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => { if (para.length) blocks.push({ type: "text", text: para.join("\n") }); para = []; };
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    let m: RegExpExecArray | null;
    if (!line) flush();
    else if ((m = HEADING_LINE.exec(line))) { flush(); blocks.push({ type: "heading", text: m[2]!, level: m[1]!.length }); }
    else if ((m = IMAGE_LINE.exec(line))) { flush(); blocks.push({ type: "image", alt: m[1]!, url: m[2]! }); }
    else if ((m = BUTTON_LINE.exec(line))) { flush(); blocks.push({ type: "button", text: m[1]!, url: m[2]! }); }
    else if ((m = POLL_LINE.exec(line))) { flush(); blocks.push({ type: "poll", n: Number(m[1]) }); }
    else para.push(raw);
  }
  flush();
  return blocks;
}

