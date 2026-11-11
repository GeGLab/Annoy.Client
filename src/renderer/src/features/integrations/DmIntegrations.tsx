import { isCallable } from "@annoy/protocol";
import { useEffect, useState } from "react";
import { t as translate } from "../../../../shared/localization/index.ts";
import { navigate } from "../../client.ts";
import { Button } from "../../components/ui/button.tsx";
import { Dialog, DialogContent, DialogTitle } from "../../components/ui/dialog.tsx";
import { toast } from "../../store.ts";
import { IntegrationIcon } from "./Setup.tsx";
import { removeDmIntegration, requestDmIntegration } from "./dm.ts";
import { loadCatalog, useIntegrations } from "./state.ts";

/** "Adicionar integração" of a DM: the integrations this account connected, and the ones already in the conversation. */
export function DmIntegrationsDialog({ conversationId, me, otherName, onClose }: { conversationId: string; me: string; otherName: string; onClose: () => void }) {
  const catalog = useIntegrations((s) => s.catalog);
  const connected = useIntegrations((s) => s.account.connected);
  const links = useIntegrations((s) => s.account.dms[conversationId]);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { void loadCatalog(); }, []);
  const rows = catalog.filter((i) => isCallable(i, "dm") && (connected[i.id] || links?.[i.id]));
  const run = async (id: string, action: () => Promise<void>) => {
    setBusy(id);
    try { await action(); }
    catch (error) { toast((error as Error).message); }
    finally { setBusy(null); }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="modal integration-dialog" aria-describedby={undefined}>
        <div className="modal-body">
          <DialogTitle asChild><h2>{translate("integrations.dmTitle")}</h2></DialogTitle>
          {rows.length === 0 && <p className="muted">{translate("integrations.dmNone")}</p>}
          <div className="installed-bots">
            {rows.map((integration) => {
              const link = links?.[integration.id];
              const mine = link?.owner === me;
              return (
                <article className="installed-bot" key={integration.id}>
                  <IntegrationIcon integration={integration} size={40} />
                  <div className="installed-bot-info">
                    <h3>{integration.name}</h3>
                    <span className={`bot-runtime${link?.status === "active" ? " running" : ""}`}>
                      {!link ? integration.summary : link.status === "active" ? (mine ? translate("integrations.active") : translate("integrations.addedBy", { p0: otherName })) : mine ? translate("integrations.pending", { p0: otherName }) : translate("integrations.requestText", { p0: otherName, p1: integration.name })}
                    </span>
                  </div>
                  {link ? (
                    <Button variant="secondary" size="sm" loading={busy === integration.id} disabled={!!busy} onClick={() => void run(integration.id, () => removeDmIntegration(conversationId, integration.id, integration.name))}>{translate("integrations.remove")}</Button>
                  ) : (
                    <Button size="sm" loading={busy === integration.id} disabled={!!busy} onClick={() => void run(integration.id, () => requestDmIntegration(conversationId, integration))}>{translate("integrations.add")}</Button>
                  )}
                </article>
              );
            })}
          </div>
          <div className="form-actions">
            <Button variant="secondary" onClick={() => { onClose(); navigate({ kind: "marketplace", accountId: null, serverId: null }); }}>{translate("integrations.openStore")}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
