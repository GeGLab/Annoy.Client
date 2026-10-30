import { useRef, useState } from "react";
import { Search, SlidersHorizontal, FileSearch, ArrowUpRight } from "lucide-react";
import type { MessageSearchPage } from "@distopic/protocol";
import { apiFor, jumpToMessage } from "../../client.ts";
import { useStore } from "../../store.ts";
import { Modal, Avatar, Field } from "../../components/ui.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Input } from "../../components/ui/input.tsx";
import { Select } from "../../components/ui/select.tsx";
import { DatePicker } from "../../components/ui/date-picker.tsx";
import { useRequestOwner } from "../../lib/use-request-owner.ts";
import { isCancellation } from "../../../../shared/requests.ts";
export default function SearchDialog({ accountId, serverId, channelId }: { accountId: string; serverId?: string; channelId?: string }) {
  const requests = useRequestOwner(JSON.stringify([accountId, serverId]));
  const pending = useRef<AbortController | null>(null);
  const instance = useStore((s) => s.instances[accountId]);
  const [query, setQuery] = useState("");
  const [channel, setChannel] = useState(channelId ?? "");
  const [author, setAuthor] = useState("");
  const [has, setHas] = useState("");
  const [before, setBefore] = useState("");
  const [after, setAfter] = useState("");
  const [filters, setFilters] = useState(false);
  const [results, setResults] = useState<MessageSearchPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const generation = useRef(0);
  const lastParams = useRef("");
  const channels = serverId ? (instance?.serverStates[serverId]?.channels.filter((c) => c.type === "text") ?? []) : [];
  const members = serverId
    ? (instance?.serverStates[serverId]?.members.map((m) => m.user) ?? [])
    : (instance?.relationships.filter((r) => r.status === "friend").map((r) => r.user) ?? []);
  const search = async (more = false) => {
    pending.current?.abort();
    pending.current = new AbortController();
    const signal = AbortSignal.any([pending.current.signal, requests.signal]);
    const current = ++generation.current;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ q: query });
    if (serverId) params.set("serverId", serverId);
    if (channel) params.set("channelId", channel);
    if (author) params.set("authorId", author);
    if (has) params.set("has", has);
    if (before) params.set("before", before);
    if (after) params.set("after", after);
    if (more && results?.nextCursor) params.set("cursor", results.nextCursor);
    else {
      lastParams.current = params.toString();
      setResults(null);
    }
    try {
      const page = await apiFor(accountId).get<MessageSearchPage>(
        `/search/messages?${more ? lastParams.current + `&cursor=${encodeURIComponent(results!.nextCursor!)}` : params}`,
        signal,
      );
      if (signal.aborted || current !== generation.current) return;
      setResults((previous) => (more ? { ...page, items: [...(previous?.items ?? []), ...page.items] } : page));
    } catch (error) {
      if (current === generation.current && !isCancellation(error))
        setError(
          (error as { status?: number }).status === 404
            ? "Atualize esta instância para habilitar a busca de mensagens."
            : (error as Error).message,
        );
    } finally {
      if (current === generation.current) setLoading(false);
    }
  };
  return (
    <Modal
      title={serverId ? `Buscar em ${instance?.serverStates[serverId]?.server.name ?? "servidor"}` : "Buscar mensagens"}
      wide
      className="search-modal"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <div className="search-query">
          <Search size={20} />
          <Input
            aria-label="Buscar mensagens"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="O que você quer encontrar?"
            autoFocus
            maxLength={200}
          />
          <Button loading={loading} type="submit">
            Buscar
          </Button>
        </div>
        <div className="search-scope">
          <span>{serverId ? "Canais que você pode acessar" : "Seus canais e mensagens diretas nesta instância"}</span>
          <Button size="sm" variant="ghost" onClick={() => setFilters((v) => !v)} aria-expanded={filters}>
            <SlidersHorizontal size={15} />
            Filtros
          </Button>
        </div>
        {filters && (
          <div className="search-filters">
            {channels.length > 0 && (
              <Field label="No canal">
                <Select value={channel} onChange={(e) => setChannel(e.target.value)}>
                  <option value="">Todos os canais</option>
                  {channels.map((c) => (
                    <option value={c.id} key={c.id}>
                      #{c.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label="Enviada por">
              <Select value={author} onChange={(e) => setAuthor(e.target.value)}>
                <option value="">Qualquer pessoa</option>
                {members.map((u) => (
                  <option value={u.id} key={u.id}>
                    {u.displayName} (@{u.username})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Contém">
              <Select value={has} onChange={(e) => setHas(e.target.value)}>
                <option value="">Qualquer conteúdo</option>
                {[
                  ["image", "Imagem"],
                  ["video", "Vídeo"],
                  ["audio", "Áudio"],
                  ["file", "Anexo"],
                  ["link", "Link"],
                ].map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Depois de">
              <DatePicker label="Depois de" value={after} onValueChange={setAfter} />
            </Field>
            <Field label="Antes de">
              <DatePicker label="Antes de" value={before} onValueChange={setBefore} />
            </Field>
          </div>
        )}
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="search-results" aria-busy={loading}>
        {results?.items.map(({ message, channelName, serverId: resultServer }) => (
          <button
            className="search-result"
            key={message.id}
            disabled={!!opening}
            onClick={() => {
              setOpening(message.id);
              setError(null);
              void jumpToMessage(accountId, message.channelId, message.id, resultServer, requests.signal).catch((error) => {
                setOpening(null);
                if (!isCancellation(error)) setError((error as Error).message);
              });
            }}
          >
            <Avatar user={message.author} size={32} />
            <div>
              <header>
                <strong>{message.author.displayName}</strong>
                <time>{new Date(message.createdAt).toLocaleString("pt-BR")}</time>
              </header>
              <p>{message.content || `${message.attachments.length} anexo(s)`}</p>
              <small>
                {resultServer ? `#${channelName}` : "Mensagem direta"}
                {message.attachments.length > 0 ? ` · ${message.attachments.length} anexo(s)` : ""}
              </small>
            </div>
            <ArrowUpRight size={17} />
          </button>
        ))}
        {loading && (
          <p role="status" className="muted">
            Buscando mensagens…
          </p>
        )}
        {results?.items.length === 0 && !loading && (
          <div className="search-empty">
            <FileSearch size={32} />
            <h3>Nenhuma mensagem encontrada</h3>
            <p>Tente outra palavra ou amplie os filtros.</p>
          </div>
        )}
        {!results && !loading && !error && (
          <div className="search-empty">
            <Search size={32} />
            <h3>Encontre o trecho da conversa</h3>
            <p>Busque por palavras ou use filtros de pessoa, canal, data e anexos.</p>
          </div>
        )}
        {results?.nextCursor && (
          <Button variant="secondary" loading={loading} onClick={() => void search(true)}>
            Mais resultados
          </Button>
        )}
      </div>
    </Modal>
  );
}
