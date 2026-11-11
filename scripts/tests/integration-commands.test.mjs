import { test } from "node:test";
import assert from "node:assert/strict";
import { integrationCommands, matchingCommands, currentCommand } from "../../src/shared/integration-commands.ts";

const steam = { id: "steamprofiler", name: "SteamProfiler", scopes: ["server", "dm"], runtime: { type: "http" }, commands: [{ name: "steam", description: "Steam profiles", usage: "profile <id> | versus <id1> <id2>" }] };
const gpt = { id: "gpt", name: "GPT", scopes: ["dm"], runtime: { type: "builtin", name: "openai" }, commands: [{ name: "gpt", description: "Ask GPT", usage: "<text>" }] };

test("slash choices respect scope and expand fixed subcommands without inserting placeholders", () => {
  const server = integrationCommands([steam, gpt], "server");
  assert.deepEqual(server.map((c) => c.path), ["/steam profile", "/steam versus"]);
  assert.equal(server[1].usage, "/steam versus <id1> <id2>");
  assert.equal(integrationCommands([gpt], "dm")[0].path, "/gpt");
});

test("typing slash or a prefix filters available commands while complete arguments retain only a usage hint", () => {
  const choices = integrationCommands([steam, gpt], "dm");
  assert.equal(matchingCommands("/", choices).length, 3);
  assert.equal(matchingCommands("/ste", choices).length, 2);
  assert.equal(matchingCommands("/steam v", choices)[0].path, "/steam versus");
  assert.equal(matchingCommands("/steam versus user-a user-b", choices).length, 0);
  assert.equal(currentCommand("/steam versus user-a user-b", choices).usage, "/steam versus <id1> <id2>");
  assert.equal(currentCommand("/steam versus-other", choices), undefined);
  assert.equal(matchingCommands("text /steam", choices).length, 0);
  assert.equal(matchingCommands("/steam\nprofile", choices).length, 0);
});
