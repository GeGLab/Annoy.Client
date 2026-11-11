import { cleanSettings, missingSettings, openaiModels, type IntegrationSettings, type ServerIntegration, type StoreIntegration } from "@annoy/protocol";
import { useId, useState, type FormEvent } from "react";
import { t as translate } from "../../../../shared/localization/index.ts";
import { isCancellation } from "../../../../shared/requests.ts";
import { apiFor } from "../../client.ts";
import { Icon, Field } from "../../components/ui.tsx";
import { confirmAction } from "../../components/ui/action-dialog.tsx";
import { Button } from "../../components/ui/button.tsx";
import { Checkbox } from "../../components/ui/checkbox.tsx";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/dialog.tsx";
import { Input } from "../../components/ui/input.tsx";
import { Select } from "../../components/ui/select.tsx";
import { runtime } from "../../social/runtime.ts";
import { removeDmIntegration } from "./dm.ts";
import { connectIntegration, disconnectIntegration, iconOf, integrations, setProfilePanel, useIntegrations } from "./state.ts";
import { integrationHttp } from "./transport.ts";
import { clearVpngoRoutes } from "./vpngo.ts";
import { VpngoRoutes } from "./VpngoRoutes.tsx";

export type SetupTarget =
  | { kind: "account" }
  | { kind: "server"; accountId: string; serverId: string; installed: ServerIntegration | null; canManage: boolean; onChange: (list: ServerIntegration[]) => void };

export function IntegrationIcon({ integration, size = 46 }: { integration: Pick<StoreIntegration, "icon" | "name"> | { icon: string | null; name: string }; size?: number }) {
  const icon = iconOf(integration);
  return (
    <span className="bot-avatar integration-icon" style={{ width: size, height: size }}>
      {icon ? <img src={icon} alt="" width={size} height={size} loading="lazy" /> : <Icon name="cable" size={Math.round(size * 0.55)} />}
    </span>
  );
}

