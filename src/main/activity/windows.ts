import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { UserActivity } from "@distopic/protocol";
import type { ActivityPreferences, DesktopActivitySnapshot } from "../../shared/activity.ts";
import { windowsProbe } from "./windows-script.ts";
export interface WindowsProbe {
  steamPath: string;
  running: string[];
  paths: string[];
  media: { source: string; title: string; artist: string; album: string }[];
  mediaError: boolean;
}
export interface InstalledGame {
  appId: string;
  name: string;
  directory: string;
}
let cache: { root: string; at: number; games: InstalledGame[] } | null = null;
const field = (source: string, key: string) => new RegExp(`"${key}"\\s+"([^"\\r\\n]*)"`, "i").exec(source)?.[1] ?? "";
async function installedGames(root: string): Promise<InstalledGame[]> {
  if (!root) return [];
  if (cache?.root === root && Date.now() - cache.at < 300_000) return cache.games;
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
          if (/^\d{1,10}$/.test(appId) && name && directory.toLowerCase().startsWith(common.toLowerCase() + sep))
            games.push({ appId, name, directory });
        } catch {}
      }
    } catch {}
  cache = { root, at: Date.now(), games };
  return games;
}
export function detectActivities(probe: WindowsProbe, games: InstalledGame[], preferences: ActivityPreferences): UserActivity[] {
  const activities: UserActivity[] = [];
  if (preferences.games) {
    const game = games.find(
      (g) =>
        probe.running.map(String).includes(g.appId) &&
        probe.paths.some((path) => path.toLowerCase().startsWith(g.directory.toLowerCase() + sep)),
    );
    if (game) activities.push({ kind: "game", provider: "steam", name: game.name.slice(0, 160), appId: game.appId });
  }
  if (preferences.music) {
    const media = probe.media.find((m) => m.title && /spotify|applemusic/i.test(m.source));
    if (media)
      activities.push({
        kind: "music",
        provider: /spotify/i.test(media.source) ? "spotify" : "apple-music",
        name: media.title.slice(0, 160),
        artist: media.artist?.slice(0, 160),
        album: media.album?.slice(0, 160),
      });
  }
  return activities;
}
export async function probeWindows(preferences: ActivityPreferences, signal?: AbortSignal): Promise<DesktopActivitySnapshot> {
  const script =
    `$detectGames=$${preferences.games ? "true" : "false"}; $detectMusic=$${preferences.music ? "true" : "false"}\n` + windowsProbe;
  const probe = await new Promise<WindowsProbe>((resolveProbe, reject) =>
    execFile(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
      { signal, windowsHide: true, timeout: 10_000, maxBuffer: 2 * 1024 * 1024, encoding: "utf8" },
      (error, stdout) => {
        if (error) return reject(error);
        try {
          resolveProbe(JSON.parse(stdout.replace(/^\uFEFF/, "")));
        } catch (error) {
          reject(error);
        }
      },
    ),
  );
  signal?.throwIfAborted();
  return {
    supported: true,
    activities: detectActivities(probe, preferences.games ? await installedGames(probe.steamPath) : [], preferences),
    error:
      preferences.music && probe.mediaError
        ? "O Windows não disponibilizou a sessão de música. Confira se o aplicativo está reproduzindo e tente novamente."
        : null,
  };
}
