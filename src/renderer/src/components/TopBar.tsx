import type { ServerSummary } from "@distopic/protocol";
import { leaveVoice, navigate, openServer, reconnect, updateVoiceSettings } from "../client.ts";
import { initials } from "../format.tsx";
import { setState, useStore, type Account, type InstanceState } from "../store.ts";
import { Avatar, Icon } from "./ui.tsx";
import { Brand } from "./Brand.tsx";
import { Tooltip } from "./ui/tooltip.tsx";
import { VoicePanel, DeviceMenu } from "./VoicePanel.tsx";

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

  const toggle = (key: "selfMute" | "selfDeaf") => {
    setState((s) => {
      s.settings[key] = !s.settings[key];
      // Undeafening also unmutes.
      if (key === "selfDeaf" && !s.settings.selfDeaf) s.settings.selfMute = false;
    });
    updateVoiceSettings();
  };
  const openSettings = () =>
    setState((s) => {
      s.modal = { kind: "userSettings" };
    });

  return (
    <footer className="user-panel">
      <VoicePanel />
      <div className="user-panel-row">
        <button className="user-identity" onClick={openSettings} aria-label="Abrir configurações de usuário">
          {user ? <Avatar user={user} size={32} presence="online" /> : <Brand size={32} />}
          <span className="user-identity-text">
            <strong className="truncate">{user?.displayName ?? "Seu espaço"}</strong>
            <span>{user ? `@${user.username}` : "Vamos conversar?"}</span>
          </span>
        </button>
        <div className="user-control-pair">
          <Tooltip content={settings.selfMute ? "Ativar microfone" : "Silenciar microfone"} side="top">
            <button
              className={`icon-btn${settings.selfMute ? " danger" : ""}`}
              onClick={() => toggle("selfMute")}
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
              onClick={() => toggle("selfDeaf")}
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

/** Persistent community rail; user and voice controls live beside the channels. */
export function TopBar() {
  const accounts = useStore((s) => s.accounts);
  const instances = useStore((s) => s.instances);
  const view = useStore((s) => s.view);
  const badge = useStore((s) => s.discordBadge);

  let homeCount = 0;
  for (const a of accounts) {
    const inst = instances[a.id];
    for (const dm of inst?.dms ?? []) homeCount += inst?.unread[dm.id]?.count ?? 0;
    homeCount += inst?.relationships.filter((r) => r.status === "incoming").length ?? 0;
  }

  return (
    <header className="topbar">
      <div className="rail-brand" title="Annoy">
        <Brand size={42} />
      </div>
      <nav className="tabs-strip" aria-label="Navegação do Annoy">
        <span className="rail-section-label">Atalhos</span>
        <button
          className={`tab-item fixed${view.kind === "discord" ? " active" : ""}`}
          onClick={() => navigate({ kind: "discord" })}
          title="Discord"
          aria-label="Discord"
          aria-current={view.kind === "discord" ? "page" : undefined}
        >
          <span className="tab-tile">DC</span>
          <span className="rail-label">Discord</span>
          {badge && <span className="tab-badge">{badge}</span>}
        </button>
        <button
          className={`tab-item fixed${view.kind === "home" ? " active" : ""}`}
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
        <button
          className="tabbar-add"
          title="Adicionar servidor"
          aria-label="Adicionar servidor"
          onClick={() =>
            setState((s) => {
              s.modal = accounts.length === 0 ? { kind: "addAccount" } : { kind: "createServer", accountId: accounts[0]!.id };
            })
          }
        >
          <span className="tab-tile">
            <Icon name="plus" size={18} />
          </span>
          <span className="rail-label">Adicionar</span>
        </button>
      </nav>
      <Tooltip content="Configurações">
        <button
          className="rail-settings icon-btn"
          aria-label="Configurações"
          onClick={() =>
            setState((s) => {
              s.modal = { kind: "userSettings" };
            })
          }
        >
          <Icon name="gear" size={21} />
        </button>
      </Tooltip>
    </header>
  );
}
