import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanMixer, DEFAULT_MIXER, EQ_BANDS, EQ_LIMIT, MIXER_PRESETS, mixerNeutral, PREAMP_MAX, PREAMP_MIN, PRESET_SOUNDS } from "../../src/shared/sound-mixer.ts";

test("stored or sent equalizer settings are always valid", () => {
  assert.deepEqual(cleanMixer(null), DEFAULT_MIXER);
  const wild = cleanMixer({ on: true, preset: "rock", eq: [99, -99, "x", 2.3, 0, 0, 0, 0, 0, 0], preamp: 40 });
  assert.deepEqual(wild, { on: true, preset: "rock", eq: [EQ_LIMIT, -EQ_LIMIT, 0, 2.5, 0, 0, 0, 0, 0, 0], preamp: PREAMP_MAX });
  assert.equal(cleanMixer({ preamp: -40 }).preamp, PREAMP_MIN);
  assert.equal(cleanMixer({ preset: "evil", eq: EQ_BANDS.map(() => 1) }).preset, "custom");
  // A curve saved with another number of bands (the old five-band one) starts flat.
  assert.deepEqual(cleanMixer({ on: true, preset: "bass", eq: [8, 4, 0, 0, 1], reverb: 1 }), { on: true, preset: "flat", eq: EQ_BANDS.map(() => 0), preamp: 0 });
});

test("a neutral equalizer leaves the music alone; every preset but flat changes something", () => {
  assert.equal(mixerNeutral(null), true);
  assert.equal(mixerNeutral({ ...DEFAULT_MIXER, on: false, ...PRESET_SOUNDS.rock }), true, "off");
  assert.equal(mixerNeutral({ ...DEFAULT_MIXER, on: true }), true, "on but flat");
  assert.equal(mixerNeutral({ ...DEFAULT_MIXER, on: true, preamp: -3 }), false, "preamp alone");
  for (const preset of MIXER_PRESETS) {
    assert.equal(PRESET_SOUNDS[preset].eq.length, EQ_BANDS.length, preset);
    assert.equal(mixerNeutral({ on: true, preset, ...PRESET_SOUNDS[preset] }), preset === "flat", preset);
    assert.deepEqual(cleanMixer({ on: true, preset, ...PRESET_SOUNDS[preset] }), { on: true, preset, ...PRESET_SOUNDS[preset] }, `${preset} survives cleaning`);
  }
});
