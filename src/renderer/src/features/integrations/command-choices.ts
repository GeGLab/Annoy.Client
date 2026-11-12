import { has, Permission, type ServerIntegration } from "@annoy/protocol";
import { useEffect, useState } from "react";
import { integrationCommands, type CommandChoice } from "../../../../shared/integration-commands.ts";
import { apiFor } from "../../client.ts";
import { channelPerms } from "../../perms.ts";
import { useStore } from "../../store.ts";
import { loadCatalog, useIntegrations } from "./state.ts";
import { useDmLinks } from "./dm-links.ts";

export function useDmCommandChoices(conversationId: string, enabled: boolean): CommandChoice[] {
  const catalog = useIntegrations((s) => s.catalog);
  const links = useDmLinks(conversationId);
  useEffect(() => { if (enabled) void loadCatalog(); }, [enabled]);
  return integrationCommands(catalog.filter((integration) => links?.[integration.id]?.status === "active"), "dm");
}

export function useServerCommandChoices(accountId: string, serverId: string | null | undefined, channelId: string, enabled: boolean): { choices: CommandChoice[]; loading: boolean } {
  const account = useStore((s) => s.accounts.find((a) => a.id === accountId));
  const allowed = useStore((s) => {
    const instance = s.instances[accountId];
    const server = serverId ? instance?.serverStates[serverId] : undefined;
    const channel = server?.channels.find((c) => c.id === channelId);
    return !!(instance?.status === "ready" && instance.instance?.integrations && server && channel && instance.user && has(channelPerms(server, instance.user.id, channel), Permission.USE_INTEGRATIONS));
  });
  const revision = useStore((s) => s.instances[accountId]?.integrationRevision ?? 0);
  const key = JSON.stringify([accountId, account?.url, account?.token, serverId, revision]);
  const [result, setResult] = useState<{ key: string; choices: CommandChoice[]; loading: boolean } | null>(null);
  useEffect(() => {
    if (!enabled || !allowed || !serverId) return;
    const controller = new AbortController();
    setResult({ key, choices: [], loading: true });
    void apiFor(accountId).get<ServerIntegration[]>(`/servers/${serverId}/integrations`, controller.signal).then(
      (rows) => { if (!controller.signal.aborted) setResult({ key, choices: integrationCommands(rows.map((row) => row.integration), "server"), loading: false }); },
      () => { if (!controller.signal.aborted) setResult({ key, choices: [], loading: false }); },
    );
    return () => controller.abort();
  }, [enabled, allowed, key, accountId, serverId]);
  return allowed && result?.key === key ? result : { choices: [], loading: enabled && allowed };
}
