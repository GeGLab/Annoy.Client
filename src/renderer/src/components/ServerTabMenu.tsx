import {t as translate} from "../../../shared/localization/index.ts";
import type { ReactNode } from "react";
import { has, Permission, type ServerSummary } from "@annoy/protocol";
import { apiFor, canRemoveServerConnection, editServerNickname, markServerRead, reconnect, removeServerConnection } from "../client.ts";
import { notificationKey, toggleMessageMute } from "../lib/notification-preferences.ts";
import { toast, useStore, type Account, type InstanceState } from "../store.ts";
import { act, openModal } from "./ui.tsx";
import { confirmAction } from "./ui/action-dialog.tsx";
import { EntryContextMenu, type MenuEntry } from "./ui/entry-menu.tsx";

export function ServerTabMenu({ account, server, inst, children }: {
  account: Account; server: ServerSummary; inst: InstanceState | undefined; children: ReactNode;
}) {
  const muted = useStore((s) => s.settings.mutedServers.includes(notificationKey(account.id, server.id)));
  const state = inst?.serverStates[server.id];
  const ready = inst?.status === "ready";
  const owner = server.ownerId === account.userId;
  const removable = canRemoveServerConnection(account.id);
  const perms = state?.permissions ?? 0;
  const settings = ready && (owner || [Permission.MANAGE_SERVER, Permission.MANAGE_ROLES, Permission.BAN_MEMBERS].some((p) => has(perms, p)));
  const copy = async (value: string, message: string) => {
    try { await navigator.clipboard.writeText(value); toast(message); }
    catch { toast(translate("common.d778ec87c370")); }
  };
  const leave = async () => {
    if (await confirmAction(
      translate("common.ff1bc8d50ebc",{p0:(server.name)}),
      { title: translate("common.9ef7e8c971e3",{p0:(server.name)}), confirmLabel: translate("common.46cfdbc41810") },
    ))
      await act(apiFor(account.id).del(`/servers/${server.id}/members/@me`));
  };
  const remove = async () => {
    if (await confirmAction(
      translate("common.646ec10a4c46",{p0:(server.name)}),
      { title: translate("common.c59916eb4548",{p0:(server.name)}), confirmLabel: translate("common.56a631206917") },
    )) removeServerConnection(account.id);
  };
  const entries: MenuEntry[] = [
    { kind: "label", text: server.name },
    { kind: "item", id: "read", icon: "check", text: translate("common.f35e881d0f5c",{p0:""}), run: () => markServerRead(account.id, server.id) },
    ...(ready && has(perms, Permission.CREATE_INVITE) ? [{ kind: "item", id: "invite", icon: "userPlus", text: translate("common.64074706bf95",{p0:""}), run: () => openModal({ kind: "invite", accountId: account.id, serverId: server.id }) } as const] : []),
    { kind: "separator" },
    ...(ready ? [{ kind: "item", id: "nickname", icon: "edit", text: translate("server.nicknameMenu"), run: () => void editServerNickname(account.id, server.id) } as const] : []),
    { kind: "item", id: "mute", icon: muted ? "bell" : "bellOff", text: muted ? translate("common.615490f2cb43") : translate("common.b60be554ff31"), run: () => toggleMessageMute("server", account.id, server.id) },
    ...(settings ? [{ kind: "item", id: "settings", icon: "gear", text: translate("common.a86cf2b71570",{p0:""}), run: () => openModal({ kind: "serverSettings", accountId: account.id, serverId: server.id }) } as const] : []),
    ...(ready && owner ? [{ kind: "item", id: "ownership", icon: "crown", text: translate("common.f2d74b4ab9eb",{p0:""}), run: () => openModal({ kind: "serverSettings", accountId: account.id, serverId: server.id }) } as const] : []),
    ...(ready && has(perms, Permission.MANAGE_CHANNELS) ? [
      { kind: "item", id: "channel", icon: "hash", text: translate("common.df6ff3015259",{p0:""}), run: () => openModal({ kind: "createChannel", accountId: account.id, serverId: server.id, parentId: null, type: "text" }) } as const,
      { kind: "item", id: "category", icon: "plus", text: translate("common.4d8d42aa234f",{p0:""}), run: () => openModal({ kind: "createChannel", accountId: account.id, serverId: server.id, parentId: null, type: "category" }) } as const,
    ] : []),
    { kind: "separator" },
    { kind: "item", id: "copyId", icon: "restore", text: translate("common.ffaee7643680",{p0:""}), run: () => void copy(server.id, translate("common.5c27b420a68b")) },
    { kind: "item", id: "copyUrl", icon: "link", text: translate("common.7e16118133a2",{p0:""}), run: () => void copy(account.url, translate("common.236589b57f24")) },
    ...(!ready ? [{ kind: "item", id: "reconnect", icon: "refresh", text: inst?.status === "invalid" ? translate("common.05d410b61f11") : inst?.status === "outdated" ? translate("connection.updateAction") : translate("common.3a4cc1faed8c"), run: () => inst?.status === "invalid" ? openModal({ kind: "addAccount", rememberedId: account.id }) : reconnect(account.id) } as const] : []),
    { kind: "separator" },
    ...(ready && !owner ? [{ kind: "item", id: "leave", icon: "logout", destructive: true, text: translate("common.fd41f9870c0a",{p0:""}), run: () => void leave() } as const] : []),
    { kind: "item", id: "remove", icon: "trash", destructive: true, disabled: !removable, text: translate("common.04ad962fd414",{p0:""}), run: () => void remove() },
    ...(!removable ? [{ kind: "label", text: translate("common.d058501cc3dc") } as const] : []),
  ];
  return <EntryContextMenu label={translate("common.0a8466721cbb",{p0:(server.name)})} entries={entries}>{children}</EntryContextMenu>;
}




