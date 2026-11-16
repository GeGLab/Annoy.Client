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

test("Steam's report adds the lobby to the same game running here, and builds a join link only with a Steam account", async () => {
  const { steamJoinUrl } = await import("../../src/shared/steam-activity.ts");
  const lobby = { ...remote, lobbyId: "109775241000000001" };
  const here = { kind: "game", provider: "steam", name: "Local name", appId: "480", startedAt: 5 };
  assert.deepEqual(withSteamFallback([here], lobby), [{ ...here, lobbyId: "109775241000000001" }]);
  assert.deepEqual(withSteamFallback([{ ...here, appId: "730" }], lobby), [{ ...here, appId: "730" }], "another game keeps no lobby");
  assert.deepEqual(withSteamFallback([here], remote), [here], "no lobby, nothing added");
  assert.equal(steamJoinUrl(lobby, "76561198000000001"), "steam://joinlobby/480/109775241000000001/76561198000000001");
  assert.equal(steamJoinUrl(lobby, null), null);
  assert.equal(steamJoinUrl(remote, "76561198000000001"), null);
  assert.equal(steamJoinUrl({ ...lobby, lobbyId: "1/../x" }, "76561198000000001"), null);
  assert.equal(steamJoinUrl({ ...lobby, provider: "spotify" }, "76561198000000001"), null);
});
