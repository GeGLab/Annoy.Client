import { test } from "node:test";
import assert from "node:assert/strict";

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

globalThis.localStorage = new MemoryStorage();
const chatState = await import("../../src/renderer/src/chat-state.ts");

test("drafts are versioned and isolated by account and channel", () => {
  chatState.writeChatDraft("account-a", "channel-1", { text: "local draft", replyToId: "message-3", attachmentCount: 0 });
  chatState.writeChatDraft("account-b", "channel-1", { text: "other account", replyToId: null, attachmentCount: 0 });
  assert.equal(chatState.readChatDraft("account-a", "channel-1").text, "local draft");
  assert.equal(chatState.readChatDraft("account-a", "channel-2").text, "");
  assert.equal(chatState.readChatDraft("account-b", "channel-1").replyToId, null);
});

test("only attachment count persists; File objects remain in session memory", () => {
  const file = { name: "private-document.pdf", size: 40 };
  chatState.writePendingFiles("account-a", "channel-1", [file]);
  assert.deepEqual(chatState.readPendingFiles("account-a", "channel-1"), [file]);
  assert.equal(chatState.readChatDraft("account-a", "channel-1").attachmentCount, 1);
  const persisted = localStorage.getItem("distopic.chat-state.v1");
  assert.ok(persisted);
  assert.ok(!persisted.includes("private-document.pdf"));
  assert.ok(persisted.includes("local draft"));
});

test("anchors debounce to durable state and explicit latest clears the anchor", async () => {
  chatState.writeChatAnchor("account-a", "channel-1", { messageId: "message-20", offset: -15.25 });
  await new Promise((resolve) => setTimeout(resolve, 220));
  assert.deepEqual(chatState.readChatAnchor("account-a", "channel-1"), { messageId: "message-20", offset: -15.25 });
  chatState.clearChatAnchor("account-a", "channel-1");
  assert.equal(chatState.readChatAnchor("account-a", "channel-1"), null);
});

test("recovery destinations survive in the versioned state and account removal clears owned data", () => {
  chatState.saveRecoveryReturn("account-a", { kind: "server", serverId: "server-1", channelId: "channel-1" });
  assert.deepEqual(chatState.readRecoveryReturn("account-a"), { kind: "server", serverId: "server-1", channelId: "channel-1" });
  chatState.writeChatDraft("account-a", "channel-2", { text: "remove me", replyToId: null, attachmentCount: 0 });
  chatState.writeChatDraft("account-b", "channel-1", { text: "keep me", replyToId: null, attachmentCount: 0 });
  chatState.writeChatAnchor("account-a", "channel-1", { messageId: "message-20", offset: 12 });
  chatState.flushChatState();
  chatState.clearAccountChatState("account-a");
  assert.equal(chatState.readRecoveryReturn("account-a"), null);
  assert.equal(chatState.readChatDraft("account-a", "channel-2").text, "");
  assert.equal(chatState.readChatDraft("account-b", "channel-1").text, "keep me");
  assert.equal(chatState.readChatAnchor("account-a", "channel-1"), null);
});
