import { test } from "node:test";
import assert from "node:assert/strict";
import { withSteamFallback } from "../../src/shared/steam-activity.ts";

const remote = { kind: "game", provider: "steam", name: "Remote game", appId: "480" };
test("Steam online fallback supplements music and development without duplicating local games", () => {
  const music = { kind: "music", provider: "spotify", name: "Song" };
  const development = { kind: "development", provider: "vscode", name: "Project" };
  const localGame = { ...remote, appId: "730", name: "Local game" };
  assert.deepEqual(withSteamFallback([music, development], remote), [music, development, remote]);
  assert.deepEqual(withSteamFallback([music, localGame], remote), [music, localGame]);
  assert.deepEqual(withSteamFallback([], remote), [remote]);
  assert.deepEqual(withSteamFallback([], undefined), []);
  assert.deepEqual(withSteamFallback([], { ...remote, appId: "invalid" }), []);
  assert.deepEqual(withSteamFallback([], music), []);
});
