import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { transformSync } from "rolldown/utils";

// Run the real session controllers with deterministic media/signaling ports.
// No Electron, devices, network, graphics or SFU credentials are needed.
const h = { tiles: new Map(), offers: [], audio: [], micStart: null };
globalThis.__annoyVoiceLifecycle = h;
const stubs = new Map();
const stub = (path, source) => stubs.set(new URL(`../../src/renderer/src/${path}`, import.meta.url).href, source);
stub("store.ts", "export const toast=()=>{};");
stub("media.ts", `const h=globalThis.__annoyVoiceLifecycle;
  export const putTile=t=>h.tiles.set(t.key,t), dropTile=id=>h.tiles.delete(id);
  export const clearTiles=()=>{h.tiles.clear();h.offers=[];},setStreamOffers=v=>{h.offers=v;};`);
stub("mic.ts", `export class MicGate { async start(){return globalThis.__annoyVoiceLifecycle.micStart();} stop(){} }`);
stub("lib/devices.ts", "export const savedDevice=async()=>undefined;");
stub("media-profiles.ts", `export const alignExtmap=s=>s,tuneOpus=s=>s;
  export const CAMERA_PROFILE={},OPUS_SCREEN={},OPUS_VOICE={},captureScreen=()=>{},screenAudioSupported=()=>false;`);
const hooks = registerHooks({
  resolve(specifier, context, next) {
    const url = context.parentURL && specifier.startsWith(".") ? new URL(specifier, context.parentURL).href : null;
    return url && stubs.has(url) ? { url, shortCircuit: true } : next(specifier, context);
  },
  load(url, context, next) {
    if (stubs.has(url)) return { format: "module", source: stubs.get(url), shortCircuit: true };
    if (/\/voice(?:-cloudflare)?\.ts$/.test(url)) return {
      format: "module", shortCircuit: true,
      source: transformSync(new URL(url).pathname, readFileSync(new URL(url), "utf8"), { target: "esnext" }).code,
    };
    return next(url, context);
  },
});
globalThis.MediaStream = class { constructor(tracks) { this.tracks = tracks; } getTracks() { return this.tracks; } };
globalThis.Audio = class {
  constructor() { h.audio.push(this); this.played = 0; this.srcObject = null; }
  async setSinkId() {}
  async play() { this.played++; }
  pause() {}
};
const { VoiceSession } = await import("../../src/renderer/src/voice.ts");
const { CloudflareVoiceSession } = await import("../../src/renderer/src/voice-cloudflare.ts");
after(() => { hooks.deregister(); delete globalThis.__annoyVoiceLifecycle; });
beforeEach(() => { h.tiles.clear(); h.offers = []; h.audio.length = 0; h.micStart = null; });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
const track = () => ({ readyState: "live", stop() { this.readyState = "ended"; } });
const announced = (producerId, source = "screen") => ({ t: "VOICE_NEW_PRODUCER", d: { channelId: "channel", producerId, userId: "friend", source } });
const ended = producerId => ({ t: "VOICE_PRODUCER_CLOSED", d: { producerId } });

class Connection {
  transceivers = [];
  signalingState = "stable";
  closed = false;
  getTransceivers() { return this.transceivers; }
  addReceiver(mid) {
    const entry = { mid, currentDirection: "recvonly", receiver: { track: track() }, stopped: false,
      stop() { this.stopped = true; this.currentDirection = "stopped"; this.receiver.track.stop(); } };
    this.transceivers.push(entry);
    return entry;
  }
  async createOffer() {
    assert.equal(this.signalingState, "stable", "previous negotiation must have finished");
    return { type: "offer", sdp: "close-offer" };
  }
  async createAnswer() { return { type: "answer", sdp: "answer" }; }
  async setLocalDescription(description) {
    assert.equal(this.closed, false, "retired connections must not negotiate");
    this.localDescription = description;
    this.signalingState = description.type === "offer" ? "have-local-offer" : "stable";
  }
  async setRemoteDescription(description) {
    assert.equal(this.closed, false, "late replies must not touch a closed connection");
    this.signalingState = description.type === "offer" ? "have-remote-offer" : "stable";
  }
  addEventListener() {}
  close() { this.closed = true; }
}

