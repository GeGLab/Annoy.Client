import { t as translate } from "../../../../shared/localization/index.ts";
import { mediaDigest, parsePack } from "./library.ts";
import { cacheCatalog, cachedCatalog } from "./storage.ts";
import { searchText, type MediaPack, type MediaPage } from "./types.ts";

export const CATEGORIES = { all: "expression.catalog.9e753333692c", animals: "expression.catalog.ce3f58666657", reactions: "expression.catalog.ceb7d6f1945f", food: "expression.catalog.56dd40554fc9", nature: "expression.catalog.f58c2019b303", activities: "expression.catalog.f19c5cd1c2df" } as const;
export type Category = keyof typeof CATEGORIES;
export interface CatalogPack extends MediaPack { category: Category; }
interface Entry { id: string; name: string; category: Category; search: string; page: string; sha256: string; }
interface Index { schemaVersion: 1; version: string; packs: Entry[]; }
const base = new URL(`${import.meta.env.BASE_URL}expression/`, window.location.href).href;
const memory = new Map<string, unknown>();
const invalid = () => new Error(translate("expression.catalog.97565f21c78a"));
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object";
const text = (value: unknown, max = 500): value is string => typeof value === "string" && value.length > 0 && value.length <= max;
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
function validateIndex(raw: unknown): Index {
  if (!object(raw) || raw.schemaVersion !== 1 || !text(raw.version, 40) || !Array.isArray(raw.packs) || raw.packs.length > 10000) throw invalid();
  const ids = new Set<string>();
  for (const item of raw.packs) {
    if (!object(item) || !text(item.id, 80) || ids.has(item.id) || !text(item.name, 80) || !text(item.search, 10000) || !text(item.category, 40) || !(item.category in CATEGORIES) || !text(item.page) || !/^catalog\/[\w-]+\/page-\d+\.json$/.test(item.page) || !hash(item.sha256)) throw invalid();
    ids.add(item.id);
  }
  return raw as unknown as Index;
}
async function load<T>(path: string, key: string, validate: (raw: unknown) => T, signal?: AbortSignal, sha256?: string): Promise<T> {
  signal?.throwIfAborted();
  if (memory.has(key)) return validate(memory.get(key));
  let raw: unknown;
  try {
    const response = await fetch(new URL(path, base), { credentials: "omit", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) });
    if (!response.ok || !response.body) throw new Error(translate("expression.catalog.01a54269e3f9"));
    const reader = response.body.getReader(), chunks: Uint8Array<ArrayBuffer>[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 1024 * 1024) throw invalid();
        chunks.push(value as Uint8Array<ArrayBuffer>);
      }
    } finally { await reader.cancel(); }
    const blob = new Blob(chunks);
    if (sha256 && await mediaDigest(blob) !== sha256) throw invalid();
    raw = JSON.parse(await blob.text());
  } catch (error) {
    signal?.throwIfAborted();
    const cached = await cachedCatalog<unknown>(key).catch(() => undefined);
    if (cached === undefined) throw error;
    raw = cached;
  }
  signal?.throwIfAborted();
  const value = validate(raw);
  memory.set(key, raw);
  if (memory.size > 8) memory.delete(memory.keys().next().value!);
  // Cache is optional: quota/private storage failures must not block discovery.
  void cacheCatalog(key, raw).catch(() => undefined);
  return value;
}
function validatePage(raw: unknown, index: Index, path: string): { schemaVersion: 1; version: string; packs: CatalogPack[] } {
  if (!object(raw) || raw.schemaVersion !== 1 || raw.version !== index.version || !Array.isArray(raw.packs) || raw.packs.length > 12) throw invalid();
  const expected = index.packs.filter((entry) => entry.page === path);
  if (expected.length !== raw.packs.length) throw invalid();
  const packs = raw.packs.map((value): CatalogPack => {
    if (!object(value)) throw invalid();
    const entry = expected.find((entry) => entry.id === value.id);
    if (!entry || value.name !== entry.name || value.category !== entry.category || !text(value.version, 40) || !text(value.credits, 2000) || !text(value.licenseUrl) || !/^https:\/\//.test(value.licenseUrl) || !text(value.source) || !/^https:\/\//.test(value.source)) throw invalid();
    const parsed = parsePack(value); // Apply the same size and item validation as imports.
    const items = parsed.items.map((item, i) => {
      const original = (value.items as Record<string, unknown>[])[i]!;
      if (!text(original.id, 80) || !hash(original.sha256) || !text(original.url) || !/^openmoji\/[A-F0-9-]+\.png$/.test(original.url)) throw invalid();
      return { ...item, id: original.id, sha256: original.sha256, url: new URL(original.url, base).href };
    });
    if (new Set(items.map((item) => item.id)).size !== items.length) throw invalid();
    return { ...parsed, id: entry.id, category: entry.category, items };
  });
  if (new Set(packs.map((pack) => pack.id)).size !== packs.length) throw invalid();
  return { schemaVersion: 1, version: index.version, packs };
}
export async function readCatalogPage({ after, query = "", category = "all", signal }: { after?: string | null; query?: string; category?: Category; signal?: AbortSignal } = {}): Promise<MediaPage<CatalogPack>> {
  const index = await load("catalog/index.json", "catalog:index:1", validateIndex, signal);
  const needle = searchText(query.trim());
  const entries = index.packs.filter((entry) => (category === "all" || entry.category === category) && searchText(`${entry.name} ${entry.search} OpenMoji CC BY-SA 4.0`).includes(needle));
  const start = after ? entries.findIndex((entry) => entry.id === after) + 1 : 0;
  const selected = entries.slice(start, start + 2);
  // At most two different manifest requests per page; asset downloads are separate.
  const pages = await Promise.all([...new Set(selected.map((entry) => entry.page))].map((path) => {
    const entry = selected.find((entry) => entry.page === path)!;
    return load(path, `${index.version}:${path}:${entry.sha256}`, (raw) => validatePage(raw, index, path), signal, entry.sha256);
  }));
  signal?.throwIfAborted();
  return { items: selected.map((entry) => pages.flatMap((page) => page.packs).find((pack) => pack.id === entry.id)!), next: start + selected.length < entries.length ? selected.at(-1)!.id : null };
}
