import { confirmAction, promptText } from "./ui/action-dialog.tsx";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "./ui/dropdown-menu.tsx";
import { Select } from "./ui/select.tsx";
import { ActivityCard } from "../features/activity/ActivityCard.tsx";
import { EMPTY_ACTIVITIES } from "../store.ts";
import * as ProfilePopover from "@radix-ui/react-popover";
import { EntityPicker } from "./ui/entity-picker.tsx";
import { has, Permission, type Channel, type Member, type ServerState, type VoiceState } from "@distopic/protocol";
import { useMemo, useState } from "react";
import { apiFor, joinVoice, navigate, openChannel, openDm, reconnect } from "../client.ts";
import { channelPerms, displayNameOf, memberColor, rankOf } from "../perms.ts";
import { toast, useStore } from "../store.ts";
import { Chat } from "./Chat.tsx";
import { VoiceStage } from "./VoiceStage.tsx";
import { act, Avatar, Icon, openModal } from "./ui.tsx";
import { UserPanel } from "./TopBar.tsx";
import { ChatSkeleton } from "./ui/skeleton.tsx";
import { ResizablePanel, togglePanel } from "./layout/ResizablePanel.tsx";

// Channel list -------------------------------------------------------------

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
  return (
    <ul className="voice-users">
      {voiceStates.map((v) => {
        const member = state.members.find((m) => m.user.id === v.userId);
        if (!member) return null;
        return (
          <li key={v.userId} className="voice-user">
            <Avatar user={member.user} size={22} speaking={v.speaking && !v.selfMute && !v.serverMute} />
            <span className="voice-user-name">{displayNameOf(member)}</span>
            {(v.serverMute || v.selfMute) && (
              <span
                className={v.serverMute ? "voice-flag server" : "voice-flag"}
                title={v.serverMute ? "Silenciado pelo servidor" : "Microfone desativado"}
              >
                <Icon name="micOff" size={14} />
              </span>
            )}
            {v.video && (
              <span className="voice-flag" title="Câmera ligada">
                <Icon name="camera" size={14} />
              </span>
            )}
            {v.screen && (
              <span className="live small" title="Compartilhando a tela">
                AO VIVO
              </span>
            )}
            {v.selfDeaf && (
              <span className="voice-flag" title="Ensurdecido">
                <Icon name="headphonesOff" size={14} />
              </span>
            )}
            {canModerate && (
              <span className="voice-mod">
                <button
                  className="icon-btn tiny"
                  title={v.serverMute ? "Remover silêncio do servidor" : "Silenciar no servidor"}
                  onClick={() =>
                    void act(
                      apiFor(accountId).patch(`/servers/${state.server.id}/members/${v.userId}/voice`, { serverMute: !v.serverMute }),
                    )
                  }
                >
                  <Icon name={v.serverMute ? "mic" : "micOff"} size={14} />
                </button>
                <button
                  className="icon-btn tiny"
                  title="Desconectar da voz"
                  onClick={() =>
                    void act(apiFor(accountId).patch(`/servers/${state.server.id}/members/${v.userId}/voice`, { disconnect: true }))
                  }
                >
                  <Icon name="hangup" size={14} />
                </button>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

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
  const perms = channelPerms(state, me, channel);
  const canManage = has(perms, Permission.MANAGE_CHANNELS);
  const gear = canManage && (
    <button
      className="icon-btn tiny channel-gear"
      title="Editar canal"
      onClick={(e) => {
        e.stopPropagation();
        openModal({ kind: "channelSettings", accountId, serverId: state.server.id, channelId: channel.id });
      }}
    >
      <Icon name="gear" size={14} />
    </button>
  );

  if (channel.type === "voice") {
    const inChannel = state.voiceStates.filter((v) => v.channelId === channel.id);
    const connected = voice?.accountId === accountId && voice.serverId === state.server.id && voice.channelId === channel.id;
    const canConnect = has(perms, Permission.CONNECT);
    return (
      <li>
        <div
          className={`channel voice${connected ? " active" : ""}${canConnect ? "" : " locked"}`}
          onClick={() => {
            if (!canConnect) return toast("Sem permissão para conectar");
            if (!connected) void joinVoice(accountId, state.server.id, channel.id);
            openChannel(accountId, state.server.id, channel.id);
          }}
          title={canConnect ? "Clique para entrar" : "Sem permissão para conectar"}
        >
          <Icon name={canConnect ? "speaker" : "lock"} size={16} />
          <span className="channel-name">{channel.name}</span>
          {connected && <span className={`voice-here ${voice.status}`}>{voice.status === "connected" ? "Na sala" : "Entrando"}</span>}
          {gear}
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
        <Icon name="hash" size={16} />
        <span className="channel-name">{channel.name}</span>
        {unread?.mention && <span className="badge">{unread.count}</span>}
        {gear}
      </div>
    </li>
  );
}

function ChannelList({ accountId, state, me, activeId }: { accountId: string; state: ServerState; me: string; activeId: string | null }) {
  const [menu, setMenu] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const perms = state.permissions;
  const isOwner = state.server.ownerId === me;
  const canSettings = isOwner || [Permission.MANAGE_SERVER, Permission.MANAGE_ROLES, Permission.BAN_MEMBERS].some((p) => has(perms, p));
  const canChannels = has(perms, Permission.MANAGE_CHANNELS);

  const { loose, categories } = useMemo(() => {
    const sorted = [...state.channels].sort((a, b) => a.position - b.position);
    const cats = sorted.filter((c) => c.type === "category");
    return {
      loose: sorted.filter((c) => c.type !== "category" && (!c.parentId || !cats.some((k) => k.id === c.parentId))),
      categories: cats.map((cat) => ({ cat, children: sorted.filter((c) => c.parentId === cat.id) })),
    };
  }, [state.channels]);

  const leave = async () => {
    if (await confirmAction(`Sair de ${state.server.name}?`)) void act(apiFor(accountId).del(`/servers/${state.server.id}/members/@me`));
  };

  return (
    <ResizablePanel panel="channels" otherVisible={state.channels.some((c) => c.id === activeId && c.type === "text")}>
      <DropdownMenu open={menu} onOpenChange={setMenu}>
        <DropdownMenuTrigger asChild>
          <button className="channels-header server-menu-trigger" aria-label={`Menu de ${state.server.name}`}>
            <span className="truncate">{state.server.name}</span>
            <Icon name="chevron" size={16} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="server-menu" align="start">
          {has(perms, Permission.CREATE_INVITE) && (
            <DropdownMenuItem onSelect={() => openModal({ kind: "invite", accountId, serverId: state.server.id })}>
              <Icon name="userPlus" />
              Convidar pessoas
            </DropdownMenuItem>
          )}
          {canSettings && (
            <DropdownMenuItem onSelect={() => openModal({ kind: "serverSettings", accountId, serverId: state.server.id })}>
              <Icon name="gear" />
              Configurações do servidor
            </DropdownMenuItem>
          )}
          {canChannels && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => openModal({ kind: "createChannel", accountId, serverId: state.server.id, parentId: null, type: "text" })}
              >
                <Icon name="hash" />
                Criar canal
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  openModal({ kind: "createChannel", accountId, serverId: state.server.id, parentId: null, type: "category" })
                }
              >
                <Icon name="plus" />
                Criar categoria
              </DropdownMenuItem>
            </>
          )}
          {isOwner && (
            <DropdownMenuItem onSelect={() => openModal({ kind: "importDiscord", accountId, serverId: state.server.id })}>
              <Icon name="refresh" />
              Importar do Discord
            </DropdownMenuItem>
          )}
          {!isOwner && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onSelect={leave}>
                <Icon name="hangup" />
                Sair do servidor
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <ul className="channel-scroll">
        <li>
          <button
            className="channel server-bot-link"
            onClick={() => navigate({ kind: "marketplace", accountId, serverId: state.server.id })}
          >
            <Icon name="bot" size={17} />
            <span className="channel-name">Bots do servidor</span>
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
                    title="Criar canal nesta categoria"
                    onClick={() =>
                      openModal({ kind: "createChannel", accountId, serverId: state.server.id, parentId: cat.id, type: "text" })
                    }
                  >
                    <Icon name="plus" size={14} />
                  </button>
                  <button
                    className="icon-btn tiny"
                    title="Editar categoria"
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
  member,
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
  const relationships = useStore((s) => s.instances[accountId]?.relationships);
  const perms = state.permissions;
  const myRank = rankOf(state, me);
  const isSelf = member.user.id === me;
  const outranks = myRank > rankOf(state, member.user.id);
  const api = apiFor(accountId);
  const sid = state.server.id;
  const rel = relationships?.find((r) => r.user.id === member.user.id);
  const activities = useStore((s) => s.instances[accountId]?.activities?.[member.user.id] ?? EMPTY_ACTIVITIES);
  const assignable = state.roles.filter((r) => r.id !== sid && r.position < myRank);

  return (
    <ProfilePopover.Root open onOpenChange={(open) => !open && onClose()}>
      <ProfilePopover.Anchor virtualRef={{ current: at.anchor }} />
      <ProfilePopover.Portal>
        <ProfilePopover.Content
          role="dialog"
          aria-label={`Perfil de ${member.user.displayName}`}
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
          {rel?.status === "friend" && activities.length > 0 && (
            <div className="member-card-section">
              <div className="section-label">Atividade · Só para amigos</div>
              {activities.map((activity) => (
                <ActivityCard key={activity.kind} activity={activity} />
              ))}
            </div>
          )}
          <div className="member-card-section">
            <div className="section-label">Cargos</div>
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
                        title="Remover cargo"
                        onClick={() => void act(api.del(`/servers/${sid}/members/${member.user.id}/roles/${r.id}`))}
                      >
                        <Icon name="x" size={12} />
                      </button>
                    )}
                  </span>
                ))}
              {member.roleIds.length === 0 && <span className="muted">Nenhum cargo</span>}
            </div>
            {has(perms, Permission.MANAGE_ROLES) && assignable.some((r) => !member.roleIds.includes(r.id)) && (
              <EntityPicker
                label="Adicionar cargo"
                placeholder="Adicionar cargo"
                value=""
                onValueChange={(id) => void act(api.put(`/servers/${sid}/members/${member.user.id}/roles/${id}`))}
                items={assignable
                  .filter((r) => !member.roleIds.includes(r.id))
                  .map((r) => ({ id: r.id, label: r.name, group: "Cargos", color: r.color }))}
              />
            )}
          </div>
          {!isSelf && (
            <div className="member-card-actions">
              <button className="btn" onClick={() => void openDm(accountId, member.user.id).then(onClose)}>
                <Icon name="message" size={16} /> Mensagem
              </button>
              {!rel && (
                <button
                  className="btn btn-ghost"
                  onClick={() => void act(api.post("/relationships", { username: member.user.username }), "Pedido de amizade enviado")}
                >
                  <Icon name="userPlus" size={16} /> Adicionar amigo
                </button>
              )}
              {outranks && has(perms, Permission.KICK_MEMBERS) && (
                <button
                  className="btn btn-danger"
                  onClick={async () =>
                    (await confirmAction(`Expulsar ${displayNameOf(member)}?`)) &&
                    void act(api.del(`/servers/${sid}/members/${member.user.id}`)).then(onClose)
                  }
                >
                  Expulsar
                </button>
              )}
              {outranks && has(perms, Permission.BAN_MEMBERS) && (
                <button
                  className="btn btn-danger"
                  onClick={async () => {
                    const reason = await promptText(`Banir ${displayNameOf(member)}? Motivo (opcional):`);
                    if (reason !== null) void act(api.put(`/servers/${sid}/bans/${member.user.id}`, { reason })).then(onClose);
                  }}
                >
                  Banir
                </button>
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
  const activeFriends = state.members.filter(
    (m) =>
      m.user.id !== me &&
      inst?.relationships.some((r) => r.user.id === m.user.id && r.status === "friend") &&
      (inst.activities?.[m.user.id]?.length ?? 0) > 0,
  );
  const [card, setCard] = useState<{ member: Member; anchor: HTMLElement } | null>(null);
  const online = state.members.filter((m) => m.presence === "online");
  const offline = state.members.filter((m) => m.presence !== "online");
  const section = (label: string, list: Member[]) =>
    list.length > 0 && (
      <>
        <div className="section-label">
          {label} — {list.length}
        </div>
        {list.map((m) => (
          <button
            key={m.user.id}
            className={`member${m.presence === "online" ? "" : " offline"}`}
            onClick={(e) => setCard({ member: m, anchor: e.currentTarget })}
          >
            <Avatar user={m.user} size={32} presence={m.presence} />
            <span className="truncate" style={{ color: memberColor(state, m) }}>
              {displayNameOf(m)}
            </span>
            {m.user.id === state.server.ownerId && (
              <span className="owner-crown" title="Dono do servidor">
                <Icon name="crown" size={13} />
              </span>
            )}
          </button>
        ))}
      </>
    );
  return (
    <ResizablePanel panel="members" otherVisible>
      {activeFriends.length > 0 && (
        <section className="friend-activities">
          <h3>Atividade dos amigos — {activeFriends.length}</h3>
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
      {section("Online", online)}
      {section("Offline", offline)}
      {card && state.members.some((m) => m.user.id === card.member.user.id) && (
        <MemberCard
          accountId={accountId}
          state={state}
          member={state.members.find((m) => m.user.id === card.member.user.id)!}
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
function ServerUnavailable({ accountId }: { accountId: string }) {
  const status = useStore((s) => s.instances[accountId]?.status);
  const name = useStore((s) => s.accounts.find((a) => a.id === accountId)?.instanceName ?? "servidor");
  if (status === "ready" || status === undefined) return <ChatSkeleton />;
  return (
    <div className="empty-main offline-panel">
      <div className="offline-icon">
        <Icon name="refresh" size={26} />
      </div>
      <h2>{status === "invalid" ? "Sessão expirada" : `Sem conexão com ${name}`}</h2>
      <p className="muted">
        {status === "invalid"
          ? "Entre de novo para continuar."
          : "O app continua tentando sozinho. Se você estava numa chamada, ele volta para a sala quando reconectar."}
      </p>
      <button className="btn" onClick={() => (status === "invalid" ? openModal({ kind: "addAccount" }) : reconnect(accountId))}>
        {status === "invalid" ? "Entrar de novo" : "Tentar agora"}
      </button>
    </div>
  );
}

export function ServerView({ accountId, serverId, channelId }: { accountId: string; serverId: string; channelId: string | null }) {
  const state = useStore((s) => s.instances[accountId]?.serverStates[serverId]);
  const me = useStore((s) => s.instances[accountId]?.user?.id);
  const showMembers = useStore((s) => s.settings.membersOpen);
  if (!state || !me) return <ServerUnavailable accountId={accountId} />;

  const channel = state.channels.find((c) => c.id === channelId && c.type === "text");
  const voiceChannel = state.channels.find((c) => c.id === channelId && c.type === "voice");
  const perms = channel ? channelPerms(state, me, channel) : 0;
  const names = new Map(state.members.map((m) => [m.user.id, displayNameOf(m)]));

  return (
    <div className="server-view">
      <ChannelList accountId={accountId} state={state} me={me} activeId={channelId} />
      {voiceChannel ? (
        <VoiceStage accountId={accountId} state={state} channel={voiceChannel} />
      ) : channel ? (
        <Chat
          key={channel.id}
          accountId={accountId}
          channelId={channel.id}
          title={channel.name}
          icon="hash"
          topic={channel.topic}
          canSend={has(perms, Permission.SEND_MESSAGES)}
          canAttach={has(perms, Permission.ATTACH_FILES)}
          canModerate={has(perms, Permission.MANAGE_MESSAGES)}
          nameOf={(id) => names.get(id)}
          channelOf={(id) => state.channels.find((c) => c.id === id)?.name}
          mentionables={state.members.map((m) => ({ id: m.user.id, name: displayNameOf(m), username: m.user.username }))}
          headerExtra={
            <button
              className={`icon-btn${showMembers ? " on" : ""}`}
              aria-label="Alternar painel de membros"
              aria-pressed={showMembers}
              title="Lista de membros"
              onClick={() => togglePanel("members")}
            >
              <Icon name="users" />
            </button>
          }
        />
      ) : (
        <div className="empty-main">
          <p>Escolha um canal de texto{state.channels.some((c) => c.type === "voice") ? " ou entre em um canal de voz" : ""}.</p>
        </div>
      )}
      {channel && <MemberList accountId={accountId} state={state} me={me} />}
    </div>
  );
}
