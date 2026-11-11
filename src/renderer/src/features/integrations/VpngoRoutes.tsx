import { useEffect, useState } from "react";
import { t as translate } from "../../../../shared/localization/index.ts";
import { Select } from "../../components/ui/select.tsx";
import { toast, useStore } from "../../store.ts";
import { hostOf, setVpngoRoute, useVpngoRoutes, vpngoAvailable, type VpngoStatus } from "./vpngo.ts";

/** One row per annoy-server connection: the VPNGo profile it goes through, or none. */
export function VpngoRoutes() {
  const accounts = useStore((s) => s.accounts);
  const { routes, failed } = useVpngoRoutes();
  const [status, setStatus] = useState<VpngoStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void window.annoy?.vpngo?.status().then((next) => active && setStatus(next), () => undefined);
    return () => { active = false; };
  }, []);
  if (!vpngoAvailable()) return <p className="muted">{translate("integrations.vpngo.desktopOnly")}</p>;
  if (!status) return <p className="muted" role="status">{translate("common.6cc1bbba0f84")}</p>;
  if (!status.installed) return <p className="muted">{translate("integrations.vpngo.notInstalled")} <a href="https://vpngo.geg.dev.br" target="_blank" rel="noreferrer">{translate("integrations.vpngo.download")}</a></p>;
  if (status.problem) return <p className="error" role="alert">{translate("integrations.vpngo.problem", { p0: status.problem })}</p>;
  if (!status.profiles.length) return <p className="muted">{translate("integrations.vpngo.noProfiles")}</p>;
  const hosts = [...new Map(accounts.flatMap((account) => { const host = hostOf(account.url); return host ? [[host, account.instanceName] as const] : []; })).entries()];
  const choose = async (host: string, profile: string) => {
    setBusy(host);
    try { await setVpngoRoute(host, profile || null); }
    catch (error) { toast((error as Error).message); }
    finally { setBusy(null); }
  };
  return (
    <div className="integration-routes">
      <h3>{translate("integrations.vpngo.routesTitle")}</h3>
      {hosts.length === 0 && <p className="muted">{translate("integrations.vpngo.noServers")}</p>}
      {hosts.map(([host, name]) => (
        <div className="integration-route" key={host}>
          <span className="integration-route-name"><strong className="truncate">{name}</strong><small className="muted truncate">{host}</small></span>
          <Select aria-label={name} value={routes[host] ?? ""} disabled={busy !== null} onChange={(event) => void choose(host, event.target.value)}>
            <option value="">{translate("integrations.vpngo.direct")}</option>
            {status.profiles.map((profile) => <option key={profile} value={profile}>{profile}</option>)}
            {routes[host] && !status.profiles.includes(routes[host]!) && <option value={routes[host]}>{routes[host]}</option>}
          </Select>
          {failed[host] !== undefined && <p className="error small" role="alert">{translate("integrations.vpngo.failed", { p0: failed[host] })}</p>}
        </div>
      ))}
      <p className="muted small">{translate("integrations.vpngo.voiceNote")}</p>
    </div>
  );
}
