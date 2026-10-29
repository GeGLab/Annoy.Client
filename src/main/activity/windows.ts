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
  media: { source: string; title: string; artist: string; album: string; artwork?: string }[];
  mediaError: boolean;
  editors?: { process: string; title: string; active?: boolean }[];
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
        ...(media.artwork && media.artwork.length <= 24_000 && /^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]+={0,2}$/.test(media.artwork)
          ? { artwork: media.artwork } : {}),
      });
  }
  if (preferences.development) {
    const editor = [...(probe.editors ?? [])].sort((a, b) => Number(!!b.active) - Number(!!a.active)).find((item) => item.title);
    if (editor) {
      const provider = /code/i.test(editor.process) ? "vscode" : /idea|pycharm/i.test(editor.process) ? "intellij" : /dbeaver/i.test(editor.process) ? "dbeaver" : /ssms/i.test(editor.process) ? "ssms" : "visual-studio";
      const parts = editor.title.replace(/^[●*\s]+/, "").split(/\s+[-–—]\s+/).filter((part) => !/^(Visual Studio Code|IntelliJ IDEA|Microsoft Visual Studio|DBeaver|SQL Server Management Studio)(\b|$)/i.test(part));
      const clean = (value: string) => value.split(/[\\/]/).pop()!.replace(/[\u0000-\u001f]/g, "").slice(0, 160);
      const extensions = new Set(["tsx", "jsx", "ts", "js", "mjs", "cjs", "py", "cs", "sql", "java", "kt", "vue", "svelte", "go", "rs", "rb", "php", "cpp", "c", "h", "html", "css", "scss", "json", "yaml", "yml", "xml", "md", "ipynb", "sln", "csproj"]);
      const file = clean(parts.find((part) => extensions.has(/\.([a-z0-9]{1,12})(?:\s|$)/i.exec(clean(part))?.[1]?.toLowerCase() ?? "")) ?? "");
      const project = clean(parts.find((part) => clean(part) !== file) ?? parts[0] ?? "");
      const extension = /\.([a-z0-9]{1,12})(?:\s|$)/i.exec(file)?.[1]?.toLowerCase();
      const language = extension === "tsx" || extension === "jsx" ? "react" : extension === "ts" ? "typescript" : extension === "js" ? "javascript" : extension === "py" ? "python" : extension === "cs" ? "csharp" : extension === "sql" ? "sql" : extension === "vue" ? "vue" : extension;
      activities.push({ kind: "development", provider, name: project || "Programando", ...(file && { file }), ...(project && { project }), ...(language && { language }) });
    }
  }
  return activities;
}
export async function probeWindows(preferences: ActivityPreferences, signal?: AbortSignal): Promise<DesktopActivitySnapshot> {
  const script =
    `$detectGames=$${preferences.games ? "true" : "false"}; $detectMusic=$${preferences.music ? "true" : "false"}; $detectDevelopment=$${preferences.development ? "true" : "false"}\n` + windowsProbe;
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
  const activities = detectActivities(probe, preferences.games ? await installedGames(probe.steamPath) : [], preferences);
  for (const activity of activities) {
    if (activity.kind === "game" && activity.appId) activity.artwork = await steamArtwork(activity.appId, signal);
  }
  return {
    supported: true,
    activities,
    error:
      preferences.music && probe.mediaError
        ? "O Windows não disponibilizou a sessão de música. Confira se o aplicativo está reproduzindo e tente novamente."
        : null,
  };
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
