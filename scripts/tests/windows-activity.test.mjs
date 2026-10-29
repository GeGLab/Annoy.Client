import { test } from "node:test";
import assert from "node:assert/strict";
import { sep } from "node:path";
import { detectActivities, steamArtwork } from "../../src/main/activity/windows.ts";
import { isAway } from "../../src/shared/presence.ts";
import { effectivePresence } from "../../src/shared/presence.ts";
const directory = ["F:", "Steam", "common", "Synthetic"].join(sep),
  game = { appId: "480", name: "Synthetic game", directory };

test("manual presence overrides inactivity; online mode resumes automatic away", () => {
  assert.equal(effectivePresence("online", 601, 10), "idle");
  assert.equal(effectivePresence("online", 0, 10), "online");
  for (const status of ["idle", "dnd", "offline"]) {
    assert.equal(effectivePresence(status, 0, 10), status);
    assert.equal(effectivePresence(status, 601, 10), status);
  }
});
const probe = {
  steamPath: "F:/Steam",
  running: ["480"],
  paths: [`${directory}${sep}bin${sep}game.exe`],
  media: [{ source: "Spotify.exe", title: "Synthetic song", artist: "Artist", album: "Album" }],
  mediaError: false,
};
test("only positively matched Steam game and playing-provider metadata leave OS adapter", () => {
  const result = detectActivities(probe, [game], { games: true, music: true });
  assert.deepEqual(result, [
    { kind: "game", provider: "steam", name: "Synthetic game", appId: "480" },
    { kind: "music", provider: "spotify", name: "Synthetic song", artist: "Artist", album: "Album" },
  ]);
  assert.equal(JSON.stringify(result).includes("game.exe"), false);
  assert.deepEqual(detectActivities({ ...probe, paths: [] }, [game], { games: true, music: false }), []);
  assert.deepEqual(detectActivities({ ...probe, running: [] }, [game], { games: true, music: false }), []);
});
test("disabled categories collect no published activity and Apple Music is recognized", () => {
  assert.deepEqual(detectActivities(probe, [game], { games: false, music: false }), []);
  assert.equal(
    detectActivities({ ...probe, media: [{ source: "AppleMusic_aumid", title: "Song", artist: "Artist", album: "" }] }, [], {
      games: false,
      music: true,
    })[0].provider,
    "apple-music",
  );
  assert.deepEqual(
    detectActivities({ ...probe, media: [{ source: "chrome.exe", title: "Private browser title", artist: "", album: "" }] }, [], {
      games: false,
      music: true,
    }),
    [],
  );
});

test("music carries a bounded JPEG thumbnail and discards unsafe or oversized artwork", () => {
  const artwork = "data:image/jpeg;base64,/9j/AA==";
  const withArt = (value) => ({ ...probe, media: [{ ...probe.media[0], artwork: value }] });
  assert.equal(detectActivities(withArt(artwork), [], { games: false, music: true })[0].artwork, artwork);
  for (const value of ["file:///private/path.jpg", "data:image/svg+xml;base64,AA==", artwork + "A".repeat(24_000)])
    assert.equal(detectActivities(withArt(value), [], { games: false, music: true })[0].artwork, undefined);
});

test("Steam resolves hashed official artwork, caches lookups and rejects invalid IDs", async () => {
  const original = globalThis.fetch;
  let requests = 0;
  const url = "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/12345/abc/header.jpg?t=1";
  globalThis.fetch = async () => { requests++; return new Response(JSON.stringify({ "12345": { success: true, data: { header_image: url } } })); };
  try {
    assert.equal(await steamArtwork("12345"), url);
    assert.equal(await steamArtwork("12345"), url);
    assert.equal(await steamArtwork("not-an-id"), undefined);
    assert.equal(requests, 1);
  } finally { globalThis.fetch = original; }
});

test("development activity identifies active editor, project and React without exporting absolute paths", () => {
  const data = { ...probe, editors: [{ process: "devenv", title: "Other - Microsoft Visual Studio" }, { process: "Code", title: "App.tsx - Annoy.Client - Visual Studio Code", active: true }] };
  const result = detectActivities(data, [], { games: false, music: false, development: true });
  assert.deepEqual(result, [{ kind: "development", provider: "vscode", name: "Annoy.Client", file: "App.tsx", project: "Annoy.Client", language: "react" }]);
  const paths = detectActivities({ ...probe, editors: [{ process: "idea64", title: "F:\\private\\MyProject - src\\Main.java - IntelliJ IDEA", active: true }] }, [], { games: false, music: false, development: true });
  assert.equal(JSON.stringify(paths).includes("F:"), false);
  assert.equal(paths[0].provider, "intellij");
  const workspaceOnly = detectActivities({ ...probe, editors: [{ process: "Code", title: "Annoy.Client - Visual Studio Code" }] }, [], { games: false, music: false, development: true });
  assert.equal(workspaceOnly[0].file, undefined);
  assert.equal(workspaceOnly[0].project, "Annoy.Client");
  assert.deepEqual(detectActivities(data, [], { games: false, music: false, development: false }), []);
});
test("automatic away observes the configured boundary and supports disabling", () => {
  assert.equal(isAway(599, 10), false);
  assert.equal(isAway(600, 10), true);
  assert.equal(isAway(60, 1), true);
  assert.equal(isAway(10_000, 0), false);
  assert.equal(isAway(NaN, 10), false);
});


test("screen profiles preserve selected caps, 2K labels and upstream native/uncapped mode", async () => {
  const { screenProfile, screenQualityLabel } = await import("../../src/renderer/src/lib/screen-profile.ts");
  const selected = screenProfile({ screenHeight: 2048, screenFps: 60 });
  assert.equal(selected.constraints.width.max, 2048);
  assert.equal(selected.constraints.height.max, 1080);
  assert.equal(selected.constraints.frameRate.max, 60);
  assert.equal(screenQualityLabel(selected.quality), "2K 60 FPS");
  assert.ok(Number.isInteger(selected.maxBitrate));
  const native = screenProfile({ screenHeight: 0, screenFps: 0 });
  assert.equal(native.constraints.width, undefined);
  assert.equal(native.constraints.frameRate.max, undefined);
  assert.equal(screenQualityLabel(native.quality), "Nativa Sem limite");
  assert.ok(native.maxBitrate <= 60_000_000);
});
