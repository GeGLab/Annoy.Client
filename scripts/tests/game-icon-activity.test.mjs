import { test } from "node:test";
import assert from "node:assert/strict";
import { steamGameIcon } from "../../src/main/activity/game-icon.ts";
import { registerActivity } from "../../src/main/activity/index.ts";

const dotaIcon = "https://shared.fastly.steamstatic.com/community_assets/images/apps/570/48eb825bb93787945065b460bdc109e395384ebf.jpg";

test("game icons resolve the game's identity, coalesce lookups and cache the official image", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let requests = 0;
  globalThis.fetch = async (url) => {
    assert.equal(String(url), "https://steamcommunity.com/app/570");
    requests++;
    return new Response(`<img class="apphub_AppIcon" src="${dotaIcon}">`);
  };
  assert.deepEqual(await Promise.all([steamGameIcon("570"), steamGameIcon("570")]), [dotaIcon, dotaIcon]);
  assert.equal(await steamGameIcon("570"), dotaIcon);
  assert.equal(requests, 1);
});

test("invalid IDs, other games, nonofficial hosts and oversized pages cannot supply icons", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error("Unexpected request"); };
  for (const id of ["", "../570", "https://attacker.test", "570?x=1", "1234567890123"])
    assert.equal(await steamGameIcon(id), null);
  assert.equal(requests, 0);
  for (const [id, body] of [
    ["48001", `<img src="${dotaIcon}">`],
    ["48002", `<img src="https://attacker.test/community_assets/images/apps/48002/${"a".repeat(40)}.jpg">`],
    ["48003", "x".repeat(256 * 1024 + 1) + `https://shared.fastly.steamstatic.com/community_assets/images/apps/48003/${"a".repeat(40)}.jpg`],
  ]) {
    globalThis.fetch = async () => new Response(body);
    assert.equal(await steamGameIcon(id), null);
  }
});

test("failed icon requests remain optional and negative results are cached", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error("Network unavailable"); };
  assert.equal(await steamGameIcon("48004"), null);
  assert.equal(await steamGameIcon("48004"), null);
  assert.equal(requests, 1);
});

test("the icon IPC accepts only numeric app IDs from the local main frame", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const icon = dotaIcon.replaceAll("570/", "48005/");
  globalThis.fetch = async () => new Response(`<img src="${icon}">`);
  const handlers = new Map();
  const frame = {}, webContents = { mainFrame: frame };
  const stop = registerActivity({ handle: (name, handler) => handlers.set(name, handler) }, () => ({ webContents }));
  t.after(stop);
  const handler = handlers.get("activity:game-icon");
  assert.throws(() => handler({ sender: {}, senderFrame: frame }, "570"), /Invalid activity sender/);
  assert.throws(() => handler({ sender: webContents, senderFrame: {} }, "570"), /Invalid activity sender/);
  assert.equal(handler({ sender: webContents, senderFrame: frame }, 570), null);
  assert.equal(await handler({ sender: webContents, senderFrame: frame }, "bad-id"), null);
  assert.equal(await handler({ sender: webContents, senderFrame: frame }, "48005"), icon);
});
