import { isCallable, type StoreIntegration } from "@annoy/protocol";

export interface CommandChoice {
  id: string;
  integration: string;
  path: string;
  usage: string;
  description: string;
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
      return { id: `${integration.id}:${path}`, integration: integration.name, path, usage: `/${command.name}${usage.trim() ? ` ${usage.trim()}` : ""}`, description: command.description };
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
