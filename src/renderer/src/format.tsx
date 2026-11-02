import {number,localizationPreferences} from "./../../shared/localization/index.ts";
import {t as translate} from "../../shared/localization/index.ts";
import type { ReactNode } from "react";

/** Resolves an id to a display name, for <@user> and <#channel> mentions. */
export type NameOf = (id: string) => string | undefined;

const INLINE = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|__[^_\n]+__|~~[^~\n]+~~|<@[0-9a-z]+>|<#[0-9a-z]+>|https?:\/\/[^\s<]+|@everyone|@here)/g;

function inline(text: string, nameOf: NameOf, channelOf: NameOf, me: string | null, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const match of text.matchAll(INLINE)) {
    const token = match[0];
    const at = match.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const key = `${keyBase}-${i++}`;
    if (token.startsWith("`")) out.push(<code key={key}>{token.slice(1, -1)}</code>);
    else if (token.startsWith("**")) out.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith("__")) out.push(<u key={key}>{token.slice(2, -2)}</u>);
    else if (token.startsWith("~~")) out.push(<s key={key}>{token.slice(2, -2)}</s>);
    else if (token.startsWith("*")) out.push(<em key={key}>{token.slice(1, -1)}</em>);
    else if (token.startsWith("<@")) {
      const id = token.slice(2, -1);
      out.push(
        <span key={key} className={`mention${id === me ? " mention-me" : ""}`}>
          @{nameOf(id) ?? translate("common.c4197364c8d5")}
        </span>,
      );
    } else if (token.startsWith("<#")) {
      out.push(
        <span key={key} className="mention">
          #{channelOf(token.slice(2, -1)) ?? translate("common.e113486af161")}
        </span>,
      );
    } else if (token.startsWith("@")) out.push(<span key={key} className="mention">{token}</span>);
    else {
      // Trailing punctuation is almost never part of the URL.
      const url = token.replace(/[),.;:!?]+$/, "");
      out.push(
        <a key={key} href={url} target="_blank" rel="noreferrer">
          {url}
        </a>,
      );
      if (url.length < token.length) out.push(token.slice(url.length));
    }
    last = at + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** One line of plain text for previews: markup dropped, mentions resolved. */
export function previewText(content: string, nameOf: NameOf, channelOf: NameOf = () => undefined): string {
  return content
    .replace(/```(?:[a-z0-9]+\n)?([\s\S]*?)```/g, "$1")
    .replace(/\s+/g, " ")
    .replace(INLINE, (token) => {
      if (token.startsWith("`")) return token.slice(1, -1);
      if (token.startsWith("**") || token.startsWith("__") || token.startsWith("~~")) return token.slice(2, -2);
      if (token.startsWith("*")) return token.slice(1, -1);
      if (token.startsWith("<@")) return `@${nameOf(token.slice(2, -1)) ?? translate("common.c4197364c8d5")}`;
      if (token.startsWith("<#")) return `#${channelOf(token.slice(2, -1)) ?? translate("common.e113486af161")}`;
      return token;
    })
    .trim();
}

/** Small Discord-flavoured markdown: code blocks, quotes and inline styles. */
export function renderContent(content: string, nameOf: NameOf, me: string | null, channelOf: NameOf = () => undefined): ReactNode {
  const parts = content.split(/```(?:[a-z0-9]+\n)?([\s\S]*?)```/g);
  return parts.map((part, idx) => {
    if (idx % 2 === 1) return <pre key={idx}>{part.replace(/\n$/, "")}</pre>;
    return part.split("\n").map((line, li, lines) => {
      const key = `${idx}-${li}`;
      const body = line.startsWith("> ") ? <blockquote key={key}>{inline(line.slice(2), nameOf, channelOf, me, key)}</blockquote> : inline(line, nameOf, channelOf, me, key);
      return (
        <span key={key}>
          {body}
          {li < lines.length - 1 && !line.startsWith("> ") ? <br /> : null}
        </span>
      );
    });
  });
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const time = d.toLocaleTimeString(localizationPreferences().region, { hour: "2-digit", minute: "2-digit", hourCycle:localizationPreferences().hourCycle });
  if (d.toDateString() === today.toDateString()) return translate("common.01ab17c3ebca",{p0:(time)});
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return translate("common.2c81730c5698",{p0:(time)});
  return `${d.toLocaleDateString(localizationPreferences().region)} ${time}`;
}

export const formatClock = (iso: string) => new Date(iso).toLocaleTimeString(localizationPreferences().region, { hour: "2-digit", minute: "2-digit", hourCycle:localizationPreferences().hourCycle });

/** Label for a day divider: "Hoje", "Ontem" or a full date. */
export function formatDay(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return translate("common.a46d7cd01bd9");
  if (d.toDateString() === yesterday.toDateString()) return translate("common.358ce4a99328");
  return d.toLocaleDateString(localizationPreferences().region, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${number(bytes)} B`;
  if (bytes < 1024 * 1024) return `${number(bytes / 1024,{minimumFractionDigits:1,maximumFractionDigits:1})} KB`;
  return `${number(bytes / 1024 / 1024,{minimumFractionDigits:1,maximumFractionDigits:1})} MB`;
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

/** Stable pleasant color per id, used for avatars without images. */
export function colorFor(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360} 45% 45%)`;
}


