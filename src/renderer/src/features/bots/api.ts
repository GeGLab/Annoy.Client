import type { Api } from "../../api.ts";
import { RequestError } from "../../api.ts";
import { BOT_PERMISSIONS, type BotInstallation, type BotListing, type BotPlatformSnapshot } from "./types.ts";

export class UnsupportedBotPlatform extends Error {}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 10_000;
const listing = (value: unknown): value is BotListing =>
  object(value) &&
  [value.id, value.name, value.description, value.author, value.version].every(text) &&
  value.runtime === "distopic-worker-v1" &&
  Array.isArray(value.permissions) &&
  value.permissions.every((p) => typeof p === "string" && Object.hasOwn(BOT_PERMISSIONS, p));
const installation = (value: unknown): value is BotInstallation =>
  object(value) &&
  [value.id, value.botId, value.version].every(text) &&
  typeof value.enabled === "boolean" &&
  ["starting", "running", "stopped", "error"].includes(String(value.runtimeStatus)) &&
  (value.lastError === undefined || value.lastError === null || typeof value.lastError === "string");

/** A missing capability is different from an empty catalog or a network error. */
export async function loadBotPlatform(api: Api, serverId: string, signal: AbortSignal): Promise<BotPlatformSnapshot> {
  let info: unknown;
  try {
    info = await api.request("GET", "/bot-platform", undefined, signal);
  } catch (error) {
    if (error instanceof RequestError && (error.status === 404 || error.status === 501))
      throw new UnsupportedBotPlatform("Esta instância ainda não oferece a plataforma de bots.");
    throw error;
  }
  if (!object(info) || info.apiVersion !== 1)
    throw new Error("A versão da plataforma de bots é incompatível. Atualize o cliente ou consulte quem hospeda a instância.");
  const root = `/servers/${encodeURIComponent(serverId)}/bot-installations`;
  const [catalog, installed] = await Promise.all([
    api.request<unknown>("GET", "/bots/catalog", undefined, signal),
    api.request<unknown>("GET", root, undefined, signal),
  ]);
  if (
    !object(catalog) ||
    !Array.isArray(catalog.bots) ||
    catalog.bots.length > 1000 ||
    !catalog.bots.every(listing) ||
    new Set(catalog.bots.map((b) => b.id)).size !== catalog.bots.length ||
    !object(installed) ||
    typeof installed.canManage !== "boolean" ||
    !Array.isArray(installed.installations) ||
    installed.installations.length > 1000 ||
    !installed.installations.every(installation) ||
    new Set(installed.installations.map((i) => i.botId)).size !== installed.installations.length
  )
    throw new Error("A instância retornou dados inválidos. Atualize o estado antes de alterar bots.");
  return { bots: catalog.bots, installations: installed.installations, canManage: installed.canManage };
}

export async function installBot(api: Api, serverId: string, bot: BotListing) {
  await api.request(
    "POST",
    `/servers/${encodeURIComponent(serverId)}/bot-installations`,
    { botId: bot.id, version: bot.version, grantedPermissions: bot.permissions },
    AbortSignal.timeout(20_000),
  );
}
export async function setBotEnabled(api: Api, serverId: string, id: string, enabled: boolean) {
  await api.request(
    "PATCH",
    `/servers/${encodeURIComponent(serverId)}/bot-installations/${encodeURIComponent(id)}`,
    { enabled },
    AbortSignal.timeout(20_000),
  );
}
export async function uninstallBot(api: Api, serverId: string, id: string) {
  await api.request(
    "DELETE",
    `/servers/${encodeURIComponent(serverId)}/bot-installations/${encodeURIComponent(id)}`,
    undefined,
    AbortSignal.timeout(20_000),
  );
}
