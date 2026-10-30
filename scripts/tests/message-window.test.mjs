import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mergeMessageWindow,
  reconcileMessageWindow,
  boundMessageCaches,
} from "../../src/shared/message-window.ts";
const messages = (start, count) =>
  Array.from({ length: count }, (_, index) => ({
    id: String(start + index).padStart(8, "0"),
    content: "body",
  }));
test("global cache evicts least recently used channels and preserves the visible conversation", () => {
  const cache = Object.fromEntries(
    Array.from({ length: 12 }, (_, index) => [
      `channel-${index}`,
      { items: messages(index * 500, 500), lastAccessed: index },
    ]),
  );
  boundMessageCaches(cache, ["channel-0", "channel-11"]);
  assert.equal(
    Object.values(cache).reduce((sum, entry) => sum + entry.items.length, 0),
    5000,
  );
  assert.ok(cache["channel-0"]);
  assert.ok(cache["channel-11"]);
  assert.equal(cache["channel-1"], undefined);
  assert.equal(cache["channel-2"], undefined);
});
test("bounded history retains the requested side and supports traversing back to newer pages", () => {
  let cache = messages(500, 500);
  const older = mergeMessageWindow(cache, messages(450, 50), "before");
  assert.equal(older.items.length, 500);
  assert.equal(older.items[0].id, "00000450");
  assert.equal(older.evictedAfter, true);
  const newer = mergeMessageWindow(older.items, messages(950, 50), "after");
  assert.deepEqual(newer.items, cache);
  assert.equal(newer.evictedBefore, true);
});
test("late pages cannot resurrect deleted messages or undo a live edit, and off-window creates do not form gaps", () => {
  const page = messages(100, 50),
    edited = { ...page[10], content: "live edit" },
    created = messages(200, 1)[0];
  const changes = [
    { sequence: 2, kind: "update", message: edited, messageId: edited.id },
    { sequence: 3, kind: "delete", message: null, messageId: page[20].id },
    { sequence: 4, kind: "create", message: created, messageId: created.id },
  ];
  const context = reconcileMessageWindow(page, changes, 1, false);
  assert.equal(context.length, 49);
  assert.equal(
    context.find((item) => item.id === edited.id).content,
    "live edit",
  );
  assert.equal(
    context.some((item) => item.id === page[20].id),
    false,
  );
  assert.equal(
    context.some((item) => item.id === created.id),
    false,
  );
  const latest = reconcileMessageWindow(page, changes, 1, true);
  assert.equal(latest.length, 50);
  assert.equal(latest.at(-1).id, created.id);
});
test("overlapping responses and edits merge deterministically without duplicate message IDs", () => {
  const previous = messages(0, 100),
    update = { ...previous[50], content: "edited" };
  const result = mergeMessageWindow(
    previous,
    [...messages(50, 100), update],
    "after",
  );
  assert.equal(result.items.length, 150);
  assert.equal(result.items[50].content, "edited");
  assert.equal(new Set(result.items.map((item) => item.id)).size, 150);
  assert.equal(
    mergeMessageWindow(result.items, messages(900, 50), "replace").items.length,
    50,
  );
});
