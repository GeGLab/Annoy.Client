import { setState, type Settings } from "../store.ts";

/** Scope each preference to the instance account: IDs can repeat on independent servers. */
export const notificationKey = (accountId: string, id: string) => JSON.stringify([accountId, id]);

export function isMessageMuted(settings: Settings, accountId: string, channelId: string, serverId?: string): boolean {
  return settings.mutedChannels.includes(notificationKey(accountId, channelId)) ||
    !!serverId && settings.mutedServers.includes(notificationKey(accountId, serverId));
}

export function toggleMessageMute(scope: "server" | "channel", accountId: string, id: string): void {
  const key = scope === "server" ? "mutedServers" : "mutedChannels";
  const value = notificationKey(accountId, id);
  setState((s) => {
    const values = s.settings[key];
    s.settings[key] = values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
  });
}
