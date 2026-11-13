import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLyricsfile } from '../../src/main/lyrics-format.ts';

// Shapes LRCLIB really serves (excerpts of "The Drug In Me Is Reimagined").
const wordSynced = [
  "version: '1.0'",
  'metadata:',
  '  title: The Drug In Me Is Reimagined',
  'lines:',
  "- text: Can't you see?",
  '  start_ms: 329765',
  '  end_ms: 332702',
  '  words:',
  "  - text: 'Can''t '",
  '    start_ms: 329765',
  "  - text: 'you '",
  '    start_ms: 330573',
  '  - text: see?',
  '    start_ms: 331019',
  'plain: |-',
  '  I heard a knock upon my door the other day',
  '  I opened it to find death staring in my face',
  '',
  "  And I'm so high on misery, can't you see?",
].join('\n');

const withBreak = [
  'lines:',
  '- text: Everywhere I go, I drag this coffin just in case',
  '  start_ms: 14400',
  '  end_ms: 25220',
  "- text: ''",
  '  start_ms: 25220',
  '  end_ms: 31590',
  "- text: My body's trembling, sends shivers down my spine",
  '  start_ms: 31590',
  '  end_ms: 36360',
].join('\n');

test('the plain text after the lines never joins the last line', () => {
  const lines = parseLyricsfile(wordSynced);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, "Can't you see?");
  assert.deepEqual(lines[0].words.map((w) => w.text), ["Can't ", 'you ', 'see?']);
});

test("an instrumental break ('') is an empty line, not the start of a long one", () => {
  const lines = parseLyricsfile(withBreak);
  assert.deepEqual(lines.map((l) => [l.time, l.text]), [
    [14.4, 'Everywhere I go, I drag this coffin just in case'],
    [25.22, ''],
    [31.59, "My body's trembling, sends shivers down my spine"],
  ]);
});

test('a quoted line wrapped over several rows is still read whole', () => {
  const lines = parseLyricsfile(["- text: 'It''s a long", "  line that wraps'", '  start_ms: 1000'].join('\n'));
  assert.deepEqual(lines.map((l) => l.text), ["It's a long line that wraps"]);
});
