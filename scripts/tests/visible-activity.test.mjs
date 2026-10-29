import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleUserActivities } from "../../src/shared/activity.ts";

const game = { kind: "game", provider: "steam", name: "Current game", appId: "480" };
const otherGame = { ...game, name: "Other game", appId: "730" };
const music = { kind: "music", provider: "spotify", name: "Current song" };
const development = { kind: "development", provider: "vscode", name: "Project" };
const self = { isSelf: true, isFriend: false, sharing: true };

test("own game, music and development remain visible together and override the online game", () => {
  assert.deepEqual(visibleUserActivities({ ...self, local: [game, music, development], reported: [otherGame] }), [game, music, development]);
});

test("own online game appears beside the name even without a local game", () => {
  assert.deepEqual(visibleUserActivities({ ...self, reported: [game] }), [game]);
  assert.deepEqual(visibleUserActivities({ ...self, local: [music, development], reported: [game] }), [music, development, game]);
});

test("disabled sharing hides all own activity, including the online fallback", () => {
  assert.deepEqual(visibleUserActivities({ ...self, sharing: false, local: [game, music], reported: [otherGame] }), []);
});

test("confirmed friends expose activities; strangers and pending requests expose none", () => {
  const remote = { isSelf: false, sharing: false, isFriend: true, local: [otherGame], reported: [game, music] };
  assert.deepEqual(visibleUserActivities(remote), [game, music]);
  assert.deepEqual(visibleUserActivities({ ...remote, isFriend: false }), []);
});

test("ended local music and programming are not restored from the gateway's previous report", () => {
  assert.deepEqual(visibleUserActivities({ ...self, reported: [music, development] }), []);
});
