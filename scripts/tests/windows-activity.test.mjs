import { test } from "node:test";
import assert from "node:assert/strict";
import { sep } from "node:path";
import { detectActivities } from "../../src/main/activity/windows.ts";
const directory = ["F:", "Steam", "common", "Synthetic"].join(sep),
  game = { appId: "480", name: "Synthetic game", directory };
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
