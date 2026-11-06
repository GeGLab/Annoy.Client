import {rich} from "../lib/localization.ts";
import {t as translate} from "../../../shared/localization/index.ts";
import type { FocusEvent, ReactNode } from "react";
import type { Member, VoiceState } from "@annoy/protocol";
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
        <Icon name={voice.serverMute ? "mic" : "micOff"} />{voice.serverMute ? translate("common.24059e1a1ff4") : translate("common.f5b97f82540a")}
      </Item>}
      <Item destructive onSelect={() => void act(apiFor(accountId).patch(`/servers/${serverId}/members/${member.user.id}/voice`, { disconnect: true }))}>{rich("common.acacdbe48cbe",{p0:(<Icon name="hangup" />)})}</Item>
    </>}
  </>;
}

export function VoiceUserContextMenu({ children, ...props }: Props & { children: ReactNode }) {
  return <ContextMenu><ContextMenuTrigger>{children}</ContextMenuTrigger>
    <ContextMenuContent onFocus={focusVolume} aria-label={translate("common.f0647b2f9a6d",{p0:(displayNameOf(props.member))})}><VoiceMenuItems {...props} context /></ContextMenuContent>
  </ContextMenu>;
}

export function VoiceUserMenuButton(props: Props) {
  return <DropdownMenu><DropdownMenuTrigger asChild>
    <button className="icon-btn tiny voice-mod" aria-label={translate("common.e0ea6c559299",{p0:(displayNameOf(props.member))})}><Icon name="more" size={14} /></button>
  </DropdownMenuTrigger><DropdownMenuContent align="end" onFocus={focusVolume} aria-label={translate("common.f0647b2f9a6d",{p0:(displayNameOf(props.member))})}><VoiceMenuItems {...props} context={false} /></DropdownMenuContent></DropdownMenu>;
}


