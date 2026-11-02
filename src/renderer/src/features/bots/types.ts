import {t as translate,onLocalizationChange} from "../../../../shared/localization/index.ts";
/** Proposed server-owned bot platform v1; independent of Discord's private APIs. */
export let BOT_PERMISSIONS = {
  "messages.read": translate("common.65e290b301e9"),
  "messages.send": translate("common.cc29692e6ed2"),
  "members.read": translate("common.8b4eef78f2a8"),
  "moderation.manage": translate("common.bb292810ae75"),
  "voice.connect": translate("common.643b57dc316a"),
} as const;
export type BotPermission = keyof typeof BOT_PERMISSIONS;
export interface BotListing {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  runtime: "distopic-worker-v1";
  permissions: BotPermission[];
}
export interface BotInstallation {
  id: string;
  botId: string;
  version: string;
  enabled: boolean;
  runtimeStatus: "starting" | "running" | "stopped" | "error";
  lastError?: string | null;
}
export interface BotPlatformSnapshot {
  bots: BotListing[];
  installations: BotInstallation[];
  canManage: boolean;
}



onLocalizationChange(()=>{BOT_PERMISSIONS={
  "messages.read": translate("common.65e290b301e9"),
  "messages.send": translate("common.cc29692e6ed2"),
  "members.read": translate("common.8b4eef78f2a8"),
  "moderation.manage": translate("common.bb292810ae75"),
  "voice.connect": translate("common.643b57dc316a"),
} as const;});
