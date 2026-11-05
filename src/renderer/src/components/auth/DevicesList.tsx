import { useEffect, useState } from "react";
import { t as translate } from "../../../../shared/localization/index.ts";
import { listClients, signOutClient, type ClientInfo } from "../../auth/session.ts";
import { formatTime } from "../../format.tsx";
import { toast, useStore } from "../../store.ts";
import { confirmAction } from "../ui/action-dialog.tsx";
import { Button } from "../ui/button.tsx";
import { Icon } from "../ui.tsx";

/**
 * Installs signed in to this Annoy account (TODO item 2.4), with the last
 * sign-in on each. Any of them can be signed out from here.
 */
export function DevicesList() {
  const signedIn = useStore((s) => !!s.global);
  const [clients, setClients] = useState<ClientInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () =>
    listClients()
      .then((list) => {
        setClients(list);
        setError(null);
      })
      .catch((err) => setError((err as Error).message));
  useEffect(() => {
    if (signedIn) void load();
  }, [signedIn]);
  if (!signedIn) return <p className="muted">{translate("auth.devicesNeedAccount")}</p>;
  const signOut = async (client: ClientInfo, forget: boolean) => {
    if (!(await confirmAction(forget ? translate("auth.forgetDeviceConfirm", { p0: client.name }) : translate("auth.signOutDeviceConfirm", { p0: client.name })))) return;
    try {
      await signOutClient(client.id, forget);
      await load();
    } catch (err) {
      toast((err as Error).message);
    }
  };
  return (
    <div className="devices-list">
      <p className="muted">{translate("auth.devicesHelp")}</p>
      {error && <p className="error" role="alert">{error}</p>}
      {!clients && !error && <p className="muted" role="status">{translate("auth.loading")}</p>}
      <ul>
        {clients?.map((c) => (
          <li key={c.id} className={`device-row${c.current ? " current" : ""}`}>
            <Icon name="monitor" size={22} />
            <div className="device-info">
              <strong>{c.name}</strong>
              <small className="muted">
                {c.current ? translate("auth.thisDevice") : c.signedIn ? translate("auth.signedIn") : translate("auth.signedOut")} · {translate("auth.lastLogin", { p0: formatTime(c.lastLogin) })}
              </small>
            </div>
            <span className="spacer" />
            {!c.current && c.signedIn && (
              <Button size="sm" variant="secondary" onClick={() => void signOut(c, false)}>
                {translate("auth.signOutDevice")}
              </Button>
            )}
            {!c.current && !c.signedIn && (
              <Button size="sm" variant="ghost" onClick={() => void signOut(c, true)}>
                {translate("auth.forgetDevice")}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