function setup(backend) {
  const requests = [], consumers = [], pc = new Connection(), failures = [];
  let intercept = async () => undefined;
  const gw = { voice: async (method, data) => {
    requests.push({ method, data });
    const reply = await intercept(method, data);
    if (reply) return reply;
    if (method === "consume") return { id: `consumer-${requests.length}`, producerId: data.producerId, kind: data.producerId.includes("mic") || data.producerId.includes("sound") ? "audio" : "video", rtpParameters: {} };
    if (method === "subscribe") {
      const mid = String(pc.transceivers.length);
      pc.addReceiver(mid);
      return { mid, kind: data.producerId.includes("mic") || data.producerId.includes("sound") ? "audio" : "video", renegotiate: true, sdp: "offer" };
    }
    return { sdp: "answer" };
  } };
  const Session = backend === "builtin" ? VoiceSession : CloudflareVoiceSession;
  const session = new Session(gw, "channel", "self", { selfDeaf: false }, () => {}, () => failures.push(true), "account");
  if (backend === "builtin") {
    session.device = { rtpCapabilities: {} };
    session.recv = { id: "receive", close() {}, consume: async params => {
      const consumer = { ...params, track: track(), closed: false, close() { this.closed = true; } };
      consumers.push(consumer); return consumer;
    } };
  } else session.pc = pc;
  return { session, pc, requests, consumers, failures, intercept: callback => { intercept = callback; } };
}

for (const backend of ["builtin", "cloudflare"]) {
  test(`${backend}: watch/stop/watch repeatedly replaces the receiver and preserves microphone playback`, async () => {
    const { session, pc, requests } = setup(backend);
    session.handleEvent(announced("mic", "mic"));
    session.handleEvent(announced("screen"));
    session.handleEvent(announced("sound", "screen_audio"));
    await flush();
    const microphone = h.audio[0];
    assert.ok(microphone.srcObject);
    assert.equal(h.tiles.size, 0);
    let previous;
    for (let i = 0; i < 3; i++) {
      session.watch("friend"); await flush();
      const current = h.tiles.get("screen").stream;
      assert.notEqual(current, previous, "watch again receives a new live track");
      assert.equal(current.getTracks()[0].readyState, "live");
      previous = current;
      const receiver = pc.transceivers.find(t => !t.stopped && t !== pc.transceivers[0]);
      session.unwatch("friend"); await flush();
      assert.equal(h.tiles.size, 0);
      assert.deepEqual(h.offers, [{ userId: "friend", watching: false }]);
      assert.ok(microphone.srcObject, "stopping the share keeps the microphone attached");
      if (backend === "cloudflare") assert.equal(receiver.stopped, true);
    }
    assert.equal(requests.filter(r => r.method === (backend === "builtin" ? "consume" : "subscribe") && r.data.producerId === "mic").length, 1);
    session.close(false);
  });

  test(`${backend}: duplicate producer events during setup allocate one microphone receiver`, async () => {
    const { session, requests, intercept } = setup(backend), wait = deferred();
    intercept(async method => { if (method === (backend === "builtin" ? "consume" : "subscribe")) await wait.promise; });
    session.handleEvent(announced("mic", "mic"));
    session.handleEvent(announced("mic", "mic"));
    await flush(); wait.resolve(); await flush();
    assert.equal(requests.filter(r => r.method === (backend === "builtin" ? "consume" : "subscribe")).length, 1);
    assert.equal(h.audio.length, 1);
    session.close(false);
  });

  test(`${backend}: a producer ending while setup is pending cannot reappear as a black tile`, async () => {
    const { session, intercept } = setup(backend), wait = deferred();
    intercept(async method => { if (method === (backend === "builtin" ? "consume" : "subscribe")) await wait.promise; });
    session.handleEvent(announced("screen")); session.watch("friend"); await flush();
    session.handleEvent(ended("screen")); wait.resolve(); await flush();
    assert.equal(h.tiles.size, 0);
    assert.deepEqual(h.offers, []);
    session.close(false);
  });

  test(`${backend}: stopping while setup is pending keeps the share available to watch again`, async () => {
    const { session, intercept } = setup(backend), wait = deferred();
    intercept(async method => { if (method === (backend === "builtin" ? "consume" : "subscribe")) await wait.promise; });
    session.handleEvent(announced("screen")); session.watch("friend"); await flush();
    session.unwatch("friend"); wait.resolve(); await flush();
    assert.equal(h.tiles.size, 0);
    assert.deepEqual(h.offers, [{ userId: "friend", watching: false }]);
    session.watch("friend"); await flush();
    assert.equal(h.tiles.size, 1);
    session.close(false);
  });

  test(`${backend}: closing a session with an outstanding reply cannot erase the next session's media`, async () => {
    const { session, intercept } = setup(backend), wait = deferred();
    intercept(async method => { if (method === (backend === "builtin" ? "consume" : "subscribe")) await wait.promise; });
    session.handleEvent(announced("screen")); session.watch("friend"); await flush();
    session.close(false);
    h.tiles.set("next-session", {});
    wait.resolve(); await flush();
    assert.deepEqual([...h.tiles.keys()], ["next-session"]);
    session.handleEvent(announced("late"));
    assert.deepEqual(h.offers, []);
  });
}

