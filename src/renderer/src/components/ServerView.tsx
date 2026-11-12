import { CommunityCover, CommunitySummary, CommunityWelcome, CommunityPulse } from "../features/redesign/LiveExperience.tsx";
import {rich} from "../lib/localization.ts";
import {t as translate} from "../../../shared/localization/index.ts";
import {FullProfileButton} from "./FullProfile.tsx";
import { SearchButton } from "../features/search/SearchButton.tsx";
import { canViewActivity } from "../features/activity/access.ts";
import { UserProfile } from "./UserProfile.tsx";
import { UserVolume } from "./UserVolume.tsx";
import { confirmAction, promptText } from "./ui/action-dialog.tsx";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "./ui/dropdown-menu.tsx";
import { Select } from "./ui/select.tsx";
import { ActivityCard, ActivityStack } from "../features/activity/ActivityCard.tsx";
import { ProviderIcon } from "../features/activity/ProviderIcon.tsx";
import { Code2 } from "lucide-react";
import { GameIcon } from "../features/activity/GameIcon.tsx";
import { visibleUserActivities } from "../../../shared/activity.ts";
import { EMPTY_ACTIVITIES } from "../store.ts";
import * as ProfilePopover from "@radix-ui/react-popover";
import { EntityPicker } from "./ui/entity-picker.tsx";
import { has, isVoiceChannel, Permission, type Channel, type Member, type ServerState, type VoiceState } from "@annoy/protocol";
import { useEffect, useMemo, useState } from "react";
import { apiFor, editServerNickname, ensureServer, joinVoice, loadServerMembers, navigate, openChannel, openDm, reconnect } from "../client.ts";
import { channelPerms, displayNameOf, memberColor, rankOf } from "../perms.ts";
import { getState, toast, useStore } from "../store.ts";
import { Chat } from "./Chat.tsx";
import { VoiceStage } from "./VoiceStage.tsx";
import { FilesView } from "../features/channels/FilesView.tsx";
import { CodeView } from "../features/channels/CodeView.tsx";
import { SongView, TheaterView } from "../features/channels/PlaybackRooms.tsx";
import { act, Avatar, Icon, openModal, type IconName } from "./ui.tsx";
import { Tooltip } from "./ui/tooltip.tsx";
import { notificationKey, toggleMessageMute } from "../lib/notification-preferences.ts";
import { screenQualityLabel } from "../lib/screen-profile.ts";
import { Input } from "./ui/input.tsx";
import { isCancellation } from "../../../shared/requests.ts";
import { UserPanel } from "./TopBar.tsx";
import { VoiceUserContextMenu, VoiceUserMenuButton } from "./VoiceUserMenu.tsx";
import { ChatSkeleton } from "./ui/skeleton.tsx";
import { ResizablePanel, togglePanel } from "./layout/ResizablePanel.tsx";
import { addFriend } from "../social/index.ts";

// Channel list -------------------------------------------------------------

function VoiceFlag({ icon, label, server = false }: { icon: IconName; label: string; server?: boolean }) {
  return <Tooltip content={label}><span className={`voice-flag${server ? " server" : ""}`} role="img" aria-label={label}><Icon name={icon} size={14} /></span></Tooltip>;
}

