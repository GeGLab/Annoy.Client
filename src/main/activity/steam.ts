import { readFile, readdir } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

export interface InstalledGame {
  appId: string;
  name: string;
  directory: string;
}
const cache = new Map<string, { at: number; games: InstalledGame[] }>();
const field = (source: string, key: string) => new RegExp(`"${key}"\\s+"([^"\\r\\n]*)"`, "i").exec(source)?.[1] ?? "";
export async function installedGames(root: string): Promise<InstalledGame[]> {
  if (!root) return [];
  const cached = cache.get(root);
  if (cached && Date.now() - cached.at < 300_000) return cached.games;
  const libraries = new Set([root]);
  try {
    const vdf = await readFile(join(root, "steamapps", "libraryfolders.vdf"), "utf8");
    for (const match of vdf.matchAll(/"path"\s+"([^"\r\n]+)"/g)) libraries.add(match[1]!.replaceAll("\\\\", "\\"));
  } catch {}
  const games: InstalledGame[] = [];
  for (const library of libraries)
    try {
      const folder = join(library, "steamapps");
      for (const file of (await readdir(folder)).filter((f) => /^appmanifest_\d+\.acf$/.test(f)).slice(0, 5000)) {
        try {
          const text = await readFile(join(folder, file), "utf8"),
            appId = field(text, "appid"),
            name = field(text, "name"),
            dir = field(text, "installdir"),
            common = resolve(folder, "common"),
            directory = resolve(common, dir);
          const inside = process.platform === "win32"
            ? directory.toLowerCase().startsWith(common.toLowerCase() + sep)
            : directory.startsWith(common + sep);
          if (/^\d{1,10}$/.test(appId) && file === `appmanifest_${appId}.acf` && name.trim() && inside)
            games.push({ appId, name, directory });
        } catch {}
      }
    } catch {}
  if (cache.size >= 8) cache.delete(cache.keys().next().value!);
  cache.set(root, { at: Date.now(), games });
  return games;
}

const artworkCache = new Map<string, { expiresAt: number; url: string }>();
export async function steamArtwork(appId: string, signal?: AbortSignal): Promise<string | undefined> {
  if (!/^\d{1,10}$/.test(appId)) return undefined;
  const cached = artworkCache.get(appId);
  if (cached && Date.now() < cached.expiresAt) return cached.url;
  let url = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`;
  let cacheMs = 60_000;
  try {
    const response = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appId}&filters=basic`, {
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(3000)]) : AbortSignal.timeout(3000),
    });
    if (response.ok) {
      const data = await response.json() as Record<string, { success: boolean; data?: { header_image?: string } }>;
      const artwork = data[appId]?.success && data[appId]?.data?.header_image;
      if (artwork && /^https:\/\/[a-z0-9.-]+\.steamstatic\.com\/(?:store_item_assets\/)?steam\/apps\/\d+\/[a-zA-Z0-9_/.?=&%-]+$/.test(artwork)) {
        url = artwork;
        cacheMs = 3_600_000;
      }
    }
  } catch { signal?.throwIfAborted(); }
  if (artworkCache.size >= 64) artworkCache.delete(artworkCache.keys().next().value!);
  artworkCache.set(appId, { expiresAt: Date.now() + cacheMs, url });
  return url;
}
