import {rich} from "../../lib/localization.ts";
import {localizationPreferences} from "../../../../shared/localization/index.ts";
import {t as translate,onLocalizationChange} from "../../../../shared/localization/index.ts";
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

let runtimeLabels = { starting: translate("common.4ec788bb7183"), running: translate("common.3127edd67f20"), stopped: translate("common.31e8729fef87"), error: translate("common.c8e3214bc0f8") };

function BotServer({ accountId, serverId }: { accountId: string; serverId: string }) {
  const { snapshot, status, error, busy, refresh, run } = useBotPlatform(accountId, serverId);
  const [tab, setTab] = useState<"catalog" | "installed">("catalog");
  const [query, setQuery] = useState("");
  const [confirmation, setConfirmation] = useState<
    { kind: "install"; bot: BotListing } | { kind: "uninstall"; installation: BotInstallation; name: string } | null
  >(null);
  const installed = useMemo(() => new Map(snapshot?.installations.map((i) => [i.botId, i]) ?? []), [snapshot]);
  const names = useMemo(() => new Map(snapshot?.bots.map((b) => [b.id, b]) ?? []), [snapshot]);
  const normalized = query.trim().toLocaleLowerCase(localizationPreferences().region);
  if (status === "loading") return <ChatSkeleton />;
  if (status === "unsupported")
    return (
      <div className="bot-platform-empty">
        <Icon name="bot" size={44} />
        <h2>{translate("common.eec7a26b4277")}</h2>
        <p>{translate("common.e0158ad4976b")}</p>
        <p className="muted">{translate("common.5d5cced7251a")}</p>
        <Button variant="secondary" onClick={() => void refresh()}>{rich("common.13d1d4853c27",{p0:(<Icon name="refresh" size={16} />)})}</Button>
      </div>
    );
  if (!snapshot)
    return (
      <div className="bot-platform-empty">
        <Icon name="wifiOff" size={36} />
        <h2>{translate("common.efc935c6600f")}</h2>
        <p role="alert">{error}</p>
        <Button variant="secondary" onClick={() => void refresh()}>{translate("common.b9e10688be01")}</Button>
      </div>
    );
  const catalog = snapshot.bots.filter((bot) =>
    `${bot.name} ${bot.description} ${bot.author}`.toLocaleLowerCase(localizationPreferences().region).includes(normalized),
  );
  const installations = snapshot.installations.filter((i) =>
    `${names.get(i.botId)?.name ?? i.botId}`.toLocaleLowerCase(localizationPreferences().region).includes(normalized),
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
          aria-label={translate("common.371becfc0b02")}
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
          >{translate("common.aa56664d77c6")}</button>
          <button
            className={`tab${tab === "installed" ? " active" : ""}`}
            role="tab"
            id="bots-tab-installed"
            aria-controls="bots-tab-panel"
            tabIndex={tab === "installed" ? 0 : -1}
            aria-selected={tab === "installed"}
            onClick={() => setTab("installed")}
          >{translate("common.f09622ba36ca")}<span className="bot-count">{snapshot.installations.length}</span>
          </button>
        </div>
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={translate("common.0696da4f794d")} aria-label={translate("common.0696da4f794d")} />
        <Button variant="ghost" size="icon" disabled={!!busy} onClick={() => void refresh()} aria-label={translate("common.78d7db9a9d6f")}>
          <Icon name="refresh" size={17} />
        </Button>
      </div>
      <div className="bot-page-content" id="bots-tab-panel" role="tabpanel" aria-labelledby={`bots-tab-${tab}`} tabIndex={0}>
        <div className="bot-intro">
          <h2>{tab === "catalog" ? translate("common.f600f53631e4") : translate("common.9aeaa65f5fc0")}</h2>
          <p>
            {tab === "catalog"
              ? translate("common.5b768fb240ce")
              : translate("common.8f696503334c")}
          </p>
        </div>
        {!snapshot.canManage && (
          <p className="bot-notice">{rich("common.e0e13031ef5a",{p0:(<Icon name="lock" size={16} />)})}</p>
        )}
        {error && (
          <p className="error bot-error" role="alert">
            {error}
            <button onClick={() => void refresh()}>{translate("common.2772d019cbdc")}</button>
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
                      <span className="muted small">{rich("common.fe985ae40a56",{p0:(bot.author),p1:(bot.version)})}</span>
                    </div>
                  </div>
                  <p>{bot.description}</p>
                  <span className="bot-permission-count">{rich("common.98573cade371",{p0:(bot.permissions.length)})}</span>
                  <Button
                    variant={installed.has(bot.id) ? "secondary" : "default"}
                    disabled={!canManage || !!busy || installed.has(bot.id)}
                    onClick={() => setConfirmation({ kind: "install", bot })}
                  >
                    {installed.has(bot.id) ? translate("common.668467851678") : translate("common.f62d0c114a61")}
                  </Button>
                </article>
              ))}
            </div>
          ) : (
            <div className="bot-list-empty">
              <h3>{query ? translate("common.618573be078d") : translate("common.d4b9c352be45")}</h3>
              <p className="muted">{query ? translate("common.d8c1afb51853") : translate("common.23c558fcf75a")}</p>
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
                    <span className={`bot-runtime ${installation.enabled ? installation.runtimeStatus : "disabled"}`}>{rich("common.fe985ae40a56",{p0:(!installation.enabled ? translate("common.f47dfde9cb6f") : runtimeLabels[installation.runtimeStatus]),p1:(installation.version)})}</span>
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
                    {installation.enabled ? translate("common.67afbeec3df0") : translate("common.631205572827")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={translate("expression.82e85db7347e",{p0:(bot?.name ?? installation.botId)})}
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
            <h3>{query ? translate("common.618573be078d") : translate("common.64c51c991076")}</h3>
            <p className="muted">{query ? translate("common.278eda9a4058") : translate("common.d17469e324f6")}</p>
            {!query && (
              <Button variant="secondary" onClick={() => setTab("catalog")}>{translate("common.ce38f241cdd3")}</Button>
            )}
          </div>
        )}
      </div>
      {confirmation && (
        <Dialog open onOpenChange={(open) => !open && !busy && setConfirmation(null)}>
          <DialogContent className="modal bot-confirmation" showClose={false} aria-describedby="bot-confirm-description">
            <div className="modal-body">
              <DialogTitle asChild>
                <h2>{confirmation.kind === "install" ? translate("common.9e3b80b80cff",{p0:(confirmation.bot.name)}) : translate("common.f5a2d16b8d07",{p0:(confirmation.name)})}</h2>
              </DialogTitle>
              {confirmation.kind === "install" ? (
                <>
                  <p id="bot-confirm-description" className="muted">{rich("common.3d1c1a7ee692",{p0:(confirmation.bot.author),p1:(confirmation.bot.version)})}</p>
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
                <p id="bot-confirm-description" className="muted">{translate("common.abcee77a6976")}</p>
              )}
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              {status === "error" && (
                <Button variant="secondary" size="sm" disabled={!!busy} onClick={() => void refresh()}>{translate("common.2772d019cbdc")}</Button>
              )}
              <div className="form-actions">
                <Button variant="secondary" disabled={!!busy} onClick={() => setConfirmation(null)}>{translate("common.bb9dbb406dcb")}</Button>
                <Button
                  variant={confirmation.kind === "uninstall" ? "destructive" : "default"}
                  disabled={!canManage}
                  loading={!!busy}
                  onClick={() => void confirm()}
                >
                  {confirmation.kind === "install" ? translate("common.aa5019de8fdc") : translate("common.6db7953be9a9")}
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
        <Icon name="cable" size={21} />
        <h1>{translate("common.02cba44bb25b")}</h1>
        <span className="marketplace-context">{translate("desktop.7cd80ae96251")}</span>
        <span className="spacer" />
        {selected && (
          <Select
            className="bot-server-select"
            aria-label={translate("common.7b4891b9a36e")}
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
          <h2>{translate("common.c3fe7034d6c7")}</h2>
          <p>{translate("common.995457afd3bc")}</p>
          <Button onClick={() => openModal({ kind: "addAccount" })}>{translate("common.3613a9c100f2")}</Button>
        </div>
      )}
    </section>
  );
}

onLocalizationChange(()=>{runtimeLabels={ starting: translate("common.4ec788bb7183"), running: translate("common.3127edd67f20"), stopped: translate("common.31e8729fef87"), error: translate("common.c8e3214bc0f8") };});

onLocalizationChange(()=>{runtimeLabels={ starting: translate("common.4ec788bb7183"), running: translate("common.3127edd67f20"), stopped: translate("common.31e8729fef87"), error: translate("common.c8e3214bc0f8") };});
