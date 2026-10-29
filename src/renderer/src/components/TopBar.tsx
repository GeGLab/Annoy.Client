import type { ServerSummary } from "@distopic/protocol";
import * as Popover from "@radix-ui/react-popover";
import { leaveVoice, navigate, openServer, reconnect, toggleVoiceSetting } from "../client.ts";
import { initials } from "../format.tsx";
import { setState, useStore, type Account, type InstanceState } from "../store.ts";
import { Avatar, Icon, openModal } from "./ui.tsx";
import { ServiceTab, tabLayout } from "./Services.tsx";
import { Brand } from "./Brand.tsx";
import { Tooltip } from "./ui/tooltip.tsx";
import { VoicePanel, DeviceMenu } from "./VoicePanel.tsx";
import { ActivityCard } from "../features/activity/ActivityCard.tsx";
import { EMPTY_ACTIVITIES } from "../store.ts";

function unreadFor(inst: InstanceState | undefined, channelIds: readonly string[]): { count: number; mention: boolean } {
  let count = 0;
  let mention = false;
  for (const id of channelIds) {
    const u = inst?.unread[id];
    if (u) {
      count += u.count;
      mention ||= u.mention;
    }
  }
  return { count, mention };
}

function ServerTab({ account, server, inst }: { account: Account; server: ServerSummary; inst: InstanceState | undefined }) {
  const view = useStore((s) => s.view);
  const active = view.kind === "server" && view.accountId === account.id && view.serverId === server.id;
  const unread = unreadFor(inst, inst?.serverStates[server.id]?.channels.map((c) => c.id) ?? []);
  return (
    <Tooltip content={`${server.name} · ${account.instanceName}`}>
      <button
        className={`tab-item${active ? " active" : ""}${unread.count ? " unread" : ""}${inst?.status === "ready" ? "" : " offline"}`}
        onClick={() => void openServer(account.id, server.id)}
        aria-label={`${server.name} · ${account.instanceName}`}
        aria-current={active ? "page" : undefined}
        title={`${server.name} · ${account.instanceName}`}
      >
        <span className="tab-tile">{initials(server.name)}</span>
        <span className="rail-label">{server.name}</span>
        {unread.mention && <span className="tab-badge">{unread.count}</span>}
      </button>
    </Tooltip>
  );
}

