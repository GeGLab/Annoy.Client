import { useEffect, useMemo, useState } from "react";
import type { ServerSummary, ServerSummaryPage } from "@distopic/protocol";
import { apiFor, navigate, openServer, reconnect, resumeRecoveredView } from "../client.ts";
import { RequestError } from "../api.ts";
import { isCancellation } from "../../../shared/requests.ts";
import { readRecoveryReturn } from "../chat-state.ts";
import { initials } from "../format.tsx";
import { useStore } from "../store.ts";
import { Icon, openModal } from "./ui.tsx";
import { Button } from "./ui/button.tsx";
import { Select } from "./ui/select.tsx";

const checkedLabel = (at: number | null) => at === null ? "horário indisponível"
  : new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(at);
type DirectoryPage = { servers: ServerSummary[]; cursor: string | null; total: number; loading: boolean; error: string | null; cached: boolean };

export function ServerDirectory() {
  const accounts = useStore((s) => s.accounts);
  const instances = useStore((s) => s.instances);
  const [query, setQuery] = useState("");
  const [accountFilter, setAccountFilter] = useState("all");
  const [pages, setPages] = useState<Record<string, DirectoryPage>>({});
  const normalized = query.trim().toLocaleLowerCase("pt-BR");
  const connectionSignature = accounts.map((account) => `${account.id}:${instances[account.id]?.status ?? "none"}`).join("|");
  const summarySignature = accounts.map((account) => `${account.id}:${(instances[account.id]?.servers ?? []).map((server) => `${server.id}/${server.name}`).join(",")}`).join("|");
  useEffect(() => { document.getElementById("server-directory-title")?.focus(); }, []);

  useEffect(() => {
    const controller = new AbortController();
    const candidates = accounts.filter((account) => accountFilter === "all" || account.id === accountFilter);
    setPages(Object.fromEntries(candidates.map((account) => [account.id, { servers: [], cursor: null, total: 0, loading: true, error: null, cached: false }])));
    void Promise.all(candidates.map(async (account) => {
      const instance = instances[account.id];
      const accountMatches = account.instanceName.toLocaleLowerCase("pt-BR").includes(normalized);
      const term = normalized && !accountMatches ? normalized : "";
      if (instance?.status === "ready") {
        const params = new URLSearchParams({ limit: "50", q: term });
        try {
          const page = await apiFor(account.id).get<ServerSummaryPage>(`/servers?${params}`, controller.signal);
          if (!Array.isArray(page?.servers) || typeof page.total !== "number") throw new Error("A instância não retornou uma página de servidores válida.");
          if (!controller.signal.aborted) setPages((current) => ({ ...current, [account.id]: { servers: page.servers, cursor: page.nextCursor, total: page.total, loading: false, error: null, cached: false } }));
          return;
        } catch (reason) {
          if (controller.signal.aborted || isCancellation(reason)) return;
          if (!(reason instanceof RequestError) || reason.status !== 404) {
            const cached = instance.servers.filter((server) => !term || server.name.toLocaleLowerCase("pt-BR").includes(term));
            setPages((current) => ({ ...current, [account.id]: { servers: cached.slice(0, 50), cursor: cached.length > 50 ? "50" : null, total: cached.length, loading: false, error: (reason as Error).message, cached: true } }));
            return;
          }
        }
      }
      const cached = (instance?.servers ?? []).filter((server) => !term || server.name.toLocaleLowerCase("pt-BR").includes(term));
      if (!controller.signal.aborted) setPages((current) => ({ ...current, [account.id]: { servers: cached.slice(0, 50), cursor: cached.length > 50 ? "50" : null, total: cached.length, loading: false, error: null, cached: true } }));
    }));
    return () => controller.abort();
  }, [accounts, accountFilter, normalized, connectionSignature, summarySignature]);

  const groups = useMemo(() => accounts
    .filter((account) => accountFilter === "all" || account.id === accountFilter)
    .map((account) => ({ account, instance: instances[account.id], page: pages[account.id], recoveryReturn: readRecoveryReturn(account.id) }))
    .filter(({ account, page, recoveryReturn }) => account.instanceName.toLocaleLowerCase("pt-BR").includes(normalized) || (page?.servers.length ?? 0) > 0 || page?.loading || !!recoveryReturn),
  [accounts, instances, pages, accountFilter, normalized]);
  const knownCount = groups.reduce((count, group) => count + (group.page?.total ?? 0), 0);

  const loadMore = async (accountId: string) => {
    const current = pages[accountId];
    if (!current?.cursor || current.loading) return;
    const account = accounts.find((item) => item.id === accountId);
    if (!account) return;
    const instance = instances[accountId];
    setPages((value) => ({ ...value, [accountId]: { ...current, loading: true, error: null } }));
    try {
      if (instance?.status === "ready" && !current.cached) {
        const params = new URLSearchParams({ limit: "50", after: current.cursor, q: normalized && !account.instanceName.toLocaleLowerCase("pt-BR").includes(normalized) ? normalized : "" });
        const next = await apiFor(accountId).get<ServerSummaryPage>(`/servers?${params}`);
        setPages((value) => ({ ...value, [accountId]: { servers: [...(value[accountId]?.servers ?? []), ...next.servers], cursor: next.nextCursor, total: next.total, loading: false, error: null, cached: false } }));
      } else {
        const term = normalized && !account.instanceName.toLocaleLowerCase("pt-BR").includes(normalized) ? normalized : "";
        const all = (instance?.servers ?? []).filter((server) => !term || server.name.toLocaleLowerCase("pt-BR").includes(term));
        const offset = Number(current.cursor);
        const next = all.slice(offset, offset + 50);
        const nextOffset = offset + next.length;
        setPages((value) => ({ ...value, [accountId]: { servers: [...(value[accountId]?.servers ?? []), ...next], cursor: nextOffset < all.length ? String(nextOffset) : null, total: all.length, loading: false, error: null, cached: true } }));
      }
    } catch (reason) {
      setPages((value) => ({ ...value, [accountId]: { ...current, loading: false, error: (reason as Error).message } }));
    }
  };

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
    </div> : groups.length === 0 || (groups.every(({ page }) => !page?.loading) && knownCount === 0) ? (
      <div className="server-directory-empty"><Icon name="search" size={26} />
        <h2>{normalized ? "Nenhum resultado" : "Nenhum servidor disponível"}</h2>
        <p>{normalized ? "Tente outro nome de servidor ou instância." : "As instâncias conectadas não disponibilizaram comunidades para estas contas."}</p>
      </div>
    ) : <div className="server-directory-groups">
      {groups.map(({ account, instance, page, recoveryReturn }) => {
        const ready = instance?.status === "ready";
        const invalid = instance?.status === "invalid";
        const servers = page?.servers ?? [];
        const awaiting = !!page?.loading && !servers.length && !recoveryReturn;
        const resumeServer = recoveryReturn?.kind === "server" ? instance?.servers.find((server) => server.id === recoveryReturn.serverId) : undefined;
        const resumeError = recoveryReturn?.kind === "server" ? instance?.serverLoadErrors[recoveryReturn.serverId] : undefined;
        return <section className="server-directory-group" key={account.id} aria-labelledby={`server-account-${account.id}`}>
          <header><div className="server-directory-instance-icon" aria-hidden="true">{initials(account.instanceName)}</div>
            <div className="server-directory-instance-copy"><h2 id={`server-account-${account.id}`}>{account.instanceName}</h2>
              <span className={`server-directory-status ${ready ? "ready" : invalid ? "invalid" : "offline"}`}><span aria-hidden="true" />{ready ? "Conectado" : invalid ? "Sessão expirada" : "Desconectado"}</span>
            </div>
            {!ready && (invalid
              ? <Button variant="secondary" onClick={() => openModal({ kind: "addAccount", rememberedId: account.id })}>Entrar novamente</Button>
              : <Button variant="secondary" onClick={() => reconnect(account.id)}><Icon name="refresh" size={16} />Reconectar</Button>)}
            {ready && recoveryReturn && <Button variant="secondary" onClick={() => void resumeRecoveredView(account.id)}><Icon name="left" size={16} />Voltar{resumeServer ? ` a ${resumeServer.name}` : recoveryReturn.kind === "home" ? " à conversa" : " ao espaço"}</Button>}
          </header>
          {resumeError && <p className="server-directory-no-results" role="alert">{resumeError}</p>}
          {page?.error && <p className="server-directory-no-results" role="alert">Não foi possível atualizar a lista: {page.error}</p>}
          <p className="server-directory-freshness"><Icon name={ready ? "check" : "clock"} size={14} />
            {ready && !page?.cached ? `Verificado ${checkedLabel(instance?.serversObservedAt ?? null)}` : `Última informação conhecida · ${checkedLabel(instance?.serversObservedAt ?? null)}`}
            {page?.cached ? " · cache local" : ""}
          </p>
          {awaiting ? <div className="server-directory-skeleton" role="status" aria-label="Carregando servidores"><span /><span /><span /></div> :
            servers.length ? <><div className="server-directory-cards">{servers.map((server) => <button className="server-directory-card" key={server.id} onClick={() => void openServer(account.id, server.id)}>
              <span className="server-directory-avatar">{server.iconUrl ? <img src={server.iconUrl} alt="" /> : initials(server.name)}</span>
              <span className="server-directory-card-copy"><strong>{server.name}</strong><small>{ready ? "Disponibilidade confirmada" : "Disponibilidade não confirmada"}</small></span><Icon name="right" size={17} />
            </button>)}</div>
            {page?.cursor && <Button className="server-directory-more" variant="secondary" disabled={page.loading} onClick={() => void loadMore(account.id)}>{page.loading ? "Carregando…" : `Carregar mais (${Math.max(0, page.total - servers.length)} restantes)`}</Button>}</>
              : <p className="server-directory-no-results">Nenhum servidor nesta instância corresponde à busca.</p>}
        </section>;
      })}
    </div>}
  </section>;
}
