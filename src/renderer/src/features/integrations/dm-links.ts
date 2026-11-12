import { useMemo } from "react";
import { useStore } from "../../store.ts";
import { useIntegrations } from "./state.ts";
import { resolveDmLinks } from "./dm-consent.ts";

export function useDmLinks(conversationId: string) {
  const cached = useIntegrations(s => s.account.dms[conversationId]);
  const items = useStore(s => s.social.threads[conversationId]?.items);
  return useMemo(() => resolveDmLinks(cached, items ?? []), [cached, items]);
}
