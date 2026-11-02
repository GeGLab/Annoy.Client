import { t as translate, onLocalizationChange } from "../../../../shared/localization/index.ts";
import type { MediaItem, MediaPack } from "./types.ts";
import { savePack } from "./storage.ts";
export type { MediaItem, MediaKind, MediaPack, PackMetadata } from "./types.ts";
export { readPacks, readPack, readPackPage, readItemPage, readMediaBlob, savePack, removePack } from "./storage.ts";
function emojiEntries() { return [
 ["😀",translate("expression.6f0a75b9a62a")], ["😃","alegre"], ["😄","rindo"], ["😁",translate("expression.c6d0f0c185bd")], ["😆","risada"], ["😅",translate("expression.28251a28dbc6")], ["😂",translate("expression.761ee68fc054")], ["🤣","gargalhada"], ["😊",translate("expression.5a316457c3a2")], ["🙂",translate("expression.36c53d5774c7")], ["🙃","invertido"], ["😉","piscando"], ["😍","apaixonado"], ["🥰","amor"], ["😘","beijo"], ["😎",translate("expression.57fa5a87f7b2")], ["🤓","nerd"], ["🤔","pensando"], ["🤨","desconfiado"], ["😐","neutro"], ["😴","dormindo"], ["🤤","babando"], ["😢",translate("expression.f19ddd690ae2")], ["😭","chorando"], ["😤","bravo"], ["😡","raiva"], ["🤯","explodindo"], ["🥺",translate("expression.87d73033cc73")], ["😱","grito"], ["😳","surpreso"], ["🙄","olhos"], ["🤡",translate("expression.56b70b7a56a5")], ["💀","caveira"], ["👻","fantasma"], ["👽","alien"], ["🤖",translate("expression.f618819281d8")], ["💩",translate("expression.d2083000a505")], ["🔥","fogo"], ["✨","brilho"], ["🎉","festa"], ["❤️",translate("expression.b8ef851013ba")], ["💜",translate("expression.feb206f365a0")], ["💛",translate("expression.b1a99ad7be64")], ["💔",translate("expression.f2912f56a80e")], ["👍",translate("expression.eab8d84285a5")], ["👎","negativo"], ["👏","palmas"], ["🙌","celebrar"], ["🙏","obrigado"], ["💪",translate("expression.2fe9e377415b")], ["👀","olhando"], ["✅","certo"], ["❌","errado"], ["💯","cem"], ["🚀","foguete"], ["🎮","jogo"], ["🎵",translate("expression.88752b6636ea")], ["☕",translate("expression.850f7dc43910")], ["🍕","pizza"], ["🐱","gato"], ["🐶","cachorro"], ["🐸","sapo"], ["🦊","raposa"], ["🐼","panda"], ["🦄",translate("expression.38d4a12fb563")], ["🌈",translate("expression.c9a5d6d57545")], ["🌙","lua"], ["⭐","estrela"]
]; }
export let EMOJIS: MediaItem[] = emojiEntries().map(([emoji, name], index) => ({ id: `unicode-${index}`, name: name!, emoji: emoji!, kind: "emoji" }));
onLocalizationChange(() => { EMOJIS = emojiEntries().map(([emoji, name], index) => ({ id: `unicode-${index}`, name: name!, emoji: emoji!, kind: "emoji" })); });
const bundledBase = new URL(`${import.meta.env.BASE_URL}expression/`, window.location.href).href;
export async function downloadMedia(url: string, signal?: AbortSignal): Promise<Blob> {
  const embedded = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]*={0,2})$/.exec(url);
  if (embedded) {
    if (embedded[2]!.length > Math.ceil(8 * 1024 * 1024 / 3) * 4) throw new Error(translate("expression.3d19c17da6dd"));
    const binary = atob(embedded[2]!);
    if (binary.length > 8 * 1024 * 1024) throw new Error(translate("expression.3d19c17da6dd"));
    return new Blob([Uint8Array.from(binary, (character) => character.charCodeAt(0))], { type: embedded[1] });
  }
  if (!url.startsWith(bundledBase) && !/^https:\/\//.test(url) && !/^data:image\/(png|jpeg|webp|gif);base64,/.test(url)) throw new Error(translate("expression.cf6fe6fe099c"));
  const response = await fetch(url, { credentials: "omit", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000) });
  if (!response.ok || !response.body) throw new Error(translate("expression.6d7205eb88a2"));
  const reader = response.body.getReader(), chunks: Uint8Array<ArrayBuffer>[] = []; let size = 0;
  try {
    while (true) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > 8 * 1024 * 1024) throw new Error(translate("expression.3d19c17da6dd")); chunks.push(value as Uint8Array<ArrayBuffer>); }
  } finally { await reader.cancel(); }
  const type = response.headers.get("content-type")?.split(";")[0] ?? "";
  if (!/^image\/(png|jpeg|webp|gif)$/.test(type)) throw new Error(translate("expression.107405d20ce1"));
  return new Blob(chunks, { type });
}
export async function installPack(pack: MediaPack, options: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {}): Promise<void> {
  if (!pack.items.length || new Set(pack.items.map((item) => item.id)).size !== pack.items.length) throw new Error(translate("expression.catalog.36daee69704e"));
  if (pack.items.length > 60) throw new Error(translate("expression.31820662c1e1"));
  let total = 0; const items: MediaItem[] = [];
  for (const item of pack.items) {
    options.signal?.throwIfAborted();
    if (item.emoji) items.push(item);
    else {
      const blob = item.blob ?? await downloadMedia(item.url!, options.signal);
      if (blob.size > 8 * 1024 * 1024 || !/^image\/(png|jpeg|webp|gif)$/.test(blob.type)) throw new Error(translate("expression.catalog.07043ff60181"));
      if (item.sha256 && await mediaDigest(blob) !== item.sha256) throw new Error(translate("expression.catalog.e9f22f27e956"));
      total += blob.size;
      if (total > 50 * 1024 * 1024) throw new Error(translate("expression.bc249c06588b"));
      items.push({ ...item, url: undefined, blob });
    }
    options.onProgress?.(items.length, pack.items.length);
  }
  options.signal?.throwIfAborted();
  await savePack({ ...pack, items }, options.signal);
}
export async function mediaDigest(blob: Blob): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export function parsePack(raw: unknown): MediaPack {
  const pack = raw as Partial<MediaPack>;
  if (!pack || typeof pack.name !== "string" || !pack.name.trim() || pack.name.length > 80 || typeof pack.author !== "string" || !pack.author.trim() || pack.author.length > 120 || typeof pack.license !== "string" || !pack.license.trim() || pack.license.length > 120 || typeof pack.source !== "string" || !pack.source.trim() || pack.source.length > 500 || !Array.isArray(pack.items) || !pack.items.length || pack.items.length > 60) throw new Error(translate("expression.eb66e3d71b97"));
  const items = pack.items.map((item, index): MediaItem => {
    if (!item || typeof item.name !== "string" || item.name.length > 80 || !["emoji","gif","sticker"].includes(item.kind)) throw new Error(translate("expression.0f5afffe0b94"));
    if (item.emoji) {
      if (typeof item.emoji !== "string" || item.emoji.length > 32 || [...new Intl.Segmenter("und", {granularity:"grapheme"}).segment(item.emoji)].length !== 1 || !/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(item.emoji)) throw new Error(translate("expression.6c945970c2dc"));
      return { id: String(index), name: item.name, kind: "emoji", emoji: item.emoji };
    }
    if (typeof item.url !== "string" || item.url.length > 12 * 1024 * 1024) throw new Error(translate("expression.1f0c788564c6"));
    return { id: String(index), name: item.name, kind: item.kind, url: item.url };
  });
  return { id: `import-${crypto.randomUUID()}`, name: pack.name, author: pack.author, license: pack.license, source: pack.source, ...packAttribution(pack), items };
}
export async function exportPack(pack: MediaPack): Promise<Blob> {
  const items = await Promise.all(pack.items.map(async ({blob, ...item}) => {
    if (!blob) return item;
    const url = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob); });
    return { ...item, url };
  }));
  return new Blob([JSON.stringify({...pack,items}, null, 2)], { type: "application/json" });
}

function packAttribution(pack: Partial<MediaPack>): Partial<MediaPack> {
  const result: Partial<MediaPack> = {};
  for (const key of ["version", "credits", "licenseUrl"] as const) {
    const value = pack[key];
    if (value !== undefined) {
      if (typeof value !== "string" || value.length > (key === "credits" ? 2000 : 500)) throw new Error(translate("expression.catalog.dc78dc0fb325"));
      if (key === "licenseUrl" && !/^https:\/\//.test(value)) throw new Error(translate("expression.catalog.44c4d5bc3c87"));
      result[key] = value;
    }
  }
  return result;
}