export function UserPanel() {
  const settings = useStore((s) => s.settings);
  const view = useStore((s) => s.view);
  const accounts = useStore((s) => s.accounts);
  const accountId = "accountId" in view && view.accountId ? view.accountId : accounts[0]?.id;
  const user = useStore((s) => (accountId ? s.instances[accountId]?.user : undefined));
  const ownPresence = useStore((s) => accountId && user ? s.instances[accountId]?.status === "ready" ? s.instances[accountId]?.presences[user.id] ?? "online" : "offline" : undefined);
  const snapshot = useStore((s) => s.desktopActivity);
  const activities = settings.shareActivity ? (snapshot?.activities ?? EMPTY_ACTIVITIES) : EMPTY_ACTIVITIES;

  const openSettings = () =>
    setState((s) => {
      s.modal = { kind: "userSettings" };
    });

  return (
    <footer className="user-panel">
      <VoicePanel />
      <div className="user-panel-row">
        <Popover.Root>
          <Popover.Trigger asChild>
          <button className="user-identity" aria-label="Abrir meu perfil">
            {user ? <Avatar user={user} size={32} presence={ownPresence} /> : <Brand size={32} />}
            <span className="user-identity-text">
              <strong className="truncate">{user?.displayName ?? "Seu espaço"}</strong>
              <span>{user ? `@${user.username}` : "Vamos conversar?"}</span>
            </span>
          </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content className="member-card member-profile self-profile" side="top" align="start" sideOffset={12} collisionPadding={12} role="dialog" aria-label="Meu perfil">
              <div className="member-card-head">
                {user ? <Avatar user={user} size={56} presence={ownPresence} /> : <Brand size={48} />}
                <div><strong className="member-card-name">{user?.displayName ?? "Seu espaço"}</strong>{user && <div className="muted">@{user.username}</div>}</div>
              </div>
              {user?.bio && <p className="profile-bio" title={user.bio}>{user.bio}</p>}
              <div className="self-profile-activity">
                <h3>Minha atividade</h3>
                {activities.map((activity) => <ActivityCard key={activity.kind} activity={activity} />)}
                {!activities.length && <p className="muted">{!settings.shareActivity ? "O compartilhamento está desativado." : snapshot?.error ?? "Nenhum jogo ou música detectado agora."}</p>}
                {activities.length > 0 && <p className="muted">Compartilhada com seus amigos nesta instância.</p>}
              </div>
              <Popover.Close asChild><button className="btn btn-ghost" onClick={openSettings}><Icon name="edit" size={16} />Editar perfil</button></Popover.Close>
              <Popover.Close asChild><button className="btn btn-ghost" onClick={() => openModal({ kind: "switchAccount" })}><Icon name="users" size={16} />Trocar de conta</button></Popover.Close>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
        <div className="user-control-pair">
          <Tooltip content={settings.selfMute ? "Ativar microfone" : "Silenciar microfone"} side="top">
            <button
              className={`icon-btn${settings.selfMute ? " danger" : ""}`}
              onClick={() => toggleVoiceSetting("selfMute")}
              aria-label={settings.selfMute ? "Ativar microfone" : "Silenciar microfone"}
              aria-pressed={settings.selfMute}
            >
              <Icon name={settings.selfMute ? "micOff" : "mic"} size={17} />
            </button>
          </Tooltip>
          <DeviceMenu kind="input" />
        </div>
        <div className="user-control-pair">
          <Tooltip content={settings.selfDeaf ? "Ativar áudio" : "Desativar áudio"} side="top">
            <button
              className={`icon-btn${settings.selfDeaf ? " danger" : ""}`}
              onClick={() => toggleVoiceSetting("selfDeaf")}
              aria-label={settings.selfDeaf ? "Ativar áudio" : "Desativar áudio"}
              aria-pressed={settings.selfDeaf}
            >
              <Icon name={settings.selfDeaf ? "headphonesOff" : "headphones"} size={17} />
            </button>
          </Tooltip>
          <DeviceMenu kind="output" />
        </div>
        <Tooltip content="Configurações" side="top">
          <button className="icon-btn" onClick={openSettings} aria-label="Configurações">
            <Icon name="gear" size={17} />
          </button>
        </Tooltip>
      </div>
    </footer>
  );
}

