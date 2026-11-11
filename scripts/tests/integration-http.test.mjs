import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const h = { addresses: [], calls: [], authorized: true };
globalThis.__annoyHttpTests = h;
const modules = {
  electron: `export const session={fromPartition:()=>({fetch:async(url,options)=>{
    globalThis.__annoyHttpTests.calls.push({url,options});
    return new Response(JSON.stringify({text:'Steam profile'}),{headers:{'content-type':'application/json'}});
  }})};`,
  "node:dns/promises": "export const lookup=async()=>globalThis.__annoyHttpTests.addresses;",
};
const hooks = registerHooks({
  resolve(specifier, context, next) {
    return specifier in modules ? { url: `test:${specifier}`, shortCircuit: true } : next(specifier, context);
  },
  load(url, context, next) {
    return url.startsWith("test:") ? { format: "module", source: modules[url.slice(5)], shortCircuit: true } : next(url, context);
  },
});
const { registerIntegrationHttp } = await import("../../src/main/integrations/http.ts");
let handler;
registerIntegrationHttp({ handle: (_name, callback) => { handler = callback; } }, () => h.authorized);
after(() => { hooks.deregister(); delete globalThis.__annoyHttpTests; });
beforeEach(() => { h.addresses = [{ address: "104.21.63.72", family: 4 }]; h.calls.length = 0; h.authorized = true; });
const input = {
  url: "https://steamprofiler.org/api/annoy", method: "POST", body: '{}',
  headers: { "content-type": "application/json", "x-annoy-integration": "steamprofiler", "x-annoy-timestamp": "1700000000", "x-annoy-signature": "signature", "x-annoy-key-id": "key", cookie: "never-send" },
  maxBytes: 1024, timeoutMs: 5000,
};

test("public IPv4 reaches the integration and preserves signature headers without cookies", async () => {
  const result = await handler({}, input);
  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(h.calls.length, 1);
  const { headers, credentials, redirect } = h.calls[0].options;
  assert.equal(headers["x-annoy-signature"], "signature");
  assert.equal(headers["x-annoy-timestamp"], "1700000000");
  assert.equal(headers["x-annoy-key-id"], "key");
  assert.equal(headers.cookie, undefined);
  assert.equal(credentials, "omit");
  assert.equal(redirect, "error");
});

test("public dual-stack DNS works while private and mapped addresses remain blocked", async () => {
  h.addresses.push({ address: "2606:4700:3036::6815:3f48", family: 6 });
  assert.equal((await handler({}, input)).ok, true);
  for (const [address, family] of [["127.0.0.1", 4], ["10.0.0.1", 4], ["192.168.1.1", 4], ["::1", 6], ["fc00::1", 6], ["fe80::1", 6], ["::ffff:104.21.63.72", 6], ["64:ff9b::6815:3f48", 6]]) {
    h.calls.length = 0;
    h.addresses = [{ address: "104.21.63.72", family: 4 }, { address, family }];
    assert.equal((await handler({}, input)).ok, false, address);
    assert.equal(h.calls.length, 0, address);
  }
});

test("unauthorized callers and non-public URLs never make a request", async () => {
  h.authorized = false;
  assert.equal((await handler({}, input)).ok, false);
  h.authorized = true;
  for (const url of ["http://steamprofiler.org/api/annoy", "https://127.0.0.1/", "https://example.local/"]) {
    assert.equal((await handler({}, { ...input, url })).ok, false);
  }
  assert.equal(h.calls.length, 0);
});
