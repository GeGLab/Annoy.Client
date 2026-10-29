import { Select } from "../../components/ui/select.tsx";
import { useMemo, useState } from "react";
import { apiFor, navigate } from "../../client.ts";
import { useStore } from "../../store.ts";
import { openModal, Icon } from "../../components/ui.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Input } from "../../components/ui/input.tsx";
import { Dialog, DialogContent, DialogTitle } from "../../components/ui/dialog.tsx";
import { ChatSkeleton } from "../../components/ui/skeleton.tsx";
import { installBot, setBotEnabled, uninstallBot } from "./api.ts";
import { useBotPlatform } from "./useBotPlatform.ts";
import { BOT_PERMISSIONS, type BotInstallation, type BotListing } from "./types.ts";

const runtimeLabels = { starting: "Iniciando", running: "Em execução", stopped: "Parado", error: "Falha na execução" };

function BotServer({ accountId, serverId }: { accountId: string; serverId: string }) {
  const { snapshot, status, error, busy, refresh, run } = useBotPlatform(accountId, serverId);
  const [tab, setTab] = useState<"catalog" | "installed">("catalog");
  const [query, setQuery] = useState("");
  const [confirmation, setConfirmation] = useState<
    { kind: "install"; bot: BotListing } | { kind: "uninstall"; installation: BotInstallation; name: string } | null
  >(null);
  const installed = useMemo(() => new Map(snapshot?.installations.map((i) => [i.botId, i]) ?? []), [snapshot]);
  const names = useMemo(() => new Map(snapshot?.bots.map((b) => [b.id, b]) ?? []), [snapshot]);
  const normalized = query.trim().toLocaleLowerCase("pt-BR");
  if (status === "loading") return <ChatSkeleton />;
  if (status === "unsupported")
    return (
      <div className="bot-platform-empty">
        <Icon name="bot" size={44} />
        <h2>A loja precisa do suporte da sua instância</h2>
        <p>
          Este servidor ainda não oferece instalação e execução de bots Annoy. Quem hospeda a instância precisa habilitar a plataforma
          antes de você instalar um bot.
        </p>
        <p className="muted">
          Bots existentes do Discord precisam ser adaptados para funcionar aqui. Seus bots e servidores do Discord continuam disponíveis na
          aba Discord.
        </p>
        <Button variant="secondary" onClick={() => void refresh()}>
          <Icon name="refresh" size={16} />
          Verificar novamente
        </Button>
      </div>
    );
  if (!snapshot)
    return (
      <div className="bot-platform-empty">
        <Icon name="wifiOff" size={36} />
        <h2>Não foi possível abrir a loja</h2>
        <p role="alert">{error}</p>
        <Button variant="secondary" onClick={() => void refresh()}>
          Tentar novamente
        </Button>
      </div>
    );
  const catalog = snapshot.bots.filter((bot) =>
    `${bot.name} ${bot.description} ${bot.author}`.toLocaleLowerCase("pt-BR").includes(normalized),
  );
  const installations = snapshot.installations.filter((i) =>
    `${names.get(i.botId)?.name ?? i.botId}`.toLocaleLowerCase("pt-BR").includes(normalized),
  );
  const canManage = snapshot.canManage && status === "ready";
  const confirm = async () => {
    if (!confirmation || busy || !canManage) return;
    const selected = confirmation;
    const api = apiFor(accountId);
    const ok = await run(selected.kind === "install" ? selected.bot.id : selected.installation.id, () =>
      selected.kind === "install" ? installBot(api, serverId, selected.bot) : uninstallBot(api, serverId, selected.installation.id),
    );
    if (ok) setConfirmation(null);
  };
  return (
    <>
      <div className="bot-toolbar">
        <div
          className="tabs inline"
          role="tablist"
          aria-label="Bots do servidor"
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === "Home" ? "catalog" : event.key === "End" ? "installed" : tab === "catalog" ? "installed" : "catalog";
            setTab(next);
            event.currentTarget.querySelector<HTMLButtonElement>(`#bots-tab-${next}`)?.focus();
          }}
        >
          <button
            className={`tab${tab === "catalog" ? " active" : ""}`}
            role="tab"
            id="bots-tab-catalog"
            aria-controls="bots-tab-panel"
            tabIndex={tab === "catalog" ? 0 : -1}
            aria-selected={tab === "catalog"}
            onClick={() => setTab("catalog")}
          >
            Explorar
          </button>
          <button
            className={`tab${tab === "installed" ? " active" : ""}`}
            role="tab"
            id="bots-tab-installed"
            aria-controls="bots-tab-panel"
            tabIndex={tab === "installed" ? 0 : -1}
            aria-selected={tab === "installed"}
            onClick={() => setTab("installed")}
          >
            Instalados <span className="bot-count">{snapshot.installations.length}</span>
          </button>
        </div>
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar bots" aria-label="Buscar bots" />
        <Button variant="ghost" size="icon" disabled={!!busy} onClick={() => void refresh()} aria-label="Atualizar bots">
          <Icon name="refresh" size={17} />
        </Button>
      </div>
      <div className="bot-page-content" id="bots-tab-panel" role="tabpanel" aria-labelledby={`bots-tab-${tab}`} tabIndex={0}>
        <div className="bot-intro">
          <h2>{tab === "catalog" ? "Mais possibilidades para a sua comunidade." : "Os bots deste servidor."}</h2>
          <p>
            {tab === "catalog"
              ? "Explore os bots publicados pela sua instância e revise as permissões antes de instalar."
              : "Desativar mantém a instalação. Remover desinstala o bot deste servidor."}
          </p>
        </div>
        {!snapshot.canManage && (
          <p className="bot-notice">
            <Icon name="lock" size={16} />
            Você pode consultar a loja. Para alterar bots, peça permissão a quem administra o servidor.
          </p>
        )}
        {error && (
          <p className="error bot-error" role="alert">
            {error}
            <button onClick={() => void refresh()}>Atualizar estado</button>
          </p>
        )}
        {tab === "catalog" ? (
          catalog.length ? (
            <div className="bot-catalog">
              {catalog.map((bot) => (
                <article className="bot-listing" key={bot.id}>
                  <div className="bot-listing-heading">
                    <span className="bot-avatar">
                      <Icon name="bot" size={27} />
                    </span>
                    <div>
                      <h3>{bot.name}</h3>
                      <span className="muted small">
                        {bot.author} · v{bot.version}
                      </span>
                    </div>
                  </div>
                  <p>{bot.description}</p>
                  <span className="bot-permission-count">{bot.permissions.length} permissões solicitadas</span>
                  <Button
                    variant={installed.has(bot.id) ? "secondary" : "default"}
                    disabled={!canManage || !!busy || installed.has(bot.id)}
                    onClick={() => setConfirmation({ kind: "install", bot })}
                  >
                    {installed.has(bot.id) ? "Instalado" : "Revisar e instalar"}
                  </Button>
                </article>
              ))}
            </div>
          ) : (
            <div className="bot-list-empty">
              <h3>{query ? "Nenhum bot encontrado" : "O catálogo ainda está vazio"}</h3>
              <p className="muted">{query ? "Tente outro nome ou limpe a busca." : "Os bots publicados pela instância aparecerão aqui."}</p>
            </div>
          )
        ) : installations.length ? (
          <div className="installed-bots">
            {installations.map((installation) => {
              const bot = names.get(installation.botId);
              return (
                <article className="installed-bot" key={installation.id}>
                  <span className="bot-avatar">
                    <Icon name="bot" size={25} />
                  </span>
                  <div className="installed-bot-info">
                    <h3>{bot?.name ?? installation.botId}</h3>
                    <span className={`bot-runtime ${installation.enabled ? installation.runtimeStatus : "disabled"}`}>
                      {!installation.enabled ? "Desativado" : runtimeLabels[installation.runtimeStatus]} · v{installation.version}
                    </span>
                    {installation.lastError && <p className="error small">{installation.lastError}</p>}
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={busy === installation.id}
                    disabled={!canManage || !!busy}
                    onClick={() =>
                      void run(installation.id, () => setBotEnabled(apiFor(accountId), serverId, installation.id, !installation.enabled))
                    }
                  >
                    {installation.enabled ? "Desativar" : "Ativar"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remover ${bot?.name ?? installation.botId}`}
                    disabled={!canManage || !!busy}
                    onClick={() => setConfirmation({ kind: "uninstall", installation, name: bot?.name ?? installation.botId })}
                  >
                    <Icon name="trash" size={17} />
                  </Button>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="bot-list-empty">
            <Icon name="bot" size={36} />
            <h3>{query ? "Nenhum bot encontrado" : "Seu primeiro bot começa na loja"}</h3>
            <p className="muted">{query ? "Tente outro nome." : "Explore o catálogo para adicionar um bot ao servidor."}</p>
            {!query && (
              <Button variant="secondary" onClick={() => setTab("catalog")}>
                Explorar bots
              </Button>
            )}
          </div>
        )}
      </div>
      {confirmation && (
        <Dialog open onOpenChange={(open) => !open && !busy && setConfirmation(null)}>
          <DialogContent className="modal bot-confirmation" showClose={false} aria-describedby="bot-confirm-description">
            <div className="modal-body">
              <DialogTitle asChild>
                <h2>{confirmation.kind === "install" ? `Instalar ${confirmation.bot.name}?` : `Remover ${confirmation.name}?`}</h2>
              </DialogTitle>
              {confirmation.kind === "install" ? (
                <>
                  <p id="bot-confirm-description" className="muted">
                    {confirmation.bot.author} · v{confirmation.bot.version}. O bot será executado pela instância e terá estas permissões
                    neste servidor:
                  </p>
                  <ul className="bot-permissions">
                    {confirmation.bot.permissions.map((permission) => (
                      <li key={permission}>
                        <Icon name="shield" size={16} />
                        {BOT_PERMISSIONS[permission]}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p id="bot-confirm-description" className="muted">
                  O bot será interrompido e sua instalação será removida deste servidor. Para apenas pausar o funcionamento, use Desativar.
                </p>
              )}
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              {status === "error" && (
                <Button variant="secondary" size="sm" disabled={!!busy} onClick={() => void refresh()}>
                  Atualizar estado
                </Button>
              )}
              <div className="form-actions">
                <Button variant="secondary" disabled={!!busy} onClick={() => setConfirmation(null)}>
                  Cancelar
                </Button>
                <Button
                  variant={confirmation.kind === "uninstall" ? "destructive" : "default"}
                  disabled={!canManage}
                  loading={!!busy}
                  onClick={() => void confirm()}
                >
                  {confirmation.kind === "install" ? "Autorizar e instalar" : "Remover bot"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

export default function Marketplace({ accountId, serverId }: { accountId: string | null; serverId: string | null }) {
  const accounts = useStore((s) => s.accounts);
  const instances = useStore((s) => s.instances);
  const choices = accounts.flatMap((account) =>
    (instances[account.id]?.servers ?? []).map((server) => ({ account, server, key: JSON.stringify([account.id, server.id]) })),
  );
  const selected = choices.find((c) => c.account.id === accountId && c.server.id === serverId) ?? choices[0];
  return (
    <section className="marketplace">
      <header className="chat-header">
        <Icon name="store" size={21} />
        <h1>Loja de bots</h1>
        <span className="marketplace-context">Annoy</span>
        <span className="spacer" />
        {selected && (
          <Select
            className="bot-server-select"
            aria-label="Servidor dos bots"
            value={selected.key}
            onChange={(event) => {
              const choice = choices.find((c) => c.key === event.target.value);
              if (choice) navigate({ kind: "marketplace", accountId: choice.account.id, serverId: choice.server.id });
            }}
          >
            {choices.map((c) => (
              <option key={c.key} value={c.key}>
                {c.server.name} · {c.account.instanceName}
              </option>
            ))}
          </Select>
        )}
      </header>
      {selected ? (
        <BotServer key={selected.key} accountId={selected.account.id} serverId={selected.server.id} />
      ) : (
        <div className="bot-platform-empty">
          <Icon name="store" size={44} />
          <h2>Conecte sua comunidade para explorar bots</h2>
          <p>Os bots são instalados por servidor. Conecte uma instância Annoy e escolha um servidor para começar.</p>
          <Button onClick={() => openModal({ kind: "addAccount" })}>Conectar uma instância</Button>
        </div>
      )}
    </section>
  );
}
