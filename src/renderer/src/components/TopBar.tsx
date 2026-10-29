import type { ServerSummary } from "@distopic/protocol";
import logo from "../assets/logo.svg";
import { leaveVoice, navigate, openServer, reconnect, updateVoiceSettings } from "../client.ts";
import { initials } from "../format.tsx";
import { setState, useStore, type Account, type InstanceState } from "../store.ts";
import { ServiceTab, tabLayout } from "./Services.tsx";
import { Avatar, Icon, openModal } from "./ui.tsx";

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
    <button
      className={`tab-item${active ? " active" : ""}${unread.count ? " unread" : ""}${inst?.status === "ready" ? "" : " offline"}`}
      onClick={() => void openServer(account.id, server.id)}
      title={`${server.name} · ${account.instanceName}`}
    >
      <span className="tab-tile">{initials(server.name)}</span>
      <span className="tab-label">{server.name}</span>
      {unread.mention && <span className="tab-badge">{unread.count}</span>}
    </button>
  );
}

function VoiceChip() {
  const voice = useStore((s) => s.voice);
  const inst = useStore((s) => (s.voice ? s.instances[s.voice.accountId] : undefined));
  if (!voice) return null;
  const state = inst?.serverStates[voice.serverId];
  const channel = state?.channels.find((c) => c.id === voice.channelId);
  return (
    <div className={`voice-chip ${voice.status}`}>
      <span className="voice-dot" />
      <button className="voice-chip-label" onClick={() => void openServer(voice.accountId, voice.serverId)} title="Ir para o servidor">
        <strong>{voice.status === "connected" ? channel?.name ?? "Voz" : "Conectando…"}</strong>
        <span>{state?.server.name ?? ""}</span>
      </button>
      <button className="icon-btn danger" onClick={() => leaveVoice()} title="Desconectar da voz">
        <Icon name="hangup" size={16} />
      </button>
    </div>
  );
}

function Controls() {
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
    <div className="topbar-controls">
      <VoiceChip />
      <button className={`icon-btn${settings.selfMute ? " danger" : ""}`} onClick={() => toggle("selfMute")} title={settings.selfMute ? "Ativar microfone" : "Silenciar"}>
        <Icon name={settings.selfMute ? "micOff" : "mic"} />
      </button>
      <button className={`icon-btn${settings.selfDeaf ? " danger" : ""}`} onClick={() => toggle("selfDeaf")} title={settings.selfDeaf ? "Ativar áudio" : "Ensurdecer"}>
        <Icon name={settings.selfDeaf ? "headphonesOff" : "headphones"} />
      </button>
      <button className="icon-btn" onClick={openSettings} title="Configurações">
        <Icon name="gear" />
      </button>
      <button className="topbar-user" onClick={openSettings} title={user ? `@${user.username}` : "Sem conta"}>
        {user ? <Avatar user={user} size={30} presence="online" /> : <span className="avatar placeholder" />}
      </button>
    </div>
  );
}

/** Tab bar: home, browser services and every server of every connected instance, plus global controls. */
export function TopBar() {
  const accounts = useStore((s) => s.accounts);
  const instances = useStore((s) => s.instances);
  const view = useStore((s) => s.view);
  const services = useStore((s) => s.services);
  const settings = useStore((s) => s.settings);
  const shown = services.filter((sv) => !sv.hidden);
  const before = shown.filter((sv) => tabLayout(sv, settings).placement === "before");
  const after = shown.filter((sv) => tabLayout(sv, settings).placement === "after");

  let homeCount = 0;
  for (const a of accounts) {
    const inst = instances[a.id];
    for (const dm of inst?.dms ?? []) homeCount += inst?.unread[dm.id]?.count ?? 0;
    homeCount += inst?.relationships.filter((r) => r.status === "incoming").length ?? 0;
  }

  return (
    <header className="topbar">
      <div className="brand-mark" aria-hidden>
        <img src={logo} alt="" width="28" height="28" />
      </div>
      <nav className="tabs-strip" aria-label="Servidores">
        <button
          className={`tab-item fixed${view.kind === "home" ? " active" : ""}`}
          onClick={() => navigate({ kind: "home", accountId: view.kind === "home" ? view.accountId : (accounts[0]?.id ?? null), dmId: null })}
          title="Amigos e mensagens diretas"
        >
          <span className="tab-tile">
            <Icon name="home" size={15} />
          </span>
          <span className="tab-label">Início</span>
          {homeCount > 0 && <span className="tab-badge">{homeCount}</span>}
        </button>
        {before.map((service) => (
          <ServiceTab key={service.id} service={service} />
        ))}
        <span className="tabs-sep" />
        {accounts.map((account) => {
          const inst = instances[account.id];
          return (
            <div key={account.id} className="tab-group" title={account.instanceName}>
              {inst?.status !== "ready" && (
                <button
                  className={`instance-status ${inst?.status ?? "connecting"}`}
                  title={inst?.status === "invalid" ? `${account.instanceName}: sessão expirada, entre de novo` : `${account.instanceName}: sem conexão. Clique para tentar agora`}
                  onClick={() => (inst?.status === "invalid" ? setState((s) => void (s.modal = { kind: "addAccount" })) : reconnect(account.id))}
                />
              )}
              {inst?.servers.map((server) => <ServerTab key={server.id} account={account} server={server} inst={inst} />)}
            </div>
          );
        })}
        {after.length > 0 && accounts.length > 0 && <span className="tabs-sep" />}
        {after.map((service) => (
          <ServiceTab key={service.id} service={service} />
        ))}
        <button className="tabbar-add" title="Nova aba: servidor Annoy ou serviço" onClick={() => openModal({ kind: "addTab" })}>
          <Icon name="plus" size={18} />
        </button>
      </nav>
      <Controls />
    </header>
  );
}
