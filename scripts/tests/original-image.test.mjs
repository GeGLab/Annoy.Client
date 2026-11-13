import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { openOriginalImage } from "../../src/renderer/src/lib/original-image.ts";

const originalFetch = globalThis.fetch, originalWindow = globalThis.window;
afterEach(() => { globalThis.fetch = originalFetch; globalThis.window = originalWindow; });

function windowPort() {
  const calls = [], nodes = [], revoked = [], events = new Map();
  let owned;
  const child = {
    closed: false, close() { this.closed = true; },
    URL: { createObjectURL: blob => { owned = blob; return "blob:child-owned"; }, revokeObjectURL: url => revoked.push(url) },
    document: { title: "", body: { style: {}, append: element => nodes.push(element) }, createElement: tag => ({ tag, style: {} }) },
    addEventListener: (event, callback) => events.set(event, callback),
  };
  globalThis.window = { open: (...args) => { calls.push(args); return child; } };
  return { child, calls, nodes, revoked, events, owned: () => owned };
}

test("an encrypted WebP original opens in the app with its own URL and unchanged image bytes", async () => {
  const port = windowPort(), content = new Blob(["RIFF-original-WebP"], { type: "image/webp" });
  globalThis.fetch = async url => { assert.equal(url, "blob:preview"); return new Response(content); };
  await openOriginalImage("blob:preview", "foto.webp");
  assert.equal(port.calls[0][0], "about:blank");
  assert.match(port.calls[0][1], /^annoy-image:/);
  assert.equal(port.child.document.title, "foto.webp");
  assert.equal(port.nodes[0].tag, "img");
  assert.equal(port.nodes[0].src, "blob:child-owned");
  assert.equal(await port.owned().text(), await content.text());
  assert.equal(port.owned().type, "image/webp");
  assert.deepEqual(port.revoked, []);
  port.events.get("pagehide")();
  assert.deepEqual(port.revoked, ["blob:child-owned"]);
});

test("the image window opens before reading bytes to retain the user's click activation", async () => {
  const port = windowPort();
  globalThis.fetch = async () => { assert.equal(port.calls.length, 1); return new Response(new Blob(["image"])); };
  await openOriginalImage("data:image/png;base64,aW1hZ2U=", "imagem.png");
  assert.equal(port.nodes.length, 1);
});

test("blocked windows and unavailable originals report failure instead of silently doing nothing", async () => {
  globalThis.window = { open: () => null };
  await assert.rejects(openOriginalImage("blob:preview", "photo.webp"), /blocked/);
  const port = windowPort();
  globalThis.fetch = async () => new Response(null, { status: 404 });
  await assert.rejects(openOriginalImage("blob:expired", "photo.webp"));
  assert.equal(port.child.closed, true);
});

test("ordinary image links still use the external browser", async () => {
  const port = windowPort();
  globalThis.fetch = () => { throw new Error("ordinary URLs must not be copied"); };
  await openOriginalImage("https://example.test/photo.webp", "photo.webp");
  assert.deepEqual(port.calls, [["https://example.test/photo.webp", "_blank", "noopener,noreferrer"]]);
});
