import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanMixer, DEFAULT_MIXER, EQ_BANDS, EQ_LIMIT, MIXER_PRESETS, mixerNeutral, PRESET_SOUNDS } from "../../src/shared/sound-mixer.ts";

test("stored or sent mixer settings are always valid", () => {
  assert.deepEqual(cleanMixer(null), { ...DEFAULT_MIXER, preset: "custom" });
  const wild = cleanMixer({ on: true, preset: "bass", eq: [99, -99, "x", 2.3], reverb: 7, spin: -1 });
  assert.deepEqual(wild, { on: true, preset: "bass", eq: [EQ_LIMIT, -EQ_LIMIT, 0, 2.5, 0], reverb: 1, spin: 0 });
  assert.equal(cleanMixer({ preset: "evil" }).preset, "custom");
  assert.equal(cleanMixer({ eq: [1, 2, 3, 4, 5, 6, 7] }).eq.length, EQ_BANDS.length);
});

test("a neutral mixer leaves the music alone; every preset changes something but flat", () => {
  assert.equal(mixerNeutral(null), true);
  assert.equal(mixerNeutral({ ...DEFAULT_MIXER, on: false, ...PRESET_SOUNDS.bass }), true, "off");
  assert.equal(mixerNeutral({ ...DEFAULT_MIXER, on: true }), true, "on but flat");
  for (const preset of MIXER_PRESETS) {
    assert.equal(mixerNeutral({ on: true, preset, ...PRESET_SOUNDS[preset] }), preset === "flat", preset);
    assert.deepEqual(cleanMixer({ on: true, preset, ...PRESET_SOUNDS[preset] }), { on: true, preset, ...PRESET_SOUNDS[preset] }, `${preset} survives cleaning`);
  }
});