function VoiceUsers({
  state,
  voiceStates,
  accountId,
  canModerate,
}: {
  state: ServerState;
  voiceStates: VoiceState[];
  accountId: string;
  canModerate: boolean;
}) {
  const instance = useStore((s) => s.instances[accountId]);
  const localActivity = useStore((s) => s.desktopActivity);
  const shareActivity = useStore((s) => s.settings.shareActivity);
  const me = instance?.user?.id;
  return (
    <ul className="voice-users">
      {voiceStates.map((v) => {
        const member = state.members.find((m) => m.user.id === v.userId);
        if (!member) return null;
        const isSelf = v.userId === me;
        const activities = visibleUserActivities({
          isSelf,
          sharing: shareActivity,
          isFriend: canViewActivity(instance, v.userId),
          local: localActivity?.activities,
          reported: instance?.activities[v.userId],
        });
        const menuProps = { accountId, serverId: state.server.id, member, voice: v, canModerate };
        const row = (
          <li key={v.userId} className="voice-user" data-user-id={v.userId} tabIndex={!isSelf ? 0 : undefined}>
            <Avatar user={member.user} size={22} speaking={v.speaking && !v.selfMute && !v.serverMute} />
            <UserProfile user={member.user} accountId={accountId}><span className="voice-user-name" title={displayNameOf(member)}>{displayNameOf(member)}</span></UserProfile>
            <span className="voice-user-status">
            {(v.serverMute || v.selfMute) && (
              <VoiceFlag icon="micOff" server={v.serverMute} label={v.serverMute ? translate("common.7ae3e0888c68") : translate("common.d86004fdf05a")} />
            )}
            {v.video && <VoiceFlag icon="camera" label={translate("common.eebc796702a9")} />}
            {v.screen && <VoiceFlag icon="monitor" label={translate("common.f3f0b5cea141")} />}
            {v.screen && v.screenQuality && <span className="stream-quality" title={translate("common.fd1dbe936b42")}>{screenQualityLabel(v.screenQuality)}</span>}
            {v.selfDeaf && <VoiceFlag icon="headphonesOff" label={translate("common.285ba5cbf277")} />}
            {activities.map((activity) => {
              const label = activity.kind === "game" ? `Jogando ${activity.name}`
                : activity.kind === "development" ? `Programando · ${activity.name}`
                : `Ouvindo ${activity.name}${activity.artist ? ` · ${activity.artist}` : ""}`;
              return <Tooltip key={activity.kind} content={label}>
                <span className={`voice-flag voice-activity voice-activity-${activity.kind}`} role="img" aria-label={label} tabIndex={0}>
                  {activity.kind === "game" ? <GameIcon activity={activity} size={16} />
                    : activity.kind === "development" ? <Code2 size={12} aria-hidden />
                    : <ProviderIcon provider={activity.provider} size={12} />}
                </span>
              </Tooltip>;
            })}
            </span>
            {!isSelf && <VoiceUserMenuButton {...menuProps} />}
          </li>
        );
        return isSelf ? row : <VoiceUserContextMenu key={v.userId} {...menuProps}>{row}</VoiceUserContextMenu>;
      })}
    </ul>
  );
}

const CHANNEL_ICONS: Partial<Record<Channel["type"], IconName>> = { text: "hash", files: "folder", code: "code", theater: "theater", song: "song" };

function ChannelRow({
  accountId,
  state,
  channel,
  me,
  activeId,
}: {
  accountId: string;
  state: ServerState;
  channel: Channel;
  me: string;
  activeId: string | null;
}) {
  const unread = useStore((s) => s.instances[accountId]?.unread[channel.id]);
  const voice = useStore((s) => s.voice);
  const muted = useStore((s) => s.settings.mutedChannels.includes(notificationKey(accountId, channel.id)));
  const perms = channelPerms(state, me, channel);
  const canManage = has(perms, Permission.MANAGE_CHANNELS);
  const gear = canManage && (
    <button
      className="icon-btn tiny channel-gear"
      title={translate("common.45ea6f7af821")}
      onClick={(e) => {
        e.stopPropagation();
        openModal({ kind: "channelSettings", accountId, serverId: state.server.id, channelId: channel.id });
      }}
    >
      <Icon name="gear" size={14} />
    </button>
  );

  if (isVoiceChannel(channel.type)) {
    const inChannel = state.voiceStates.filter((v) => v.channelId === channel.id);
    const connected = voice?.accountId === accountId && voice.serverId === state.server.id && voice.channelId === channel.id;
    const canConnect = has(perms, Permission.CONNECT);
    // A theater opens first: people may watch along without joining the call.
    const theater = channel.type === "theater";
    return (
      <li>
        <div
          className={`channel voice${canManage ? " has-gear" : ""}${connected || (theater && activeId === channel.id) ? " active" : ""}${canConnect || theater ? "" : " locked"}`}
          onClick={() => {
            if (theater) return openChannel(accountId, state.server.id, channel.id);
            if (!canConnect) return toast(translate("common.ef08de31ea80"));
            if (!connected) void joinVoice(accountId, state.server.id, channel.id);
            openChannel(accountId, state.server.id, channel.id);
          }}
          title={theater ? translate("common.84e3a10b7e63") : channel.temporary ? translate("common.cb5b2f065da6") : canConnect ? translate("common.85058122c6e0") : translate("common.ef08de31ea80")}
        >
          <Icon name={theater ? "theater" : !canConnect ? "lock" : channel.temporary ? "hourglass" : "speaker"} size={16} />
          <span className="channel-name">{channel.name}</span>
          {connected && <span className={`voice-here ${voice.status}`}>{voice.status === "connected" ? translate("common.3ebd9160b485") : translate("common.236615ad8069")}</span>}
          {canManage && <span className="channel-voice-actions">{gear}</span>}
        </div>
        {inChannel.length > 0 && (
          <VoiceUsers state={state} voiceStates={inChannel} accountId={accountId} canModerate={has(perms, Permission.MUTE_MEMBERS)} />
        )}
      </li>
    );
  }

  return (
    <li>
      <div
        className={`channel${activeId === channel.id ? " active" : ""}${unread ? " unread" : ""}`}
        onClick={() => openChannel(accountId, state.server.id, channel.id)}
      >
        <Icon name={CHANNEL_ICONS[channel.type] ?? "hash"} size={16} />
        <span className="channel-name">{channel.name}</span>
        {muted && <Icon name="bellOff" size={14} />}
        {unread?.mention && <span className="badge">{unread.count}</span>}
        <span className="channel-text-actions" onClick={(event) => event.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><button className="icon-btn tiny" aria-label={translate("common.d914457a16f5",{p0:(channel.name)})}><Icon name="more" size={14} /></button></DropdownMenuTrigger>
            <DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => toggleMessageMute("channel", accountId, channel.id)}><Icon name={muted ? "bell" : "bellOff"} />{muted ? translate("common.7188378d54aa") : translate("common.53963dd070f0")}</DropdownMenuItem></DropdownMenuContent>
          </DropdownMenu>
          {gear}
        </span>
      </div>
    </li>
  );
}

