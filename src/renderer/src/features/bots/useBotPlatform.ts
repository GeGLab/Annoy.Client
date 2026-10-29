import { useCallback, useEffect, useRef, useState } from "react";
import { apiFor } from "../../client.ts";
import { loadBotPlatform, UnsupportedBotPlatform } from "./api.ts";
import type { BotPlatformSnapshot } from "./types.ts";
import { RequestError } from "../../api.ts";

export function useBotPlatform(accountId: string, serverId: string) {
  const [snapshot, setSnapshot] = useState<BotPlatformSnapshot | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "unsupported" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const mounted = useRef(false);
  const request = useRef<AbortController | null>(null);
  const mutation = useRef(false);
  const supported = useRef(false);
  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    try {
      const data = await loadBotPlatform(apiFor(accountId), serverId, AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]));
      if (!mounted.current || controller.signal.aborted) return;
      supported.current = true;
      setSnapshot(data);
      setStatus("ready");
      setError(null);
    } catch (error) {
      if (!mounted.current || controller.signal.aborted) return;
      setStatus(error instanceof UnsupportedBotPlatform ? "unsupported" : "error");
      setError((error as Error).message || "Não foi possível carregar a loja. Tente novamente.");
    }
  }, [accountId, serverId]);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const timer = setInterval(() => {
      if (supported.current && !document.hidden && !mutation.current) void refresh();
    }, 15_000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
      request.current?.abort();
    };
  }, [refresh]);
  const run = async (id: string, action: () => Promise<void>) => {
    if (mutation.current) return false;
    request.current?.abort();
    mutation.current = true;
    setBusy(id);
    setError(null);
    try {
      await action();
      if (mounted.current) await refresh();
      return true;
    } catch (error) {
      if (mounted.current) {
        setStatus("error");
        setError(
          "Não foi possível confirmar a operação. Ela pode ter sido aplicada no servidor. Atualize o estado antes de tentar novamente.",
        );
        if (error instanceof RequestError && (error.status === 401 || error.status === 403)) {
          await refresh();
          if (mounted.current) setError("A instância recusou a alteração. Suas permissões foram consultadas novamente.");
        }
      }
      return false;
    } finally {
      mutation.current = false;
      if (mounted.current) setBusy(null);
    }
  };
  return { snapshot, status, error, busy, refresh, run };
}
