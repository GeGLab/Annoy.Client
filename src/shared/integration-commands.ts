import { isCallable, type StoreIntegration } from "@annoy/protocol";
import { t } from "./localization/index.ts";

export interface CommandChoice {
  id: string;
  integration: string;
  path: string;
  usage: string;
  description: string;
  /** The integration reads Steam profiles: Annoy fills in the Steam accounts the person means. */
  steam?: boolean;
}

/** Fixed subcommands in usage (e.g. profile <id> | versus <id1> <id2>) get their own row. */
export function integrationCommands(integrations: StoreIntegration[], scope: "dm" | "server"): CommandChoice[] {
  return integrations.filter((integration) => isCallable(integration, scope)).flatMap((integration) =>
    integration.commands.flatMap((command) => command.usage.split(/\s+\|\s+/).map((usage) => {
      const fixed = usage.trim().split(/\s+/).filter(Boolean);
      const words: string[] = [];
      for (const word of fixed) {
        if (!/^[a-z][a-z0-9-]*$/i.test(word)) break;
        words.push(word);
      }
      const path = `/${command.name}${words.length ? ` ${words.join(" ")}` : ""}`;
      return { id: `${integration.id}:${path}`, integration: integration.name, path, usage: `/${command.name}${usage.trim() ? ` ${usage.trim()}` : ""}`, description: command.description, ...(integration.profile?.connection === "steam" && { steam: true }) };
    })),
  );
}

export function matchingCommands(text: string, choices: CommandChoice[]): CommandChoice[] {
  if (!text.startsWith("/") || text.includes("\n")) return [];
  const query = text.trimEnd().toLowerCase();
  return choices.filter((choice) => choice.path.toLowerCase().startsWith(query)).slice(0, 12);
}

export function currentCommand(text: string, choices: CommandChoice[]): CommandChoice | undefined {
  return choices.filter((choice) => text === choice.path || text.startsWith(`${choice.path} `))
    .sort((a, b) => b.path.length - a.path.length)[0];
}

/**
 * For an integration that reads Steam profiles: a mention becomes that person's Steam
 * account, and a missing first profile is the sender's own ("/steam profile" is me,
 * "/steam versus @ana" is me × Ana). Anything else goes as written. `aliases` turns
 * plain-text names (a DM has no mention tokens) into tokens before reading.
 */
export async function fillSteamArgs(
  content: string,
  choices: readonly CommandChoice[],
  steam: { own: () => Promise<string | null>; mention: (token: string) => Promise<string> },
  aliases: readonly [text: string, token: string][] = [],
): Promise<string> {
  const choice = currentCommand(content, choices.filter((c) => c.steam));
  if (!choice) return content;
  const slots = choice.usage.slice(choice.path.length).trim().split(/\s+/).filter((word) => /^<.+>$/.test(word)).length;
  let rest = content.slice(choice.path.length);
  for (const [text, token] of [...aliases].sort((a, b) => b[0].length - a[0].length)) rest = rest.split(text).join(token);
  const given = rest.trim() ? rest.trim().split(/\s+/) : [];
  if (!slots || given.length > slots || slots - given.length > 1) return content;
  const filled = await Promise.all(given.map((word) => (/^<@[^>\s]+>$/.test(word) ? steam.mention(word) : Promise.resolve(word))));
  if (filled.length < slots) {
    const own = await steam.own();
    if (!own) throw new Error(t("integrations.steamArgs.linkFirst"));
    filled.unshift(own);
  }
  return `${choice.path} ${filled.join(" ")}`;
}
