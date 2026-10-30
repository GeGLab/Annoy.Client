import { useEffect, useRef, useState } from "react";
import { navigate, reconnect, removeAccount } from "../client.ts";
import { getState, setState, useStore } from "../store.ts";
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
      if ("accountId" in current && current.accountId === accountId && (current.kind === "server" || current.kind === "home")) {
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
    <span>{status === "invalid" ? "Sessão expirada" : `Sem conexão com ${name}`}. Mensagens e chamadas estão indisponíveis. O status dos amigos será atualizado após a reconexão.</span>
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
        <h2 id="connection-title">{invalid ? "Sessão expirada" : "Reconectando ao seu espaço"}</h2>
        <p id="connection-description">
          {invalid ? "Entre novamente nesta instância para continuar."
            : "Esta área aguarda a conexão. Você pode abrir outra comunidade ou serviço pela barra de navegação."}
        </p>
        <div className="connection-accounts">
          <div className="connection-account">
            <Icon name={invalid ? "lock" : "wifiOff"} size={18} />
            <span><strong>{account.instanceName}</strong><small role="status">
              {invalid ? "Sua sessão expirou" : offline ? "O sistema informou que está offline; as tentativas serão retomadas quando voltar" : connection?.cause === "timeout" ? "A tentativa expirou; a próxima será automática" : connection?.cause === "service" ? "A instância anunciou uma reinicialização" : connection?.cause === "network" ? "A conexão com esta instância foi interrompida" : "Tentando restabelecer a conexão…"}
            </small></span>
          </div>
          {!invalid && <div className="connection-diagnostics" aria-live="polite">
            <span>Tentativa {connection?.attempt ?? 0}</span>
            {connection?.observedAt !== null && connection?.observedAt !== undefined && <span>Atualizado às {new Intl.DateTimeFormat("pt-BR", { timeStyle: "medium" }).format(connection.observedAt)}</span>}
            {connection?.nextRetryAt !== null && connection?.nextRetryAt !== undefined && <span>Próxima tentativa em {Math.max(0, Math.ceil((connection.nextRetryAt - now) / 1000))} s</span>}
            {connection?.recoveryDeadline !== null && connection?.recoveryDeadline !== undefined && <span>Esta tela irá para a lista de servidores em {Math.max(0, Math.ceil((connection.recoveryDeadline - now) / 1000))} s</span>}
          </div>}
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
