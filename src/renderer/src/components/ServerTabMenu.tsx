import type { ReactNode } from "react";
import { has, Permission, type ServerSummary } from "@distopic/protocol";
import { apiFor, markServerRead, reconnect, removeAccount } from "../client.ts";
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
  const owner = server.ownerId === inst?.user?.id;
  const perms = state?.permissions ?? 0;
  const settings = ready && (owner || [Permission.MANAGE_SERVER, Permission.MANAGE_ROLES, Permission.BAN_MEMBERS].some((p) => has(perms, p)));
  const copy = async (value: string, message: string) => {
    try { await navigator.clipboard.writeText(value); toast(message); }
    catch { toast("Não foi possível copiar para a área de transferência."); }
  };
  const leave = async () => {
    if (await confirmAction(
      `Deseja mesmo sair de ${server.name}? Você precisará de um novo convite para entrar novamente.`,
      { title: `Sair de "${server.name}"`, confirmLabel: "Sair do servidor" },
    ))
      await act(apiFor(account.id).del(`/servers/${server.id}/members/@me`));
  };
  const remove = async () => {
    if (await confirmAction(
      `Deseja mesmo remover ${server.name} da barra lateral? Você poderá adicioná-lo novamente quando quiser.`,
      { title: `Remover "${server.name}"`, confirmLabel: "Remover da barra" },
    )) removeAccount(account.id);
  };
  return <ContextMenu>
    <ContextMenuTrigger>{children}</ContextMenuTrigger>
    <ContextMenuContent aria-label={`Opções de ${server.name}`}>
      <ContextMenuLabel>{server.name}</ContextMenuLabel>
      <ContextMenuItem onSelect={() => markServerRead(account.id, server.id)}><Icon name="check" />Marcar como lido</ContextMenuItem>
      {ready && has(perms, Permission.CREATE_INVITE) && <ContextMenuItem onSelect={() => openModal({ kind: "invite", accountId: account.id, serverId: server.id })}><Icon name="userPlus" />Convidar pessoas</ContextMenuItem>}
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => toggleMessageMute("server", account.id, server.id)}><Icon name={muted ? "bell" : "bellOff"} />{muted ? "Ativar notificações do servidor" : "Silenciar servidor"}</ContextMenuItem>
      {settings && <ContextMenuItem onSelect={() => openModal({ kind: "serverSettings", accountId: account.id, serverId: server.id })}><Icon name="gear" />Configurações do servidor</ContextMenuItem>}
      {ready && has(perms, Permission.MANAGE_CHANNELS) && <>
        <ContextMenuItem onSelect={() => openModal({ kind: "createChannel", accountId: account.id, serverId: server.id, parentId: null, type: "text" })}><Icon name="hash" />Criar canal</ContextMenuItem>
        <ContextMenuItem onSelect={() => openModal({ kind: "createChannel", accountId: account.id, serverId: server.id, parentId: null, type: "category" })}><Icon name="plus" />Criar categoria</ContextMenuItem>
      </>}
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => void copy(server.id, "ID do servidor copiado.")}><Icon name="restore" />Copiar ID do servidor</ContextMenuItem>
      <ContextMenuItem onSelect={() => void copy(account.url, "Endereço do servidor copiado.")}><Icon name="link" />Copiar endereço</ContextMenuItem>
      {!ready && <ContextMenuItem onSelect={() => inst?.status === "invalid" ? openModal({ kind: "addAccount", rememberedId: account.id }) : reconnect(account.id)}><Icon name="refresh" />{inst?.status === "invalid" ? "Entrar novamente" : "Tentar reconectar"}</ContextMenuItem>}
      <ContextMenuSeparator />
      {ready && !owner && <ContextMenuItem destructive onSelect={() => void leave()}><Icon name="logout" />Sair do servidor…</ContextMenuItem>}
      <ContextMenuItem destructive onSelect={() => void remove()}><Icon name="trash" />Remover da barra…</ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>;
}
