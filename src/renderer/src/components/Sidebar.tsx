import type { ServerSummary } from "@distopic/protocol";
import { navigate, openServer } from "../client.ts";
import { initials } from "../format.tsx";
import { setState, useStore, type Account, type InstanceState } from "../store.ts";
import { Icon } from "./ui.tsx";

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

function ServerIcon({ account, server, inst }: { account: Account; server: ServerSummary; inst: InstanceState | undefined }) {
  const view = useStore((s) => s.view);
  const active = view.kind === "server" && view.accountId === account.id && view.serverId === server.id;
  const channelIds = inst?.serverStates[server.id]?.channels.map((c) => c.id) ?? [];
  const unread = unreadFor(inst, channelIds);
  return (
    <div className={`rail-item${active ? " active" : ""}${unread.count ? " unread" : ""}`}>
      <span className="rail-pill" />
      <button className="rail-btn" onClick={() => void openServer(account.id, server.id)} title={`${server.name} · ${account.instanceName}`}>
        {initials(server.name)}
      </button>
      {unread.mention && <span className="rail-badge">{unread.count}</span>}
    </div>
  );
}

export function Sidebar() {
  const accounts = useStore((s) => s.accounts);
  const instances = useStore((s) => s.instances);
  const view = useStore((s) => s.view);
  const badge = useStore((s) => s.discordBadge);

  let homeMentions = 0;
  for (const a of accounts) {
    const inst = instances[a.id];
    for (const dm of inst?.dms ?? []) homeMentions += inst?.unread[dm.id]?.count ?? 0;
    homeMentions += inst?.relationships.filter((r) => r.status === "incoming").length ?? 0;
  }

  return (
    <nav className="rail" aria-label="Servidores">
      <div className={`rail-item${view.kind === "discord" ? " active" : ""}`}>
        <span className="rail-pill" />
        <button className="rail-btn rail-discord" onClick={() => navigate({ kind: "discord" })} title="Discord">
          DC
        </button>
        {badge && <span className="rail-badge">{badge}</span>}
      </div>
      <div className={`rail-item${view.kind === "home" ? " active" : ""}`}>
        <span className="rail-pill" />
        <button
          className="rail-btn rail-home"
          onClick={() => navigate({ kind: "home", accountId: view.kind === "home" ? view.accountId : (accounts[0]?.id ?? null), dmId: null })}
          title="Início Distopic: amigos e mensagens diretas"
        >
          <Icon name="home" size={22} />
        </button>
        {homeMentions > 0 && <span className="rail-badge">{homeMentions}</span>}
      </div>
      <div className="rail-sep" />
      <div className="rail-scroll">
        {accounts.map((account) => {
          const inst = instances[account.id];
          return (
            <div key={account.id} className="rail-group" title={account.instanceName}>
              {inst?.status !== "ready" && (
                <div className={`rail-status rail-status-${inst?.status ?? "connecting"}`} title={`${account.instanceName}: ${inst?.status ?? "conectando"}`} />
              )}
              {inst?.servers.map((server) => <ServerIcon key={server.id} account={account} server={server} inst={inst} />)}
              {inst && inst.servers.length > 0 && <div className="rail-sep rail-sep-thin" />}
            </div>
          );
        })}
        <div className="rail-item">
          <button
            className="rail-btn rail-add"
            title="Adicionar servidor Distopic ou criar/entrar em um servidor"
            onClick={() =>
              setState((s) => {
                s.modal = accounts.length === 0 ? { kind: "addAccount" } : { kind: "createServer", accountId: accounts[0]!.id };
              })
            }
          >
            <Icon name="plus" size={22} />
          </button>
        </div>
      </div>
    </nav>
  );
}
