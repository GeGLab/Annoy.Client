import {rich} from "../lib/localization.ts";
import {localizationPreferences} from "../../../shared/localization/index.ts";
import {t as translate,counted} from "../../../shared/localization/index.ts";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ServerSummary, ServerSummaryPage } from "@annoy/protocol";
import { apiFor, navigate, openServer, reconnect, resumeRecoveredView } from "../client.ts";
import { RequestError } from "../api.ts";
import { isCancellation } from "../../../shared/requests.ts";
import { readRecoveryReturn } from "../chat-state.ts";
import { initials } from "../format.tsx";
import { useStore } from "../store.ts";
import { Icon, openModal } from "./ui.tsx";
import { Button } from "./ui/button.tsx";
import { Select } from "./ui/select.tsx";

const checkedLabel = (at: number | null) => at === null ? translate("common.88bad3263261")
  : new Intl.DateTimeFormat(localizationPreferences().region, { dateStyle: "short", timeStyle: "short",hourCycle:localizationPreferences().hourCycle }).format(at);
type DirectoryPage = { servers: ServerSummary[]; cursor: string | null; total: number; loading: boolean; error: string | null; cached: boolean; key: string; term: string };
const SEARCH_DEBOUNCE_MS = 300;

export function ServerDirectory() {
  const accounts = useStore((s) => s.accounts);
  const instances = useStore((s) => s.instances);
  const annoySignedIn = useStore((s) => !!s.global);
  const vaultSync = useStore((s) => s.vaultSync);
  const [query, setQuery] = useState("");
  const [accountFilter, setAccountFilter] = useState("all");
  const [pages, setPages] = useState<Record<string, DirectoryPage>>({});
  const [normalized, setNormalized] = useState("");
  const inflight = useRef(new Map<string, { key: string; controller: AbortController }>());
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const connectionSignature = accounts.map((account) => `${account.id}:${instances[account.id]?.status ?? "none"}`).join("|");
  const summarySignature = accounts.map((account) => `${account.id}:${(instances[account.id]?.servers ?? []).map((server) => `${server.id}/${server.name}`).join(",")}`).join("|");
  useEffect(() => {
    const next = query.trim().toLocaleLowerCase(localizationPreferences().region);
    const timer = setTimeout(() => setNormalized(next), next ? SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => { document.getElementById("server-directory-title")?.focus(); }, []);
  useEffect(() => () => { for (const { controller } of inflight.current.values()) controller.abort(); inflight.current.clear(); }, []);

  // Each instance is its own server, so the instance filter only decides which servers are queried:
  // a page already fetched for the same term and server state is reused instead of requested again.
  useEffect(() => {
    const region = localizationPreferences().region;
    const candidates = accounts.filter((account) => accountFilter === "all" || account.id === accountFilter);
    const wanted = new Map(candidates.map((account) => {
      const instance = instances[account.id];
      const term = normalized && !account.instanceName.toLocaleLowerCase(region).includes(normalized) ? normalized : "";
      const serverSignature = (instance?.servers ?? []).map((server) => `${server.id}/${server.name}`).join(",");
      return [account.id, { account, term, key: `${term}\u0000${instance?.status ?? "none"}\u0000${serverSignature}` }];
    }));
    for (const [accountId, request] of inflight.current) {
      if (wanted.get(accountId)?.key === request.key) continue;
      request.controller.abort();
      inflight.current.delete(accountId);
    }
    for (const { account, term, key } of wanted.values()) {
      if (inflight.current.get(account.id)?.key === key) continue;
      const existing = pagesRef.current[account.id];
      if (existing && existing.key === key && !existing.loading) continue;
      const instance = instances[account.id];
      const fromCache = (error: string | null): DirectoryPage => {
        const cached = (instance?.servers ?? []).filter((server) => !term || server.name.toLocaleLowerCase(region).includes(term));
        return { servers: cached.slice(0, 50), cursor: cached.length > 50 ? "50" : null, total: cached.length, loading: false, error, cached: true, key, term };
      };
      if (instance?.status !== "ready") { setPages((current) => ({ ...current, [account.id]: fromCache(null) })); continue; }
      const controller = new AbortController();
      inflight.current.set(account.id, { key, controller });
      setPages((current) => ({ ...current, [account.id]: { servers: [], cursor: null, total: 0, error: null, cached: false, key, term, loading: true } }));
      const settle = (page: DirectoryPage) => {
        if (controller.signal.aborted) return;
        inflight.current.delete(account.id);
        setPages((current) => ({ ...current, [account.id]: page }));
      };
      void (async () => {
        try {
          const page = await apiFor(account.id).get<ServerSummaryPage>(`/servers?${new URLSearchParams({ limit: "50", q: term })}`, controller.signal);
          if (!Array.isArray(page?.servers) || typeof page.total !== "number") throw new Error(translate("common.eab1543a1723"));
          settle({ servers: page.servers, cursor: page.nextCursor, total: page.total, loading: false, error: null, cached: false, key, term });
        } catch (reason) {
          if (controller.signal.aborted || isCancellation(reason)) return;
          settle(fromCache(reason instanceof RequestError && reason.status === 404 ? null : (reason as Error).message));
        }
      })();
    }
  }, [accounts, accountFilter, normalized, connectionSignature, summarySignature]);

  const groups = useMemo(() => accounts
    .filter((account) => accountFilter === "all" || account.id === accountFilter)
    .map((account) => ({ account, instance: instances[account.id], page: pages[account.id], recoveryReturn: readRecoveryReturn(account.id) }))
    .filter(({ account, page, recoveryReturn }) => account.instanceName.toLocaleLowerCase(localizationPreferences().region).includes(normalized) || (page?.servers.length ?? 0) > 0 || page?.loading || !!recoveryReturn),
  [accounts, instances, pages, accountFilter, normalized]);
  const knownCount = groups.reduce((count, group) => count + (group.page?.total ?? 0), 0);

  const loadMore = async (accountId: string) => {
    const current = pages[accountId];
    if (!current?.cursor || current.loading || inflight.current.has(accountId)) return;
    const instance = instances[accountId];
    const { key, term } = current;
    const stillCurrent = () => pagesRef.current[accountId]?.key === key;
    setPages((value) => ({ ...value, [accountId]: { ...current, loading: true, error: null } }));
    try {
      if (instance?.status === "ready" && !current.cached) {
        const next = await apiFor(accountId).get<ServerSummaryPage>(`/servers?${new URLSearchParams({ limit: "50", after: current.cursor, q: term })}`);
        if (!stillCurrent()) return;
        setPages((value) => ({ ...value, [accountId]: { servers: [...(value[accountId]?.servers ?? []), ...next.servers], cursor: next.nextCursor, total: next.total, loading: false, error: null, cached: false, key, term } }));
      } else {
        const all = (instance?.servers ?? []).filter((server) => !term || server.name.toLocaleLowerCase(localizationPreferences().region).includes(term));
        const offset = Number(current.cursor);
        const next = all.slice(offset, offset + 50);
        const nextOffset = offset + next.length;
        setPages((value) => ({ ...value, [accountId]: { servers: [...(value[accountId]?.servers ?? []), ...next], cursor: nextOffset < all.length ? String(nextOffset) : null, total: all.length, loading: false, error: null, cached: true, key, term } }));
      }
    } catch (reason) {
      if (stillCurrent()) setPages((value) => ({ ...value, [accountId]: { ...current, loading: false, error: (reason as Error).message } }));
    }
  };

  return <section className="server-directory" aria-labelledby="server-directory-title">
    <header className="server-directory-header">
      <div><span className="eyebrow">{translate("common.1471b88bbb29")}</span><h1 id="server-directory-title" tabIndex={-1}>{translate("common.c1158df03518")}</h1>
        <p>{translate("common.0e457eca5933")}</p></div>
      <Button variant="secondary" onClick={() => navigate({ kind: "home", accountId: accounts[0]?.id ?? null, dmId: null })}>{rich("common.81f329048e3d",{p0:(<Icon name="home" size={16} />)})}</Button>
    </header>
    <div className="server-directory-tools">
      <label className="server-directory-search"><Icon name="search" size={17} /><span className="sr-only">{translate("common.b408dd0fad7b")}</span>
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={translate("common.f9b06fce2da3")} />
      </label>
      <label className="server-directory-account">{translate("common.c641bdc857f2")}<Select aria-label={translate("common.de7db69257b7")} value={accountFilter} onChange={(event) => setAccountFilter(event.target.value)}>
          <option value="all">{translate("common.3a97741f2fef")}</option>
          {accounts.map((account) => <option key={account.id} value={account.id}>{account.instanceName}</option>)}
        </Select>
      </label>
      <span className="muted small" aria-live="polite">{counted(knownCount,"counts.server.one","counts.server.other")}</span>
    </div>
    {!accounts.length && annoySignedIn && vaultSync !== "done" ? <div className="server-directory-empty" role="status">
      <Icon name="refresh" size={26} /><h2>{translate("servers.syncing")}</h2>
      <p>{translate(vaultSync === "retrying" ? "servers.syncRetrying" : "servers.syncingHint")}</p>
    </div> : !accounts.length ? <div className="server-directory-empty">
      <Icon name="users" size={26} /><h2>{translate("common.71e2f935e297")}</h2>
      <p>{translate("common.443b1939fc84")}</p>
      <Button onClick={() => openModal({ kind: "addAccount" })}>{translate("common.11cf7643fb7e")}</Button>
    </div> : groups.length === 0 || (groups.every(({ page }) => !page?.loading) && knownCount === 0) ? (
      <div className="server-directory-empty"><Icon name="search" size={26} />
        <h2>{normalized ? translate("expression.4410f3299961") : translate("common.c136e23df880")}</h2>
        <p>{normalized ? translate("common.2159c612d6b0") : translate("common.45242c572011")}</p>
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
              <span className={`server-directory-status ${ready ? "ready" : invalid ? "invalid" : "offline"}`}><span aria-hidden="true" />{ready ? translate("common.7444e37ea660") : invalid ? translate("common.69883ff8a543") : translate("common.879b012449c1")}</span>
            </div>
            {!ready && (invalid
              ? <Button variant="secondary" onClick={() => openModal({ kind: "addAccount", rememberedId: account.id })}>{translate("common.05d410b61f11")}</Button>
              : <Button variant="secondary" onClick={() => reconnect(account.id)}>{rich("common.7c87f7d3a1c8",{p0:(<Icon name="refresh" size={16} />)})}</Button>)}
            {ready && recoveryReturn && <Button variant="secondary" onClick={() => void resumeRecoveredView(account.id)}>{rich("common.dcb5610cefb3",{p0:(<Icon name="left" size={16} />),p1:(resumeServer ? ` a ${resumeServer.name}` : recoveryReturn.kind === "home" ? translate("common.6f9369b08e82") : translate("common.c4e831d91b82"))})}</Button>}
          </header>
          {resumeError && <p className="server-directory-no-results" role="alert">{resumeError}</p>}
          {page?.error && <p className="server-directory-no-results" role="alert">{rich("common.4fde0860898a",{p0:(page.error)})}</p>}
          <p className="server-directory-freshness"><Icon name={ready ? "check" : "clock"} size={14} />
            {ready && !page?.cached ? translate("common.5433ece37ba2",{p0:(checkedLabel(instance?.serversObservedAt ?? null))}) : translate("common.120413bc8326",{p0:(checkedLabel(instance?.serversObservedAt ?? null))})}
            {page?.cached ? translate("common.a5d5aede1a0c") : ""}
          </p>
          {awaiting ? <div className="server-directory-skeleton" role="status" aria-label={translate("common.e12549431de7")}><span /><span /><span /></div> :
            servers.length ? <><div className="server-directory-cards">{servers.map((server) => <button className="server-directory-card" key={server.id} onClick={() => void openServer(account.id, server.id)}>
              <span className="server-directory-avatar">{server.iconUrl ? <img src={server.iconUrl} alt="" /> : initials(server.name)}</span>
              <span className="server-directory-card-copy"><strong>{server.name}</strong><small>{ready ? translate("common.b093850c7839") : translate("common.d8fb58e618d8")}</small></span><Icon name="right" size={17} />
            </button>)}</div>
            {page?.cursor && <Button className="server-directory-more" variant="secondary" disabled={page.loading} onClick={() => void loadMore(account.id)}>{page.loading ? translate("common.6cc1bbba0f84") : translate("common.3298a7dab87a",{p0:(Math.max(0, page.total - servers.length))})}</Button>}</>
              : <p className="server-directory-no-results">{translate("common.e0365f8a1ebe")}</p>}
        </section>;
      })}
    </div>}
  </section>;
}