test("cloudflare: a returning participant gets a new microphone after the old receiver is retired", async () => {
  const { session, pc } = setup("cloudflare");
  session.handleEvent(announced("old-mic", "mic")); await flush();
  const oldAudio = h.audio[0];
  session.handleEvent(ended("old-mic"));
  assert.equal(pc.transceivers[0].stopped, true);
  assert.equal(oldAudio.srcObject, null);
  session.handleEvent(announced("new-mic", "mic")); await flush();
  assert.ok(h.audio[1].srcObject);
  assert.ok(h.audio[1].played > 0);
  session.close(false);
});

test("builtin: stopping and watching before an old resume reply arrives still receives the screen", async () => {
  const { session, intercept, consumers } = setup("builtin"), wait = deferred();
  intercept(async method => { if (method === "resumeConsumer") await wait.promise; });
  session.handleEvent(announced("screen")); session.watch("friend"); await flush();
  session.unwatch("friend"); session.watch("friend"); await flush();
  wait.resolve(); await flush();
  assert.equal(h.tiles.size, 1);
  assert.equal(consumers.length, 2);
  assert.equal(consumers[0].closed, true);
  assert.equal(consumers[1].closed, false);
  session.close(false);
});

test("cloudflare: leaving during microphone capture does not publish into a later session", async () => {
  const { session, requests, intercept } = setup("cloudflare"), wait = deferred();
  globalThis.RTCPeerConnection = Connection;
  h.micStart = () => wait.promise;
  intercept(async method => method === "join" ? { canSpeak: true, canStream: true, iceServers: [] } : undefined);
  const starting = session.start(); await flush();
  session.close(false);
  const captured = track(); wait.resolve(captured); await starting;
  assert.equal(captured.readyState, "ended");
  assert.deepEqual(requests.map(r => r.method), ["join"]);
});

test("cloudflare: Windows ERROR_CONTENT retires negotiation and requests media recovery once", async () => {
  const { session, pc, requests, failures } = setup("cloudflare");
  pc.createOffer = async () => { throw new Error('Failed to execute createOffer: Session error code: ERROR_CONTENT. Failed to set remote video description send parameters for m-section with mid="4".'); };
  const captured = track();
  pc.addTransceiver = () => ({ sender: {} });
  await assert.rejects(session.publish(captured, "video", "screen"), /ERROR_CONTENT/);
  assert.equal(failures.length, 1);
  assert.equal(captured.readyState, "ended");
  await assert.rejects(session.publish(track(), "video", "screen"));
  assert.equal(failures.length, 1);
  assert.equal(requests.length, 0, "queued work cannot mutate the poisoned SFU session");
  session.close(false);
});

test("cloudflare: a microphone is retried when the server redacts a temporary SFU track error", async () => {
  const { session, requests, intercept } = setup("cloudflare");
  let first = true;
  intercept(async method => {
    if (method === "subscribe" && first) { first = false; throw new Error("Serviço de mídia recusou a faixa"); }
  });
  await session.offer("late-mic", "friend", "mic");
  assert.equal(requests.filter(r => r.method === "subscribe").length, 2);
  assert.ok(h.audio[0].srcObject);
  session.close(false);
});
