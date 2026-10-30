import { useEffect, useRef, useState } from "react";
import { reconnect, removeAccount } from "../client.ts";
import { setState, useStore } from "../store.ts";
import { affectedAccountId } from "../../../shared/connectivity.ts";
import { Brand } from "./Brand.tsx";
import { Button } from "./ui/button.tsx";
import { confirmAction } from "./ui/action-dialog.tsx";
import { Icon } from "./ui.tsx";

const BLOCK_AFTER_MS = 2000;

export function useConnectionBlocked() {
  const affected = useStore((s) => affectedAccountId(s.view, s.instances, s.connectivity.network));
  const accountId = useStore((s) => s.accounts.find((a) => a.id === affected)?.id ?? null);
  const invalid = useStore((s) => !!accountId && s.instances[accountId]?.status === "invalid");
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
    <span>{status === "invalid" ? "Sessão expirada" : `Sem conexão com ${name}`}. Mensagens e chamadas estão indisponíveis. O status dos amigos será atualizado após a reconexão.</span>
  </div>;
}

/** Recovery lives inside the affected area, leaving the navigation and other accounts reachable. */
export function ConnectionOverlay({ accountId, onContinue }: { accountId: string; onContinue: () => void }) {
  const account = useStore((s) => s.accounts.find((a) => a.id === accountId));
  const status = useStore((s) => s.instances[accountId]?.status);
  const offline = useStore((s) => s.connectivity.network.status === "offline");
  const panel = useRef<HTMLElement>(null);
  const opener = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  useEffect(() => {
    // Move focus out of the unavailable area, without stealing it from navigation or a modal.
    if (opener.current?.closest(".connection-content") || document.activeElement === document.body) panel.current?.focus();
    return () => {
      if (opener.current?.isConnected && document.activeElement === document.body && !opener.current.closest("[inert]")) opener.current.focus();
    };
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
        <h2 id="connection-title">{invalid ? "Sessão expirada" : "Reconectando ao seu espaço"}</h2>
        <p id="connection-description">
          {invalid ? "Entre novamente nesta instância para continuar."
            : "Esta área aguarda a conexão. Você pode abrir outra comunidade ou serviço pela barra de navegação."}
        </p>
        <div className="connection-accounts">
          <div className="connection-account">
            <Icon name={invalid ? "lock" : "wifiOff"} size={18} />
            <span><strong>{account.instanceName}</strong><small role="status">
              {invalid ? "Sua sessão expirou" : offline ? "O sistema informou que está offline" : "Tentando restabelecer a conexão…"}
            </small></span>
          </div>
        </div>
        <div className="form-actions center">
          {invalid ? <Button variant="secondary" onClick={() => setState((s) => { s.modal = { kind: "addAccount" }; })}>
            Entrar novamente
          </Button> : <Button variant="secondary" onClick={() => reconnect(accountId)}>
            <Icon name="refresh" size={16} />Tentar agora
          </Button>}
          <Button variant="ghost" onClick={async () => {
            if (await confirmAction(`Desconectar a conta de ${account.instanceName} deste cliente? Você poderá adicioná-la novamente.`)) removeAccount(accountId);
          }}>Desconectar conta</Button>
          <Button variant="ghost" onClick={onContinue}>Ver conteúdo salvo</Button>
        </div>
        {!invalid && <span className="muted small">A reconexão automática continua para esta instância.</span>}
      </section>
    </div>
  );
}
