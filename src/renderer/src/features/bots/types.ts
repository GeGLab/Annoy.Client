/** Proposed server-owned bot platform v1; independent of Discord's private APIs. */
export const BOT_PERMISSIONS = {
  "messages.read": "Ler mensagens dos canais autorizados",
  "messages.send": "Enviar mensagens como bot",
  "members.read": "Consultar membros do servidor",
  "moderation.manage": "Moderar mensagens e membros",
  "voice.connect": "Participar de canais de voz autorizados",
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
