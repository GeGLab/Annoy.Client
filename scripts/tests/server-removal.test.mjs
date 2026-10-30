import { test } from "node:test";
import assert from "node:assert/strict";
import { canRemoveServer, connectionOfflineSince, OWNER_OFFLINE_GRACE_MS } from "../../src/shared/server-removal.ts";

const now = 2_000_000_000_000;
const owner = { ownerId: "owner", userId: "owner", status: "ready", now };

test("owners are blocked with other members and with unknown membership", () => {
  assert.equal(canRemoveServer({ ...owner, memberIds: ["owner", "offline-member"] }), false);
  assert.equal(canRemoveServer(owner), false);
  assert.equal(canRemoveServer({ ...owner, memberIds: [] }), false);
  assert.equal(canRemoveServer({ ...owner, memberIds: ["someone-else"] }), false);
  assert.equal(canRemoveServer({ ...owner, memberIds: ["owner"] }), true);
  assert.equal(canRemoveServer({ ...owner, ownerId: undefined, memberIds: ["owner"] }), false);
});

test("a former owner can remove their shortcut after a transfer", () => {
  assert.equal(canRemoveServer({ ...owner, ownerId: "new-owner", memberIds: ["owner", "new-owner"] }), true);
});

test("offline owners require seven complete days, including during connection retries", () => {
  const offlineSince = now - OWNER_OFFLINE_GRACE_MS;
  assert.equal(canRemoveServer({ ...owner, status: "offline", offlineSince: offlineSince + 1 }), false);
  assert.equal(canRemoveServer({ ...owner, status: "offline", offlineSince }), true);
  assert.equal(canRemoveServer({ ...owner, status: "connecting", offlineSince }), true);
  assert.equal(canRemoveServer({ ...owner, status: "ready", offlineSince, memberIds: ["owner", "member"] }), false);
  assert.equal(canRemoveServer({ ...owner, status: "invalid", offlineSince }), false);
});

test("unknown, invalid and future outage times cannot unlock removal", () => {
  for (const offlineSince of [undefined, NaN, Infinity, -1, now + 1])
    assert.equal(canRemoveServer({ ...owner, status: "offline", offlineSince }), false);
});

test("outage start persists through retries and restart serialization; reachable servers clear it", () => {
  const start = connectionOfflineSince(undefined, "offline", now);
  assert.equal(start, now);
  assert.equal(connectionOfflineSince(start, "connecting", now + 1000), start);
  assert.equal(connectionOfflineSince(start, "offline", now + 2000), start);
  const restored = JSON.parse(JSON.stringify({ offlineSince: start }));
  assert.equal(connectionOfflineSince(restored.offlineSince, "connecting", now + OWNER_OFFLINE_GRACE_MS), start);
  assert.equal(connectionOfflineSince(start, "ready", now + 3000), undefined);
  assert.equal(connectionOfflineSince(start, "invalid", now + 3000), undefined);
  assert.equal(connectionOfflineSince(undefined, "offline", now, false), undefined);
});
