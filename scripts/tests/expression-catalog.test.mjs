import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = new URL("../../src/renderer/public/expression/", import.meta.url);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("every distributed catalog asset has pinned provenance, credits, license and matching integrity", async () => {
  const index = JSON.parse(await readFile(new URL("catalog/index.json", root), "utf8"));
  assert.equal(index.schemaVersion, 1);
  assert.equal(index.packs.length, 6);
  const ids = new Set();
  for (const entry of index.packs) {
    const bytes = await readFile(new URL(entry.page, root));
    assert.equal(sha256(bytes), entry.sha256);
    const page = JSON.parse(bytes);
    assert.equal(page.version, index.version);
    assert.equal(page.packs.length, 2);
    const pack = page.packs.find((pack) => pack.id === entry.id);
    assert.ok(pack && !ids.has(pack.id)); ids.add(pack.id);
    assert.equal(pack.version, "16.0.0");
    assert.equal(pack.author, "OpenMoji");
    assert.equal(pack.license, "CC BY-SA 4.0");
    assert.equal(pack.licenseUrl, "https://creativecommons.org/licenses/by-sa/4.0/");
    assert.match(pack.source, /66e17da0f2d4347f64ee9d78c367fc5234283863/);
    assert.match(pack.credits, /Unmodified PNG artwork/);
    assert.ok(pack.items.length > 0 && pack.items.length <= 60);
    for (const item of pack.items) {
      const image = await readFile(new URL(item.url, root));
      assert.equal(sha256(image), item.sha256);
      assert.equal(image.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    }
  }
  assert.match(await readFile(new URL("openmoji/LICENSE.txt", root), "utf8"), /Attribution-ShareAlike 4.0 International/);
});
