import type { FocusEvent, ReactNode } from "react";
import type { Member, VoiceState } from "@distopic/protocol";
import { apiFor } from "../client.ts";
import { displayNameOf } from "../perms.ts";
import { act, Icon } from "./ui.tsx";
import { UserVolumeControl } from "./UserVolumeControl.tsx";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "./ui/context-menu.tsx";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "./ui/dropdown-menu.tsx";

type Props = { accountId: string; serverId: string; member: Member; voice: VoiceState; canModerate: boolean };

function focusVolume(event: FocusEvent<HTMLDivElement>) {
  if (event.target !== event.currentTarget) return;
  event.preventDefault();
  event.currentTarget.querySelector<HTMLElement>('[role="slider"]')?.focus();
}

function VoiceMenuItems({ accountId, serverId, member, voice, canModerate, context }: Props & { context: boolean }) {
  const Item = context ? ContextMenuItem : DropdownMenuItem;
  const Separator = context ? ContextMenuSeparator : DropdownMenuSeparator;
  return <>
    <UserVolumeControl accountId={accountId} userId={member.user.id} name={displayNameOf(member)} />
    {canModerate && <>
      <Separator />
      {(voice.serverMute || !voice.selfMute) && <Item onSelect={() => void act(apiFor(accountId).patch(`/servers/${serverId}/members/${member.user.id}/voice`, { serverMute: !voice.serverMute }))}>
        <Icon name={voice.serverMute ? "mic" : "micOff"} />{voice.serverMute ? "Remover silêncio do servidor" : "Silenciar no servidor"}
      </Item>}
      <Item destructive onSelect={() => void act(apiFor(accountId).patch(`/servers/${serverId}/members/${member.user.id}/voice`, { disconnect: true }))}><Icon name="hangup" />Desconectar da voz</Item>
    </>}
  </>;
}

export function VoiceUserContextMenu({ children, ...props }: Props & { children: ReactNode }) {
  return <ContextMenu><ContextMenuTrigger>{children}</ContextMenuTrigger>
    <ContextMenuContent onFocus={focusVolume} aria-label={`Opções de voz de ${displayNameOf(props.member)}`}><VoiceMenuItems {...props} context /></ContextMenuContent>
  </ContextMenu>;
}

export function VoiceUserMenuButton(props: Props) {
  return <DropdownMenu><DropdownMenuTrigger asChild>
    <button className="icon-btn tiny voice-mod" aria-label={`Ações de voz de ${displayNameOf(props.member)}`}><Icon name="more" size={14} /></button>
  </DropdownMenuTrigger><DropdownMenuContent align="end" onFocus={focusVolume} aria-label={`Opções de voz de ${displayNameOf(props.member)}`}><VoiceMenuItems {...props} context={false} /></DropdownMenuContent></DropdownMenu>;
}
