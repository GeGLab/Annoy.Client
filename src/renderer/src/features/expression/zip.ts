import { t } from "../../../../shared/localization/index.ts";

export interface ZipImage {
  path: string;
  name: string;
  blob: Blob | null;
  problem: string | null;
}
// Local library budgets; these do not set message display sizes or upload limits.
const MAX_IMAGE = 8 * 1024 * 1024, MAX_TOTAL = 300 * 1024 * 1024, MAX_ENTRIES = 1000;
const invalid = () => new Error(t("expression.zip.invalid"));
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function imageType(bytes: Uint8Array) {
  const ascii = (a: number, b: number) => String.fromCharCode(...bytes.subarray(a, b));
  if (ascii(0, 8) === "\x89PNG\r\n\x1a\n") return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (/^GIF8[79]a$/.test(ascii(0, 6))) return "image/gif";
  return null;
}
async function inflate(raw: Uint8Array<ArrayBuffer>, size: number, signal?: AbortSignal) {
  const reader = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let total = 0;
  const cancel = () => { void reader.cancel(signal?.reason).catch(() => {}); };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > size || total > MAX_IMAGE) throw invalid();
      chunks.push(value);
    }
    signal?.throwIfAborted();
    return new Uint8Array(await new Blob(chunks).arrayBuffer());
  } finally {
    signal?.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => {});
  }
}

/** ZIP's central directory supports stored/deflated images, including data descriptors.
 * Never extracts paths to disk, and bounds output while decompressing untrusted data. */
export async function readImageZip(file: Blob, signal?: AbortSignal): Promise<ZipImage[]> {
  signal?.throwIfAborted();
  if (file.size > MAX_TOTAL) throw new Error(t("expression.zip.tooLarge"));
  const bytes = new Uint8Array(await file.arrayBuffer()), view = new DataView(bytes.buffer);
  signal?.throwIfAborted();
  const range = (at: number, length: number) => {
    if (at < 0 || length < 0 || at + length > bytes.length) throw invalid();
  };
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) { end = i; break; }
  }
  if (end < 0) throw invalid();
  const count = view.getUint16(end + 10, true), start = view.getUint32(end + 16, true), length = view.getUint32(end + 12, true);
  if (count === 0xffff || start === 0xffffffff || length === 0xffffffff) throw new Error(t("expression.zip.unsupported"));
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || view.getUint16(end + 8, true) !== count) throw new Error(t("expression.zip.unsupported"));
  if (count > MAX_ENTRIES) throw new Error(t("expression.zip.entries"));
  if (start + length > end) throw invalid();
  const decoder = new TextDecoder(), entries = [];
  let at = start, total = 0;
  for (let i = 0; i < count; i++) {
    range(at, 46);
    if (view.getUint32(at, true) !== 0x02014b50) throw invalid();
    const flags = view.getUint16(at + 8, true), method = view.getUint16(at + 10, true), crc = view.getUint32(at + 16, true);
    const compressed = view.getUint32(at + 20, true), size = view.getUint32(at + 24, true), local = view.getUint32(at + 42, true);
    const nameLength = view.getUint16(at + 28, true), extra = view.getUint16(at + 30, true), comment = view.getUint16(at + 32, true);
    range(at + 46, nameLength + extra + comment);
    const path = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength)).replaceAll("\\", "/"), base = path.split("/").at(-1) ?? "";
    at += 46 + nameLength + extra + comment;
    if (at > start + length) throw invalid();
    if (!base || path.split("/").some(part => part.startsWith(".") || part === "__MACOSX") || !/\.(png|jpe?g|webp|gif)$/i.test(base)) continue;
    total += size;
    entries.push({ path, base, flags, method, crc, compressed, size, local });
  }
  if (at !== start + length) throw invalid();
  if (!entries.length) throw new Error(t("expression.zip.empty"));
  if (total > MAX_TOTAL) throw new Error(t("expression.zip.tooLarge"));
  const images: ZipImage[] = [];
  for (const entry of entries) {
    signal?.throwIfAborted();
    const item: ZipImage = { path: entry.path, name: entry.base.replace(/\.[^.]+$/, "").slice(0, 80), blob: null, problem: null };
    try {
      if (entry.size > MAX_IMAGE) throw new Error(t("expression.catalog.afe2acdb3bf9"));
      if (entry.flags & 1 || ![0, 8].includes(entry.method)) throw new Error(t("expression.zip.unsupported"));
      range(entry.local, 30);
      if (view.getUint32(entry.local, true) !== 0x04034b50 || view.getUint16(entry.local + 8, true) !== entry.method || view.getUint16(entry.local + 6, true) & 1) throw invalid();
      const offset = entry.local + 30 + view.getUint16(entry.local + 26, true) + view.getUint16(entry.local + 28, true);
      range(offset, entry.compressed);
      if (offset + entry.compressed > start) throw invalid();
      const raw = bytes.subarray(offset, offset + entry.compressed);
      const data = entry.method === 0 ? raw : await inflate(raw, entry.size, signal);
      if (data.length !== entry.size || crc32(data) !== entry.crc) throw invalid();
      const type = imageType(data);
      if (!type) throw new Error(t("expression.zip.image"));
      item.blob = new Blob([data], { type });
    } catch (error) {
      signal?.throwIfAborted();
      item.problem = error instanceof Error ? error.message : t("expression.zip.invalid");
    }
    images.push(item);
  }
  return images;
}
