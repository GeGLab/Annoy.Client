import { confirmAction } from "./ui/action-dialog.tsx";
import { useEffect, useState } from "react";
import { reconnect, removeAccount } from "../client.ts";
import { setState, useStore } from "../store.ts";
import { Brand } from "./Brand.tsx";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog.tsx";
import { Button } from "./ui/button.tsx";
import { Icon } from "./ui.tsx";

export function useConnectionBlocked() {
  const accounts = useStore((s) => s.accounts);
  const instances = useStore((s) => s.instances);
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return accounts.length > 0 && (!online || accounts.some((a) => instances[a.id]?.status !== "ready"));
}

/** An application-level focus trap also blocks open portals and native Discord. */
export function ConnectionOverlay({ blocked }: { blocked: boolean }) {
  const accounts = useStore((s) => s.accounts);
  const instances = useStore((s) => s.instances);
  const failed = accounts.filter((a) => instances[a.id]?.status !== "ready");
  const [authAccount, setAuthAccount] = useState<string | null>(null);
  // Authentication is the one recovery flow that must remain reachable.
  const authOpen = useStore((s) => s.modal?.kind === "addAccount");
  useEffect(() => {
    if (!authOpen) setAuthAccount(null);
  }, [authOpen]);
  if (!blocked || (authOpen && authAccount)) return null;
  return (
    <Dialog open>
      <DialogContent
        className="connection-dialog"
        showClose={false}
        aria-describedby="connection-description"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <div className="reconnect-symbol">
          <span className="reconnect-wave" />
          <span className="reconnect-wave" />
          <Brand size={48} />
        </div>
        <DialogTitle>Reconectando ao seu espaço</DialogTitle>
        <p id="connection-description">Suas conversas continuam aqui. Vamos liberar o aplicativo assim que a conexão voltar.</p>
        <div className="connection-accounts">
          {failed.map((a) => (
            <div className="connection-account" key={a.id}>
              <Icon name={instances[a.id]?.status === "invalid" ? "lock" : "wifiOff"} size={18} />
              <span>
                <strong>{a.instanceName}</strong>
                <small>{instances[a.id]?.status === "invalid" ? "Sua sessão expirou" : "Tentando restabelecer a conexão…"}</small>
              </span>
              {instances[a.id]?.status === "invalid" && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setAuthAccount(a.id);
                    setState((s) => {
                      s.modal = { kind: "addAccount" };
                    });
                  }}
                >
                  Entrar novamente
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  if (await confirmAction(`Desconectar a conta de ${a.instanceName} deste cliente? Você poderá adicioná-la novamente.`))
                    removeAccount(a.id);
                }}
              >
                Desconectar conta
              </Button>
            </div>
          ))}
        </div>
        <Button variant="secondary" onClick={() => reconnect()}>
          <Icon name="refresh" size={16} />
          Tentar agora
        </Button>
        <span className="muted small" role="status">
          Reconexão automática em andamento
        </span>
      </DialogContent>
    </Dialog>
  );
}
