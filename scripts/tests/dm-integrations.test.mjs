import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// Exercise DM dispatch with the real command parser and HTTP runtime; replace
// account persistence, transport and message delivery with isolated ports.
const steam = {
  id: "steamprofiler", name: "SteamProfiler", scopes: ["dm"],
  key: { required: false }, settings: [], mention: false,
  commands: [{ name: "steam" }], access: { history: false, attachments: false },
  runtime: { type: "http", endpoint: "https://steamprofiler.org/api/annoy" },
};
const h = {
  mocks: [], runtime: { me: "alice" }, notices: [], calls: [], replies: [],
  social: {
    me: { id: "alice", username: "Alice" }, profiles: { bob: { username: "Bob" } },
    relationships: [], dms: [{ id: "dm", recipientId: "bob" }],
    threads: { dm: { items: [] } },
  },
};
globalThis.__annoyIntegrationTests = h;
const stubs = new Map();
function stub(path, exports) {
  const id = h.mocks.push(exports) - 1;
  stubs.set(new URL(`../../src/renderer/src/${path}`, import.meta.url).href,
    Object.keys(exports).map(name => `export const ${name}=globalThis.__annoyIntegrationTests.mocks[${id}][${JSON.stringify(name)}];`).join("\n"));
}
stub("social/runtime.ts", { runtime: h.runtime, social: () => h.social, displayName: p => p?.username ?? "" });
stub("store.ts", { toast: text => h.notices.push(text) });
stub("social/cloud.ts", { cloud: async () => ({ timestamp: 1700000000, signature: "test", keyId: "test" }) });
stub("social/dms.ts", {
  setDmMessageHook: hook => { h.hook = hook; }, loadThread: async () => {},
  openAttachment: async () => { throw Error("Unexpected attachment read"); },
  sendDm: async (...args) => { h.replies.push(args); },
});
stub("features/integrations/state.ts", {
  integrations: () => h.state, integrationById: id => id === steam.id ? steam : undefined,
  loadCatalog: async () => {}, updateAccount: async change => change(h.state.account),
  iconOf: () => null,
});
stub("features/integrations/transport.ts", {
  integrationHttp: async request => {
    h.calls.push(request);
    return { status: 200, type: "application/json", body: new TextEncoder().encode(JSON.stringify({ text: "Steam profile card" })) };
  },
});
const hooks = registerHooks({
  resolve(specifier, context, next) {
    const url = context.parentURL && specifier.startsWith(".") ? new URL(specifier, context.parentURL).href : null;
    return url && stubs.has(url) ? { url, shortCircuit: true } : next(specifier, context);
  },
  load(url, context, next) {
    return stubs.has(url) ? { format: "module", source: stubs.get(url), shortCircuit: true } : next(url, context);
  },
});
const { initDmIntegrations, dmLinks } = await import("../../src/renderer/src/features/integrations/dm.ts");
initDmIntegrations();
after(() => { hooks.deregister(); delete globalThis.__annoyIntegrationTests; });
beforeEach(() => {
  h.state = { account: { connected: { steamprofiler: { settings: {}, key: null } }, dms: { dm: { steamprofiler: { owner: "alice", status: "pending" } } } } };
  h.notices.length = h.calls.length = h.replies.length = 0;
  h.social.threads.dm.items = [];
});
const message = {
  id: "message-1", conversationId: "dm", senderId: "alice",
  content: "/steam profile 76561198086380973", attachments: [], createdAt: "2026-11-11T16:10:00Z",
};
const settle = () => new Promise(resolve => setTimeout(resolve, 30));

test("a local command awaiting consent shows who must accept and sends no request or reply", async () => {
  h.hook(message, true, true);
  await settle();
  assert.deepEqual(h.notices, ["Aguardando Bob aceitar"]);
  assert.equal(h.calls.length, 0);
  assert.equal(h.replies.length, 0);
});

test("remote and unrelated commands produce no pending notice or request", async () => {
  h.hook({ ...message, senderId: "bob" }, true, false);
  h.hook({ ...message, content: "/unknown profile" }, true, true);
  await settle();
  assert.deepEqual(h.notices, []);
  assert.equal(h.calls.length, 0);
});

test("after the other person accepts, a new command calls SteamProfiler and delivers its reply", async () => {
  h.hook({ ...message, senderId: "bob", integration: { op: "accept", id: steam.id, name: steam.name } }, true, false);
  h.hook(message, true, true);
  for (let i = 0; i < 50 && !h.replies.length; i++) await settle();
  assert.deepEqual(h.notices, []);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].url, steam.runtime.endpoint);
  assert.equal(JSON.parse(h.calls[0].body).text, "profile 76561198086380973");
  assert.equal(h.replies.length, 1);
  assert.equal(h.replies[0][1], "Steam profile card");
  assert.equal(h.replies[0][4].integration.id, steam.id);
});

test("historical commands never run or display a notice", async () => {
  h.hook(message, false, false);
  await settle();
  assert.deepEqual(h.notices, []);
  assert.equal(h.calls.length, 0);
});

test("an invitation loaded from encrypted history remains answerable when the separate account cache is missing", async () => {
  h.state.account.dms = {};
  const invitation = { ...message, id: "001", integration: { op: "request", id: steam.id, name: steam.name } };
  h.social.threads.dm.items = [invitation];
  assert.equal(dmLinks("dm").steamprofiler.status, "pending");
  const accepted = { ...message, id: "002", senderId: "bob", integration: { op: "accept", id: steam.id, name: steam.name } };
  h.social.threads.dm.items.push(accepted);
  h.hook(accepted, true, false);
  await settle();
  assert.equal(h.state.account.dms.dm.steamprofiler.status, "active");
  assert.equal(h.calls.length, 0, "consent controls never execute an integration");
});
