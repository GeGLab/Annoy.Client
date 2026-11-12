import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveDmLinks } from "../../src/renderer/src/features/integrations/dm-consent.ts";

const message = (id, senderId, op) => ({ id, senderId, integration: { op, id: "steamprofiler", name: "SteamProfiler" } });
const request = message("001", "alice", "request");
const accept = message("002", "bob", "accept");

test("a recipient with no integration cache recovers the pending invitation from conversation history", () => {
  assert.deepEqual(resolveDmLinks(undefined, [request]), {
    steamprofiler: { owner: "alice", status: "pending", name: "SteamProfiler", controlId: "001" },
  });
});

test("accept and decline work from history without installing the integration or waiting for the account API", () => {
  assert.equal(resolveDmLinks(undefined, [accept, request]).steamprofiler.status, "active");
  assert.deepEqual(resolveDmLinks(undefined, [message("002", "bob", "decline"), request]), {});
});

test("the inviter cannot accept their own request and an unsent acceptance grants nothing", () => {
  assert.equal(resolveDmLinks(undefined, [request, message("002", "alice", "accept")]).steamprofiler.status, "pending");
  assert.equal(resolveDmLinks(undefined, [request, { ...accept, state: "failed" }]).steamprofiler.status, "pending");
});

test("older messages cannot undo a newer cached acceptance or replace its owner", () => {
  const cached = resolveDmLinks(undefined, [request, accept]);
  const next = resolveDmLinks(cached, [request, message("0015", "bob", "request")]);
  assert.deepEqual(next, cached);
  assert.equal(cached.steamprofiler.owner, "alice");
});

test("declines and removals stay effective while recovering history, and a later resend can be answered", () => {
  const decline = message("002", "bob", "decline");
  assert.deepEqual(resolveDmLinks(undefined, [request, decline]), {});
  const resend = message("003", "alice", "request");
  assert.equal(resolveDmLinks(undefined, [request, decline, resend]).steamprofiler.status, "pending");
  assert.deepEqual(resolveDmLinks(undefined, [request, accept, message("004", "alice", "remove")]), {});
});
