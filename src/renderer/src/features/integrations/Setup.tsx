import { cleanSettings, missingSettings, openaiModels, type IntegrationSettings, type ServerIntegration, type SteamConnectionStatus, type StoreIntegration } from "@annoy/protocol";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
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
import { cloudSteam } from "../../social/details.ts";
import { linkSteam } from "../activity/SteamConnection.tsx";
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
  const savedManualSteam = useIntegrations((s) => s.manualSteam);
  const signedIn = useIntegrations((s) => s.accountStatus === "ready");
  const server = target.kind === "server" ? target : null;
  const current = server ? server.installed : connected;
  const savedSettings: IntegrationSettings = server ? (server.installed?.settings ?? {}) : (connected?.settings ?? {});
  const [key, setKey] = useState(server ? "" : (connected?.key ?? ""));
  const [settings, setSettings] = useState<Record<string, string>>(() => Object.fromEntries(integration.settings.map((s) => [s.key, savedSettings[s.key] === undefined ? "" : String(savedSettings[s.key])])));
  const [panel, setPanel] = useState(shownOnProfile);
  const [manualSteam, setManualSteam] = useState(savedManualSteam ?? "");
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState<"save" | "remove" | "models" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listId = useId();
  const canEdit = server ? server.canManage : signedIn;
  const hasSavedKey = server ? !!server.installed?.hasKey : !!connected?.key;
  const openai = integration.runtime.type === "builtin" && integration.runtime.name === "openai";
  const vpngo = integration.runtime.type === "builtin" && integration.runtime.name === "vpngo";
  const callable = integration.commands.length > 0 || integration.mention;
  const steamPanel = !server && canEdit && integration.profile?.connection === "steam";

  const fail = (err: unknown) => {
    if (isCancellation(err)) return;
    const code = (err as { code?: string }).code;
    setError(code === "steam_profile_not_found" ? translate("integrations.steam.notFound") : code === "invalid_steam_profile" ? translate("integrations.steam.invalid") : (err as Error).message);
  };
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
        // The Steam profile typed by hand goes with the panel; an empty field forgets it.
        const typed = manualSteam.trim() || null;
        const typedChanged = steamPanel && panel && typed !== savedManualSteam;
        if (integration.profile && (panel !== shownOnProfile || typedChanged)) await setProfilePanel(integration.id, panel, typedChanged ? typed : undefined);
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
          {steamPanel && panel && <SteamPanelSource value={manualSteam} onChange={setManualSteam} disabled={!!busy} />}
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

/** Where a Steam panel's profile comes from: the linked Steam account or, without one, a profile typed by hand. */
function SteamPanelSource({ value, onChange, disabled }: { value: string; onChange: (value: string) => void; disabled: boolean }) {
  const [status, setStatus] = useState<SteamConnectionStatus | null>(null);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const linkRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    const load = () => void cloudSteam.status(abort.signal).then((next) => { setStatus(next); setError(null); }, (err: Error) => { if (!abort.signal.aborted) setError(err.message); });
    load();
    window.addEventListener("steam-connection-changed", load);
    return () => { abort.abort(); linkRequest.current?.abort(); window.removeEventListener("steam-connection-changed", load); };
  }, []);
  const link = async () => {
    const abort = new AbortController();
    linkRequest.current = abort;
    setLinking(true);
    setError(null);
    try { setStatus(await linkSteam(cloudSteam, abort.signal)); }
    catch (err) { if (!abort.signal.aborted) setError((err as Error).message); }
    finally { if (linkRequest.current === abort) { linkRequest.current = null; setLinking(false); } }
  };
  if (!status && !error) return <p className="muted small" role="status">{translate("integrations.steam.checking")}</p>;
  const connection = status?.connection;
  if (connection) return <p className="integration-steam-linked small"><Icon name="check" size={14} />{translate("integrations.steam.linked", { p0: connection.personaName || connection.steamId })}</p>;
  return (
    <div className="integration-steam-source">
      <p className="muted small">{translate("integrations.steam.notLinked")}</p>
      <div className="integration-steam-link">
        <Button type="button" variant="secondary" size="sm" loading={linking} disabled={disabled || linking} onClick={() => void link()}>{translate("integrations.steam.link")}</Button>
        {linking && <span className="muted small" role="status">{translate("integrations.steam.waiting")}</span>}
      </div>
      <Field label={translate("integrations.steam.manual")} hint={translate("integrations.steam.manualHint")}>
        <Input value={value} disabled={disabled} maxLength={200} spellCheck={false} autoComplete="off" placeholder="https://steamcommunity.com/id/…" onChange={(e) => onChange(e.target.value)} />
      </Field>
      {error && <p className="error small" role="alert">{error}</p>}
    </div>
  );
}