/** A voice room that disappears once everyone leaves (or after 10 minutes if nobody comes). */
async function createTempRoom(accountId: string, state: ServerState): Promise<void> {
  const me = state.members.find((m) => m.user.id === getState().instances[accountId]?.user?.id);
  const name = await promptText(
    translate("common.038c80567cb8"),
    me ? `Sala de ${displayNameOf(me)}` : translate("common.cf29c3858d74"),
    { confirmLabel: translate("common.b6fca790ee9c") },
  );
  if (!name?.trim()) return;
  // Next to the other voice rooms, in the first category that has one.
  const parentId = state.channels.find((c) => c.type === "voice" && c.parentId)?.parentId ?? null;
  try {
    const channel = await apiFor(accountId).post<Channel>(`/servers/${state.server.id}/temp-rooms`, { name: name.trim(), parentId });
    await ensureServer(accountId, state.server.id, true);
    await joinVoice(accountId, state.server.id, channel.id);
    openChannel(accountId, state.server.id, channel.id);
  } catch (err) {
    toast((err as Error).message);
  }
}

function ChannelList({ accountId, state, me, activeId }: { accountId: string; state: ServerState; me: string; activeId: string | null }) {
  const [menu, setMenu] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const perms = state.permissions;
  const isOwner = state.server.ownerId === me;
  const canSettings = isOwner || [Permission.MANAGE_SERVER, Permission.MANAGE_ROLES, Permission.BAN_MEMBERS].some((p) => has(perms, p));
  const canChannels = has(perms, Permission.MANAGE_CHANNELS);
  const muted = useStore((s) => s.settings.mutedServers.includes(notificationKey(accountId, state.server.id)));

  const { loose, categories } = useMemo(() => {
    const sorted = [...state.channels].sort((a, b) => a.position - b.position);
    const cats = sorted.filter((c) => c.type === "category");
    return {
      loose: sorted.filter((c) => c.type !== "category" && (!c.parentId || !cats.some((k) => k.id === c.parentId))),
      categories: cats.map((cat) => ({ cat, children: sorted.filter((c) => c.parentId === cat.id) })),
    };
  }, [state.channels]);

  const leave = async () => {
    if (await confirmAction(
      translate("common.ff1bc8d50ebc",{p0:(state.server.name)}),
      { title: `Sair de "${state.server.name}"`, confirmLabel: "Sair do servidor" },
    )) void act(apiFor(accountId).del(`/servers/${state.server.id}/members/@me`));
  };

  return (
    <ResizablePanel panel="channels" otherVisible={state.channels.some((c) => c.id === activeId && c.type === "text")}>
      <DropdownMenu open={menu} onOpenChange={setMenu}>
        <DropdownMenuTrigger asChild>
          <button className="channels-header server-menu-trigger live-community-cover" aria-label={translate("common.78ef0e3d7cfb",{p0:(state.server.name)})}>
            <CommunityCover state={state}/>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="server-menu" align="start">
          <DropdownMenuItem onSelect={() => void editServerNickname(accountId, state.server.id)}><Icon name="edit" />{translate("server.nicknameMenu")}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => toggleMessageMute("server", accountId, state.server.id)}><Icon name={muted ? "bell" : "bellOff"} />{muted ? translate("common.615490f2cb43") : translate("common.b60be554ff31")}</DropdownMenuItem>
          <DropdownMenuSeparator />
          {has(perms, Permission.CREATE_INVITE) && (
            <DropdownMenuItem onSelect={() => openModal({ kind: "invite", accountId, serverId: state.server.id })}>{rich("common.64074706bf95",{p0:(<Icon name="userPlus" />)})}</DropdownMenuItem>
          )}
          {canSettings && (
            <DropdownMenuItem onSelect={() => openModal({ kind: "serverSettings", accountId, serverId: state.server.id })}>{rich("common.a86cf2b71570",{p0:(<Icon name="gear" />)})}</DropdownMenuItem>
          )}
          {canChannels && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => openModal({ kind: "createChannel", accountId, serverId: state.server.id, parentId: null, type: "text" })}
              >{rich("common.df6ff3015259",{p0:(<Icon name="hash" />)})}</DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  openModal({ kind: "createChannel", accountId, serverId: state.server.id, parentId: null, type: "category" })
                }
              >{rich("common.4d8d42aa234f",{p0:(<Icon name="plus" />)})}</DropdownMenuItem>
            </>
          )}
          {has(perms, Permission.CONNECT) && (
            <DropdownMenuItem onSelect={() => void createTempRoom(accountId, state)}>{rich("common.c9347fda4e36",{p0:(<Icon name="hourglass" />)})}</DropdownMenuItem>
          )}
          {isOwner && (
            <DropdownMenuItem onSelect={() => openModal({ kind: "importDiscord", accountId, serverId: state.server.id })}>{rich("common.39c9cd54472d",{p0:(<Icon name="refresh" />)})}</DropdownMenuItem>
          )}
          {!isOwner && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onSelect={leave}>{rich("common.2acd3120ded4",{p0:(<Icon name="hangup" />)})}</DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <CommunitySummary accountId={accountId} state={state}/>
      <ul className="channel-scroll">
        <li>
          <button
            className="channel server-bot-link"
            onClick={() => navigate({ kind: "marketplace", accountId, serverId: state.server.id })}
          >
            <Icon name="bot" size={17} />
            <span className="channel-name">{translate("redesign.communityApps")}</span>
          </button>
        </li>
        {loose.map((c) => (
          <ChannelRow key={c.id} accountId={accountId} state={state} channel={c} me={me} activeId={activeId} />
        ))}
        {categories.map(({ cat, children }) => (
          <li key={cat.id} className="category">
            <div className="category-header">
              <button className="category-toggle" onClick={() => setCollapsed((c) => ({ ...c, [cat.id]: !c[cat.id] }))}>
                <span className={collapsed[cat.id] ? "chev collapsed" : "chev"}>
                  <Icon name="chevron" size={12} />
                </span>
                {cat.name}
              </button>
              {canChannels && (
                <>
                  <button
                    className="icon-btn tiny"
                    title={translate("common.35dccd0e38f1")}
                    onClick={() =>
                      openModal({ kind: "createChannel", accountId, serverId: state.server.id, parentId: cat.id, type: "text" })
                    }
                  >
                    <Icon name="plus" size={14} />
                  </button>
                  <button
                    className="icon-btn tiny"
                    title={translate("common.618bb4d7a6ca")}
                    onClick={() => openModal({ kind: "channelSettings", accountId, serverId: state.server.id, channelId: cat.id })}
                  >
                    <Icon name="gear" size={14} />
                  </button>
                </>
              )}
            </div>
            <ul>
              {children
                .filter((c) => !collapsed[cat.id] || c.id === activeId || state.voiceStates.some((v) => v.channelId === c.id))
                .map((c) => (
                  <ChannelRow key={c.id} accountId={accountId} state={state} channel={c} me={me} activeId={activeId} />
                ))}
            </ul>
          </li>
        ))}
      </ul>
      <UserPanel />
    </ResizablePanel>
  );
}

