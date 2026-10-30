import { test } from "node:test";
import assert from "node:assert/strict";
import { affectedAccountId, jitterRetryDelay, observeHttp, observeNetwork, observeReachable, observeRequestFailure, observeTransport, recoveryDeadline, unknownEndpoint } from "../../src/shared/connectivity.ts";

const network = { status: "unknown", observedAt: null };

test("OS online does not prove internet access and offline is explicit", () => {
  assert.deepEqual(observeNetwork(false, 10), { status: "offline", observedAt: 10 });
  assert.deepEqual(observeNetwork(true, 20), { status: "unknown", observedAt: 20 });
});

test("recovery delay spreads clients and foreground deadline honors announced restarts", () => {
  assert.equal(jitterRetryDelay(1000, () => 0), 750);
  assert.equal(jitterRetryDelay(1000, () => 0.5), 1000);
  assert.equal(jitterRetryDelay(30_000, () => 1), 37_500);
  assert.equal(recoveryDeadline(10_000, null), 70_000);
  assert.equal(recoveryDeadline(10_000, 190_000), 190_000);
  assert.equal(recoveryDeadline(null, null), null);
});

test("transport observations carry scheduler diagnostics without persisting them elsewhere", () => {
  const initial = unknownEndpoint();
  assert.equal(initial.attempt, 0);
  assert.equal(initial.nextRetryAt, null);
  const recovering = { ...initial, attempt: 3, nextRetryAt: 5000, recoveryDeadline: 60_000, restartUntil: null };
  const connecting = observeTransport(recovering, "connecting", 4000, network);
  assert.equal(connecting.attempt, 3);
  assert.equal(connecting.nextRetryAt, 5000);
  const ready = observeTransport(connecting, "ready", 6000, network);
  assert.equal(ready.attempt, 0);
  assert.equal(ready.recoveryDeadline, null);
});

test("cached and unobserved endpoints start unknown, independently", () => {
  const a = unknownEndpoint(), b = unknownEndpoint();
  assert.notEqual(a, b);
  assert.equal(a.availability, "unknown");
  assert.equal(a.authentication, "unknown");
  assert.equal(a.observedAt, null);
  const ready = observeTransport(a, "ready", 10, network);
  assert.equal(ready.authentication, "valid");
  assert.equal(ready.availability, "available");
  assert.equal(b.availability, "unknown");
});

test("retries preserve the latest result, and recovery clears the failure", () => {
  const ready = observeTransport(unknownEndpoint(), "ready", 10, network);
  const down = observeTransport(ready, "offline", 20, network);
  assert.equal(down.cause, "network");
  assert.equal(down.authentication, "valid");
  assert.equal(observeTransport(down, "connecting", 25, network), down);
  const recovered = observeTransport(down, "ready", 30, network);
  assert.equal(recovered.cause, null);
  assert.equal(recovered.observedAt, 30);
  assert.equal(ready.observedAt, 10);
});

test("socket reachability does not claim authentication before READY", () => {
  const open = observeReachable(unknownEndpoint(), 10);
  assert.equal(open.availability, "available");
  assert.equal(open.authentication, "unknown");
  assert.equal(observeTransport(open, "invalid", 20, network).authentication, "invalid");
});

test("401, 403 and server failure are distinct from transport failure", () => {
  const initial = unknownEndpoint();
  for (const [status, authentication, cause, availability] of [
    [401, "invalid", "unauthorized", "available"],
    [403, "forbidden", "forbidden", "available"],
    [503, "unknown", "service", "unavailable"],
  ]) {
    const next = observeHttp(initial, status, 10, true);
    assert.deepEqual([next.authentication, next.cause, next.availability], [authentication, cause, availability]);
  }
  assert.equal(observeHttp(initial, 200, 10, false).authentication, "unknown");
  assert.equal(observeHttp(initial, 200, 10, true).authentication, "valid");
});

test("failure distinguishes timeout and offline without inventing internet diagnosis", () => {
  const initial = unknownEndpoint();
  assert.equal(observeRequestFailure(initial, new DOMException("Timeout", "TimeoutError"), 10, network).cause, "timeout");
  assert.equal(observeRequestFailure(initial, new TypeError("Failed to fetch"), 10, network).cause, "network");
  assert.equal(observeRequestFailure(initial, new TypeError("Failed to fetch"), 10, observeNetwork(false, 5)).cause, "system-offline");
  assert.equal(network.status, "unknown");
});

test("A falling never blocks B, and changing areas immediately changes recovery scope", () => {
  const instances = { a: { status: "offline" }, b: { status: "ready" } };
  assert.equal(affectedAccountId({ kind: "server", accountId: "a" }, instances, network), "a");
  for (const kind of ["server", "home", "marketplace"])
    assert.equal(affectedAccountId({ kind, accountId: "b" }, instances, network), null);
  assert.equal(affectedAccountId({ kind: "home", accountId: "a" }, instances, network), "a");
  assert.equal(affectedAccountId({ kind: "marketplace", accountId: "a" }, instances, network), "a");
  for (const view of [{ kind: "service" }, { kind: "news" }, { kind: "home", accountId: null }, { kind: "marketplace", accountId: null }])
    assert.equal(affectedAccountId(view, instances, observeNetwork(false, 10)), null);
});

test("an invalid session and OS offline affect only the selected account", () => {
  const instances = { a: { status: "invalid" }, b: { status: "ready" } };
  assert.equal(affectedAccountId({ kind: "server", accountId: "a" }, instances, network), "a");
  assert.equal(affectedAccountId({ kind: "server", accountId: "b" }, instances, network), null);
  assert.equal(affectedAccountId({ kind: "server", accountId: "b" }, instances, observeNetwork(false, 10)), "b");
});