/** What the integration is, what it gets, and the fields of whoever connects or installs it. */
export function IntegrationDialog({ integration, target, onClose }: { integration: StoreIntegration; target: SetupTarget; onClose: () => void }) {
  const connected = useIntegrations((s) => s.account.connected[integration.id]);
  const shownOnProfile = useIntegrations((s) => s.panels.includes(integration.id));
  const signedIn = useIntegrations((s) => s.accountStatus === "ready");
  const server = target.kind === "server" ? target : null;
  const current = server ? server.installed : connected;
  const savedSettings: IntegrationSettings = server ? (server.installed?.settings ?? {}) : (connected?.settings ?? {});
  const [key, setKey] = useState(server ? "" : (connected?.key ?? ""));
  const [settings, setSettings] = useState<Record<string, string>>(() => Object.fromEntries(integration.settings.map((s) => [s.key, savedSettings[s.key] === undefined ? "" : String(savedSettings[s.key])])));
  const [panel, setPanel] = useState(shownOnProfile);
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState<"save" | "remove" | "models" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listId = useId();
  const canEdit = server ? server.canManage : signedIn;
  const hasSavedKey = server ? !!server.installed?.hasKey : !!connected?.key;
  const openai = integration.runtime.type === "builtin" && integration.runtime.name === "openai";
  const vpngo = integration.runtime.type === "builtin" && integration.runtime.name === "vpngo";
  const callable = integration.commands.length > 0 || integration.mention;

  const fail = (err: unknown) => { if (!isCancellation(err)) setError((err as Error).message); };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !canEdit) return;
    const clean = cleanSettings(integration, settings);
    if (integration.key.required && !key.trim() && !(server && hasSavedKey)) return setError(translate("integrations.error.keyMissing"));
    if (missingSettings(integration, clean).length) return setError(translate("integrations.error.settingsMissing"));
    setBusy("save");
    setError(null);
    try {
      if (server) server.onChange(await apiFor(server.accountId).put<ServerIntegration[]>(`/servers/${server.serverId}/integrations/${integration.id}`, { ...(key.trim() && { apiKey: key.trim() }), settings: clean }));
      else {
        await connectIntegration(integration, key, clean);
        if (integration.profile && panel !== shownOnProfile) await setProfilePanel(integration.id, panel);
      }
      onClose();
    } catch (err) { fail(err); }
    finally { setBusy(null); }
  };
  const remove = async () => {
    if (busy || !canEdit) return;
    const question = server ? translate("integrations.server.uninstallConfirm", { p0: integration.name }) : translate("integrations.disconnectConfirm", { p0: integration.name });
    if (!(await confirmAction(question, { title: integration.name, confirmLabel: server ? translate("integrations.server.uninstall") : translate("integrations.disconnect") }))) return;
    setBusy("remove");
    setError(null);
    try {
      if (server) server.onChange(await apiFor(server.accountId).del<ServerIntegration[]>(`/servers/${server.serverId}/integrations/${integration.id}`));
      else {
        // The conversations it was added to are told, then the key goes.
        const me = runtime.me;
        for (const [conversationId, links] of Object.entries(integrations().account.dms)) {
          if (links[integration.id]?.owner === me) await removeDmIntegration(conversationId, integration.id, integration.name).catch(() => undefined);
        }
        if (integration.profile && shownOnProfile) await setProfilePanel(integration.id, false).catch(() => undefined);
        if (vpngo) await clearVpngoRoutes().catch(() => undefined);
        await disconnectIntegration(integration.id);
      }
      onClose();
    } catch (err) { fail(err); }
    finally { setBusy(null); }
  };
  const loadModels = async () => {
    const value = key.trim();
    if (!value || busy) return;
    setBusy("models");
    setError(null);
    try { setModels(await openaiModels(integrationHttp, value)); }
    catch (err) { setError((err as { detail?: string | null }).detail ?? translate("integrations.error.unreachable")); }
    finally { setBusy(null); }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="modal integration-dialog" aria-describedby={`${listId}-summary`}>
        <form className="modal-body" onSubmit={(event) => void save(event)}>
          <header className="integration-dialog-head">
            <IntegrationIcon integration={integration} size={52} />
            <div>
              <DialogTitle asChild><h2>{integration.name}{integration.verified && <span className="integration-verified" title={translate("integrations.verified")}><Icon name="shield" size={14} />{translate("integrations.verified")}</span>}</h2></DialogTitle>
              <span className="muted small">{translate("integrations.by", { p0: integration.developer.name })}</span>
            </div>
          </header>
          <DialogDescription asChild><p id={`${listId}-summary`}>{integration.summary}</p></DialogDescription>
          {integration.description && <p className="integration-description">{integration.description}</p>}
          {callable && (
            <section className="integration-facts">
              <h3>{translate("integrations.commands")}</h3>
              <ul>
                {integration.commands.map((c) => <li key={c.name}><code>/{c.name}{c.usage ? ` ${c.usage}` : ""}</code><span className="muted">{c.description}</span></li>)}
                {integration.mention && <li><code>{translate("integrations.mention", { p0: integration.name })}</code></li>}
              </ul>
              <h3>{translate("integrations.receives")}</h3>
              <ul>
                <li>{translate("integrations.receivesCall")}</li>
                {integration.access.history && <li>{translate("integrations.receivesHistory")}</li>}
                {integration.access.attachments && <li>{translate("integrations.receivesAttachments")}</li>}
              </ul>
            </section>
          )}
          {(integration.website || integration.privacyUrl) && (
            <p className="integration-links small">
              {integration.website && <a href={integration.website} target="_blank" rel="noreferrer">{translate("integrations.website")}</a>}
              {integration.privacyUrl && <a href={integration.privacyUrl} target="_blank" rel="noreferrer">{translate("integrations.privacy")}</a>}
            </p>
          )}
          {!server && !signedIn && <p className="bot-notice">{translate("integrations.signIn")}</p>}
          {server && !server.canManage && <p className="bot-notice">{translate("integrations.server.ownerOnly")}</p>}
          {canEdit && integration.key.required && (
            <Field label={integration.key.label ?? translate("integrations.apiKey")} hint={server ? (hasSavedKey ? translate("integrations.server.keyKept") : undefined) : translate("integrations.apiKeyStored")}>
              <Input type="password" autoComplete="off" spellCheck={false} value={key} maxLength={500} onChange={(e) => setKey(e.target.value)} disabled={!!busy} />
            </Field>
          )}
          {canEdit && integration.key.required && (integration.key.helpUrl || openai) && (
            <p className="integration-links small">
              {integration.key.helpUrl && <a href={integration.key.helpUrl} target="_blank" rel="noreferrer">{translate("integrations.apiKeyHelp")}</a>}
              {openai && <button type="button" className="link-button" disabled={!key.trim() || !!busy} onClick={() => void loadModels()}>{translate("integrations.loadModels")}</button>}
            </p>
          )}
          {canEdit && integration.settings.map((s) => (
            <Field key={s.key} label={s.label}>
              {s.type === "select" ? (
                <Select value={settings[s.key] ?? ""} disabled={!!busy} onChange={(e) => setSettings((v) => ({ ...v, [s.key]: e.target.value }))}>
                  <option value="">—</option>
                  {s.options?.map((o) => <option key={o} value={o}>{o}</option>)}
                </Select>
              ) : (
                <Input
                  type={s.type === "number" ? "number" : "text"} value={settings[s.key] ?? ""} disabled={!!busy} maxLength={200}
                  {...(s.type === "number" && { min: s.min, max: s.max, step: 1 })}
                  {...(openai && s.type === "text" && models.length > 0 && { list: listId })}
                  onChange={(e) => setSettings((v) => ({ ...v, [s.key]: e.target.value }))}
                />
              )}
            </Field>
          ))}
          {models.length > 0 && <datalist id={listId}>{models.map((m) => <option key={m} value={m} />)}</datalist>}
          {!server && canEdit && integration.profile && (
            <label className="perm"><Checkbox checked={panel} disabled={!!busy} onChange={(e) => setPanel(e.target.checked)} />{translate("integrations.showOnProfile")}</label>
          )}
          {!server && vpngo && connected && <VpngoRoutes />}
          {error && <p className="error" role="alert">{error}</p>}
          <div className="form-actions">
            {current && canEdit && <Button variant="ghost" className="integration-remove" loading={busy === "remove"} disabled={!!busy} onClick={() => void remove()}>{server ? translate("integrations.server.uninstall") : translate("integrations.disconnect")}</Button>}
            <Button variant="secondary" disabled={!!busy} onClick={onClose}>{translate("integrations.cancel")}</Button>
            {canEdit && <Button type="submit" loading={busy === "save"} disabled={!!busy}>{current ? translate("integrations.save") : server ? translate("integrations.server.install") : translate("integrations.connect")}</Button>}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