// Members ------------------------------------------------------------------

function MemberCard({
  accountId,
  state,
  member: supplied,
  me,
  at,
  onClose,
}: {
  accountId: string;
  state: ServerState;
  member: Member;
  me: string;
  at: { anchor: HTMLElement };
  onClose: () => void;
}) {
  const inst = useStore((s) => s.instances[accountId]);
  const relationships = useStore((s) => s.instances[accountId]?.relationships);
  const member = useStore((s) => s.instances[accountId]?.serverStates[state.server.id]?.members.find((item) => item.user.id === supplied.user.id) ?? supplied);
  const perms = state.permissions;
  const myRank = rankOf(state, me);
  const isSelf = member.user.id === me;
  const outranks = myRank > rankOf(state, member.user.id);
  const api = apiFor(accountId);
  const sid = state.server.id;
  const rel = relationships?.find((r) => r.user.id === member.user.id);
  const annoySocial = !!inst?.instance?.annoySocial;
  const cloudRel = useStore((s) => (member.user.annoyId ? s.social.relationships.find((r) => r.user.id === member.user.annoyId) : undefined));
  const activities = useStore((s) => isSelf ? s.settings.shareActivity ? s.desktopActivity?.activities ?? EMPTY_ACTIVITIES : EMPTY_ACTIVITIES : s.instances[accountId]?.activities?.[member.user.id] ?? EMPTY_ACTIVITIES);
  const assignable = state.roles.filter((r) => r.id !== sid && r.position < myRank);

  return (
    <ProfilePopover.Root open onOpenChange={(open) => !open && onClose()}>
      <ProfilePopover.Anchor virtualRef={{ current: at.anchor }} />
      <ProfilePopover.Portal>
        <ProfilePopover.Content
          role="dialog"
          aria-label={translate("common.bb51fa235d84",{p0:(member.user.displayName)})}
          className="member-card member-profile"
          side="left"
          align="start"
          sideOffset={12}
          collisionPadding={12}
        >
          <div className="member-card-head">
            <Avatar user={member.user} size={64} presence={member.presence} />
            <div>
              <div className="member-card-name" style={{ color: memberColor(state, member) }}>
                {displayNameOf(member)}
              </div>
              <div className="muted">@{member.user.username}</div>
            </div>
          </div>
          {member.user.bio && <p className="profile-bio" title={member.user.bio}>{member.user.bio}</p>}
          <FullProfileButton accountId={accountId} user={member.user}/>
          {canViewActivity(inst, member.user.id) && activities.length > 0 && (
            <div className="member-card-section">
              <div className="section-label">{isSelf ? translate("common.c539537cdd76") : rel?.status === "friend" ? translate("common.a5121730503f") : translate("common.a5121730503f")}</div>
              <ActivityStack activities={activities} />
            </div>
          )}
          <div className="member-card-section">
            <div className="section-label">{translate("common.0ca317ead9f6")}</div>
            <div className="role-chips">
              {state.roles
                .filter((r) => member.roleIds.includes(r.id))
                .map((r) => (
                  <span key={r.id} className="role-chip">
                    <span className="role-dot" style={{ background: r.color ?? "var(--text-muted)" }} />
                    {r.name}
                    {r.id !== sid && has(perms, Permission.MANAGE_ROLES) && r.position < myRank && (
                      <button
                        className="role-chip-x"
                        title={translate("common.2de2e74df518")}
                        onClick={() => void act(api.del(`/servers/${sid}/members/${member.user.id}/roles/${r.id}`))}
                      >
                        <Icon name="x" size={12} />
                      </button>
                    )}
                  </span>
                ))}
              {member.roleIds.length === 0 && <span className="muted">{translate("common.69fafa3929a3")}</span>}
            </div>
            {has(perms, Permission.MANAGE_ROLES) && assignable.some((r) => !member.roleIds.includes(r.id)) && (
              <EntityPicker
                label={translate("common.bb5bd0dd048c")}
                placeholder={translate("common.bb5bd0dd048c")}
                value=""
                onValueChange={(id) => void act(api.put(`/servers/${sid}/members/${member.user.id}/roles/${id}`))}
                items={assignable
                  .filter((r) => !member.roleIds.includes(r.id))
                  .map((r) => ({ id: r.id, label: r.name, group: translate("common.0ca317ead9f6"), color: r.color }))}
              />
            )}
          </div>
          {!isSelf && <UserVolume accountId={accountId} userId={member.user.id} name={displayNameOf(member)} />}
          {!isSelf && (
            <div className="member-card-actions">
              <button className="btn" onClick={() => void openDm(accountId, member.user.id).then(onClose)}>{rich("common.034692b8029f",{p0:(<Icon name="message" size={16} />)})}</button>
              {!rel && !cloudRel && (!annoySocial || member.user.annoyId) && (
                <button
                  className="btn btn-ghost"
                  onClick={() => void act(annoySocial ? addFriend(member.user.annoyId!) : api.post("/relationships", { username: member.user.username }), translate("social.requestSent"))}
                >{rich("common.65f4ed364cc0",{p0:(<Icon name="userPlus" size={16} />)})}</button>
              )}
              {outranks && has(perms, Permission.KICK_MEMBERS) && (
                <button
                  className="btn btn-danger"
                  onClick={async () =>
                    (await confirmAction(translate("common.c722514df782",{p0:(displayNameOf(member))}))) &&
                    void act(api.del(`/servers/${sid}/members/${member.user.id}`)).then(onClose)
                  }
                >{translate("common.ffb1a9c946e7")}</button>
              )}
              {outranks && has(perms, Permission.BAN_MEMBERS) && (
                <button
                  className="btn btn-danger"
                  onClick={async () => {
                    const reason = await promptText(translate("common.e8b8dc7785ff",{p0:(displayNameOf(member))}));
                    if (reason !== null) void act(api.put(`/servers/${sid}/bans/${member.user.id}`, { reason })).then(onClose);
                  }}
                >{translate("common.903303033882")}</button>
              )}
            </div>
          )}
        </ProfilePopover.Content>
      </ProfilePopover.Portal>
    </ProfilePopover.Root>
  );
}

