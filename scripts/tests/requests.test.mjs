import { test } from "node:test";
import assert from "node:assert/strict";
import { Api, authenticate, findInstance } from "../../src/renderer/src/api.ts";
import { abortableDelay, isCancellation, parseResponse, READ_TIMEOUT_MS, RequestError, RequestScope, UPLOAD_TIMEOUT_MS, WRITE_TIMEOUT_MS } from "../../src/shared/requests.ts";

const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const flush = async () => { for (let n = 0; n < 12; n++) await Promise.resolve(); };
const response = (value, status = 200) => new Response(JSON.stringify(value), { status });

test("reads and writes terminate at their distinct deadlines even when fetch ignores abort", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const fetch = t.mock.method(globalThis, "fetch", () => new Promise(() => {}));
  const api = new Api("http://test", "token");
  const read = assert.rejects(api.get("/read"), { kind: "timeout" });
  const write = assert.rejects(api.post("/write", {}), { kind: "timeout" });
  await flush();
  const [readSignal, writeSignal] = fetch.mock.calls.map((call) => call.arguments[1].signal);
  t.mock.timers.tick(READ_TIMEOUT_MS);
  await read;
  assert.equal(readSignal.aborted, true);
  assert.equal(writeSignal.aborted, false);
  t.mock.timers.tick(WRITE_TIMEOUT_MS - READ_TIMEOUT_MS);
  await write;
  assert.equal(writeSignal.aborted, true);
  assert.equal(fetch.mock.callCount(), 2);
});

test("the deadline covers a stalled response body as well as headers", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({ start() {} })));
  const request = assert.rejects(new Api("http://test", "token").get("/body"), { kind: "timeout" });
  await flush();
  t.mock.timers.tick(READ_TIMEOUT_MS);
  await request;
});

test("identical reads coalesce but cancellation belongs to each consumer", async (t) => {
  const wait = deferred();
  const fetch = t.mock.method(globalThis, "fetch", () => wait.promise);
  const api = new Api("http://test", "token"), controller = new AbortController();
  const first = api.get("/items?before=one", controller.signal);
  const rejected = assert.rejects(first, isCancellation);
  const second = api.get("/items?before=one");
  await flush();
  assert.equal(fetch.mock.callCount(), 1);
  controller.abort();
  await rejected;
  assert.equal(fetch.mock.calls[0].arguments[1].signal.aborted, false);
  wait.resolve(response(["shared"]));
  assert.deepEqual(await second, ["shared"]);
});

test("account, query cursor and mutation requests never share an in-flight result", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => response([]));
  const a = new Api("http://test", "account-a"), b = new Api("http://test", "account-b");
  await Promise.all([a.get("/items?before=a"), a.get("/items?before=b"), b.get("/items?before=a"), a.post("/items", {}), a.post("/items", {})]);
  assert.equal(fetch.mock.callCount(), 5);
  assert.equal(fetch.mock.calls[2].arguments[1].headers.authorization, "Bearer account-b");
});

test("the last consumer aborts the source, and a later read starts a new generation", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", () => new Promise(() => {}));
  const api = new Api("http://test", "token"), controller = new AbortController();
  const cancelled = assert.rejects(api.get("/items", controller.signal), isCancellation);
  await flush();
  controller.abort();
  await cancelled;
  assert.equal(fetch.mock.calls[0].arguments[1].signal.aborted, true);
  const next = assert.rejects(api.get("/items"), isCancellation);
  await flush();
  assert.equal(fetch.mock.callCount(), 2);
  api.cancelPending();
  await next;
});

test("invalidating an account cancels its reads and writes; disposal rejects future work", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", () => new Promise(() => {}));
  const api = new Api("http://test", "token");
  const first = assert.rejects(api.get("/items"), isCancellation);
  const mutation = assert.rejects(api.post("/items", {}), isCancellation);
  await flush();
  api.cancelPending();
  await Promise.all([first, mutation]);
  assert.equal(api.generation, 1);
  api.dispose();
  await assert.rejects(api.get("/items"), isCancellation);
  assert.equal(fetch.mock.callCount(), 2);
});

