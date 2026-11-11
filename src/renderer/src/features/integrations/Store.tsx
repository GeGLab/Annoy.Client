import { isCallable, type StoreIntegration } from "@annoy/protocol";
import { useEffect, useMemo, useState } from "react";
import { localizationPreferences, t as translate } from "../../../../shared/localization/index.ts";
import { Icon } from "../../components/ui.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Input } from "../../components/ui/input.tsx";
import { ChatSkeleton } from "../../components/ui/skeleton.tsx";
import { IntegrationDialog, IntegrationIcon } from "./Setup.tsx";
import { loadCatalog, useIntegrations } from "./state.ts";

/** What the store offers, by tab. More kinds (themes, emojis, sounds) come as new tabs. */
const TABS = ["integrations"] as const;
type Tab = (typeof TABS)[number];

function Integrations({ query }: { query: string }) {
  const catalog = useIntegrations((s) => s.catalog);
  const status = useIntegrations((s) => s.catalogStatus);
  const connected = useIntegrations((s) => s.account.connected);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { void loadCatalog(); }, []);
  const normalized = query.trim().toLocaleLowerCase(localizationPreferences().region);
  const shown = useMemo(
    () => catalog.filter((i) => `${i.name} ${i.summary} ${i.developer.name} ${i.commands.map((c) => c.name).join(" ")}`.toLocaleLowerCase(localizationPreferences().region).includes(normalized)),
    [catalog, normalized],
  );
  const selected = catalog.find((i) => i.id === open);
  if (status === "loading" || status === "idle") return <ChatSkeleton />;
  if (status === "error")
    return (
      <div className="bot-platform-empty">
        <Icon name="wifiOff" size={36} />
        <p role="alert">{translate("integrations.loadError")}</p>
        <Button variant="secondary" onClick={() => void loadCatalog(true)}>{translate("integrations.retry")}</Button>
      </div>
    );
  return (
    <>
      {shown.length ? (
        <div className="bot-catalog">
          {shown.map((integration: StoreIntegration) => {
            const isConnected = !!connected[integration.id];
            return (
              <article className="bot-listing integration-listing" key={integration.id}>
                <div className="bot-listing-heading">
                  <IntegrationIcon integration={integration} />
                  <div>
                    <h3>{integration.name}{integration.verified && <span className="integration-verified" title={translate("integrations.verified")}><Icon name="shield" size={13} /><span className="sr-only">{translate("integrations.verified")}</span></span>}</h3>
                    <span className="muted small">{translate("integrations.by", { p0: integration.developer.name })}</span>
                  </div>
                </div>
                <p>{integration.summary}</p>
                <span className="bot-permission-count integration-scopes">
                  {isCallable(integration, "dm") && <span>{translate("integrations.scopeDm")}</span>}
                  {isCallable(integration, "server") && <span>{translate("integrations.scopeServer")}</span>}
                  {isConnected && <span className="integration-connected"><Icon name="check" size={13} />{translate("integrations.connected")}</span>}
                </span>
                <Button variant={isConnected ? "secondary" : "default"} onClick={() => setOpen(integration.id)}>
                  {isConnected ? translate("integrations.configure") : translate("integrations.connect")}
                </Button>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="bot-list-empty">
          <Icon name="store" size={36} />
          <p className="muted">{query ? translate("integrations.noResults") : translate("integrations.empty")}</p>
        </div>
      )}
      {selected && <IntegrationDialog integration={selected} target={{ kind: "account" }} onClose={() => setOpen(null)} />}
    </>
  );
}

export default function Store() {
  const [tab, setTab] = useState<Tab>("integrations");
  const [query, setQuery] = useState("");
  return (
    <section className="marketplace store">
      <header className="chat-header">
        <Icon name="store" size={21} />
        <h1>{translate("integrations.store")}</h1>
      </header>
      <div className="bot-toolbar">
        <div className="tabs inline" role="tablist" aria-label={translate("integrations.store")}>
          {TABS.map((id) => (
            <button key={id} className={`tab${tab === id ? " active" : ""}`} role="tab" id={`store-tab-${id}`} aria-controls="store-tab-panel" aria-selected={tab === id} onClick={() => setTab(id)}>
              {translate("integrations.tab")}
            </button>
          ))}
        </div>
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={translate("integrations.search")} aria-label={translate("integrations.search")} />
        <Button variant="ghost" size="icon" onClick={() => void loadCatalog(true)} aria-label={translate("integrations.retry")}>
          <Icon name="refresh" size={17} />
        </Button>
      </div>
      <div className="bot-page-content" id="store-tab-panel" role="tabpanel" aria-labelledby={`store-tab-${tab}`} tabIndex={0}>
        {tab === "integrations" && <Integrations query={query} />}
      </div>
    </section>
  );
}