function MemberList({ accountId, state, me }: { accountId: string; state: ServerState; me: string }) {
  const inst = useStore((s) => s.instances[accountId]);
  const [query, setQuery] = useState("");
  const [searchMembers, setSearchMembers] = useState<Member[] | null>(null);
  const [searchTotal, setSearchTotal] = useState<number | null>(null);
  const [nextCursor, setNextCursor] = useState(state.membersNextCursor ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [card, setCard] = useState<{ member: Member; anchor: HTMLElement } | null>(null);
  const members = searchMembers ?? state.members;
  useEffect(() => {
    const term = query.trim();
    if (!term) { setSearchMembers(null); setSearchTotal(null); setNextCursor(state.membersNextCursor ?? null); setError(null); setLoading(false); return; }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setError(null);
      void loadServerMembers(accountId, state.server.id, { query: term, signal: controller.signal, merge: false })
        .then((page) => { if (!controller.signal.aborted) { setSearchMembers(page.members); setSearchTotal(page.total); setNextCursor(page.nextCursor); } })
        .catch((reason) => { if (!controller.signal.aborted && !isCancellation(reason)) setError((reason as Error).message); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 220);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [accountId, state.server.id, state.membersNextCursor, query]);
  const activeFriends = members.filter(
    (m) =>
      m.user.id !== me &&
      canViewActivity(inst, m.user.id) &&
      (inst?.activities?.[m.user.id]?.length ?? 0) > 0,
  );
  const online = members.filter((m) => m.presence !== "offline");
  const offline = members.filter((m) => m.presence === "offline");
  const loadMoreMembers = async () => {
    if (!nextCursor || loading) return;
    setLoading(true);
    setError(null);
    try {
      const page = await loadServerMembers(accountId, state.server.id, { after: nextCursor, query: query.trim() || undefined, merge: !query.trim() });
      if (query.trim()) setSearchMembers((current) => [...(current ?? []), ...page.members]);
      setNextCursor(page.nextCursor);
      if (query.trim()) setSearchTotal(page.total);
    } catch (reason) { if (!isCancellation(reason)) setError((reason as Error).message); }
    finally { setLoading(false); }
  };
  const section = (label: string, list: Member[]) =>
    list.length > 0 && (
      <>
        <div className="section-label">
          {label} — {list.length}
        </div>
        {list.map((m) => (
          <button
            key={m.user.id}
            className={`member${m.presence !== "offline" ? "" : " offline"}`}
            onClick={(e) => setCard({ member: m, anchor: e.currentTarget })}
          >
            <Avatar user={m.user} size={32} presence={m.presence} />
            <span className="truncate" style={{ color: memberColor(state, m) }}>
              {displayNameOf(m)}
            </span>
            {m.user.id === state.server.ownerId && (
              <span className="owner-crown" title={translate("common.e7a6dbc97cca")}>
                <Icon name="crown" size={13} />
              </span>
            )}
          </button>
        ))}
      </>
    );
  return (
    <ResizablePanel panel="members" otherVisible>
      <CommunityPulse accountId={accountId} state={state} me={me}/>
      <div className="member-search-slot"><SearchButton placement="members" /></div>
      <div className="member-directory-search">
        <Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={translate("common.61fd3b555f75")} aria-label={translate("common.fb0fd14d5bbb")} />
      </div>
      <p className="member-directory-status" aria-live="polite">{query.trim() ? translate("common.fc202db56242",{p0:(members.length),p1:(searchTotal ?? "…")}) : translate("common.58ab7ca8771a",{p0:(state.members.length),p1:(state.membersTotal ?? state.members.length)})}</p>
      {activeFriends.length > 0 && !query.trim() && (
        <section className="friend-activities">
          <h3>{rich("common.2c4be32b2e13",{p0:(activeFriends.length)})}</h3>
          {activeFriends.map((m) => (
            <button key={m.user.id} onClick={(e) => setCard({ member: m, anchor: e.currentTarget })}>
              <strong>{displayNameOf(m)}</strong>
              {inst!.activities[m.user.id]!.map((a) => (
                <ActivityCard key={a.kind} activity={a} compact />
              ))}
            </button>
          ))}
        </section>
      )}
      {section(translate("common.0d21bd52022c"), online)}
      {section(translate("common.a1794783aab7"), offline)}
      {loading && <p className="member-directory-status" role="status">{translate("common.b386ed87083a")}</p>}
      {error && <div className="member-directory-error" role="alert"><span>{error}</span><button className="btn btn-ghost btn-small" onClick={() => setQuery((value) => `${value} `)}>{translate("common.b9e10688be01")}</button></div>}
      {!loading && !error && query.trim() && members.length === 0 && <p className="member-directory-status">{translate("common.eb9caaa65f99")}</p>}
      {nextCursor && <button className="btn btn-ghost btn-small member-load-more" disabled={loading} onClick={() => void loadMoreMembers()}>{loading ? translate("common.6cc1bbba0f84") : translate("common.3298a7dab87a",{p0:(Math.max(0, (query.trim() ? searchTotal ?? members.length : state.membersTotal ?? state.members.length) - members.length))})}</button>}
      {card && (
        <MemberCard
          accountId={accountId}
          state={state}
          member={members.find((m) => m.user.id === card.member.user.id) ?? card.member}
          me={me}
          at={card}
          onClose={() => setCard(null)}
        />
      )}
    </ResizablePanel>
  );
}

// View ---------------------------------------------------------------------

/** Shown while the instance is unreachable, instead of an empty screen. */
function ServerUnavailable({ accountId, serverId }: { accountId: string; serverId: string }) {
  const status = useStore((s) => s.instances[accountId]?.status);
  const error = useStore((s) => s.instances[accountId]?.serverLoadErrors[serverId]);
  const loading = useStore((s) => s.instances[accountId]?.serverLoading[serverId] === true);
  const name = useStore((s) => s.accounts.find((a) => a.id === accountId)?.instanceName ?? "servidor");
  if (status === "ready" && (!error || loading) || status === undefined) return <ChatSkeleton />;
  if (status === "ready" && error) return <div className="empty-main offline-panel" role="alert">
    <div className="offline-icon"><Icon name="wifiOff" size={26} /></div>
    <h2>{error.includes(translate("common.57d7c91d286c")) ? translate("common.aadc570a2dde") : translate("common.374445d30133")}</h2>
    <p className="muted">{error}</p>
    <button className="btn" disabled={loading} onClick={() => void ensureServer(accountId, serverId, true)}>{loading ? translate("common.6cc1bbba0f84") : translate("common.be839d7fb474")}</button>
    <button className="btn btn-ghost" disabled={loading} onClick={() => navigate({ kind: "servers" })}>{translate("common.f6a51589282a")}</button>
  </div>;
  return (
    <div className="empty-main offline-panel">
      <div className="offline-icon">
        <Icon name="refresh" size={26} />
      </div>
      <h2>{status === "outdated" ? translate("connection.updateRequired") : status === "invalid" ? translate("common.69883ff8a543") : translate("common.cfd16b7c6734",{p0:(name)})}</h2>
      <p className="muted">
        {status === "outdated" ? translate("connection.updateHint") : status === "invalid"
          ? translate("common.5a3f23aabc32")
          : translate("common.d83ab6d4e968")}
      </p>
      <button className="btn" onClick={() => (status === "invalid" ? openModal({ kind: "addAccount", accountId }) : reconnect(accountId))}>
        {status === "outdated" ? translate("connection.updateAction") : status === "invalid" ? translate("common.63034958f0db") : translate("common.1bff678f4f0f")}
      </button>
    </div>
  );
}

export function ServerView({ accountId, serverId, channelId }: { accountId: string; serverId: string; channelId: string | null }) {
  const state = useStore((s) => s.instances[accountId]?.serverStates[serverId]);
  const me = useStore((s) => s.instances[accountId]?.user?.id);
  const showMembers = useStore((s) => s.settings.membersOpen);
  const connected = useStore((s) => s.instances[accountId]?.status === "ready");
  if (!state || !me) return <ServerUnavailable accountId={accountId} serverId={serverId} />;

  const opened = state.channels.find((c) => c.id === channelId);
  const channel = opened?.type === "text" ? opened : undefined;
  const voiceChannel = opened?.type === "voice" ? opened : undefined;
  const perms = opened ? channelPerms(state, me, opened) : 0;
  const names = new Map(state.members.map((m) => [m.user.id, displayNameOf(m)]));

  return (
    <div className="server-view">
      <ChannelList accountId={accountId} state={state} me={me} activeId={channelId} />
      {!connected && opened?.type !== "text" ? <ServerUnavailable accountId={accountId} serverId={serverId} /> : opened?.type === "files" ? (
        <FilesView key={JSON.stringify([accountId, opened.id])} accountId={accountId} state={state} channel={opened} perms={perms} />
      ) : opened?.type === "code" ? (
        <CodeView key={JSON.stringify([accountId, opened.id])} accountId={accountId} state={state} channel={opened} perms={perms} />
      ) : opened?.type === "theater" ? (
        <TheaterView key={JSON.stringify([accountId, opened.id])} accountId={accountId} state={state} channel={opened} perms={perms} />
      ) : opened?.type === "song" ? (
        <SongView key={JSON.stringify([accountId, opened.id])} accountId={accountId} state={state} channel={opened} perms={perms} />
      ) : voiceChannel ? (
        <VoiceStage accountId={accountId} state={state} channel={voiceChannel} canConnect={has(perms, Permission.CONNECT)} />
      ) : channel ? (
        <Chat
          key={JSON.stringify([accountId, channel.id])}
          accountId={accountId}
          channelId={channel.id}
          title={channel.name}
          icon="hash"
          topic={channel.topic}
          introduction={<CommunityWelcome accountId={accountId} state={state}/>}
          canSend={has(perms, Permission.SEND_MESSAGES)}
          canAttach={has(perms, Permission.ATTACH_FILES)}
          canModerate={has(perms, Permission.MANAGE_MESSAGES)}
          canPin={has(perms, Permission.MANAGE_MESSAGES)}
          serverId={serverId}
          nameOf={(id) => names.get(id)}
          channelOf={(id) => state.channels.find((c) => c.id === id)?.name}
          mentionables={state.members.map((m) => ({ id: m.user.id, name: displayNameOf(m), username: m.user.username }))}
          headerExtra={
            <button
              className={`icon-btn${showMembers ? " on" : ""}`}
              aria-label={translate("common.3bbefaf8ddea")}
              aria-pressed={showMembers}
              title={translate("common.5f001b163902")}
              onClick={() => togglePanel("members")}
            >
              <Icon name="users" />
            </button>
          }
        />
      ) : opened ? (
        <div className="empty-main channel-unavailable" role="status"><Icon name="lock" size={28} /><h2>{translate("common.961b6db35417")}</h2><p>{translate("common.a0c00af7f7e7")}</p>
          {state.channels.find((candidate) => candidate.type === "text") && <button className="btn btn-ghost" onClick={() => openChannel(accountId, serverId, state.channels.find((candidate) => candidate.type === "text")!.id)}>{translate("common.4e1a188711cd")}</button>}
        </div>
      ) : !state.channels.some((candidate) => candidate.type !== "category") ? (
        <div className="empty-main channel-unavailable" role="status"><Icon name="hash" size={28} /><h2>{translate("common.b15a212b057b")}</h2><p>{translate("common.0746204a46f6")}</p>
          {has(state.permissions, Permission.MANAGE_CHANNELS) && <button className="btn" onClick={() => openModal({ kind: "createChannel", accountId, serverId, parentId: null, type: "text" })}>{translate("common.600bb4f4d3f6")}</button>}
        </div>
      ) : (
        <div className="empty-main channel-unavailable" role="status"><Icon name="hash" size={28} /><h2>{translate("common.ebfcb5dae749")}</h2><p>{rich("common.a47f3201bae2",{p0:(state.channels.some((c) => c.type === "voice") ? " ou entre em uma sala de voz" : "")})}</p></div>
      )}
      {channel && <MemberList accountId={accountId} state={state} me={me} />}
    </div>
  );
}
