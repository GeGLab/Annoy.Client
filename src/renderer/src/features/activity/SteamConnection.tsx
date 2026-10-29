import { useEffect, useRef, useState } from "react";
import type { SteamConnectionStatus, SteamLinkBegin, SteamLinkPoll } from "@distopic/protocol";
import { apiFor } from "../../client.ts";
import { useStore } from "../../store.ts";
import { Button } from "../../components/ui/button.tsx";
import { ProviderIcon } from "./ProviderIcon.tsx";
import { PreferenceCard } from "../../components/settings/PreferenceCard.tsx";
import { ActivityCard } from "./ActivityCard.tsx";

export function SteamConnection({ accountId }: { accountId: string }) {
  const account = useStore((s) => s.accounts.find((item) => item.id === accountId));
  const supported = useStore((s) => s.instances[accountId]?.instance?.steamConnection);
  const ownGame = useStore((s) => {
    const instance = s.instances[accountId];
    if (!s.settings.shareActivity || s.desktopActivity?.activities.some((a) => a.kind === "game") || !instance?.user) return undefined;
    return instance.activities[instance.user.id]?.find((a) => a.kind === "game");
  });
  const [status, setStatus] = useState<SteamConnectionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!supported) return;
    const abort = new AbortController();
    void apiFor(accountId).request<SteamConnectionStatus>("GET", "/users/@me/steam", undefined, abort.signal)
      .then(setStatus).catch((error) => { if (!abort.signal.aborted) setError(error.message); });
    return () => { abort.abort(); controller.current?.abort(); };
  }, [accountId, supported]);

  const connect = async () => {
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true); setWaiting(true); setError(null);
    try {
      const api = apiFor(accountId);
      const { url, handoff } = await api.request<SteamLinkBegin>("POST", "/auth/steam/begin", {}, abort.signal);
      window.open(url, "_blank");
      const deadline = Date.now() + 10 * 60_000;
      while (Date.now() < deadline) {
        await new Promise<void>((resolve) => {
          const done = () => { clearTimeout(timer); abort.signal.removeEventListener("abort", done); resolve(); };
          const timer = setTimeout(done, 1500);
          abort.signal.addEventListener("abort", done, { once: true });
        });
        abort.signal.throwIfAborted();
        const result = await api.request<SteamLinkPoll>("POST", "/auth/steam/poll", { handoff }, abort.signal);
        if (result.status === "error") throw new Error(result.message);
        if (result.status === "done") {
          setStatus(await api.request<SteamConnectionStatus>("GET", "/users/@me/steam", undefined, abort.signal));
          window.dispatchEvent(new Event("steam-connection-changed"));
          return;
        }
      }
      throw new Error("Tempo esgotado esperando a Steam. Tente novamente.");
    } catch (error) {
      if (!abort.signal.aborted) setError((error as Error).message);
    } finally {
      if (controller.current === abort) { controller.current = null; setBusy(false); setWaiting(false); }
    }
  };
  const disconnect = async () => {
    controller.current?.abort();
    controller.current = null;
    setWaiting(false);
    setBusy(true); setError(null);
    try {
      setStatus(await apiFor(accountId).del<SteamConnectionStatus>("/users/@me/steam"));
      window.dispatchEvent(new Event("steam-connection-changed"));
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  };
  if (!account || !supported) return null;
  return <PreferenceCard icon="radio" title={`Steam · ${account.instanceName}`} description="Conecte sua conta pelo navegador para complementar a detecção local. Sua senha fica na Steam. O vínculo vale para esta conta nesta instância.">
    {status?.connection && <p className="row"><ProviderIcon provider="steam" /><a href={status.connection.profileUrl} target="_blank" rel="noreferrer">Perfil Steam · {status.connection.steamId}</a></p>}
    {status?.connection && ownGame && <ActivityCard activity={ownGame} />}
    {status && <p className="muted small">{status.onlineActivityAvailable ? "Com o compartilhamento ativado, o jogo público da Steam aparece quando nenhum jogo local é detectado. Perfis privados podem não informar atividade." : "Conta pode ser vinculada. Para consultar atividade online, o administrador precisa configurar a integração Steam na instância. A detecção local já funciona sem isso."}</p>}
    <div className="row">
      {status && !status.connection && !busy && <Button variant="secondary" size="sm" onClick={() => void connect()}>Conectar Steam</Button>}
      {waiting && <Button variant="secondary" size="sm" onClick={() => { void disconnect(); }}>Cancelar conexão Steam</Button>}
      {status?.connection && !waiting && <Button variant="secondary" size="sm" disabled={busy} onClick={() => void disconnect()}>Desconectar Steam</Button>}
      {!status && error && <Button variant="secondary" size="sm" onClick={() => { void apiFor(accountId).get<SteamConnectionStatus>("/users/@me/steam").then(setStatus).catch((error) => setError(error.message)); }}>Tentar novamente</Button>}
    </div>
    {waiting && <p role="status" className="muted small">Conclua a autorização no navegador.</p>}
    {error && <p className="error small" role="alert">{error}</p>}
  </PreferenceCard>;
}