/** Community bar, down the side or across the top: home, browser services and every server of every connected instance. */
export function TopBar() {
  const accounts = useStore((s) => s.accounts);
  const instances = useStore((s) => s.instances);
  const view = useStore((s) => s.view);
  const services = useStore((s) => s.services);
  const settings = useStore((s) => s.settings);
  const shown = services.filter((sv) => !sv.hidden);
  const before = shown.filter((sv) => tabLayout(sv, settings).placement === "before");
  const after = shown.filter((sv) => tabLayout(sv, settings).placement === "after");
  const directMessages = accounts.flatMap((account) => (instances[account.id]?.dms ?? []).filter((dm) => dm.lastMessageId || instances[account.id]?.unread[dm.id]).map((dm) => ({ account, dm, unread: instances[account.id]?.unread[dm.id]?.count ?? 0 })));

  let homeCount = 0;
  for (const a of accounts) {
    const inst = instances[a.id];
    for (const dm of inst?.dms ?? []) homeCount += inst?.unread[dm.id]?.count ?? 0;
    homeCount += inst?.relationships.filter((r) => r.status === "incoming").length ?? 0;
  }

  return (
    <header className="topbar">
      <button className="rail-brand" title="Novidades do Annoy" aria-label="Novidades do Annoy" aria-current={view.kind === "news" ? "page" : undefined} onClick={() => navigate({ kind: "news" })}>
        <Brand size={settings.barPosition === "top" ? 30 : 42} />
      </button>
      <nav className="tabs-strip" aria-label="Navegação do Annoy">
        <span className="rail-section-label">Atalhos</span>
        <button
          className={`tab-item${view.kind === "home" ? " active" : ""}`}
          onClick={() =>
            navigate({ kind: "home", accountId: view.kind === "home" ? view.accountId : (accounts[0]?.id ?? null), dmId: null })
          }
          title="Amigos e mensagens diretas"
          aria-label="Amigos e mensagens diretas"
          aria-current={view.kind === "home" ? "page" : undefined}
        >
          <span className="tab-tile">
            <Icon name="home" size={15} />
          </span>
          <span className="rail-label">Início</span>
          {homeCount > 0 && <span className="tab-badge">{homeCount}</span>}
        </button>
        {directMessages.map(({ account, dm, unread }) => {
          const user = dm.recipients[0];
          if (!user) return null;
          const nickname = instances[account.id]?.relationships.find((r) => r.user.id === user.id)?.nickname || user.displayName;
          return <Tooltip key={`${account.id}-${dm.id}`} content={`${nickname}${unread ? ` · ${unread} novas mensagens` : ""}`}><button className={`tab-item dm-shortcut${view.kind === "home" && view.accountId === account.id && view.dmId === dm.id ? " active" : ""}`} aria-label={`Conversa com ${nickname}${unread ? `, ${unread} mensagens não lidas` : ""}`} onClick={() => navigate({ kind: "home", accountId: account.id, dmId: dm.id })}><Avatar user={user} size={36} presence={instances[account.id]?.presences[user.id] ?? "offline"} />{unread > 0 && <span key={unread} className="tab-badge">{unread}</span>}</button></Tooltip>;
        })}
        {before.map((service) => (
          <ServiceTab key={service.id} service={service} />
        ))}
        {/* Loja de bots temporariamente oculta enquanto a compatibilidade é definida.
        <Tooltip content="Loja de bots">
          <button
            className={`tab-item${view.kind === "marketplace" ? " active" : ""}`}
            aria-label="Loja de bots"
            aria-current={view.kind === "marketplace" ? "page" : undefined}
            onClick={() =>
              navigate({
                kind: "marketplace",
                accountId: "accountId" in view ? view.accountId : (accounts[0]?.id ?? null),
                serverId: view.kind === "server" || view.kind === "marketplace" ? view.serverId : null,
              })
            }
          >
            <span className="tab-tile">
              <Icon name="store" size={21} />
            </span>
            <span className="rail-label">Loja</span>
          </button>
        </Tooltip>
        */}
        <span className="rail-divider" />
        <span className="rail-section-label">Servidores</span>
        {accounts.map((account) => {
          const inst = instances[account.id];
          return (
            <div key={account.id} className="tab-group" title={account.instanceName}>
              {inst?.status !== "ready" && (
                <button
                  className={`instance-status ${inst?.status ?? "connecting"}`}
                  title={
                    inst?.status === "invalid"
                      ? `${account.instanceName}: sessão expirada, entre de novo`
                      : `${account.instanceName}: sem conexão. Clique para tentar agora`
                  }
                  onClick={() =>
                    inst?.status === "invalid" ? setState((s) => void (s.modal = { kind: "addAccount" })) : reconnect(account.id)
                  }
                />
              )}
              {inst?.servers.map((server) => (
                <ServerTab key={server.id} account={account} server={server} inst={inst} />
              ))}
            </div>
          );
        })}
        {after.length > 0 && accounts.length > 0 && <span className="rail-divider" />}
        {after.map((service) => (
          <ServiceTab key={service.id} service={service} />
        ))}
        <button
          className="tabbar-add"
          title="Nova aba: servidor Annoy ou serviço"
          aria-label="Nova aba"
          onClick={() => openModal({ kind: "addTab" })}
        >
          <span className="tab-tile">
            <Icon name="plus" size={18} />
          </span>
          <span className="rail-label">Nova aba</span>
        </button>
      </nav>
    </header>
  );
}
