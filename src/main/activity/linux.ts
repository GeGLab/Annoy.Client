import { open, readdir, readlink, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";
import type { ActivityPreferences, DesktopActivitySnapshot } from "../../shared/activity.ts";
import { installedGames, steamArtwork, type InstalledGame } from "./steam.ts";

/** Read only bounded process metadata. Environment and command lines stay in main. */
async function readProcessFile(path: string, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  const file = await open(path, "r");
  try {
    const buffer = Buffer.alloc(128 * 1024);
    const { bytesRead } = await file.read(buffer);
    signal?.throwIfAborted();
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await file.close();
  }
}

export function steamRoots(home = homedir(), dataHome = process.env.XDG_DATA_HOME): string[] {
  return [
    join(home, ".steam", "steam"),
    join(home, ".steam", "root"),
    join(dataHome && isAbsolute(dataHome) ? dataHome : join(home, ".local", "share"), "Steam"),
    join(home, ".var", "app", "com.valvesoftware.Steam", ".local", "share", "Steam"),
  ];
}

async function linuxGames(roots: string[]): Promise<InstalledGame[]> {
  const canonicalRoots = new Set<string>();
  for (const root of roots) {
    try { canonicalRoots.add(await realpath(root)); } catch { /* Steam is optional. */ }
  }
  const games: InstalledGame[] = [];
  for (const root of canonicalRoots) {
    for (const game of await installedGames(root)) {
      // Canonical paths also match Steam installations reached through ~/.steam symlinks.
      try { games.push({ ...game, directory: await realpath(game.directory) }); } catch {}
    }
  }
  return games;
}

const inside = (path: string, directory: string) => path.startsWith(directory + sep);

async function gameForProcess(folder: string, games: InstalledGame[], signal?: AbortSignal): Promise<InstalledGame | undefined> {
  // /proc also contains other users' processes: do not inspect their environments.
  if ((await stat(folder)).uid !== process.getuid?.()) return;
  const environment = (await readProcessFile(join(folder, "environ"), signal)).split("\0");
  const appId = environment.find((value) => /^SteamAppId=\d{1,10}$/.test(value))?.split("=")[1]
    ?? environment.find((value) => /^SteamGameId=\d{1,10}$/.test(value))?.split("=")[1];
  const candidates = games.filter((game) => game.appId === appId);
  if (!candidates.length) return;

  const executable = await readlink(join(folder, "exe"));
  const native = candidates.find((game) => inside(executable, game.directory));
  if (native) return native;

  // Proton's executable is Wine. Confirm the actual Windows program, rather than
  // treating a surviving wineserver, runtime or launcher as a running game.
  if (!/\/(?:wine(?:64)?(?:-preloader)?|wine-preloader)$/.test(executable)) return;
  const args = (await readProcessFile(join(folder, "cmdline"), signal)).split("\0");
  const cwd = await readlink(join(folder, "cwd"));
  for (const argument of args.slice(0, 2)) {
    if (!/\.exe$/i.test(argument)) continue;
    let path = argument.replaceAll("\\", "/");
    if (/^z:\//i.test(path)) path = path.slice(2);
    else if (/^[a-z]:/i.test(path)) continue;
    const game = candidates.find((item) => inside(resolve(cwd, path), item.directory));
    if (game) return game;
  }
}

export async function probeLinux(
  preferences: ActivityPreferences,
  signal?: AbortSignal,
  options: { roots?: string[]; procRoot?: string } = {},
): Promise<DesktopActivitySnapshot> {
  const empty: DesktopActivitySnapshot = { supported: true, activities: [], error: null };
  signal?.throwIfAborted();
  if (!preferences.games) return empty;
  const games = await linuxGames(options.roots ?? steamRoots());
  signal?.throwIfAborted();
  if (!games.length) return empty;
  const procRoot = options.procRoot ?? "/proc";
  const processes = (await readdir(procRoot)).filter((name) => /^\d+$/.test(name));
  for (const pid of processes) {
    signal?.throwIfAborted();
    let game: InstalledGame | undefined;
    try { game = await gameForProcess(join(procRoot, pid), games, signal); }
    catch { signal?.throwIfAborted(); /* Processes may exit or deny access during a poll. */ }
    if (game) {
      const artwork = await steamArtwork(game.appId, signal);
      signal?.throwIfAborted();
      return { ...empty, activities: [{ kind: "game", provider: "steam", name: game.name.slice(0, 160), appId: game.appId, artwork }] };
    }
  }
  return empty;
}
