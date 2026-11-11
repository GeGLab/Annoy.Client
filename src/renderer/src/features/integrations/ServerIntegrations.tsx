import { isCallable, type ServerIntegration } from "@annoy/protocol";
import { useEffect, useState } from "react";
import { t as translate } from "../../../../shared/localization/index.ts";
import { isCancellation } from "../../../../shared/requests.ts";
import { apiFor } from "../../client.ts";
import { Button } from "../../components/ui/button.tsx";
import { useRequestOwner } from "../../lib/use-request-owner.ts";
import { toast } from "../../store.ts";
import { IntegrationDialog, IntegrationIcon } from "./Setup.tsx";
import { loadCatalog, useIntegrations } from "./state.ts";

/** Server settings → Integrações: what is installed, and (for the owner) the store to install from. */
export function ServerIntegrations({ accountId, serverId, isOwner }: { accountId: string; serverId: string; isOwner: boolean }) {
  const requests = useRequestOwner(JSON.stringify([accountId, serverId, "integrations"]));
  const signal = requests.signal;
  const catalog = useIntegrations((s) => s.catalog);
  const [installed, setInstalled] = useState<ServerIntegration[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    void loadCatalog();
    void apiFor(accountId).get<ServerIntegration[]>(`/servers/${serverId}/integrations`, signal)
      .then((list) => { if (!signal.aborted) setInstalled(list); }, (e: Error) => { if (!isCancellation(e) && !signal.aborted) toast(e.message); });
  }, [accountId, serverId]);
  if (!installed) return <p className="muted" role="status">{translate("common.6cc1bbba0f84")}</p>;
  const byId = new Map(installed.map((i) => [i.integration.id, i]));
  // Installed ones first (as the server holds them), then what the store offers for servers.
  const rows = [...installed.map((i) => i.integration), ...catalog.filter((i) => !byId.has(i.id) && isCallable(i, "server") && isOwner)];
  const selected = rows.find((i) => i.id === open);
  return (
    <div className="form server-integrations">
      <p className="muted">{translate("integrations.server.hint")}</p>
      <div className="installed-bots">
        {rows.map((integration) => {
          const entry = byId.get(integration.id);
          return (
            <article className="installed-bot" key={integration.id}>
              <IntegrationIcon integration={integration} size={40} />
              <div className="installed-bot-info">
                <h3>{integration.name}</h3>
                <span className={`bot-runtime${entry ? " running" : ""}`}>{entry ? translate("integrations.server.installed") : integration.summary}</span>
              </div>
              <Button variant={entry ? "secondary" : "default"} size="sm" onClick={() => setOpen(integration.id)}>
                {entry ? translate("integrations.configure") : translate("integrations.server.install")}
              </Button>
            </article>
          );
        })}
        {rows.length === 0 && <p className="muted">{translate("integrations.empty")}</p>}
      </div>
      {selected && (
        <IntegrationDialog
          integration={selected}
          target={{ kind: "server", accountId, serverId, installed: byId.get(selected.id) ?? null, canManage: isOwner, onChange: setInstalled }}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}
