import { test } from "node:test";
import assert from "node:assert/strict";
import { channelNameTaken, dropFor, moveInOrder, storedChannelName } from "../../src/shared/channel-order.ts";

const ch = (id, type, parentId, position, extra = {}) => ({ id, type, parentId, position, name: id, serverId: "s", topic: "", ...extra });
const list = [ch("text", "category", null, 0), ch("geral", "text", "text", 1), ch("memes", "text", "text", 2), ch("voice", "category", null, 3), ch("sala", "voice", "voice", 4), ch("loose", "text", null, 5)];
/** What the sidebar shows: loose rooms, then each category with its rooms. */
const layout = (channels) => {
  const sorted = [...channels].sort((a, b) => a.position - b.position);
  return [
    ...sorted.filter((c) => c.type !== "category" && !c.parentId).map((c) => c.id),
    ...sorted.filter((c) => c.type === "category").map((cat) => `${cat.id}: ${sorted.filter((c) => c.parentId === cat.id).map((c) => c.id).join(",")}`),
  ];
};

test("moves match annoy-server: before a room, at the end of a category, into an empty one, and categories", () => {
  assert.deepEqual(layout(list), ["loose", "text: geral,memes", "voice: sala"]);
  assert.deepEqual(layout(moveInOrder(list, "memes", { parentId: "text", beforeId: "geral" })), ["loose", "text: memes,geral", "voice: sala"]);
  assert.deepEqual(layout(moveInOrder(list, "geral", { parentId: "voice", beforeId: null })), ["loose", "text: memes", "voice: sala,geral"]);
  assert.deepEqual(layout(moveInOrder(list, "sala", { parentId: null, beforeId: "loose" })), ["sala", "loose", "text: geral,memes", "voice: "]);
  assert.deepEqual(layout(moveInOrder(list, "voice", { parentId: null, beforeId: "text" })), ["loose", "voice: sala", "text: geral,memes"]);
  const empty = [...list, ch("vazia", "category", null, 6)];
  assert.deepEqual(layout(moveInOrder(empty, "loose", { parentId: "vazia", beforeId: null })), ["text: geral,memes", "voice: sala", "vazia: loose"]);
  assert.deepEqual(moveInOrder(list, "memes", { parentId: "text", beforeId: null }).map((c) => c.position), [0, 1, 2, 3, 4, 5]);
});

test("a drop on a row: above or below it, into a category, and categories only among categories", () => {
  const texts = [list[1], list[2]];
  assert.deepEqual(dropFor(list[4], list[1], "before", "text", texts), { parentId: "text", beforeId: "geral" });
  assert.deepEqual(dropFor(list[4], list[1], "after", "text", texts), { parentId: "text", beforeId: "memes" });
  assert.deepEqual(dropFor(list[4], list[2], "after", "text", texts), { parentId: "text", beforeId: null });
  assert.deepEqual(dropFor(list[1], list[3], "into", null, []), { parentId: "voice", beforeId: null });
  const categories = [list[0], list[3]];
  assert.deepEqual(dropFor(list[3], list[0], "before", null, categories), { parentId: null, beforeId: "text" });
  assert.deepEqual(dropFor(list[0], list[3], "after", null, categories), { parentId: null, beforeId: null });
  assert.equal(dropFor(list[0], list[1], "before", "text", texts), null, "a category never goes among rooms");
});

test("names: one per type and place, as stored, case aside; temporary rooms are free", () => {
  assert.equal(storedChannelName("text", " Regras Gerais "), "regras-gerais");
  assert.equal(storedChannelName("voice", " Sala Um "), "Sala Um");
  assert.equal(channelNameTaken(list, "text", "Geral", "text"), true);
  assert.equal(channelNameTaken(list, "text", "geral", "voice"), false, "another place");
  assert.equal(channelNameTaken(list, "voice", "geral", "text"), false, "another type");
  assert.equal(channelNameTaken(list, "text", "geral", "text", "geral"), false, "itself");
  assert.equal(channelNameTaken(list, "category", "VOICE", null), true);
  assert.equal(channelNameTaken([...list, ch("Temp", "voice", "voice", 7, { temporary: true })], "voice", "temp", "voice"), false);
});
