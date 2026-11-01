import { useEffect, useState } from "react";
import type { ProfileDetails } from "@distopic/protocol";
import { apiFor } from "../../client.ts";
import { useStore } from "../../store.ts";
import { isCancellation, RequestError } from "../../../../shared/requests.ts";

export function useProfileDetails(
  accountId: string,
  userId: string,
  enabled = true,
) {
  const revision = useStore(
    (s) => s.instances[accountId]?.profileRevision ?? 0,
  );
  const connected = useStore((s) => s.instances[accountId]?.status === "ready");
  const supported = useStore(
    (s) => s.instances[accountId]?.instance?.profileDetails === true,
  );
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    details?: ProfileDetails;
    error?: string;
    unavailable?: boolean;
  } | null>(null);
  const key = JSON.stringify([accountId, userId, revision, attempt, connected]);
  useEffect(() => {
    if (!enabled || !connected || !supported) return;
    const controller = new AbortController();
    void apiFor(accountId)
      .get<ProfileDetails>(
        `/users/${encodeURIComponent(userId)}/profile`,
        controller.signal,
      )
      .then((details) => {
        if (!controller.signal.aborted) setResult({ key, details });
      })
      .catch((error) => {
        if (!controller.signal.aborted && !isCancellation(error))
          setResult({
            key,
            error: (error as Error).message,
            unavailable: error instanceof RequestError && error.status === 404,
          });
      });
    return () => controller.abort();
  }, [key, enabled, supported]);
  const current = result?.key === key ? result : null;
  return {
    details: enabled && connected ? current?.details : undefined,
    error: current?.error,
    unavailable: current?.unavailable,
    loading: enabled && connected && supported && !current,
    supported,
    connected,
    retry: () => setAttempt((value) => value + 1),
  };
}
