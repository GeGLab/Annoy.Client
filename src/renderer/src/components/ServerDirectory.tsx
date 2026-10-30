import { useEffect, useMemo, useState } from "react";
import { navigate, openServer, reconnect, resumeRecoveredView } from "../client.ts";
import { readRecoveryReturn } from "../chat-state.ts";
import { initials } from "../format.tsx";
import { useStore } from "../store.ts";
import { Icon, openModal } from "./ui.tsx";
import { Button } from "./ui/button.tsx";
import { Select } from "./ui/select.tsx";

const checkedLabel = (at: number | null) => at === null ? "horário indisponível"
  : new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(at);

export function ServerDirectory() {
  const accounts = useStore((s) => s.accounts);
  const instances = useStore((s) => s.instances);
  const [query, setQuery] = useState("");
  const [accountFilter, setAccountFilter] = useState("all");
  const normalized = query.trim().toLocaleLowerCase("pt-BR");
  useEffect(() => { document.getElementById("server-directory-title")?.focus(); }, []);
  const groups = useMemo(() => accounts
    .filter((account) => accountFilter === "all" || account.id === accountFilter)
    .map((account) => ({ account, instance: instances[account.id] }))
    .filter(({ account, instance }) => account.instanceName.toLocaleLowerCase("pt-BR").includes(normalized) ||
      (instance?.servers ?? []).some((server) => server.name.toLocaleLowerCase("pt-BR").includes(normalized)))
    .map(({ account, instance }) => ({
      account, instance,
      recoveryReturn: readRecoveryReturn(account.id),
      servers: account.instanceName.toLocaleLowerCase("pt-BR").includes(normalized) ? instance?.servers ?? []
        : (instance?.servers ?? []).filter((server) => server.name.toLocaleLowerCase("pt-BR").includes(normalized)),
    })), [accounts, instances, accountFilter, normalized]);
  const knownCount = groups.reduce((count, group) => count + group.servers.length, 0);

  return <section className="server-directory" aria-labelledby="server-directory-title">
    <header className="server-directory-header">
      <div><span className="eyebrow">Suas comunidades</span><h1 id="server-directory-title" tabIndex={-1}>Servidores</h1>
        <p>Comunidades disponíveis nas suas instâncias Annoy.</p></div>
      <Button variant="secondary" onClick={() => navigate({ kind: "home", accountId: accounts[0]?.id ?? null, dmId: null })}>
        <Icon name="home" size={16} />Mensagens diretas
      </Button>
    </header>
    <div className="server-directory-tools">
      <label className="server-directory-search"><Icon name="search" size={17} /><span className="sr-only">Buscar servidor ou instância</span>
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar servidores ou instâncias" />
      </label>
      <label className="server-directory-account">Instância
        <Select aria-label="Filtrar por instância" value={accountFilter} onChange={(event) => setAccountFilter(event.target.value)}>
          <option value="all">Todas as instâncias</option>
          {accounts.map((account) => <option key={account.id} value={account.id}>{account.instanceName}</option>)}
        </Select>
      </label>
      <span className="muted small" aria-live="polite">{knownCount} {knownCount === 1 ? "servidor" : "servidores"}</span>
    </div>
    {!accounts.length ? <div className="server-directory-empty">
      <Icon name="users" size={26} /><h2>Nenhuma instância conectada</h2>
      <p>Adicione uma conta Annoy para ver as comunidades disponíveis.</p>
      <Button onClick={() => openModal({ kind: "addAccount" })}>Adicionar conta</Button>
    </div> : !groups.length || (knownCount === 0 && groups.every(({ instance }) => instance?.status === "ready")) ? (
      <div className="server-directory-empty"><Icon name="search" size={26} />
        <h2>{normalized ? "Nenhum resultado" : "Nenhum servidor disponível"}</h2>
        <p>{normalized ? "Tente outro nome de servidor ou instância." : "As instâncias conectadas não disponibilizaram comunidades para estas contas."}</p>
      </div>
    ) : <div className="server-directory-groups">
      {groups.map(({ account, instance, recoveryReturn }) => {
        const ready = instance?.status === "ready";
        const invalid = instance?.status === "invalid";
        const servers = account.instanceName.toLocaleLowerCase("pt-BR").includes(normalized) ? instance?.servers ?? []
          : (instance?.servers ?? []).filter((server) => server.name.toLocaleLowerCase("pt-BR").includes(normalized));
        const awaiting = !servers.length && !instance?.serversObservedAt && !ready && !normalized;
        if (!servers.length && !awaiting && !recoveryReturn && (normalized || ready)) return null;
        const resumeServer = recoveryReturn?.kind === "server" ? instance?.servers.find((server) => server.id === recoveryReturn.serverId) : undefined;
        const resumeError = recoveryReturn?.kind === "server" ? instance?.serverLoadErrors[recoveryReturn.serverId] : undefined;
        return <section className="server-directory-group" key={account.id} aria-labelledby={`server-account-${account.id}`}>
          <header><div className="server-directory-instance-icon" aria-hidden="true">{initials(account.instanceName)}</div>
            <div className="server-directory-instance-copy"><h2 id={`server-account-${account.id}`}>{account.instanceName}</h2>
              <span className={`server-directory-status ${ready ? "ready" : invalid ? "invalid" : "offline"}`}>
                <span aria-hidden="true" />{ready ? "Conectado" : invalid ? "Sessão expirada" : "Desconectado"}
              </span>
            </div>
            {!ready && (invalid
              ? <Button variant="secondary" onClick={() => openModal({ kind: "addAccount", rememberedId: account.id })}>Entrar novamente</Button>
              : <Button variant="secondary" onClick={() => reconnect(account.id)}><Icon name="refresh" size={16} />Reconectar</Button>)}
            {ready && recoveryReturn && <Button variant="secondary" onClick={() => void resumeRecoveredView(account.id)}>
              <Icon name="left" size={16} />Voltar{resumeServer ? ` a ${resumeServer.name}` : recoveryReturn.kind === "home" ? " à conversa" : " ao espaço"}
            </Button>}
          </header>
          {resumeError && <p className="server-directory-no-results" role="alert">{resumeError}</p>}
          <p className="server-directory-freshness"><Icon name={ready ? "check" : "clock"} size={14} />
            {ready ? `Verificado ${checkedLabel(instance?.serversObservedAt ?? null)}` : `Última informação conhecida · ${checkedLabel(instance?.serversObservedAt ?? null)}`}
          </p>
          {awaiting ? <div className="server-directory-skeleton" role="status" aria-label="Carregando servidores"><span /><span /><span /></div> :
            servers.length ? <div className="server-directory-cards">{servers.map((server) => <button className="server-directory-card" key={server.id} onClick={() => void openServer(account.id, server.id)}>
              <span className="server-directory-avatar">{server.iconUrl ? <img src={server.iconUrl} alt="" /> : initials(server.name)}</span>
              <span className="server-directory-card-copy"><strong>{server.name}</strong><small>{ready ? "Disponibilidade confirmada" : "Disponibilidade não confirmada"}</small></span>
              <Icon name="right" size={17} />
            </button>)}</div> : <p className="server-directory-no-results">Nenhum servidor nesta instância corresponde à busca.</p>}
        </section>;
      })}
    </div>}
  </section>;
}
