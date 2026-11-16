import { isCallable, type StoreIntegration } from "@annoy/protocol";
import { useEffect, useMemo, useState } from "react";
import { localizationPreferences, t as translate } from "../../../../shared/localization/index.ts";
import { Icon } from "../../components/ui.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Input } from "../../components/ui/input.tsx";
import { IntegrationDialog, IntegrationIcon } from "./Setup.tsx";
import { loadCatalog, useIntegrations } from "./state.ts";

/**
 * Settings → Integrações: the same connect/configure as the Store, from wherever
 * the person is (a server, a call), without leaving it. What is connected comes first.
 */
export function AccountIntegrations() {
  const catalog = useIntegrations((s) => s.catalog);
  const catalogStatus = useIntegrations((s) => s.catalogStatus);
  const accountStatus = useIntegrations((s) => s.accountStatus);
  const connected = useIntegrations((s) => s.account.connected);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { void loadCatalog(); }, []);
  const normalized = query.trim().toLocaleLowerCase(localizationPreferences().region);
  const shown = useMemo(
    () => catalog.filter((i) => `${i.name} ${i.summary} ${i.developer.name} ${i.commands.map((c) => c.name).join(" ")}`.toLocaleLowerCase(localizationPreferences().region).includes(normalized)),
    [catalog, normalized],
  );
  const mine = shown.filter((i) => connected[i.id]);
  const available = shown.filter((i) => !connected[i.id]);
  const selected = catalog.find((i) => i.id === open);

  const row = (integration: StoreIntegration) => {
    const isConnected = !!connected[integration.id];
    const scopes = [isCallable(integration, "dm") && translate("integrations.scopeDm"), isCallable(integration, "server") && translate("integrations.scopeServer")].filter(Boolean).join(" · ");
    return (
      <article className="installed-bot" key={integration.id}>
        <IntegrationIcon integration={integration} size={40} />
        <div className="installed-bot-info">
          <h3>{integration.name}{integration.verified && <span className="integration-verified" title={translate("integrations.verified")}><Icon name="shield" size={13} /><span className="sr-only">{translate("integrations.verified")}</span></span>}</h3>
          <span className={`bot-runtime${isConnected ? " running" : ""}`}>{isConnected ? translate("integrations.connected") : integration.summary}</span>
          {scopes && <span className="muted small">{scopes}</span>}
        </div>
        <Button variant={isConnected ? "secondary" : "default"} size="sm" onClick={() => setOpen(integration.id)} aria-label={`${isConnected ? translate("integrations.configure") : translate("integrations.connect")} ${integration.name}`}>
          {isConnected ? translate("integrations.configure") : translate("integrations.connect")}
        </Button>
      </article>
    );
  };

  return (
    <section className="settings-section account-integrations">
      <h3><Icon name="cable" size={24} />{translate("integrations.tab")}</h3>
      <p className="muted">{translate("integrations.settings.intro")}</p>
      {accountStatus === "error" && <p className="error small" role="alert">{translate("integrations.settings.accountError")}</p>}
      {catalogStatus === "error" ? (
        <div className="account-integrations-empty">
          <p className="muted" role="alert">{translate("integrations.loadError")}</p>
          <Button variant="secondary" size="sm" onClick={() => void loadCatalog(true)}>{translate("integrations.retry")}</Button>
        </div>
      ) : catalogStatus !== "ready" || accountStatus === "loading" ? (
        <p className="muted" role="status">{translate("common.6cc1bbba0f84")}</p>
      ) : (
        <>
          {catalog.length > 0 && <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={translate("integrations.search")} aria-label={translate("integrations.search")} />}
          <h4>{translate("integrations.settings.connected")}</h4>
          <div className="installed-bots">
            {mine.map(row)}
            {mine.length === 0 && <p className="muted small">{query ? translate("integrations.noResults") : translate("integrations.settings.noneConnected")}</p>}
          </div>
          {(available.length > 0 || !query) && <h4>{translate("integrations.settings.available")}</h4>}
          <div className="installed-bots">
            {available.map(row)}
            {available.length === 0 && !query && <p className="muted small">{catalog.length ? translate("integrations.settings.allConnected") : translate("integrations.empty")}</p>}
          </div>
        </>
      )}
      {selected && <IntegrationDialog integration={selected} target={{ kind: "account" }} onClose={() => setOpen(null)} />}
    </section>
  );
}
