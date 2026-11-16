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

test("Steam profile commands: nothing means me, mentions become the Steam accounts they show, anything else stays", async () => {
  const { fillSteamArgs } = await import("../../src/shared/integration-commands.ts");
  const choices = integrationCommands([{ ...steam, profile: { connection: "steam", image: "https://x.test/{id}" } }, gpt], "dm");
  const accounts = { "<@ana>": "76561198000000002", "<@other>": "76561198000000003" };
  const steamOf = { own: async () => "76561198000000001", mention: async (token) => { if (!accounts[token]) throw new Error(`hidden ${token}`); return accounts[token]; } };
  assert.equal(await fillSteamArgs("/steam profile", choices, steamOf), "/steam profile 76561198000000001");
  assert.equal(await fillSteamArgs("/steam profile gabelogannewell", choices, steamOf), "/steam profile gabelogannewell");
  assert.equal(await fillSteamArgs("/steam profile <@ana>", choices, steamOf), "/steam profile 76561198000000002");
  assert.equal(await fillSteamArgs("/steam versus <@ana>", choices, steamOf), "/steam versus 76561198000000001 76561198000000002");
  assert.equal(await fillSteamArgs("/steam versus <@ana> someone", choices, steamOf), "/steam versus 76561198000000002 someone");
  assert.equal(await fillSteamArgs("/steam versus @Ana Maria", choices, steamOf, [["@Ana Maria", "<@other>"]]), "/steam versus 76561198000000001 76561198000000003");
  assert.equal(await fillSteamArgs("/steam versus", choices, steamOf), "/steam versus", "two missing: left for the integration to explain");
  assert.equal(await fillSteamArgs("/gpt <@ana>", choices, steamOf), "/gpt <@ana>", "integrations without Steam are untouched");
  assert.equal(await fillSteamArgs("hello <@ana>", choices, steamOf), "hello <@ana>");
  await assert.rejects(fillSteamArgs("/steam profile <@bob>", choices, steamOf), /hidden <@bob>/);
  await assert.rejects(fillSteamArgs("/steam profile", choices, { ...steamOf, own: async () => null }), /Steam/);
  // Without a Steam panel the manifest doesn't say it reads Steam profiles.
  assert.equal(await fillSteamArgs("/steam profile", integrationCommands([steam], "dm"), steamOf), "/steam profile");
});
