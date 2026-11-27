import { after, test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// features/preferences/sync.ts: Aparência sealed in the Annoy account. The store, the cloud and the
// session are stand-ins; the crypto is the real WebCrypto.
const h = { mocks: [], listeners: new Set(), storage: new Map(), server: { version: 0, data: null, conflicts: 0, puts: 0 } };
const settings = (patch = {}) => ({ theme: "dark", themePreset: "classic", accentColor: null, surfaceColor: null, appIcon: "classic", glassBlur: 16, glassTransparency: 40, displayMode: "auto", barPosition: "side", ...patch });
h.state = { settings: settings() };
globalThis.__annoyPreferenceTests = h;
const stubs = new Map();
function stub(path, exports) {
  const id = h.mocks.push(exports) - 1;
  stubs.set(new URL(`../../src/renderer/src/${path}`, import.meta.url).href,
    Object.keys(exports).map((name) => `export const ${name}=globalThis.__annoyPreferenceTests.mocks[${id}][${JSON.stringify(name)}];`).join("\n"));
}
class CloudError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
const notify = () => { for (const l of h.listeners) l(); };
stub("store.ts", {
  getState: () => h.state,
  setState: (recipe) => { const next = structuredClone(h.state); recipe(next); h.state = next; notify(); },
  subscribe: (l) => (h.listeners.add(l), () => h.listeners.delete(l)),
});
stub("social/cloud.ts", {
  CloudError,
  cloud: async (service, path, init = {}) => {
    assert.equal(service, "users");
    assert.equal(path, "/v1/users/@me/preferences");
    if (!init.method) return { version: h.server.version, data: h.server.data, updatedAt: null };
    h.server.puts++;
    if (h.server.conflicts > 0) { h.server.conflicts--; h.server.version++; throw new CloudError(409, "data_conflict"); }
    if (init.body.baseVersion !== h.server.version) throw new CloudError(409, "data_conflict");
    h.server.version++;
    h.server.data = init.body.data;
    return { version: h.server.version };
  },
});
const vault = crypto.getRandomValues(new Uint8Array(32));
stub("auth/session.ts", { unlockedKeys: () => ({ vault }) });
const hooks = registerHooks({
  resolve(specifier, context, next) {
    const url = context.parentURL && specifier.startsWith(".") ? new URL(specifier, context.parentURL).href : null;
    return url && stubs.has(url) ? { url, shortCircuit: true } : next(specifier, context);
  },
  load(url, context, next) { return stubs.has(url) ? { format: "module", source: stubs.get(url), shortCircuit: true } : next(url, context); },
});
globalThis.localStorage = { getItem: (key) => h.storage.get(key) ?? null, setItem: (key, value) => h.storage.set(key, String(value)) };
const sync = await import("../../src/renderer/src/features/preferences/sync.ts");
after(() => { sync.stopPreferences(); hooks.deregister(); delete globalThis.__annoyPreferenceTests; });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** Another install wrote these values (sealed with the same vault key). */
async function remoteWrites(values) {
  const other = h.state;
  h.state = { settings: settings(values) };
  sync.stopPreferences();
  h.storage.set(sync.SYNCED_KEY, JSON.stringify([]));
  await sync.startPreferences("UOTHER");
  sync.stopPreferences();
  h.state = other;
}

test("only well-formed values from the account are taken", () => {
  assert.deepEqual(sync.normalizePreferences({ theme: "neon", themePreset: "nope", accentColor: "red", surfaceColor: "#12345", glassBlur: "9", displayMode: "tv", barPosition: "top" }), {});
  assert.deepEqual(sync.normalizePreferences({ theme: "light", themePreset: "ocean", accentColor: "#AABBCC", surfaceColor: null, glassBlur: 99, glassTransparency: 43, displayMode: "mobile" }),
    { theme: "light", themePreset: "ocean", accentColor: "#AABBCC", surfaceColor: null, glassBlur: 30, glassTransparency: 45, displayMode: "mobile" });
  assert.deepEqual(Object.keys(sync.pick(settings())), [...sync.SYNCED_FIELDS], "layout and other settings stay on the device");
});

test("first time on this install: its own values win and go up sealed", async () => {
  await remoteWrites({ theme: "light", themePreset: "sakura" });
  const before = h.server.version;
  h.state = { settings: settings({ themePreset: "midnight", displayMode: "desktop" }) };
  await sync.startPreferences("UME");
  assert.equal(h.server.version, before + 1);
  assert.equal(h.state.settings.themePreset, "midnight");
  assert.ok(!Buffer.from(h.server.data, "base64url").toString("latin1").includes("midnight"), "usersannoy holds only sealed bytes");
  assert.ok(JSON.parse(h.storage.get(sync.SYNCED_KEY)).includes("UME"));
});

test("later starts take the account's values", async () => {
  sync.stopPreferences();
  await remoteWrites({ theme: "light", themePreset: "coffee", glassBlur: 4 });
  h.storage.set(sync.SYNCED_KEY, JSON.stringify(["UME"]));
  h.state = { settings: settings({ themePreset: "midnight" }) };
  const puts = h.server.puts;
  await sync.startPreferences("UME");
  assert.equal(h.state.settings.themePreset, "coffee");
  assert.equal(h.state.settings.glassBlur, 4);
  assert.equal(h.server.puts, puts, "nothing to send back");
});

test("a change here goes up; a change elsewhere applies at once", async () => {
  h.state = { settings: { ...h.state.settings, accentColor: "#112233" } };
  notify();
  await wait(1000);
  const version = h.server.version;
  // Another install of the same account changes the theme.
  const mine = h.state;
  await remoteWrites({ ...mine.settings, theme: "system", accentColor: "#112233" });
  h.storage.set(sync.SYNCED_KEY, JSON.stringify(["UME"]));
  h.state = mine;
  await sync.startPreferences("UME");
  assert.equal(h.state.settings.theme, "system");
  assert.ok(h.server.version > version);
  await remoteWrites({ ...h.state.settings, displayMode: "mobile" });
  h.storage.set(sync.SYNCED_KEY, JSON.stringify(["UME"]));
  await sync.startPreferences("UME");
  await sync.preferencesChanged(h.server.version);
  assert.equal(h.state.settings.displayMode, "mobile");
});

test("a write that meets a newer copy reads it and writes again (last change wins)", async () => {
  h.server.conflicts = 1;
  h.state = { settings: { ...h.state.settings, surfaceColor: "#445566" } };
  notify();
  await wait(1000);
  sync.stopPreferences();
  h.storage.set(sync.SYNCED_KEY, JSON.stringify(["UME"]));
  h.state = { settings: settings() };
  await sync.startPreferences("UME");
  assert.equal(h.state.settings.surfaceColor, "#445566");
});
