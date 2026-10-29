import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probeLinux, steamRoots } from "../../src/main/activity/linux.ts";
import { installedGames } from "../../src/main/activity/steam.ts";

const preferences = { games: true, music: true, development: true };
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "annoy-steam-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const steam = join(root, "Steam");
  const library = join(root, "Other library");
  const directory = join(library, "steamapps", "common", "Synthetic Game");
  const procRoot = join(root, "proc");
  await mkdir(join(steam, "steamapps"), { recursive: true });
  await mkdir(directory, { recursive: true });
  await mkdir(procRoot);
  await writeFile(join(steam, "steamapps", "libraryfolders.vdf"), `"libraryfolders" { "1" { "path" "${library}" } }`);
  await writeFile(join(library, "steamapps", "appmanifest_480.acf"), '"AppState" { "appid" "480" "name" "Synthetic Game" "installdir" "Synthetic Game" }');
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests++; return new Response("{}", { status: 503 }); };
  t.after(() => { globalThis.fetch = originalFetch; });
  return {
    root, steam, library, directory, procRoot,
    requests: () => requests,
    probe: (prefs = preferences, signal) => probeLinux(prefs, signal, { roots: [steam], procRoot }),
    async process(pid, { env = "SteamAppId=480", exe = join(directory, "game"), args = [], cwd = directory } = {}) {
      const folder = join(procRoot, String(pid));
      await mkdir(folder);
      await writeFile(join(folder, "environ"), `${env}\0PRIVATE_TOKEN=never-publish\0`);
      await writeFile(join(folder, "cmdline"), args.join("\0") + "\0");
      await symlink(exe, join(folder, "exe"));
      await symlink(cwd, join(folder, "cwd"));
    },
  };
}

describe("Linux Steam detection", { skip: process.platform !== "linux" }, () => {

test("Steam roots cover native, XDG and Flatpak installations", () => {
  assert.deepEqual(steamRoots("/home/test", "/custom/data"), [
    "/home/test/.steam/steam", "/home/test/.steam/root", "/custom/data/Steam",
    "/home/test/.var/app/com.valvesoftware.Steam/.local/share/Steam",
  ]);
  assert.equal(steamRoots("/home/test", "relative")[2], "/home/test/.local/share/Steam");
});

test("native Steam game in a secondary library is sanitized and clears on process exit", async (t) => {
  const f = await fixture(t);
  // Exited/inaccessible processes do not interrupt the scan.
  await mkdir(join(f.procRoot, "1"));
  await f.process(2);
  const result = await f.probe();
  assert.deepEqual(result, { supported: true, error: null, activities: [{
    kind: "game", provider: "steam", name: "Synthetic Game", appId: "480",
    artwork: "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/480/header.jpg",
  }] });
  assert.equal(JSON.stringify(result).includes(f.root), false);
  assert.equal(JSON.stringify(result).includes("PRIVATE_TOKEN"), false);
  await rm(join(f.procRoot, "2"), { recursive: true });
  assert.deepEqual((await f.probe()).activities, []);
});

test("Proton games match Windows executable arguments, including Z: and relative paths", async (t) => {
  const f = await fixture(t);
  const scenarios = [
    [join(f.directory, "game.exe")],
    [`Z:${f.directory.replaceAll("/", "\\")}\\game.exe`],
    ["wine64", "game.exe"],
  ];
  for (const args of scenarios) {
    await f.process(2, { exe: "/runtime/bin/wine64-preloader", args, env: "SteamGameId=480" });
    assert.equal((await f.probe()).activities[0]?.appId, "480", JSON.stringify(args));
    await rm(join(f.procRoot, "2"), { recursive: true });
  }
});

test("installed games, unrelated processes, runtimes and Wine helpers never publish a game", async (t) => {
  const f = await fixture(t);
  assert.deepEqual((await f.probe()).activities, []);
  await f.process(1, { env: "SteamAppId=999" });
  await f.process(2, { exe: f.directory + "-unrelated/game" });
  await f.process(3, { exe: "/runtime/bin/wineserver", args: [join(f.directory, "game.exe")] });
  await f.process(4, { exe: "/runtime/bin/wine64", args: ["C:\\windows\\system32\\services.exe"] });
  await f.process(5, { exe: "/usr/bin/python3", args: ["proton", "run", join(f.directory, "game.exe")] });
  await f.process(6, { env: "SteamAppId=0\0SteamGameId=480" });
  await f.process(7, { env: "", exe: join(f.directory, "game") });
  assert.deepEqual((await f.probe()).activities, []);
  assert.equal(f.requests(), 0);
});

test("disabled games never inspect proc or fetch artwork, and cancellation stops a probe", async (t) => {
  const f = await fixture(t);
  await f.process(1);
  await rm(f.procRoot, { recursive: true });
  assert.deepEqual(await f.probe({ games: false, music: true, development: true }), { supported: true, error: null, activities: [] });
  await assert.rejects(f.probe(preferences, AbortSignal.abort()), { name: "AbortError" });
  assert.equal(f.requests(), 0);
});

test("missing Steam installations are normal, but failed proc access surfaces an error", async (t) => {
  const f = await fixture(t);
  assert.deepEqual((await probeLinux(preferences, undefined, { roots: [join(f.root, "missing")] })).activities, []);
  await rm(f.procRoot, { recursive: true });
  await assert.rejects(f.probe(), { code: "ENOENT" });
});

test("invalid and escaping manifests are rejected; Steam root symlinks work", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.library, "steamapps", "appmanifest_999.acf"), '"appid" "999" "name" "Escape" "installdir" "../../private"');
  await writeFile(join(f.library, "steamapps", "appmanifest_998.acf"), '"appid" "997" "name" "Mismatch" "installdir" "Other"');
  assert.deepEqual((await installedGames(f.steam)).map((game) => game.appId), ["480"]);
  await f.process(1);
  const alias = join(f.root, "steam-alias");
  await symlink(f.steam, alias);
  assert.equal((await probeLinux(preferences, undefined, { roots: [alias, f.steam], procRoot: f.procRoot })).activities[0]?.appId, "480");
});

test("real Linux proc detects a running executable and its exit without leaking OS metadata", async (t) => {
  const f = await fixture(t);
  const executable = join(f.directory, "game");
  await copyFile("/bin/sleep", executable);
  const child = spawn(executable, ["30"], { env: { SteamAppId: "480" }, stdio: "ignore" });
  const exited = new Promise((resolve) => child.once("exit", resolve));
  t.after(() => child.kill());
  await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
  const probe = () => probeLinux(preferences, undefined, { roots: [f.steam] });
  assert.equal((await probe()).activities[0]?.name, "Synthetic Game");
  child.kill();
  await exited;
  assert.deepEqual((await probe()).activities, []);
});

});
