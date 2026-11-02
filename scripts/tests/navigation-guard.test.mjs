import test from "node:test";
import assert from "node:assert/strict";
import {
  registerNavigationGuard,
  requestNavigation,
} from "../../src/renderer/src/lib/navigation-guard.ts";
test("settings overlays cannot replace the underlying unsaved-editor guard", () => {
  const order = [];
  const editor = registerNavigationGuard((next) => {
    order.push("editor");
    next();
  });
  const settings = registerNavigationGuard((next) => {
    order.push("settings");
    next();
  });
  try {
    requestNavigation(() => order.push("restart"));
    assert.deepEqual(order, ["settings", "editor", "restart"]);
    settings();
    order.length = 0;
    requestNavigation(() => order.push("quit"));
    assert.deepEqual(order, ["editor", "quit"]);
  } finally {
    settings();
    editor();
  }
});
test("deferred save/discard waits, and cancellation never runs the final action", () => {
  let confirm,
    exits = 0;
  const clean = registerNavigationGuard((next) => {
    confirm = next;
  });
  try {
    requestNavigation(() => exits++);
    assert.equal(exits, 0);
    confirm();
    assert.equal(exits, 1);
    requestNavigation(() => exits++);
    assert.equal(exits, 1);
  } finally {
    clean();
  }
});
test("a removed guard is skipped after another guard finishes asynchronously", () => {
  let confirm;
  const order = [];
  const editor = registerNavigationGuard((next) => {
    order.push("stale");
    next();
  });
  const modal = registerNavigationGuard((next) => {
    confirm = next;
  });
  try {
    requestNavigation(() => order.push("exit"));
    editor();
    confirm();
    assert.deepEqual(order, ["exit"]);
  } finally {
    editor();
    modal();
  }
});
