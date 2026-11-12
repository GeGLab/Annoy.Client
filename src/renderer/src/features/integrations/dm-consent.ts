import type { DmMessage } from "../../social/types.ts";
import type { DmLink } from "./state.ts";

/** Consent is carried by encrypted conversation messages; the account copy is a cache. */
export function resolveDmLinks(cached: Readonly<Record<string, DmLink>> | undefined, messages: readonly DmMessage[]): Record<string, DmLink> {
  const links: Record<string, DmLink> = { ...cached };
  for (const message of [...messages].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    const meta = message.integration;
    if (message.state || !meta || meta.op === "reply") continue;
    const link = links[meta.id];
    if (link?.controlId && message.id <= link.controlId) continue;
    const control = { name: meta.name, controlId: message.id };
    if (meta.op === "request") {
      if (!link || link.status === "pending") links[meta.id] = { owner: message.senderId, status: "pending", ...control };
    } else if (meta.op === "accept") {
      if (link?.status === "pending" && link.owner !== message.senderId) links[meta.id] = { ...link, status: "active", ...control };
    } else if (meta.op === "decline") {
      if (link?.status === "pending" && link.owner !== message.senderId) delete links[meta.id];
    } else delete links[meta.id];
  }
  return links;
}
