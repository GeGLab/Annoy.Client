import test from "node:test";
import assert from "node:assert/strict";
import { dueOn, localized, parseBlocks, pollText, seenKey } from "../../src/renderer/src/features/announcements/model.ts";

const base = { id: "a1", revision: 0, publishedAt: null, polls: [], locales: { en: { title: "News", body: "Hi", polls: {} }, "pt-BR": { title: "Novidades", body: "Oi", polls: {} } } };

test("opens only unseen ones from the same local day; a reopened revision opens again", () => {
  const morning = new Date(2026, 10, 26, 9, 0);
  const night = new Date(2026, 10, 26, 23, 50);
  const tomorrow = new Date(2026, 10, 27, 0, 5);
  const item = { ...base, shownAt: morning.toISOString() };
  assert.deepEqual(dueOn([item], new Set(), night).map((a) => a.id), ["a1"]);
  assert.deepEqual(dueOn([item], new Set(), tomorrow), []);
  assert.deepEqual(dueOn([item], new Set([seenKey(item)]), night), []);
  const reopened = { ...item, revision: 1 };
  assert.deepEqual(dueOn([reopened], new Set([seenKey(item)]), night).map((a) => a.revision), [1]);
  assert.deepEqual(dueOn([{ ...item, shownAt: null }], new Set(), night), []);
});

test("language falls back to English; poll texts per option too", () => {
  assert.equal(localized(base, "pt-BR").title, "Novidades");
  assert.equal(localized(base, "ja").title, "News");
  const poll = { id: "p1", mode: "single", showResults: false, closesAt: null, options: ["o1", "o2"] };
  const a = { ...base, polls: [poll], locales: { en: { ...base.locales.en, polls: { p1: { question: "Which?", options: { o1: "One", o2: "Two" } } } }, "pt-BR": { ...base.locales["pt-BR"], polls: { p1: { question: "Qual?", options: { o1: "Um" } } } } } };
  assert.deepEqual(pollText(a, poll, "pt-BR"), { question: "Qual?", options: { o1: "Um", o2: "Two" } });
});

test("Markdown blocks: heading, image, button and poll lines; paragraphs keep their lines", () => {
  const blocks = parseBlocks("## Title\nfirst line\n- item\n\n![shot](https://cdn.example/i/" + "a".repeat(40) + ".png)\n[[Open]](https://annoy.example)\n{{enquete:2}}\n\nlast");
  assert.deepEqual(blocks.map((b) => b.type), ["heading", "text", "image", "button", "poll", "text"]);
  assert.deepEqual(blocks[1], { type: "text", text: "first line\n- item" });
  assert.deepEqual(blocks[4], { type: "poll", n: 2 });
  assert.deepEqual(blocks[3], { type: "button", text: "Open", url: "https://annoy.example" });
});