test("HTTP errors retain classification and server code even with an HTML error body", async () => {
  for (const [status, kind] of [[401, "unauthorized"], [403, "forbidden"], [503, "service"], [409, "http"]])
    await assert.rejects(parseResponse(new Response("<html>proxy</html>", { status })), { status, kind });
  await assert.rejects(parseResponse(response({ error: "global_new_account", message: "Escolha um nome" }, 409)), { code: "global_new_account", message: "Escolha um nome" });
  await assert.rejects(parseResponse(new Response("not json")), { kind: "invalid-response" });
});

test("network and mutation failures are observable and never replayed automatically", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => { throw new TypeError("unreachable"); });
  const observations = [];
  const api = new Api("http://test", "token", () => true, (value) => observations.push(value));
  await assert.rejects(api.post("/messages", { content: "only once" }), { kind: "network" });
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(observations[0].kind, "network");
});

test("completed operations remove their abort listener and clear their timeout", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const scope = new RequestScope(), controller = new AbortController();
  const add = t.mock.method(controller.signal, "addEventListener"), remove = t.mock.method(controller.signal, "removeEventListener");
  let source;
  assert.equal(await scope.run(async (signal) => { source = signal; return 42; }, { signal: controller.signal }), 42);
  assert.equal(add.mock.callCount(), remove.mock.callCount());
  controller.abort();
  t.mock.timers.tick(READ_TIMEOUT_MS);
  assert.equal(source.aborted, false);
});

test("cancelled discovery does not try another host and cancelled authentication sends nothing", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", () => new Promise(() => {}));
  const controller = new AbortController();
  const pending = assert.rejects(findInstance("example.test", controller.signal), isCancellation);
  await flush();
  controller.abort();
  await pending;
  await assert.rejects(authenticate("http://test", "login", { username: "user", password: "test" }, controller.signal), isCancellation);
  assert.equal(fetch.mock.callCount(), 1);
});

test("poll delays release timers and listeners immediately on cancellation", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const controller = new AbortController();
  const remove = t.mock.method(controller.signal, "removeEventListener");
  const pending = assert.rejects(abortableDelay(1500, controller.signal), isCancellation);
  controller.abort();
  await pending;
  assert.equal(remove.mock.callCount(), 1);
  t.mock.timers.tick(1500);
});

class FakeXHR {
  static instances = [];
  upload = {};
  status = 200;
  responseText = "{}";
  aborted = 0;
  constructor() { FakeXHR.instances.push(this); }
  open() {}
  setRequestHeader() {}
  send() {}
  abort() { this.aborted++; this.onabort?.(); }
}

test("uploads have their own deadline and release progress handlers after completion", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const previous = globalThis.XMLHttpRequest;
  globalThis.XMLHttpRequest = FakeXHR;
  t.after(() => { if (previous) globalThis.XMLHttpRequest = previous; else delete globalThis.XMLHttpRequest; });
  const api = new Api("http://test", "token"), controller = new AbortController();
  const pending = api.uploadMessage("channel", "", [], () => {}, controller.signal);
  await flush();
  const xhr = FakeXHR.instances.at(-1);
  xhr.onload();
  assert.deepEqual(await pending, {});
  assert.equal(xhr.upload.onprogress, null);
  controller.abort();
  assert.equal(xhr.aborted, 0);
  const timedOut = assert.rejects(api.uploadMessage("channel", "", [], () => {}), { kind: "timeout" });
  await flush();
  const stalled = FakeXHR.instances.at(-1);
  t.mock.timers.tick(UPLOAD_TIMEOUT_MS);
  await timedOut;
  assert.equal(stalled.aborted, 1);
  assert.equal(stalled.upload.onprogress, null);
});
