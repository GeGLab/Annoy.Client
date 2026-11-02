import {rich} from "../lib/localization.ts";
import {t as translate} from "../../../shared/localization/index.ts";
import type { ReactNode } from "react";
import { has, Permission, type ServerSummary } from "@distopic/protocol";
import { apiFor, canRemoveServerConnection, markServerRead, reconnect, removeServerConnection } from "../client.ts";
import { notificationKey, toggleMessageMute } from "../lib/notification-preferences.ts";
import { toast, useStore, type Account, type InstanceState } from "../store.ts";
import { act, Icon, openModal } from "./ui.tsx";
import { confirmAction } from "./ui/action-dialog.tsx";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuTrigger } from "./ui/context-menu.tsx";

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
  return <ContextMenu>
    <ContextMenuTrigger>{children}</ContextMenuTrigger>
    <ContextMenuContent aria-label={translate("common.0a8466721cbb",{p0:(server.name)})}>
      <ContextMenuLabel>{server.name}</ContextMenuLabel>
      <ContextMenuItem onSelect={() => markServerRead(account.id, server.id)}>{rich("common.f35e881d0f5c",{p0:(<Icon name="check" />)})}</ContextMenuItem>
      {ready && has(perms, Permission.CREATE_INVITE) && <ContextMenuItem onSelect={() => openModal({ kind: "invite", accountId: account.id, serverId: server.id })}>{rich("common.64074706bf95",{p0:(<Icon name="userPlus" />)})}</ContextMenuItem>}
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => toggleMessageMute("server", account.id, server.id)}><Icon name={muted ? "bell" : "bellOff"} />{muted ? translate("common.615490f2cb43") : translate("common.b60be554ff31")}</ContextMenuItem>
      {settings && <ContextMenuItem onSelect={() => openModal({ kind: "serverSettings", accountId: account.id, serverId: server.id })}>{rich("common.a86cf2b71570",{p0:(<Icon name="gear" />)})}</ContextMenuItem>}
      {ready && owner && <ContextMenuItem onSelect={() => openModal({ kind: "serverSettings", accountId: account.id, serverId: server.id })}>{rich("common.f2d74b4ab9eb",{p0:(<Icon name="crown" />)})}</ContextMenuItem>}
      {ready && has(perms, Permission.MANAGE_CHANNELS) && <>
        <ContextMenuItem onSelect={() => openModal({ kind: "createChannel", accountId: account.id, serverId: server.id, parentId: null, type: "text" })}>{rich("common.df6ff3015259",{p0:(<Icon name="hash" />)})}</ContextMenuItem>
        <ContextMenuItem onSelect={() => openModal({ kind: "createChannel", accountId: account.id, serverId: server.id, parentId: null, type: "category" })}>{rich("common.4d8d42aa234f",{p0:(<Icon name="plus" />)})}</ContextMenuItem>
      </>}
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => void copy(server.id, translate("common.5c27b420a68b"))}>{rich("common.ffaee7643680",{p0:(<Icon name="restore" />)})}</ContextMenuItem>
      <ContextMenuItem onSelect={() => void copy(account.url, translate("common.236589b57f24"))}>{rich("common.7e16118133a2",{p0:(<Icon name="link" />)})}</ContextMenuItem>
      {!ready && <ContextMenuItem onSelect={() => inst?.status === "invalid" ? openModal({ kind: "addAccount", rememberedId: account.id }) : reconnect(account.id)}><Icon name="refresh" />{inst?.status === "invalid" ? translate("common.05d410b61f11") : translate("common.3a4cc1faed8c")}</ContextMenuItem>}
      <ContextMenuSeparator />
      {ready && !owner && <ContextMenuItem destructive onSelect={() => void leave()}>{rich("common.fd41f9870c0a",{p0:(<Icon name="logout" />)})}</ContextMenuItem>}
      <ContextMenuItem destructive disabled={!removable} onSelect={() => void remove()}>{rich("common.04ad962fd414",{p0:(<Icon name="trash" />)})}</ContextMenuItem>
      {!removable && <ContextMenuLabel>{translate("common.d058501cc3dc")}</ContextMenuLabel>}
    </ContextMenuContent>
  </ContextMenu>;
}




