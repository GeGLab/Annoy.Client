import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeUserVolume, userVolume, userVolumeKey } from "../../src/shared/user-volume.ts";
import { RemoteAudioMixer } from "../../src/renderer/src/lib/remote-audio.ts";

test("individual volume defaults to 100%, persists and is isolated by account and user", () => {
  const saved = JSON.parse(JSON.stringify({ [userVolumeKey("account-a", "alice")]: 200, [userVolumeKey("account-a", "bob")]: 0 }));
  assert.equal(userVolume(saved, "account-a", "alice"), 200);
  assert.equal(userVolume(saved, "account-a", "bob"), 0);
  assert.equal(userVolume(saved, "account-b", "alice"), 100);
  assert.equal(userVolume(saved, "account-a", "unknown"), 100);
  assert.equal(userVolume(undefined, "account-a", "alice"), 100);
  for (const value of [undefined, null, NaN, Infinity, "200"]) assert.equal(normalizeUserVolume(value), 100);
  assert.equal(normalizeUserVolume(-20), 0);
  assert.equal(normalizeUserVolume(250), 200);
});

class Node {
  connections = [];
  disconnected = false;
  connect(node) { this.connections.push(node); return node; }
  disconnect() { this.disconnected = true; this.connections = []; }
}
class Context {
  sources = [];
  gains = [];
  destinations = [];
  currentTime = 1;
  state = "running";
  closed = 0;
  resumed = 0;
  destination = new Node();
  listeners = new Set();
  addEventListener(_name, listener) { this.listeners.add(listener); }
  removeEventListener(_name, listener) { this.listeners.delete(listener); }
  createMediaStreamSource(stream) { const node = Object.assign(new Node(), { input: stream }); this.sources.push(node); return node; }
  createGain() {
    const gain = { value: 1, cancelScheduledValues() {}, setTargetAtTime(value, at, timeConstant) { this.value = value; this.ramp = { at, timeConstant }; } };
    const node = Object.assign(new Node(), { gain }); this.gains.push(node); return node;
  }
  createMediaStreamDestination() {
    const track = { stopped: false, stop() { this.stopped = true; } };
    const node = Object.assign(new Node(), { stream: { getTracks: () => [track] }, track });
    this.destinations.push(node); return node;
  }
  resume() { this.resumed++; return Promise.resolve(); }
  close() { this.closed++; return Promise.resolve(); }
}

class Audio {
  srcObject = null;
  volume = 1;
  muted = false;
  plays = 0;
  pauses = 0;
  play() { this.plays++; return Promise.resolve(); }
  pause() { this.pauses++; }
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("ordinary playback stays native and does not depend on an AudioContext", () => {
  const mixer = new RemoteAudioMixer(() => { throw new Error("Must not create a context"); });
  const audio = new Audio(), stream = { id: "rtc" };
  const output = mixer.connect(stream, 100, audio);
  assert.equal(audio.srcObject, stream);
  assert.equal(audio.volume, 1);
  output.setVolume(50);
  assert.equal(audio.srcObject, stream);
  assert.equal(audio.volume, 0.5);
  output.setVolume(0);
  assert.equal(audio.volume, 0);
  output.setVolume(100);
  assert.equal(audio.volume, 1);
  mixer.close();
});

test("200% amplifies independently, keeps the remote RTC renderer alive and preserves deafen", async () => {
  const context = new Context(), pulls = [];
  let created = 0;
  const mixer = new RemoteAudioMixer(() => { created++; return context; }, () => { const a = new Audio(); pulls.push(a); return a; });
  const aliceAudio = new Audio(), bobAudio = new Audio(), stream = { id: "alice-rtc" };
  aliceAudio.muted = true;
  const alice = mixer.connect(stream, 200, aliceAudio);
  mixer.connect({ id: "bob-rtc" }, 50, bobAudio);
  await settle();
  assert.equal(created, 1);
  assert.equal(context.gains[0].gain.value, 2);
  assert.equal(bobAudio.volume, 0.5);
  assert.equal(context.gains.length, 1);
  assert.equal(pulls[0].muted, true);
  assert.equal(pulls[0].srcObject, stream);
  assert.ok(pulls[0].plays > 0);
  assert.deepEqual(context.sources[0].connections, [context.gains[0]]);
  assert.deepEqual(context.gains[0].connections, [context.destinations[0]]);
  assert.equal(context.gains[0].connections.includes(context.destination), false);
  assert.equal(aliceAudio.srcObject, context.destinations[0].stream);
  assert.equal(aliceAudio.volume, 1);
  assert.equal(aliceAudio.muted, true);
  alice.setVolume(0);
  assert.equal(aliceAudio.srcObject, stream);
  assert.equal(aliceAudio.volume, 0);
  assert.equal(bobAudio.volume, 0.5);
  alice.setVolume(200);
  await settle();
  assert.equal(aliceAudio.srcObject, context.destinations[0].stream);
  assert.equal(aliceAudio.muted, true);
  mixer.close();
});

test("processing failures and suspended contexts fall back to native audio", async () => {
  const context = new Context();
  const mixer = new RemoteAudioMixer(() => context, () => new Audio());
  const audio = new Audio(), stream = { id: "rtc" };
  const output = mixer.connect(stream, 200, audio);
  await settle();
  context.state = "suspended";
  for (const listener of context.listeners) listener();
  assert.equal(audio.srcObject, stream);
  assert.equal(audio.volume, 1);
  context.resume = () => Promise.reject(new Error("Audio device unavailable"));
  const warn = console.warn;
  console.warn = () => {};
  try { output.setVolume(200); await settle(); } finally { console.warn = warn; }
  assert.equal(audio.srcObject, stream);
  assert.equal(audio.volume, 1);
  mixer.close();
});

test("a delayed amplification start cannot override a newer native volume or closed session", async () => {
  const context = new Context();
  let resume;
  context.resume = () => new Promise((resolve) => { resume = resolve; });
  const mixer = new RemoteAudioMixer(() => context, () => new Audio());
  const audio = new Audio(), stream = { id: "rtc" };
  const output = mixer.connect(stream, 200, audio);
  output.setVolume(50);
  resume(); await settle();
  assert.equal(audio.srcObject, stream);
  assert.equal(audio.volume, 0.5);
  output.setVolume(200);
  mixer.close(); resume(); await settle();
  assert.equal(audio.srcObject, null);
});

test("cleanup releases only owned tracks and leaves the receiver tracks alone", async () => {
  const context = new Context(), pulls = [];
  const mixer = new RemoteAudioMixer(() => context, () => { const a = new Audio(); pulls.push(a); return a; });
  const track = { stopped: false, stop() { this.stopped = true; } };
  const output = mixer.connect({ getTracks: () => [track] }, 200, new Audio());
  mixer.connect({ id: "screen-audio" }, 200, new Audio());
  await settle();
  output.close(); output.close(); output.setVolume(200);
  assert.equal(track.stopped, false);
  assert.equal(context.destinations[0].track.stopped, true);
  assert.equal(context.destinations[1].track.stopped, false);
  mixer.close(); mixer.close();
  assert.equal(context.closed, 1);
  assert.equal(context.destinations[1].track.stopped, true);
  for (const node of [...context.sources, ...context.gains, ...context.destinations]) assert.equal(node.disconnected, true);
  for (const pull of pulls) { assert.equal(pull.srcObject, null); assert.ok(pull.pauses > 0); }
  assert.equal(context.listeners.size, 0);
  assert.throws(() => mixer.connect({}, 100, new Audio()), /Audio session is closed/);
});
