import {rich} from "../lib/localization.ts";
import {t as translate,time} from "../../../shared/localization/index.ts";
import { useEffect, useRef, useState } from "react";
import { navigate, reconnect, removeAccount } from "../client.ts";
import { getState, setState, useStore } from "../store.ts";
import { affectedAccountId } from "../../../shared/connectivity.ts";
import { Brand } from "./Brand.tsx";
import { Button } from "./ui/button.tsx";
import { confirmAction } from "./ui/action-dialog.tsx";
import { Icon } from "./ui.tsx";
import { saveRecoveryReturn } from "../chat-state.ts";

const BLOCK_AFTER_MS = 2000;

export function useConnectionBlocked() {
  const affected = useStore((s) => affectedAccountId(s.view, s.instances, s.connectivity.network));
  const accountId = useStore((s) => s.accounts.find((a) => a.id === affected)?.id ?? null);
  const invalid = useStore((s) => !!accountId && s.instances[accountId]?.status === "invalid");
  const view = useStore((s) => s.view);
  const deadline = useStore((s) => accountId ? s.instances[accountId]?.connection.recoveryDeadline ?? null : null);
  const [blockedAccount, setBlockedAccount] = useState<string | null>(null);
  const [dismissedAccount, setDismissedAccount] = useState<string | null>(null);
  useEffect(() => {
    setBlockedAccount(null);
    setDismissedAccount(null);
    if (!accountId || invalid) return;
    // A quick restart must not flash recovery. A different account gets its own grace period.
    const timer = setTimeout(() => setBlockedAccount(accountId), BLOCK_AFTER_MS);
    return () => clearTimeout(timer);
  }, [accountId, invalid]);
  useEffect(() => {
    if (!accountId || invalid || deadline === null) return;
    const delay = Math.max(0, deadline - Date.now());
    const timer = setTimeout(() => {
      const current = getState().view;
      if ("accountId" in current && current.accountId === accountId && (current.kind === "server" || current.kind === "home" || current.kind === "marketplace")) {
        if (current.kind === "server") saveRecoveryReturn(accountId, { kind: "server", serverId: current.serverId, channelId: current.channelId });
        else if (current.kind === "home") saveRecoveryReturn(accountId, { kind: "home", dmId: current.dmId });
        else saveRecoveryReturn(accountId, { kind: "marketplace", serverId: current.serverId });
        navigate({ kind: "servers" });
      }
    }, delay);
    return () => clearTimeout(timer);
  }, [accountId, invalid, deadline, view]);
  return {
    accountId: dismissedAccount !== accountId && (invalid || blockedAccount === accountId) ? accountId : null,
    continueOffline: () => setDismissedAccount(accountId),
  };
}

export function ConnectionNotice({ accountId }: { accountId: string }) {
  const status = useStore((s) => s.instances[accountId]?.status);
  const name = useStore((s) => s.accounts.find((a) => a.id === accountId)?.instanceName ?? "servidor");
  if (status === "ready") return null;
  return <div className="connection-notice" role="status">
    <Icon name="wifiOff" size={18} />
    <span>{rich("common.beda4b70d735",{p0:(status === "invalid" ? translate("common.69883ff8a543") : translate("common.cfd16b7c6734",{p0:(name)}))})}</span>
  </div>;
}

/** Recovery lives inside the affected area, leaving the navigation and other accounts reachable. */
export function ConnectionOverlay({ accountId, onContinue }: { accountId: string; onContinue: () => void }) {
  const account = useStore((s) => s.accounts.find((a) => a.id === accountId));
  const status = useStore((s) => s.instances[accountId]?.status);
  const offline = useStore((s) => s.connectivity.network.status === "offline");
  const connection = useStore((s) => s.instances[accountId]?.connection);
  const [now, setNow] = useState(Date.now());
  const panel = useRef<HTMLElement>(null);
  const opener = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  useEffect(() => {
    // Move focus out of the unavailable area, without stealing it from navigation or a modal.
    if (opener.current?.closest(".connection-content") || document.activeElement === document.body) panel.current?.focus();
    return () => {
      if (opener.current?.isConnected && document.activeElement === document.body && !opener.current.closest("[inert]")) opener.current.focus();
    };
  }, []);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (!account) return null;
  const invalid = status === "invalid";
  return (
    <div className="connection-recovery">
      <section ref={panel} className="connection-dialog" tabIndex={-1} aria-labelledby="connection-title" aria-describedby="connection-description">
        <div className="reconnect-symbol" aria-hidden="true">
          {!invalid && <><span className="reconnect-wave" /><span className="reconnect-wave" /></>}
          <Brand size={48} />
        </div>
        <h2 id="connection-title">{invalid ? translate("common.69883ff8a543") : translate("common.7206ed75f933")}</h2>
        <p id="connection-description">
          {invalid ? translate("common.50bf63860d2a")
            : translate("common.2ea6624432c1")}
        </p>
        <div className="connection-accounts">
          <div className="connection-account">
            <Icon name={invalid ? "lock" : "wifiOff"} size={18} />
            <span><strong>{account.instanceName}</strong><small role="status">
              {invalid ? translate("common.b0ef0926c4cc") : offline ? translate("common.85768fafe0c1") : connection?.cause === "timeout" ? translate("common.66c86befdfa0") : connection?.cause === "service" ? translate("common.66814f9cb3c3") : connection?.cause === "network" ? translate("common.167698bbafb4") : translate("common.8350fad7c6cc")}
            </small></span>
          </div>
          {!invalid && <div className="connection-diagnostics" aria-live="polite">
            <span>{rich("common.4261b35ba05e",{p0:(connection?.attempt ?? 0)})}</span>
            {connection?.observedAt !== null && connection?.observedAt !== undefined && <span>{rich("common.e78f7b755e30",{p0:time(connection.observedAt,{timeStyle:"medium"})})}</span>}
            {connection?.nextRetryAt !== null && connection?.nextRetryAt !== undefined && <span>{rich("common.bfa16702b965",{p0:(Math.max(0, Math.ceil((connection.nextRetryAt - now) / 1000)))})}</span>}
            {connection?.recoveryDeadline !== null && connection?.recoveryDeadline !== undefined && <span>{rich("common.eb694674cce5",{p0:(Math.max(0, Math.ceil((connection.recoveryDeadline - now) / 1000)))})}</span>}
          </div>}
        </div>
        <div className="form-actions center">
          {invalid ? <Button variant="secondary" onClick={() => setState((s) => { s.modal = { kind: "addAccount", accountId }; })}>{translate("common.05d410b61f11")}</Button> : <Button variant="secondary" onClick={() => reconnect(accountId)}>{rich("common.3237985e8c9b",{p0:(<Icon name="refresh" size={16} />)})}</Button>}
          <Button variant="ghost" onClick={async () => {
            if (await confirmAction(translate("common.49bfbc7a4bca",{p0:(account.instanceName)}))) removeAccount(accountId, "signOut");
          }}>{translate("common.c7bb27862498")}</Button>
          <Button variant="ghost" onClick={onContinue}>{translate("common.ab4ed7a4199c")}</Button>
        </div>
        {!invalid && <span className="muted small">{translate("common.ed8092fd38d6")}</span>}
      </section>
    </div>
  );
}
