import { test } from "node:test";
import assert from "node:assert/strict";
import { isStreamSource, streamOffers } from "../../src/renderer/src/lib/stream-watch.ts";
import { DEFAULT_MIC_FILTERS, normalizeMicFilters } from "../../src/renderer/src/audio/mic-filters.ts";

test("screen picture and sound are opt-in; mic and camera are not", () => {
  assert.equal(isStreamSource("screen"), true);
  assert.equal(isStreamSource("screen_audio"), true);
  assert.equal(isStreamSource("mic"), false);
  assert.equal(isStreamSource("camera"), false);
});

test("one offer per person sharing a screen, flagged when watched", () => {
  const tracks = [
    { userId: "bob", source: "screen" }, { userId: "bob", source: "screen_audio" },
    { userId: "alice", source: "screen" }, { userId: "carol", source: "camera" }, { userId: "dave", source: "screen_audio" },
  ];
  assert.deepEqual(streamOffers(tracks, new Set(["bob"])), [{ userId: "alice", watching: false }, { userId: "bob", watching: true }]);
});

test("mic filters: old installs get OBS defaults, all off; values are clamped", () => {
  assert.deepEqual(normalizeMicFilters(undefined), DEFAULT_MIC_FILTERS);
  for (const group of Object.values(DEFAULT_MIC_FILTERS)) assert.equal(group.enabled, false);
  const saved = normalizeMicFilters({ gain: { enabled: true, db: 99 }, gate: { enabled: true, openDb: -40, closeDb: -10 }, compressor: { ratio: "x" } });
  assert.equal(saved.gain.enabled, true);
  assert.equal(saved.gain.db, 30);
  assert.equal(saved.gate.closeDb, -40, "the gate never closes above where it opens");
  assert.equal(saved.compressor.ratio, DEFAULT_MIC_FILTERS.compressor.ratio);
  assert.equal(saved.limiter.thresholdDb, -6);
});
